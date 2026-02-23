/* ──────────────────────────────────────────────────────────────
   printingService.js
   - Robust build-name parser (2–4 digit case numbers, fuzzy qualities/parts)
   - Tracker: leases printers, scrapes current job + percent, links to UUIDs
   - Live pub/sub for UI; optional history write when completed
   ─────────────────────────────────────────────────────────── */

import { db, logCase } from "./caseService";

/* ----------------------------- Parser ----------------------------- */

export const CANON_QUALITIES = ["signature", "premium", "basic", "economy"];
export const CANON_PARTS = [
  "teeth",
  "base",
  "try-in",
  "model",
  "tray",
  "crown",
];

const QUALITY_SYNONYMS = {
  signature: ["signature", "sig", "sign", "signiture", "sig.", "signaturee"],
  premium: ["premium", "prem", "prm", "prem.", "premuim", "premiun", "priemum"],
  basic: ["basic", "bas", "basc", "baisc", "basicc"],
  economy: ["economy", "econ", "eco", "econom", "econmy", "economi", "eco."],
};

const PART_SYNONYMS = {
  teeth: ["teeth", "tooth", "teet", "teeh", "t"],
  base: ["base", "bas", "baes", "bsae", "b"], // lone "b" = base; b1/b2 are shades
  "try-in": [
    "try-in",
    "tryin",
    "try",
    "tr-in",
    "try in",
    "try  in",
    "ti",
    "monoblock",
    "mono block",
    "monoblok",
    "monoblk",
    "monob",
  ],
  model: ["model", "mdl", "modl", "mdel"],
  tray: ["tray", "trai", "tay"],
  crown: ["crown", "cron", "crwn"],
};

const RUSH_SYNONYMS = [
  "rush",
  "superrush",
  "super-rush",
  "priority",
  "stat",
  "urgent",
  "hot",
];

const SHADE_RE = /^(?:[abcd][1-4]|bl[1-4]|b[1-4])$/i; // A1–D4, BL1–BL4, B1–B4
const CASE_NUM_RE = /^\d{2,4}$/;

// tiny Levenshtein
function lev(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}
function fuzzyMatch(token, candidates) {
  const t = token.toLowerCase();
  let best = null,
    bestD = Infinity;
  for (const c of candidates) {
    const d = lev(t, c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
    if (d === 0) break;
  }
  const threshold = t.length <= 4 ? 1 : 2;
  return bestD <= threshold ? best : null;
}

function normalize(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[_\-\/,.;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function foldMulti(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i],
      b = tokens[i + 1];
    const pair = a && b ? `${a} ${b}` : "";
    if (pair === "try in") {
      out.push("try-in");
      i++;
      continue;
    }
    if (pair === "mono block") {
      out.push("monoblock");
      i++;
      continue;
    }
    if (pair === "super rush") {
      out.push("superrush");
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}
function mapQuality(tok) {
  for (const [canon, syns] of Object.entries(QUALITY_SYNONYMS))
    if (syns.includes(tok)) return canon;
  const flat = Object.entries(QUALITY_SYNONYMS).flatMap(([canon, syns]) =>
    syns.map((s) => ({ canon, s }))
  );
  const hit = flat
    .map((x) => ({ ...x, ok: !!fuzzyMatch(tok, [x.s]) }))
    .find((x) => x.ok);
  return hit ? hit.canon : null;
}
function mapPart(tok) {
  if (tok === "b") return "base";
  for (const [canon, syns] of Object.entries(PART_SYNONYMS))
    if (syns.includes(tok)) return canon;
  const flat = Object.entries(PART_SYNONYMS).flatMap(([canon, syns]) =>
    syns.map((s) => ({ canon, s }))
  );
  const hit = flat
    .map((x) => ({ ...x, ok: !!fuzzyMatch(tok, [x.s]) }))
    .find((x) => x.ok);
  return hit ? hit.canon : null;
}
function isRush(tok) {
  return RUSH_SYNONYMS.includes(tok) || !!fuzzyMatch(tok, RUSH_SYNONYMS);
}

export function parseBuildName(raw, opts = {}) {
  const cfg = { joinTriplets: false, ...opts };
  const out = {
    raw,
    normalized: "",
    tokens: [],
    caseNumbers: [],
    part: null,
    quality: null,
    shade: null,
    rush: false,
    flags: [],
    unknown: [],
  };
  if (!raw || !String(raw).trim()) return out;
  out.normalized = normalize(raw);
  let tokens = foldMulti(out.normalized.split(" ").filter(Boolean));
  out.tokens = [...tokens];

  const residual = [];
  for (const tok of tokens) {
    if (SHADE_RE.test(tok)) {
      out.shade = tok.toUpperCase();
      continue;
    }
    if (!out.quality) {
      const q = mapQuality(tok);
      if (q) {
        out.quality = q;
        continue;
      }
    }
    if (!out.part) {
      const p = mapPart(tok);
      if (p) {
        out.part = p;
        continue;
      }
    }
    if (isRush(tok)) {
      out.rush = true;
      continue;
    }
    residual.push(tok);
  }
  for (const tok of residual)
    CASE_NUM_RE.test(tok) ? out.caseNumbers.push(tok) : out.unknown.push(tok);

  if (
    cfg.joinTriplets &&
    out.caseNumbers.length === 3 &&
    out.caseNumbers.every((n) => n.length === 3)
  ) {
    out.caseNumbers = [out.caseNumbers.join("")];
  }
  if (out.quality) out.flags.push("quality:" + out.quality);
  if (out.shade) out.flags.push("shade:" + out.shade);
  if (out.rush) out.flags.push("rush");
  return out;
}
export function explodeCases(parsed) {
  const rows = [];
  for (const cn of parsed.caseNumbers) {
    rows.push({
      raw: parsed.raw,
      caseNumber: cn,
      part: parsed.part,
      quality: parsed.quality,
      shade: parsed.shade,
      rush: parsed.rush,
      flags: parsed.flags,
    });
  }
  return rows;
}

/* ----------------------------- Tracker ----------------------------- */

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(evt) {
  for (const f of listeners) f(evt);
}
export function getLiveSnapshot() {
  const out = {};
  for (const [k, v] of liveByCase) out[k] = JSON.parse(JSON.stringify(v));
  return out;
}

const liveByCase = new Map(); // { caseNumber: { teeth: {percent, printerName}, base: {...}, ... } }
let loopFlag = false;
const holderId =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

// Supabase helpers
async function resolveLatestCaseId(caseNumber) {
  const { data } = await db.rpc("resolve_latest_case_id", {
    p_casenumber: String(caseNumber),
  });
  return data ?? null;
}
async function addModifier(caseId, mod) {
  const { data } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();
  const mods = Array.isArray(data?.modifiers) ? [...data.modifiers] : [];
  if (!mods.includes(mod)) mods.push(mod);
  await db.from("cases").update({ modifiers: mods }).eq("id", caseId);
}
async function swapModifiers(caseId, removeMod, addMod) {
  const { data } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();
  const mods = Array.isArray(data?.modifiers)
    ? data.modifiers.filter((m) => m !== removeMod)
    : [];
  if (addMod && !mods.includes(addMod)) mods.push(addMod);
  await db.from("cases").update({ modifiers: mods }).eq("id", caseId);
}
async function setStage(caseId, stage) {
  const { data } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();
  const mods = (data?.modifiers ?? []).filter((m) => !m.startsWith("stage-"));
  mods.push(`stage-${stage}`);
  await db.from("cases").update({ modifiers: mods }).eq("id", caseId);
  await logCase(caseId, `Moved to ${stage} stage`);
}
async function tryPromoteToFinishing(caseId) {
  const { data } = await db
    .from("cases")
    .select("modifiers")
    .eq("id", caseId)
    .single();
  const mods = data?.modifiers ?? [];
  const hasTeeth = mods.includes("printed-teeth");
  const hasBase = mods.includes("printed-base");
  if (hasTeeth && hasBase) {
    const { error } = await db
      .from("case_stage_events")
      .insert({ case_id: caseId, event: "printing_complete_to_finishing" });
    if (!error) {
      await setStage(caseId, "finishing");
      await logCase(caseId, "Printing complete – moved to Finishing");
    }
  }
}

// percent extractors: "63%" or "Layer 123/600"
const PCT_RE = /(\d{1,3})\s?%/;
const LAYER_RE = /Layer\s+(\d+)\s*\/\s*(\d+)/i;
function pickProgress(html) {
  const m1 = html.match(PCT_RE);
  if (m1) return Math.max(0, Math.min(100, Number(m1[1])));
  const m2 = html.match(LAYER_RE);
  if (m2) {
    const cur = Number(m2[1]),
      tot = Number(m2[2]);
    if (tot > 0)
      return Math.max(0, Math.min(100, Math.round((cur / tot) * 100)));
  }
  return null;
}

// default HTML job source (browser)
async function defaultJobSource({ base_url }) {
  const [root, queue] = await Promise.all([
    fetch(base_url, { cache: "no-store" }).then((r) => r.text()),
    fetch(base_url + "/queue", { cache: "no-store" })
      .then((r) => r.text())
      .catch(() => ""),
  ]);

  // current name cell heuristics
  const name =
    root.match(/Build Name[^<:\n]*[:\-]\s*([^<\n]+)/i)?.[1]?.trim() ||
    root
      .match(/<td[^>]*>\s*Build Name\s*<\/td>\s*<td[^>]*>([^<]+)/i)?.[1]
      ?.trim() ||
    null;

  const progress = pickProgress(root);

  // very loose queue scrape
  const queued = [];
  const tdRe = /<td[^>]*>\s*([^<\n]+)\s*<\/td>/gi;
  let m;
  while ((m = tdRe.exec(queue))) {
    const txt = m[1].trim().toLowerCase();
    if (!txt) continue;
    if (txt === "order" || txt === "build name") continue;
    if (txt.length > 64) continue;
    queued.push(m[1].trim());
  }

  return { current: name, currentProgress: progress, queued };
}

async function claimLease(printerName) {
  // If RPC isn’t present, just say “true” so single-instance sites still work.
  const { data, error } = await db
    .rpc("claim_printer_lease", {
      p_printer_name: printerName,
      p_holder_id: holderId,
      p_ttl_seconds: 45,
    })
    .catch(() => ({ data: true, error: null }));
  return error ? false : !!data;
}

function jobKey(raw) {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h.toString(16);
}

async function recordCompleted(printer, parsed) {
  const rows = explodeCases(parsed);
  for (const r of rows) {
    const linked = r.caseNumber
      ? await resolveLatestCaseId(r.caseNumber)
      : null;
    await db.from("case_print_jobs").upsert(
      {
        printer_id: printer.id,
        job_key: jobKey(parsed.raw),
        job_name: parsed.raw,
        case_number: r.caseNumber ?? null,
        linked_case_id: linked,
        part: r.part ?? null,
        shade: r.shade ?? null,
        quality: r.quality ?? null,
        rush: !!r.rush,
        status: "completed",
        completed_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "printer_id,job_key" }
    );

    if (linked && r.part) {
      await swapModifiers(linked, `print-${r.part}`, `printed-${r.part}`);
      await tryPromoteToFinishing(linked);
    }
  }
}

async function tickPrinter(printer, jobSource) {
  // lease so only one instance hits the device
  const haveLease = await claimLease(printer.name);
  if (!haveLease) return;

  const js = jobSource || defaultJobSource;
  const { current, currentProgress, queued } = await js(printer);

  if (current) {
    const parsed = parseBuildName(current, { joinTriplets: false });
    const rows = explodeCases(parsed);

    // live pub/sub without DB writes for percent
    for (const r of rows) {
      if (!r.caseNumber) continue;
      const entry = liveByCase.get(r.caseNumber) || {};
      const key = r.part || "unknown";
      entry[key] = {
        percent: typeof currentProgress === "number" ? currentProgress : null,
        printerName: printer.name,
        updatedAt: Date.now(),
      };
      liveByCase.set(r.caseNumber, entry);
      emit({
        type: "progress",
        caseNumber: r.caseNumber,
        part: key,
        percent: entry[key].percent,
      });
    }

    // reflect minimal DB signals for the stage/chips
    for (const r of rows) {
      if (!r.caseNumber || !r.part) continue;
      const caseId = await resolveLatestCaseId(r.caseNumber);
      if (caseId) {
        await addModifier(caseId, `print-${r.part}`);
        await setStage(caseId, "production");
      }
    }
  }

  // Optional: emit queue preview for the modal
  if (queued?.length)
    emit({ type: "queue", printer: printer.name, jobs: queued.slice(0, 6) });
}

export async function startPrintingTracker({ jobSource } = {}) {
  if (loopFlag) return;
  loopFlag = true;

  const { data: printers } = await db
    .from("printers")
    .select("id,name,base_url")
    .order("name");
  if (!Array.isArray(printers) || printers.length === 0) return;

  (async function loop() {
    while (loopFlag) {
      await Promise.all(
        printers.map((p) => tickPrinter(p, jobSource).catch(() => {}))
      );
      await new Promise((r) =>
        setTimeout(r, 20000 + Math.floor(Math.random() * 2500))
      ); // jitter
    }
  })();
}

export function stopPrintingTracker() {
  loopFlag = false;
}
