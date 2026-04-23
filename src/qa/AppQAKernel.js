// /src/qa/AppQAKernel.js
// ============================================================================
// APP-WIDE QA ENGINE KERNEL — v4.0.0
// ----------------------------------------------------------------------------
// Changes vs v3.1:
//   - Concept-based routing with lemmatization + synonym expansion (no more
//     substring includes() false positives)
//   - Hard `requires` gates per component (kills noisy competing matches)
//   - Softmax-normalized confidence with ambiguity detection + clarification
//   - Entity extractor fixed: case numbers require case-y context,
//     timeframe numbers ("last 30 days") no longer become case numbers
//   - Conversation state: follow-ups ("why?", "and?", "tell me more") route
//     to the last component and preserve entities
//   - quickStats() bug fixed (Supabase `count` field, not `data.length`)
//   - Dead multi-component orchestration code removed
//   - Stage modifier strings moved to CONFIG
//   - One centralized no-data fallback instead of 8 copies
//   - Responses trimmed ~50% and data-forward (glanceable numbers first)
//   - Button rotation: don't repeat the same CTA two responses in a row
// ============================================================================

import { db } from "../services/caseService";

// ============================================================================
// CONFIG
// ============================================================================
const CONFIG = {
  VERSION: "4.2.3",
  CACHE_TTL_MS: 5 * 60 * 1000,
  MAX_CONTEXT_TURNS: 30,
  MAX_BUTTONS: 4,
  DEFAULT_DEPARTMENT: "General",

  ROUTING: {
    MIN_CONFIDENCE: 0.35,      // softmax prob required to pick a primary
    AMBIGUOUS_MARGIN: 0.12,    // top - second below this → ambiguous
    FOLLOWUP_WINDOW_TURNS: 3,  // follow-ups within N turns reuse last component
    SOFTMAX_TEMP: 0.55,        // lower = sharper distribution
    BUTTON_COOLDOWN_TURNS: 2,  // don't show the same CTA within N turns
  },

  DEBUG: {
    SHOW_ROUTING: true,
    SHOW_SCORES: false,
  },

  SCORING: {
    ON_TIME_WEIGHT: 0.6,
    VELOCITY_WEIGHT: 0.4,
    LATE_PENALTY_PER_CASE: 2.5,
    EARLY_BONUS_PER_DAY: 0.5,
    MAX_EARLY_BONUS: 2.0,
    ON_TIME_TARGET: 85,
    VELOCITY_TARGET: 80,
  },

  BUFFERS: { design: 2, production: 1, finishing: 0, qc: 0 },

  STAGE_MODIFIERS: {
    design: "stage-design",
    production: "stage-production",
    finishing: "stage-finishing",
    qc: "stage-qc",
  },
  CASE_TYPE_MODIFIERS: ["bbs", "flex", "general"],

  KNOWN_TABLES: ["cases", "case_history", "active_devices"],

  UI_COMMANDS: {
    button: "[ACTION:Label|Command]",
    modal: "[MODAL:NAME|arg1|arg2|...]",
  },
};

// ============================================================================
// UTILITIES
// ============================================================================
const U = {
  now: () => new Date(),
  daysBetween: (a, b) => Math.floor((a - b) / 86400000),
  hoursBetween: (a, b) => Math.floor((a - b) / 3600000),
  toLower: (s) => (s || "").toLowerCase(),
  titleCase: (s) => (s || "").replace(/\b[a-z]/g, (m) => m.toUpperCase()),
  clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
  uniq: (a) => [...new Set(a || [])],
  compact: (a) => (a || []).filter(Boolean),
  pct: (x) => Math.max(0, Math.min(100, Number(x) || 0)),

  cleanText: (t) => String(t || "").replace(/\n{3,}/g, "\n\n").trim(),

  formatDuration(ms) {
    if (!ms || ms <= 0 || !isFinite(ms)) return "not available";
    const h = ms / 3600000;
    if (h < 1) {
      const m = Math.round(ms / 60000);
      return `${m} min${m !== 1 ? "s" : ""}`;
    }
    if (h < 24) {
      const hh = Math.floor(h);
      const mm = Math.round((h - hh) * 60);
      return mm === 0
        ? `${hh} hr${hh !== 1 ? "s" : ""}`
        : `${hh}h ${mm}m`;
    }
    const d = Math.floor(h / 24);
    const rh = Math.round(h % 24);
    return rh === 0 ? `${d}d` : `${d}d ${rh}h`;
  },

  formatNumber: (n) =>
    n === null || n === undefined ? "unknown" : n.toLocaleString(),

  formatPercent: (n) =>
    n === null || n === undefined || isNaN(n) ? "unknown" : `${n.toFixed(1)}%`,

  relativeTime(date) {
    if (!date) return "unknown";
    const now = new Date();
    const then = new Date(date);
    const diff = now - then;
    const h = diff / 3600000;
    if (h < 1) {
      const m = Math.round(diff / 60000);
      return `${m} min${m !== 1 ? "s" : ""} ago`;
    }
    if (h < 24) {
      const hh = Math.round(h);
      return `${hh} hr${hh !== 1 ? "s" : ""} ago`;
    }
    const d = Math.round(h / 24);
    if (d < 7) return `${d} day${d !== 1 ? "s" : ""} ago`;
    return then.toLocaleDateString();
  },

  // Parse a due-date value into a normalized shape:
  //   { calendarDay: "M/D/YYYY", deadlineTs: <ms>, isPlainDate: bool }
  // The DB stores `due` sometimes as a plain date string ("2026-04-23") and
  // sometimes as a full timestamp. A plain date parsed via `new Date(...)`
  // becomes midnight UTC, which in a negative-offset timezone (e.g. MST) is
  // the PREVIOUS calendar day — that's why "due 4/23" was rendering as
  // "4/22" and triggering a false overdue. Parsing the YYYY-MM-DD parts by
  // hand avoids the timezone flip. For plain dates we treat end-of-day in
  // the local timezone as the implicit deadline.
  parseDueDate(value) {
    if (!value) return null;
    const s = String(value);
    const plainDateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]00:00(?::00(?:\.000)?)?(?:Z|\+00:?00)?)?$/);
    if (plainDateMatch) {
      const [, y, m, d] = plainDateMatch;
      const month = Number(m);
      const day = Number(d);
      const year = Number(y);
      const deadline = new Date(year, month - 1, day, 23, 59, 59, 999);
      return {
        calendarDay: `${month}/${day}/${year}`,
        deadlineTs: deadline.getTime(),
        isPlainDate: true,
      };
    }
    const asDate = new Date(s);
    if (isNaN(asDate.getTime())) return null;
    return {
      calendarDay: asDate.toLocaleDateString("en-US"),
      deadlineTs: asDate.getTime(),
      isPlainDate: false,
    };
  },

  // Render a due-date value as "M/D/YYYY" without any TZ shift for plain
  // dates. Null-safe.
  formatDueDate(value) {
    const parsed = U.parseDueDate(value);
    return parsed ? parsed.calendarDay : "unknown";
  },

  async safeDb(q) {
    try {
      if (!db) return { data: null, error: "Database not initialized" };
      const out = await q;
      if (out?.error) return { data: null, error: out.error, count: out.count };
      return out;
    } catch (e) {
      console.error("[QAKernel:DB] Exception", e);
      return { data: null, error: e?.message || String(e) };
    }
  },

  stageFromCase(row) {
    const mods = row?.modifiers || [];
    for (const [stage, mod] of Object.entries(CONFIG.STAGE_MODIFIERS)) {
      if (mods.includes(mod)) return stage === "qc" ? "quality control" : stage;
    }
    return "unassigned";
  },

  caseTypeFromModifiers(mods) {
    if (!Array.isArray(mods)) return "general";
    for (const t of CONFIG.CASE_TYPE_MODIFIERS) {
      if (t !== "general" && mods.includes(t)) return t;
    }
    return "general";
  },

  scoreToRating(s) {
    if (s >= 90) return "excellent";
    if (s >= 80) return "very good";
    if (s >= 70) return "good";
    if (s >= 60) return "fair";
    if (s >= 50) return "needs improvement";
    return "critical";
  },

  riskToWords(p) {
    if (p >= 0.8) return "very likely to be late";
    if (p >= 0.6) return "likely to be late";
    if (p >= 0.4) return "at moderate risk";
    if (p >= 0.2) return "at low risk";
    return "on track";
  },
};

// ============================================================================
// NORMALIZATION — tokenize, lemmatize, strip punctuation
// ============================================================================
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "will", "would", "could",
  "should", "can", "may", "might", "must", "i", "me", "my", "mine",
  "you", "your", "yours", "we", "our", "to", "of", "in", "on", "at",
  "for", "with", "as", "by", "from", "this", "that", "these", "those",
  "and", "or", "but", "so", "if", "when", "then", "just", "only",
  "very", "really", "quite", "please",
]);

// Negation tokens — NOT stripped; used downstream
const NEGATIONS = new Set([
  "no", "not", "never", "none", "n't", "dont", "don't", "doesnt", "doesn't",
  "isnt", "isn't", "arent", "aren't", "wasnt", "wasn't", "werent", "weren't",
  "cant", "can't", "cannot", "wont", "won't", "without",
]);

// Lemmatization rules (applied in order, first match wins).
// Goal: collapse surface variants to the same stem (stem need not be a real word).
const LEMMA_RULES = [
  [/ies$/, "y"],
  [/ying$/, "y"],
  [/ing$/, ""],
  [/ed$/, ""],
  [/es$/, ""],
  [/s$/, ""],
];

function lemma(word) {
  let w = word;
  if (w.length < 4) return w;
  for (const [re, repl] of LEMMA_RULES) {
    if (re.test(w)) {
      w = w.replace(re, repl);
      break;
    }
  }
  // Collapse trailing-e variants: "improve"/"improv", "case"/"cas"
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

function tokenize(text) {
  const raw = String(text || "").toLowerCase();
  // Preserve contractions by keeping apostrophes inside words
  const parts = raw
    .replace(/[^a-z0-9'\s#-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return parts;
}

function normalize(text) {
  const tokens = tokenize(text);
  const lemmas = [];
  const kept = [];
  let hasNegation = false;

  for (const t of tokens) {
    if (NEGATIONS.has(t)) {
      hasNegation = true;
      continue;
    }
    if (STOPWORDS.has(t)) continue;
    const l = lemma(t);
    lemmas.push(l);
    kept.push(t);
  }

  return {
    raw: text,
    lower: String(text || "").toLowerCase().trim(),
    tokens,       // original surface tokens
    lemmas,       // stemmed, stopwords removed
    lemmaSet: new Set(lemmas),
    hasNegation,
    length: tokens.length,
  };
}

// ============================================================================
// CONCEPTS — canonical groups of synonym stems
// ============================================================================
function buildConcepts(raw) {
  const out = {};
  for (const [name, words] of Object.entries(raw)) {
    out[name] = new Set(words.map(lemma));
  }
  return out;
}

const CONCEPTS = buildConcepts({
  // Performance / scoring
  SCORE: ["score", "rating", "grade", "mark", "number"],
  EFFICIENCY: ["efficiency", "performance", "productivity"],
  VELOCITY: ["velocity", "speed", "pace", "throughput"],
  ONTIME: ["ontime", "on-time"],
  STATUS: ["status", "overview", "update", "doing", "going", "report"],

  // Improvement
  IMPROVE: ["improve", "better", "boost", "raise", "increase", "enhance", "lift", "gain", "fix", "solve", "address", "tackle", "resolve"],
  RECOMMEND: ["recommend", "suggest", "advice", "tip", "advise", "should"],

  // Problems
  PROBLEM: ["problem", "issue", "trouble", "concern", "wrong", "matter", "attention", "pain", "challenge", "difficulty", "broken"],

  // Risk
  RISK: ["risk", "risky", "danger", "dangerous", "critical", "urgent"],
  LATE: ["late", "overdue", "behind", "delayed", "tardy"],
  EARLY: ["early", "ahead", "soon", "sooner"],

  // Trends
  TREND: ["trend", "pattern", "history", "historical", "direction"],
  TIME: ["today", "yesterday", "tomorrow", "week", "month", "recently", "lately", "now"],
  CHANGE: ["change", "drop", "went", "gone", "decrease", "declining", "improving", "shift"],

  // Bottleneck
  BOTTLENECK: ["bottleneck", "stuck", "blocked", "congestion", "backup", "piling", "slowdown", "slowing", "jam"],
  SLOW: ["slow", "slower", "sluggish", "lag"],

  // Scenario
  WHATIF: ["suppose", "imagine", "simulate", "scenario", "hypothetical", "project"],
  IMPACT: ["impact", "affect", "effect"],

  // Explanation — "how" is intentionally NOT in this list; it's too generic
  // a question word. Phrase matches like "how is X calculated" do the work.
  EXPLAIN: ["explain", "reason", "why", "breakdown", "calculate", "calculation", "clarify", "describe"],

  // Brief / summary
  BRIEF: ["brief", "briefing", "summary", "digest", "recap"],
  MORNING: ["morning", "daily", "today", "start"],

  // Case lookup
  CASE: ["case"],
  LOOKUP: ["find", "look", "lookup", "show", "display", "get", "tell", "about", "info", "information", "detail"],

  // Schema/debug
  SCHEMA: ["schema", "table", "database", "model", "structure"],
  DEBUG: ["debug", "trace", "routing", "component"],

  // Help / greeter
  GREET: ["hi", "hello", "hey", "sup", "greetings", "yo", "howdy"],
  HELP: ["help", "assist", "guide", "capability", "capable"],

  // Capability extensions (v4.1)
  TYPE_COMPARE: ["compare", "comparison", "versus", "vs", "between"],
  CASE_TYPE: ["bbs", "flex", "general", "type", "kind"],
  BUFFER: ["buffer", "handoff", "compliance", "transition"],
  RUSH: ["rush", "priority", "urgent"],
  QUALITY: ["confidence", "reliable", "reliability", "trust", "trustworthy", "sample"],
  BREAKDOWN: ["breakdown", "split", "by", "per"],
});

function matchConcept(n, concept) {
  if (!concept) return false;
  for (const l of n.lemmaSet) {
    if (concept.has(l)) return true;
  }
  return false;
}

function conceptStrength(n, concept) {
  // number of distinct lemma hits, capped
  if (!concept) return 0;
  let hits = 0;
  for (const l of n.lemmaSet) {
    if (concept.has(l)) hits++;
  }
  return Math.min(hits, 3);
}

// ============================================================================
// ENTITY EXTRACTION — format-aware, context-sensitive
// ============================================================================
function extractEntities(text, n) {
  const lower = n.lower;
  const tokens = n.tokens;
  const out = {
    caseNumbers: [],
    scenarioCounts: [],   // numbers adjacent to "late"/"early"
    timeWindows: [],      // { amount, unit } from "last 30 days" etc.
    stages: [],
    caseTypes: [],
    timeframes: [],
    hasNegation: n.hasNegation,
  };

  // Case numbers: explicit "case <N>", "#<N>", or 5+ digit bare numbers.
  //  - 2-4 digit bare numbers are too ambiguous (dates, counts, etc.)
  const explicit = [...lower.matchAll(/(?:case|#)\s*#?\s*([a-z0-9-]{2,20})/gi)];
  for (const m of explicit) {
    const cand = m[1];
    // Don't capture if it looks like a time amount
    if (/^\d+$/.test(cand)) out.caseNumbers.push(cand);
    else if (/^[a-z0-9-]+$/i.test(cand) && /\d/.test(cand)) out.caseNumbers.push(cand);
  }
  // Bare long numbers (5+ digits) — most real case numbers; too long to be dates/counts
  const bare = lower.match(/\b\d{5,}\b/g) || [];
  for (const b of bare) {
    if (!out.caseNumbers.includes(b)) out.caseNumbers.push(b);
  }

  // Time windows: "last 7 days", "past 30 days", "in 2 weeks"
  const tw = [...lower.matchAll(
    /\b(?:last|past|next|in|over\s+the)\s+(\d+)\s+(day|days|week|weeks|month|months|hour|hours)\b/g
  )];
  for (const m of tw) {
    out.timeWindows.push({ amount: parseInt(m[1], 10), unit: m[2].replace(/s$/, "") });
  }
  const timeNumbers = new Set(tw.map((m) => m[1]));

  // Scenario counts. Several phrasings:
  //   "3 cases go late"        — N cases <verb> (late|early|...)
  //   "what if 3 cases complete 2 days early" — N cases <verb> <days> early
  //   "if 10 late"              — short form
  const sc1 = [...lower.matchAll(
    /\b(\d+)\s+(?:case|cases)\s+(?:go|goes|are|were|turn|turns|complete|completes|finish|finishes|end|ends)?\s*(?:\d+\s+days?\s+)?(late|early|overdue|ahead)\b/g
  )];
  for (const m of sc1) {
    out.scenarioCounts.push({ count: parseInt(m[1], 10), direction: m[2] });
    timeNumbers.add(m[1]);
  }
  // Fallback: "what if/if N ... late/early" anywhere in the sentence
  if (out.scenarioCounts.length === 0) {
    const sc2 = [...lower.matchAll(/\b(?:what\s+if|if|suppose)\s+(\d+)\b[^.?!]*?\b(late|early|overdue|ahead)\b/g)];
    for (const m of sc2) {
      out.scenarioCounts.push({ count: parseInt(m[1], 10), direction: m[2] });
      timeNumbers.add(m[1]);
    }
  }

  // Remove time/scenario numbers from caseNumbers if anything slipped through
  out.caseNumbers = out.caseNumbers.filter((c) => !timeNumbers.has(c));

  // Stages (word-boundary)
  const stageMap = [
    { re: /\bdesign\b/, stage: "design" },
    { re: /\bproduction\b/, stage: "production" },
    { re: /\bfinishing\b/, stage: "finishing" },
    { re: /\b(qc|quality\s+control|quality)\b/, stage: "qc" },
  ];
  for (const { re, stage } of stageMap) {
    if (re.test(lower)) out.stages.push(stage);
  }

  // Case types
  if (/\bbbs\b/.test(lower)) out.caseTypes.push("bbs");
  if (/\b(flex|3d\s*flex)\b/.test(lower)) out.caseTypes.push("flex");

  // Timeframes (keyword tokens)
  const tfs = ["today", "yesterday", "tomorrow", "this week", "last week", "next week",
    "this month", "last month", "recently", "lately", "now"];
  for (const tf of tfs) if (lower.includes(tf)) out.timeframes.push(tf);

  return out;
}

// ============================================================================
// TTL CACHE
// ============================================================================
class TTLCache {
  constructor(ttlMs = CONFIG.CACHE_TTL_MS) {
    this.ttl = ttlMs;
    this.map = new Map();
  }
  get(k) {
    const v = this.map.get(k);
    if (!v) return null;
    if (Date.now() - v.t > this.ttl) { this.map.delete(k); return null; }
    return v.d;
  }
  set(k, d) { this.map.set(k, { d, t: Date.now() }); }
  clear() { this.map.clear(); }
  has(k) { return this.get(k) !== null; }
}
const Cache = new TTLCache();

// ============================================================================
// BUTTON MANAGER + RESPONSE BUILDER
// ============================================================================
class ButtonManager {
  constructor() {
    this.recent = [];  // [{ cmd, turn }]
  }
  format(label, command) { return `[ACTION:${label}|${command}]`; }
  build(pairs) {
    const list = (pairs || []).filter(Boolean).slice(0, CONFIG.MAX_BUTTONS);
    if (!list.length) return "";
    return "\n\n" + list.map(([l, c]) => this.format(l, c)).join(" ");
  }
  // Remove duplicates within one response, and buttons shown recently
  filter(pairs, currentTurn = 0) {
    const seen = new Set();
    const cooldown = CONFIG.ROUTING.BUTTON_COOLDOWN_TURNS;
    const recentCmds = new Set(
      this.recent.filter((r) => currentTurn - r.turn <= cooldown).map((r) => r.cmd)
    );
    const out = [];
    for (const [l, c] of pairs || []) {
      const key = (c || "").toLowerCase().trim();
      if (seen.has(key)) continue;
      if (recentCmds.has(key) && out.length >= 2) continue;
      seen.add(key);
      out.push([l, c]);
    }
    return out;
  }
  record(pairs, turn) {
    for (const [, c] of pairs || []) {
      this.recent.push({ cmd: (c || "").toLowerCase().trim(), turn });
    }
    // trim
    if (this.recent.length > 40) this.recent = this.recent.slice(-40);
  }
}
const Buttons = new ButtonManager();

class ResponseBuilder {
  constructor() { this.parts = []; this.buttons = []; this.metadata = {}; }
  say(s = "") { if (s) this.parts.push(String(s)); return this; }
  paragraph(s = "") {
    if (this.parts.length > 0) this.parts.push("");
    if (s) this.parts.push(String(s));
    return this;
  }
  line(s = "") { this.parts.push(String(s)); return this; }
  kv(rows) {
    // Compact "label: value" lines for data-forward display
    const lines = rows.filter(Boolean).map(([k, v]) => `• ${k}: ${v}`);
    if (lines.length) {
      if (this.parts.length) this.parts.push("");
      this.parts.push(lines.join("\n"));
    }
    return this;
  }
  addButtons(btns = []) { this.buttons = this.buttons.concat(btns); return this; }
  setMetadata(k, v) { this.metadata[k] = v; return this; }

  finalize(turn) {
    const text = U.cleanText(this.parts.join("\n"));
    const filtered = Buttons.filter(this.buttons, turn);
    const btn = Buttons.build(filtered);
    Buttons.record(filtered, turn);
    let meta = "";
    if (this.metadata.components?.length) {
      meta += `[COMPONENTS:${this.metadata.components.join(",")}]`;
    }
    if (this.metadata.intent) meta += `[INTENT:${this.metadata.intent}]`;
    if (this.metadata.followUps?.length) {
      meta += `[FOLLOWUPS:${this.metadata.followUps.join("|")}]`;
    }
    return text + btn + meta;
  }
}

// ============================================================================
// SCORE CALCULATOR
// ============================================================================
class ScoreCalculator {
  constructor(w = CONFIG.SCORING) { this.w = w; }
  project(current, scenario) {
    const { score = 0, onTimeRate = 0, velocityScore = 0, completedCases = 80 } = current;
    const { lateCases = 0, earlyCases = 0, earlyDays = 0 } = scenario;

    const otCases = (onTimeRate / 100) * completedCases;
    const newOnTimeCases = otCases - lateCases + earlyCases;
    const newOnTimeRate = completedCases > 0
      ? (newOnTimeCases / completedCases) * 100
      : onTimeRate;

    const penalties = lateCases * this.w.LATE_PENALTY_PER_CASE;
    let bonuses = 0;
    if (earlyCases > 0 && earlyDays > 0) {
      bonuses = earlyCases *
        Math.min(earlyDays * this.w.EARLY_BONUS_PER_DAY, this.w.MAX_EARLY_BONUS);
    }

    const onTimeComp = newOnTimeRate * this.w.ON_TIME_WEIGHT;
    const velComp = velocityScore * this.w.VELOCITY_WEIGHT;
    const projected = U.clamp(onTimeComp + velComp - penalties + bonuses, 0, 100);

    return {
      currentScore: score,
      projectedScore: projected,
      scoreDelta: projected - score,
      newOnTimeRate,
      penalties,
      bonuses,
    };
  }
}
const scoreCalc = new ScoreCalculator();

// ============================================================================
// DB KNOWLEDGE  (quickStats bug fixed)
// ============================================================================
class DBKnowledge {
  static async quickStats() {
    const key = "quickStats:v3";
    const cached = Cache.get(key);
    if (cached) return cached;

    const out = {};
    for (const t of CONFIG.KNOWN_TABLES) {
      const res = await U.safeDb(
        db.from(t).select("id", { count: "exact", head: true })
      );
      // Supabase returns `count` on the response when head:true, NOT data.length
      out[t] = {
        approxRows: typeof res?.count === "number" ? res.count : 0,
        error: res?.error?.message || null,
      };
    }
    Cache.set(key, out);
    return out;
  }

  static async getActiveCases(dept = CONFIG.DEFAULT_DEPARTMENT) {
    const { data } = await U.safeDb(
      db.from("cases").select("*")
        .eq("department", dept).is("completed", null).is("archived", null)
        .order("due", { ascending: true })
    );
    return data || [];
  }

  static async getRecentCompletedCases(dept = CONFIG.DEFAULT_DEPARTMENT, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const { data } = await U.safeDb(
      db.from("cases").select("*")
        .eq("department", dept).not("completed", "is", null)
        .gte("completed", cutoff.toISOString())
        .order("completed", { ascending: false })
    );
    return data || [];
  }

  // Fetch a case by casenumber. Two gotchas this handles:
  //   1. Casenumbers aren't unique across time — the same number can exist as
  //      a historical archived row AND a currently-active row. We want the
  //      active one by default.
  //   2. `.single()` on Supabase errors out when multiple rows match. Using
  //      plain order-and-limit is more forgiving with real-world data.
  // Preference order: non-archived + non-completed, then non-archived, then
  // most-recent by created_at.
  static async caseByNumber(cn) {
    const exact = await U.safeDb(
      db.from("cases").select("*")
        .eq("casenumber", cn)
        .order("created_at", { ascending: false })
        .limit(10)
    );
    const rows = Array.isArray(exact?.data) ? exact.data : [];
    if (rows.length) {
      const pick = DBKnowledge._rankCandidates(rows);
      if (pick) return pick;
    }

    // Fallback: substring match (for users typing partial numbers).
    const like = await U.safeDb(
      db.from("cases").select("*")
        .ilike("casenumber", `%${cn}%`)
        .order("created_at", { ascending: false })
        .limit(10)
    );
    const fuzzy = Array.isArray(like?.data) ? like.data : [];
    if (fuzzy.length) {
      const pick = DBKnowledge._rankCandidates(fuzzy);
      if (pick) return pick;
    }
    return null;
  }

  static _rankCandidates(rows) {
    if (!rows?.length) return null;
    const score = (r) => {
      let s = 0;
      if (!r.archived) s += 100;
      if (!r.completed) s += 50;
      const t = r.updated_at || r.created_at;
      if (t) s += Math.min(30, (Date.now() - new Date(t).getTime()) / (-86400000));
      return s;
    };
    return rows.slice().sort((a, b) => score(b) - score(a))[0];
  }

  static async historyForCase(caseId, limit = 50) {
    const { data } = await U.safeDb(
      db.from("case_history").select("*").eq("case_id", caseId)
        .order("created_at", { ascending: false }).limit(limit)
    );
    return data || [];
  }

  static async getOverdueCases(dept = CONFIG.DEFAULT_DEPARTMENT) {
    const now = new Date().toISOString();
    const { data } = await U.safeDb(
      db.from("cases").select("*")
        .eq("department", dept).is("completed", null).is("archived", null)
        .lt("due", now).order("due", { ascending: true })
    );
    return data || [];
  }

  static async getCasesDueSoon(dept = CONFIG.DEFAULT_DEPARTMENT, hours = 24) {
    const now = new Date();
    const soon = new Date(now.getTime() + hours * 3600000);
    const { data } = await U.safeDb(
      db.from("cases").select("*")
        .eq("department", dept).is("completed", null).is("archived", null)
        .gte("due", now.toISOString()).lte("due", soon.toISOString())
        .order("due", { ascending: true })
    );
    return data || [];
  }

  static async schemaOverview() {
    const key = "schemaOverview:v1";
    const cached = Cache.get(key);
    if (cached) return cached;
    const guess = {
      cases: ["id", "casenumber", "created_at", "due", "completed", "department",
        "priority", "modifiers", "archived", "archived_at"],
      case_history: ["id", "case_id", "action", "user_name", "created_at"],
      active_devices: ["id", "user_id", "last_seen", "device_info"],
    };
    const overview = { tables: {} };
    for (const t of CONFIG.KNOWN_TABLES) {
      overview.tables[t] = {
        columns: (guess[t] || []).map((n) => ({ name: n, type: "unknown" })),
      };
    }
    Cache.set(key, overview);
    return overview;
  }
}

// ============================================================================
// COMPONENT REGISTRY
// ============================================================================
class ComponentRegistry {
  constructor() {
    this.list = [];
    this.byId = new Map();
  }
  register(comp) {
    if (!comp?.id || typeof comp.handle !== "function") {
      throw new Error("Invalid component: needs id and handle()");
    }
    comp.priority = comp.priority ?? 50;
    comp.requires = comp.requires || [];
    comp.boosters = comp.boosters || [];
    comp.phrases = comp.phrases || [];
    comp.category = comp.category || "GENERAL";
    this.list.push(comp);
    this.byId.set(comp.id, comp);
    return comp.id;
  }
  get(id) { return this.byId.get(id); }
  all() { return this.list.slice(); }
}
const COMPONENTS = new ComponentRegistry();

// ============================================================================
// KERNEL CONTEXT
// ============================================================================
class KernelContext {
  constructor() {
    this.session = {
      startedAt: Date.now(),
      turns: [],                // [{ t, q, componentId, entities }]
      lastIntent: null,
      previousScore: null,
      componentHistory: [],
      mentionedCases: [],
      lastEntities: null,
      variationIdx: 0,
      // Pending offer the assistant just made — when the user replies
      // "yes"/"sure"/"do it", we re-route to this command. Cleared on use
      // or after a few turns of staleness.
      pendingOffer: null,        // { command, prompt, turnSet }
      // Pending clarification — when the assistant asks a question with a
      // specific shape ("which stage?"), we stash an interpreter so the
      // next user reply gets handled as the answer.
      pendingClarification: null, // { kind, askingFor, command, turnSet }
      // Conversation context — a richer model than just lastIntent. Tracks
      // topic, entities under discussion, and what the assistant just said
      // so follow-ups can resolve pronouns and implicit subjects.
      conversation: {
        topic: null,                // current high-level subject ("score", "risk", etc)
        topicSetAtTurn: -1,
        topicHistory: [],           // [{ topic, turn }]
        subjectEntities: {          // who/what we're currently talking about
          caseType: null,           // "bbs" | "flex" | "general"
          stage: null,              // "design" | "production" | "qc" | "finishing"
          caseNumber: null,
          metric: null,             // "score" | "ontime" | "velocity"
        },
        // Recent things to allow short references like "the first one", "those"
        recentList: null,           // last enumerable list shown (cases/types/stages)
        recentListKind: null,       // "case" | "case_type" | "stage" | "problem"
      },
    };
    this.injectedData = null;
  }

  // --- Conversation accessors --------------------------------------------
  getConversation() { return this.session.conversation; }
  setTopic(topic) {
    if (!topic) return;
    const c = this.session.conversation;
    if (c.topic && c.topic !== topic) {
      c.topicHistory.push({ topic: c.topic, turn: c.topicSetAtTurn });
      if (c.topicHistory.length > 8) c.topicHistory.shift();
    }
    c.topic = topic;
    c.topicSetAtTurn = this.session.turns.length;
  }
  getTopic() {
    const c = this.session.conversation;
    if (!c.topic) return null;
    // Topics expire after 5 turns of silence on them
    if (this.session.turns.length - c.topicSetAtTurn > 5) {
      c.topic = null;
      return null;
    }
    return c.topic;
  }
  setSubjectEntity(key, value) {
    if (!key || !value) return;
    this.session.conversation.subjectEntities[key] = value;
  }
  getSubjectEntity(key) {
    return this.session.conversation.subjectEntities[key] || null;
  }
  setRecentList(kind, items) {
    if (!Array.isArray(items) || items.length === 0) return;
    const c = this.session.conversation;
    c.recentList = items.slice(0, 10);
    c.recentListKind = kind;
  }
  getRecentList() {
    const c = this.session.conversation;
    return c.recentList ? { kind: c.recentListKind, items: c.recentList } : null;
  }

  setPendingOffer(command, prompt = "") {
    if (!command) return;
    this.session.pendingOffer = {
      command,
      prompt,
      turnSet: this.session.turns.length,
    };
  }
  clearPendingOffer() { this.session.pendingOffer = null; }
  getPendingOffer() {
    const p = this.session.pendingOffer;
    if (!p) return null;
    // expire after 2 turns of staleness
    if (this.session.turns.length - p.turnSet > 2) {
      this.session.pendingOffer = null;
      return null;
    }
    return p;
  }

  setPendingClarification(spec) {
    if (!spec) return;
    this.session.pendingClarification = { ...spec, turnSet: this.session.turns.length };
  }
  clearPendingClarification() { this.session.pendingClarification = null; }
  getPendingClarification() {
    const p = this.session.pendingClarification;
    if (!p) return null;
    if (this.session.turns.length - p.turnSet > 1) {
      this.session.pendingClarification = null;
      return null;
    }
    return p;
  }

  setInjectedData(data) {
    this.injectedData = data;
    if (CONFIG.DEBUG.SHOW_ROUTING) {
      console.log("[KernelContext] Data injected:", {
        hasEfficiency: !!data?.efficiency,
        score: data?.efficiency?.score,
        stage: data?.stage,
        noData: data?.efficiency?.noData,
      });
    }
  }

  getEfficiency() {
    const eff = this.injectedData?.efficiency;
    return eff && !eff.noData ? eff : null;
  }
  getStage() { return this.injectedData?.stage || null; }
  getStageStats() { return this.injectedData?.stageStats || null; }
  getActiveDept() { return this.injectedData?.activeDept || CONFIG.DEFAULT_DEPARTMENT; }
  getStageCount() { return this.injectedData?.stageCount || 0; }
  getPredictions() { return this.injectedData?.efficiency?.predictions || null; }
  getThroughput() { return this.injectedData?.efficiency?.throughput || null; }
  getOnTimeDelivery() { return this.injectedData?.efficiency?.onTimeDelivery || null; }

  recordComponentUse(id) {
    this.session.componentHistory.push({ componentId: id, timestamp: Date.now() });
  }
  recordMentionedCase(cn) {
    if (!cn) return;
    if (!this.session.mentionedCases.includes(cn)) {
      this.session.mentionedCases.push(cn);
      if (this.session.mentionedCases.length > 20) this.session.mentionedCases.shift();
    }
  }
  getLastMentionedCase() {
    return this.session.mentionedCases[this.session.mentionedCases.length - 1] || null;
  }
  getLastComponent() { return this.session.lastIntent; }
  getLastTurnAge() {
    if (!this.session.turns.length) return Infinity;
    return this.session.turns.length;  // index distance, not time
  }
  pickVariation(options, bucket = "_global") {
    if (!this.session.variationBuckets) this.session.variationBuckets = {};
    const idx = this.session.variationBuckets[bucket] || 0;
    this.session.variationBuckets[bucket] = idx + 1;
    // Keep global index advancing too for any callers passing none
    this.session.variationIdx++;
    return options[idx % options.length];
  }

  init() {
    this.scoreCalculator = scoreCalc;
    this.buttons = Buttons;
    this.config = CONFIG;
    this.db = DBKnowledge;
    this.utils = {
      formatDuration: U.formatDuration, formatNumber: U.formatNumber,
      formatPercent: U.formatPercent, relativeTime: U.relativeTime,
      pct: U.pct, clamp: U.clamp, stageFromCase: U.stageFromCase,
      caseTypeFromModifiers: U.caseTypeFromModifiers,
      scoreToRating: U.scoreToRating, riskToWords: U.riskToWords,
      safeDb: U.safeDb, titleCase: U.titleCase,
    };
  }
}

// ============================================================================
// FOLLOW-UP DETECTION
// ============================================================================
const FOLLOWUP_PATTERNS = [
  /^why\??$/i,
  /^how\??$/i,
  /^and\??$/i,
  /^so\??$/i,
  /^really\??$/i,
  /^\s*(ok|okay)\??\s*$/i,
  /^tell me more/i,
  /^more\b/i,
  /^go on\b/i,
  /^what about\s/i,
  /^and (what|how)\s/i,
  /^why (is|did|does|would|was)\b/i,
  /^(this|that|it)\s/i,   // pronoun-initial short follow-ups
];

// Pure affirmation — user agreeing to a pending offer the assistant made.
// Kept tight on purpose: longer responses with content are routed normally.
const AFFIRM_PATTERNS = [
  /^(yes|yeah|yep|yup|y)\b/i,
  /^sure\b/i,
  /^ok\b/i,
  /^okay\b/i,
  /^please\b/i,
  /^do it\b/i,
  /^go( ahead)?\b/i,
  /^sounds good\b/i,
  /^alright\b/i,
  /^let'?s do (it|that)\b/i,
  /^why not\b/i,
];
const DENY_PATTERNS = [
  /^no\b/i,
  /^nope\b/i,
  /^nah\b/i,
  /^not (now|really|today|right now)\b/i,
  /^never mind\b/i,
  /^skip\b/i,
];

function isAffirmation(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.length === 0 || t.length > 30) return false;
  return AFFIRM_PATTERNS.some((re) => re.test(t));
}
function isDenial(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.length === 0 || t.length > 30) return false;
  return DENY_PATTERNS.some((re) => re.test(t));
}

// Map component id → conversational topic. Used to track what we're talking
// about so follow-ups like "and how do I fix that?" know the antecedent.
const COMPONENT_TOPICS = {
  greeter: null,
  main: "performance",
  improvement_advisor: "improvement",
  problem_finder: "problems",
  risk_analyzer: "risk",
  score_explainer: "score",
  scenario_simulator: "scenario",
  daily_brief: "brief",
  bottleneck_finder: "bottleneck",
  trend_analyzer: "trend",
  case_lookup: "case",
  schema_explorer: "schema",
  case_type_comparator: "case_type",
  buffer_compliance: "buffer",
  rush_handler: "rush",
  late_case_detail: "late_cases",
  data_quality: "data_quality",
};

// What command best continues a topic? Used for things like "fix it"/"improve
// that" where we know the user wants the improvement advisor focused on the
// last topic. Keep this small and conservative.
const TOPIC_CONTINUATIONS = {
  performance:   { improve: "How can I improve?", explain: "Why is my score what it is?", details: "What needs attention?" },
  problems:      { improve: "How can I improve?", explain: "Why is my score what it is?" },
  score:         { improve: "How can I improve?", details: "What needs attention?" },
  risk:          { improve: "How can I improve?", explain: "Why is my score what it is?" },
  bottleneck:    { improve: "How can I improve?", details: "Compare by case type" },
  case_type:     { details: "Where are the bottlenecks?" },
  buffer:        { details: "What needs attention?", improve: "How can I improve?" },
  rush:          { details: "What needs attention?", improve: "How can I improve?" },
  late_cases:    { details: "Compare by case type", improve: "How can I improve?" },
  data_quality:  { explain: "Why is my score what it is?" },
  brief:         { details: "What needs attention?" },
  scenario:      { explain: "Why is my score what it is?" },
};

// Words that typically signal an "act on the previous topic" intent when the
// question is short. e.g. "fix it", "improve that", "more on this".
const ACT_ON_TOPIC_PATTERNS = [
  { match: /\b(fix|address|solve|tackle|resolve|improve|better)\b/i, key: "improve" },
  { match: /\b(why|explain|breakdown|how.*calculated|reason)\b/i, key: "explain" },
  { match: /\b(more|details|deeper|drill|dig|specifics)\b/i, key: "details" },
];

const PRONOUN_PATTERNS = /\b(it|this|that|those|these|them|they)\b/i;

// Re-write a short user message using whatever the conversation knows about,
// so generic follow-ups (e.g. "fix it", "and design specifically?", "the
// first one?") become concrete commands the router can hit.
function enrichWithContext(question, ctx) {
  const t = String(question || "").trim();
  if (!t) return question;
  const conv = ctx.session.conversation;
  const tokens = t.toLowerCase().split(/\s+/).filter(Boolean).length;

  // Pattern 1: short imperative referring to the active topic
  // "fix it" / "improve that" / "how do I solve this?" → topic-specific command
  if (tokens <= 6 && PRONOUN_PATTERNS.test(t)) {
    const topic = ctx.getTopic();
    if (topic) {
      for (const p of ACT_ON_TOPIC_PATTERNS) {
        if (p.match.test(t)) {
          const cont = TOPIC_CONTINUATIONS[topic]?.[p.key];
          if (cont) return cont;
        }
      }
    }
  }

  // Pattern 2: refinement that drops the subject
  // "design specifically?" / "and design?" while topic=buffer → drill into it
  if (tokens <= 6) {
    const topic = ctx.getTopic();
    if (topic === "buffer") {
      for (const stage of ["design", "production", "qc", "finishing"]) {
        if (t.toLowerCase().includes(stage)) {
          ctx.setSubjectEntity("stage", stage);
          // The buffer component already shows per-stage stats; keep the
          // user's question through to it but tag the stage entity.
          return t;
        }
      }
    }
    if (topic === "case_type") {
      for (const ty of ["bbs", "flex", "general"]) {
        if (t.toLowerCase().includes(ty)) {
          ctx.setSubjectEntity("caseType", ty);
          return `Compare by case type ${ty}`;
        }
      }
    }
  }

  // Pattern 3: indexed reference to a recent list. Require the question to be
  // short AND to use indexing language ("the first one", "tell me about #2",
  // "show me the worst") so we don't false-trigger on prose like "what should
  // I focus on first?". Allows common typos for "first".
  if (tokens <= 8) {
    const list = ctx.getRecentList();
    if (list && list.kind === "case" && list.items.length) {
      // "first" with common typos: frist, fisrt, firts
      const firstWord = /\b(?:first|frist|fisrt|firts|fist)\b/i;
      if (
        (firstWord.test(t) && /\b(one|case|item)\b/i.test(t))
        || /^\s*(the )?(first|frist|fisrt|firts|fist)\??$/i.test(t)
        || /\b(?:show|tell|about) (?:me )?#?1\b/i.test(t)
        || /\b(the )?worst( one| case)?\b/i.test(t)
        || /\b(top|number) (one|1)\b/i.test(t)
      ) {
        return `Tell me about case ${list.items[0]}`;
      }
      const idxMatch = t.match(/\b(?:the )?(second|third|fourth|fifth) (?:one|case|item)?\b/i);
      const hashMatch = t.match(/#(\d)\b/);
      const map = { second: 2, third: 3, fourth: 4, fifth: 5 };
      let idx = null;
      if (idxMatch?.[1]) idx = map[idxMatch[1].toLowerCase()];
      else if (hashMatch) idx = Number(hashMatch[1]);
      if (idx && list.items[idx - 1]) {
        return `Tell me about case ${list.items[idx - 1]}`;
      }
    }
  }

  // Pattern 4: "is that bad/good/normal?" — interpretive follow-up. Re-route
  // back to the same component for a fresh, contextually flavored answer.
  if (/^(is that|is this) (bad|good|normal|ok|okay|a lot|too many|enough)/i.test(t)) {
    const topic = ctx.getTopic();
    if (topic) {
      const last = ctx.session.lastIntent;
      if (last) {
        // Re-issue the canonical phrase for that topic so the same handler
        // re-runs and the user gets fresh prose.
        return TOPIC_CONTINUATIONS[topic]?.details
            || TOPIC_CONTINUATIONS[topic]?.improve
            || t;
      }
    }
  }

  // Pattern 5: "should I be worried/concerned?" — domain-relevant emotional
  // probe. Map to a problems sweep so the user gets a real risk/issues read.
  if (/should i be (worried|concerned|nervous|scared|alarmed)/i.test(t)) {
    return "What needs attention?";
  }
  // Pattern 6: "anything (urgent|critical) (today|now)?" — same idea.
  if (/^anything (urgent|critical|risky|broken|wrong|hot)\b/i.test(t)) {
    return "What needs attention?";
  }

  return question;
}

// Resolve a short user reply against an outstanding clarification request.
// Returns the actual command to dispatch, or null if the reply doesn't
// match the expected shape (in which case routing falls through to normal).
function applyClarification(rawText, clar) {
  const t = String(rawText || "").trim().toLowerCase();
  if (!t) return null;
  if (clar.kind === "stage") {
    const stages = ["design", "production", "qc", "finishing"];
    for (const s of stages) {
      if (t.includes(s)) return clar.command.replace("{stage}", s);
    }
    return null;
  }
  if (clar.kind === "case_type") {
    for (const ty of ["bbs", "flex", "general"]) {
      if (t.includes(ty)) return clar.command.replace("{type}", ty);
    }
    return null;
  }
  if (clar.kind === "case_number") {
    const m = t.match(/\d{3,}/);
    if (m) return clar.command.replace("{case}", m[0]);
    return null;
  }
  if (clar.kind === "scenario_count") {
    const m = t.match(/\d+/);
    if (m) return clar.command.replace("{n}", m[0]);
    return null;
  }
  if (clar.kind === "choice" && Array.isArray(clar.choices)) {
    for (const c of clar.choices) {
      if (t.includes(c.match.toLowerCase())) return c.command;
    }
    return null;
  }
  return null;
}

// Pull the first [ACTION:label|command] out of a finalized response, since
// that's the implied "if you say yes" follow-up. Returns null if there isn't
// one (e.g., the response is buttonless).
function parseFirstActionButton(text) {
  if (!text) return null;
  const m = String(text).match(/\[ACTION:([^\|]+)\|([^\]]+)\]/);
  if (!m) return null;
  return { label: m[1].trim(), command: m[2].trim() };
}

// After a component finalizes, sniff its text + buttons to auto-set
// `pendingOffer` if the response ended with an offer-style question.
// Components that want explicit control can call ctx.setPendingOffer()
// themselves; this auto-capture is a fallback that only fires if the
// component didn't set one. Components that DO set one always win.
function autoCapturePendingOffer(ctx, text, primaryButton) {
  if (!text || !primaryButton) return;
  // If the component already stashed an explicit offer this turn, leave it.
  // Note: the turn isn't pushed yet at the point the component called
  // setPendingOffer, so its turnSet equals (current length) - 1 by now.
  const existing = ctx.session.pendingOffer;
  const justSet = existing && existing.turnSet >= ctx.session.turns.length - 1;
  if (justSet) return;
  // Strip metadata + button glyphs to look at the actual prose
  const body = String(text).replace(/\[ACTION:[^\]]*\]/g, "")
    .replace(/\[MODAL:[^\]]*\]/g, "")
    .replace(/\[COMPONENTS:[^\]]*\]/g, "")
    .replace(/\[INTENT:[^\]]*\]/g, "")
    .replace(/\[FOLLOWUPS:[^\]]*\]/g, "")
    .trim();
  // Last sentence
  const tail = body.split(/[\n]/).filter(Boolean).pop() || "";
  // Heuristic: the response ends with a question and there's a CTA button.
  if (/\?\s*$/.test(tail)) {
    ctx.setPendingOffer(primaryButton.command, tail);
  }
}

// Domain concepts — if any match, the question has its own semantic content
// and should be routed freshly, not treated as a follow-up to last component.
const DOMAIN_GUARD_CONCEPTS = [
  "SCORE", "EFFICIENCY", "VELOCITY", "IMPROVE", "PROBLEM", "RISK",
  "LATE", "EARLY", "TREND", "BOTTLENECK", "WHATIF", "CASE",
  "BRIEF", "SCHEMA", "DEBUG",
];

function isLikelyFollowup(text, norm) {
  const t = text.trim();
  if (t.length === 0) return false;
  if (norm.tokens.length > 4) return false;  // long questions aren't follow-ups
  // If the question contains a domain concept, it's a fresh question
  for (const c of DOMAIN_GUARD_CONCEPTS) {
    if (matchConcept(norm, CONCEPTS[c])) return false;
  }
  return FOLLOWUP_PATTERNS.some((re) => re.test(t));
}

// ============================================================================
// ROUTER — concept scoring + softmax confidence
// ============================================================================
class IntentRouter {
  constructor() {
    this.contextWindow = [];
  }

  scoreComponent(comp, n, entities) {
    // Hard gate: require at least one `requires` concept OR an explicit
    // phrase match. A phrase match is itself strong evidence ("what if",
    // "how can i improve") and should be allowed to satisfy the gate.
    if (comp.requires?.length) {
      const conceptPassed = comp.requires.some((name) =>
        matchConcept(n, CONCEPTS[name])
      );
      const phrasePassed = (comp.phrases || []).some((p) => n.lower.includes(p));
      if (!conceptPassed && !phrasePassed) return { score: 0, gated: true };
    }

    let s = 0;

    // Concept boosters with weights
    for (const { concept, weight } of comp.boosters || []) {
      const strength = conceptStrength(n, CONCEPTS[concept]);
      if (strength > 0) s += weight * (1 + (strength - 1) * 0.3);
    }

    // Multi-word phrase bonus (exact substring in lower-cased text)
    for (const p of comp.phrases || []) {
      if (n.lower.includes(p)) {
        const len = p.split(/\s+/).length;
        s += 0.4 + 0.1 * len;
      }
    }

    // Entity boost
    if (typeof comp.entityBoost === "function") {
      try { s += comp.entityBoost(entities, n) || 0; }
      catch (e) { console.warn(`[Router] entityBoost err in ${comp.id}:`, e); }
    }

    // Custom match function (fallback, rare)
    if (typeof comp.extraScore === "function") {
      try { s += comp.extraScore(n, entities) || 0; }
      catch (e) { console.warn(`[Router] extraScore err in ${comp.id}:`, e); }
    }

    return { score: Math.max(0, s), gated: false };
  }

  async route(ctx, question, n, entities) {
    // 1. Follow-up short-circuit
    if (isLikelyFollowup(question, n) && ctx.getLastComponent()) {
      const last = COMPONENTS.get(ctx.getLastComponent());
      if (last) {
        return {
          primary: last,
          secondary: [],
          confidence: 0.95,
          reason: "followup",
          scores: [],
        };
      }
    }

    // 2. Score all components
    const raws = [];
    for (const comp of COMPONENTS.all()) {
      const { score, gated } = this.scoreComponent(comp, n, entities);
      // Priority as additive tiebreaker, not multiplier
      const adj = score > 0 ? score + (comp.priority - 50) / 1000 : 0;
      raws.push({ comp, score: adj, raw: score, gated });
    }
    raws.sort((a, b) => b.score - a.score);

    if (CONFIG.DEBUG.SHOW_SCORES) {
      console.log("[Router] Top 5:", raws.slice(0, 5).map(
        (r) => `${r.comp.id}:${r.score.toFixed(3)}${r.gated ? "(gated)" : ""}`
      ));
    }

    // 3. Softmax confidence over top 5 (to keep noise bounded)
    const topN = raws.slice(0, 5).filter((r) => r.score > 0);
    if (topN.length === 0) {
      return { primary: null, secondary: [], confidence: 0, reason: "no_match", scores: raws };
    }

    const T = CONFIG.ROUTING.SOFTMAX_TEMP;
    const exps = topN.map((r) => Math.exp(r.score / T));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sum);

    const top = topN[0];
    const topProb = probs[0];
    const secondProb = probs[1] || 0;

    // 4. Ambiguity check
    if (topProb < CONFIG.ROUTING.MIN_CONFIDENCE) {
      return {
        primary: null, secondary: [], confidence: topProb,
        reason: "low_confidence",
        ambiguousCandidates: topN.slice(0, 2).map((r) => r.comp),
        scores: raws,
      };
    }
    if (topProb - secondProb < CONFIG.ROUTING.AMBIGUOUS_MARGIN && topN.length > 1) {
      return {
        primary: top.comp, secondary: [topN[1].comp],
        confidence: topProb,
        reason: "ambiguous",
        ambiguousCandidates: [topN[0].comp, topN[1].comp],
        scores: raws,
      };
    }

    // 5. Clear winner
    this.contextWindow.push(top.comp.id);
    if (this.contextWindow.length > 5) this.contextWindow.shift();

    return {
      primary: top.comp,
      secondary: topN.slice(1, 3).map((r) => r.comp),
      confidence: topProb,
      reason: "clear",
      scores: raws,
    };
  }
}
const router = new IntentRouter();

// ============================================================================
// ORCHESTRATOR
// ============================================================================
class ResponseOrchestrator {
  async orchestrate(ctx, routing, question, entities, n) {
    const greeter = COMPONENTS.get("greeter");

    // Greeter handles empty/greeting directly
    if (greeter?.shouldHandle) {
      const g = await greeter.shouldHandle(ctx, question, entities, n);
      if (g) {
        const r = await greeter.handle(ctx, question, entities, n);
        ctx.recordComponentUse("greeter");
        return { text: r, componentId: "greeter" };
      }
    }

    // No match — three sub-cases:
    //   a) genuinely ambiguous between two domain components  → clarify
    //   b) on-topic but low confidence                          → greeter help
    //   c) off-topic entirely (no domain concept present)       → natural redirect
    if (!routing.primary) {
      if (routing.ambiguousCandidates?.length === 2) {
        const [a, b] = routing.ambiguousCandidates;
        const rb = new ResponseBuilder();
        rb.say("I could take that a couple of ways — which did you mean?");
        rb.addButtons([
          [a.clarifyLabel || a.id, a.clarifyPrompt || `Show ${a.id}`],
          [b.clarifyLabel || b.id, b.clarifyPrompt || `Show ${b.id}`],
        ]);
        return { text: rb.finalize(ctx.session.turns.length), componentId: "clarify" };
      }

      // Check if the question has ANY domain concept at all.
      // If not → natural redirect rather than "please rephrase".
      if (isOutOfScope(n)) {
        return {
          text: buildOutOfScopeRedirect(ctx, question, n),
          componentId: "out_of_scope",
        };
      }

      // On-topic but ambiguous/weak → send to greeter fallback
      if (greeter) {
        const r = await greeter.handle(ctx, question, entities, n);
        ctx.recordComponentUse("greeter");
        return { text: r, componentId: "greeter" };
      }
      return {
        text: "I'm not sure how to help with that. Try asking about your score, problems, or specific cases.",
        componentId: "none",
      };
    }

    // Execute primary
    try {
      const r = await routing.primary.handle(ctx, question, entities, n);
      ctx.recordComponentUse(routing.primary.id);
      return { text: r, componentId: routing.primary.id };
    } catch (err) {
      console.error("[Orchestrator] Component error:", err);
      if (greeter?.handleError) {
        return {
          text: await greeter.handleError(ctx, question, entities, err),
          componentId: "greeter",
        };
      }
      return {
        text: "Something broke handling that. Try rephrasing?",
        componentId: "error",
      };
    }
  }
}
const orchestrator = new ResponseOrchestrator();

// ============================================================================
// KERNEL
// ============================================================================
class AppQAKernel {
  constructor() {
    this.ctx = new KernelContext();
    this._ready = false;
  }
  async ready() {
    if (this._ready) return true;
    this.ctx.init();
    this._ready = true;
    return true;
  }

  async ask(question, injectedContext = {}) {
    await this.ready();
    this.ctx.setInjectedData(injectedContext);

    const q = String(question || "").trim();

    if (!q) {
      const g = COMPONENTS.get("greeter");
      if (g) {
        const r = await g.handle(this.ctx, "", {}, normalize(""));
        return r;  // greeter's finalize() already ran
      }
      return "Hi there! How can I help?";
    }

    // ── Pending clarification: assistant just asked the user a question
    // that expects a specific shape of answer (e.g. "which stage?"). Try
    // to interpret the input through that lens before doing fresh routing.
    const clar = this.ctx.getPendingClarification();
    if (clar && clar.command) {
      const interpreted = applyClarification(q, clar);
      if (interpreted) {
        this.ctx.clearPendingClarification();
        // Recurse with the resolved command, keeping the user's raw question
        // on record as the actual turn.
        const text = await this.ask(interpreted, injectedContext);
        // Replace the recorded question with the user's literal so the trail
        // shows what they actually typed.
        const last = this.ctx.session.turns[this.ctx.session.turns.length - 1];
        if (last) last.q = q;
        return text;
      }
    }

    // ── Yes / no follow-through on a pending offer.
    const pending = this.ctx.getPendingOffer();
    if (pending) {
      if (isAffirmation(q)) {
        this.ctx.clearPendingOffer();
        const text = await this.ask(pending.command, injectedContext);
        const last = this.ctx.session.turns[this.ctx.session.turns.length - 1];
        if (last) last.q = q;
        return text;
      }
      if (isDenial(q)) {
        this.ctx.clearPendingOffer();
        const rb = new ResponseBuilder();
        rb.say(this.ctx.pickVariation([
          "No worries — what would you rather look at?",
          "All good. Want to point me somewhere else?",
          "Got it, skipping that one. Anything else on your mind?",
        ], "deny_ack"));
        rb.addButtons([
          ["Performance", "How am I doing?"],
          ["Problems", "What needs attention?"],
          ["Help", "What can you help with?"],
        ]);
        const out = rb.finalize(this.ctx.session.turns.length);
        this.ctx.session.turns.push({ t: Date.now(), q, componentId: "deny_ack", entities: {} });
        return out;
      }
    }

    // ── Enrich the question with conversation context (pronoun resolution,
    // topic continuation, list-index references). If enrichment rewrites the
    // input to a concrete command, recurse so the new command takes the full
    // routing path with its own context updates.
    const enriched = enrichWithContext(q, this.ctx);
    if (enriched && enriched !== q) {
      const text = await this.ask(enriched, injectedContext);
      const last = this.ctx.session.turns[this.ctx.session.turns.length - 1];
      if (last) last.q = q;  // keep the user's literal in the trail
      return text;
    }

    const n = normalize(q);
    const entities = extractEntities(q, n);

    // Preserve entities across follow-ups
    if (isLikelyFollowup(q, n) && this.ctx.session.lastEntities) {
      const prev = this.ctx.session.lastEntities;
      if (!entities.caseNumbers.length && prev.caseNumbers?.length) {
        entities.caseNumbers = prev.caseNumbers.slice();
      }
      if (!entities.stages.length && prev.stages?.length) {
        entities.stages = prev.stages.slice();
      }
    }

    // Carry subject entities from conversation context if the current question
    // didn't bring its own. This is what makes "and finishing times?" after a
    // case-type comparison still know we're talking about that type.
    const conv = this.ctx.session.conversation;
    if (!entities.caseTypes?.length && conv.subjectEntities.caseType) {
      entities.caseTypes = entities.caseTypes || [];
      entities.caseTypes.push(conv.subjectEntities.caseType);
    }
    if (!entities.stages?.length && conv.subjectEntities.stage) {
      entities.stages = entities.stages || [];
      entities.stages.push(conv.subjectEntities.stage);
    }

    const routing = await router.route(this.ctx, q, n, entities);

    if (CONFIG.DEBUG.SHOW_ROUTING) {
      console.log("[QA] Routing:", {
        q: q.substring(0, 60),
        primary: routing.primary?.id || "none",
        reason: routing.reason,
        confidence: routing.confidence?.toFixed(2),
      });
    }

    const { text, componentId } = await orchestrator.orchestrate(
      this.ctx, routing, q, entities, n
    );

    // Track turn
    this.ctx.session.turns.push({
      t: Date.now(), q, componentId, entities,
    });
    if (this.ctx.session.turns.length > CONFIG.MAX_CONTEXT_TURNS) {
      this.ctx.session.turns.shift();
    }
    this.ctx.session.lastIntent = componentId;
    this.ctx.session.lastEntities = entities;

    // Update conversation topic from the component that ran
    if (componentId && componentId in COMPONENT_TOPICS) {
      const topic = COMPONENT_TOPICS[componentId];
      if (topic) this.ctx.setTopic(topic);
    }

    // Carry the user-provided entities into the conversation subject
    if (entities.caseTypes?.[0]) this.ctx.setSubjectEntity("caseType", entities.caseTypes[0]);
    if (entities.stages?.[0])   this.ctx.setSubjectEntity("stage", entities.stages[0]);
    if (entities.caseNumbers?.[0]) this.ctx.setSubjectEntity("caseNumber", entities.caseNumbers[0]);

    // Auto-capture: if the response ends with a question and there's at
    // least one button, treat the first button's command as the implied
    // offer for "yes/sure/please" follow-ups.
    const firstBtn = parseFirstActionButton(text);
    if (firstBtn) autoCapturePendingOffer(this.ctx, text, firstBtn);

    const eff = this.ctx.getEfficiency();
    if (eff?.score != null) this.ctx.session.previousScore = eff.score;

    return text;
  }

  reset() {
    this.ctx = new KernelContext();
    Cache.clear();
    Buttons.recent = [];
    this._ready = false;
  }
}

// ============================================================================
// OUT-OF-SCOPE DETECTION & NATURAL REDIRECT
// ============================================================================
// A question is "out of scope" if none of its lemmas match ANY routable
// domain concept. The list is broader than DOMAIN_GUARD_CONCEPTS — we also
// count EXPLAIN and CHANGE as domain-ish so things like "what changed?" or
// "explain" still get treated as on-topic.
const ALL_DOMAIN_CONCEPTS = [
  "SCORE", "EFFICIENCY", "VELOCITY", "IMPROVE", "PROBLEM", "RISK",
  "LATE", "EARLY", "TREND", "CHANGE", "BOTTLENECK", "WHATIF",
  "CASE", "BRIEF", "SCHEMA", "DEBUG", "EXPLAIN",
  "TYPE_COMPARE", "CASE_TYPE", "BUFFER", "RUSH", "QUALITY",
];

// Words that are clearly domain-relevant even when concept sets don't fire
// (case types, stages, operational nouns). Checked against the raw lemma set.
// Deliberately excludes interrogatives ("what", "how") and generic verbs
// ("tell", "show", "give") — those alone don't indicate domain.
const DOMAIN_WORD_SET = new Set([
  "case", "order", "job", "project", "task",
  "stage", "production", "design", "finish", "qc", "quality",
  "deliver", "delivery", "deadline", "due", "overdue",
  "client", "customer", "vendor",
  "bb", "bbs", "flex",
  "penalty", "penalti", "bonus",
  "stats", "stat", "metric", "kpi", "dashboard",
  "workflow", "pipeline", "backlog", "queue",
]);

function isOutOfScope(n) {
  // 1. Any concept match → on topic
  for (const c of ALL_DOMAIN_CONCEPTS) {
    if (matchConcept(n, CONCEPTS[c])) return false;
  }
  // 2. Any raw domain word → on topic
  for (const lem of n.lemmaSet || []) {
    if (DOMAIN_WORD_SET.has(lem)) return false;
  }
  for (const tok of n.tokens || []) {
    if (DOMAIN_WORD_SET.has(tok)) return false;
  }
  // 3. Very short inputs ("ok", "thanks") — not out of scope, just chit-chat
  if ((n.tokens || []).length <= 2) return false;
  // 4. Otherwise → out of scope
  return true;
}

function buildOutOfScopeRedirect(ctx, question, n) {
  const rb = new ResponseBuilder();
  const eff = ctx.getEfficiency();
  const preds = ctx.getPredictions();
  const score = eff?.score;
  const critCount = preds?.predictions?.filter(
    (p) => p.riskLevel === "critical"
  ).length || 0;

  // Pick an acknowledgement that matches the flavor of the question.
  // We stay brief — the point is to pivot, not to explain what we don't do.
  const tokens = (n.tokens || []).join(" ");
  const isPersonal = /\b(you|your|yourself|feel|think|love|like|favorite)\b/i.test(tokens);
  const isWeather = /\b(weather|rain|sunny|snow|temperature|forecast|hot|cold)\b/i.test(tokens);
  const isJoke = /\b(joke|funny|humor)\b/i.test(tokens);
  const isCreative = /\b(poem|story|song|haiku|write|sing)\b/i.test(tokens);
  const isChitchat = /\b(how are you|who are you|what are you|thanks|thank you)\b/i.test(
    question.toLowerCase()
  );

  let ack;
  if (isWeather) {
    ack = "Weather's not my thing — I live inside your case data.";
  } else if (isJoke) {
    ack = "Comedy's not my strong suit — I'm better at flagging problems.";
  } else if (isCreative) {
    ack = "Not much of a poet. I'm better at numbers.";
  } else if (isPersonal) {
    ack = ctx.pickVariation([
      "I'll pass on that — I'm here to keep an eye on your workload.",
      "Not really my territory. I stick to cases and performance.",
    ]);
  } else if (isChitchat) {
    ack = ctx.pickVariation([
      "Good — keeping tabs on your cases.",
      "Doing what I do: watching your numbers.",
    ]);
  } else {
    ack = ctx.pickVariation([
      "That's outside what I can see.",
      "Can't help with that one — I only know about your workflow.",
      "Not my area — I'm tuned to cases and performance.",
    ]);
  }
  rb.say(ack);

  // Pivot using whatever injected data we have.
  if (score != null && critCount > 0) {
    rb.paragraph(ctx.pickVariation([
      `What I can offer: your score's at ${U.formatNumber(score)} and ${critCount} case${critCount === 1 ? "" : "s"} ${critCount === 1 ? "is" : "are"} sitting at critical risk. Want to look at those?`,
      `For something I can actually answer: you're at ${U.formatNumber(score)} with ${critCount} critical case${critCount === 1 ? "" : "s"} on the board — happy to dig into either.`,
      `If you want, I can flip to something useful — your score is ${U.formatNumber(score)} and there ${critCount === 1 ? "is" : "are"} ${critCount} critical case${critCount === 1 ? "" : "s"} I'd be looking at first.`,
    ], "oos_pivot_crit"));
    rb.addButtons([
      ["Show critical cases", "Which cases are critical?"],
      ["Why is my score where it is?", "Explain my score"],
    ]);
  } else if (score != null) {
    rb.paragraph(ctx.pickVariation([
      `Where I can help: your score is ${U.formatNumber(score)}. I can break that down, flag risks, or walk through what's slowing things down.`,
      `For something useful — you're sitting at ${U.formatNumber(score)}. Want me to explain that, surface what's at risk, or look for bottlenecks?`,
      `I can pivot to something concrete: ${U.formatNumber(score)} score right now, and I can tell you why, what's risky, or where the slowdowns are.`,
    ], "oos_pivot_score"));
    rb.addButtons([
      ["Explain my score", "Why is my score there?"],
      ["What needs attention?", "What needs attention?"],
    ]);
  } else {
    rb.paragraph(
      "I can walk through your score, flag at-risk cases, or tell you where the bottlenecks are — pick a stage from the top of the page and I'll have the numbers."
    );
    rb.addButtons([
      ["What can you do?", "What can you help with?"],
    ]);
  }

  return rb.finalize(ctx.session.turns.length);
}

// ============================================================================
// NO-DATA FALLBACK — single source of truth
// ============================================================================
function noDataResponse(ctx, topic = "performance") {
  const rb = new ResponseBuilder();
  rb.say(`I don't have ${topic} data loaded right now.`);
  rb.paragraph(
    "Select a stage (Design, Production, Finishing, or QC) from the dropdown at the top of the page and I'll have the numbers."
  );
  rb.addButtons([
    ["What can you do?", "What can you help with?"],
  ]);
  return rb.finalize(ctx.session.turns.length);
}

// ============================================================================
// CONVERSATIONAL HELPERS (v4.1)
// ----------------------------------------------------------------------------
// Small phrase bank + helpers so component handlers can produce varied,
// LLM-sounding prose without each one re-rolling its own variants.
// pickVariation() on the context cycles deterministically through options.
// ============================================================================
const PHRASES = {
  scoreLead: (s, rating) => [
    `You're sitting at ${s} right now — ${rating} territory.`,
    `Score's ${s}, which lands you in ${rating} range.`,
    `Right now you're at ${s} (${rating}).`,
    `Currently at ${s} — call that ${rating}.`,
  ],
  observation: (s) => [
    `Looking at this, ${s}`,
    `From what I can see, ${s}`,
    `The thing that stands out: ${s}`,
    `Honestly, ${s}`,
    `Here's the picture: ${s}`,
  ],
  recommendOpener: () => [
    "If I had to pick one thing to focus on,",
    "The biggest lever you've got right now is",
    "Where you'd get the most movement is",
    "Here's where I'd start:",
  ],
  goodNews: () => [
    "Good news —",
    "On the upside,",
    "The encouraging part:",
  ],
  badNews: () => [
    "The catch is,",
    "Less great:",
    "Worth flagging:",
    "On the other side,",
  ],
  ackOk: () => [
    "Looking solid overall.",
    "Honestly, things are in good shape.",
    "Nothing alarming — you're holding steady.",
  ],
  pivotQuestion: () => [
    "Want me to dig deeper?",
    "Want to look at the cases driving this?",
    "Should we run a what-if to see the impact?",
    "Want the breakdown?",
  ],
};

// Pick a variation via the context's deterministic round-robin. Pass a
// `bucket` (usually the component id) so that two components asking for
// "an opener" don't drain each other's rotation.
function vary(ctx, options, bucket) {
  return ctx.pickVariation(options, bucket);
}

// ============================================================================
// COMPONENTS
// ============================================================================

// ----------------------------------------------------------------------------
// GREETER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "greeter",
  priority: 100,
  category: "CORE",
  requires: ["GREET", "HELP"],
  boosters: [{ concept: "GREET", weight: 0.8 }, { concept: "HELP", weight: 0.5 }],
  phrases: ["what can you do", "what do you do", "how do you work"],

  async shouldHandle(ctx, question, entities, n) {
    const q = (question || "").toLowerCase().trim();
    if (q === "") return true;
    if (/^(hi|hello|hey|sup|greetings|yo|howdy)\s*[!.?]*$/i.test(q)) return true;
    if (/^(help|help me|what can you (do|help with))\s*\??$/i.test(q)) return true;
    return false;
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const q = (question || "").toLowerCase().trim();
    const hour = new Date().getHours();
    const eff = ctx.getEfficiency();
    const tod = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    if (q === "" || /^(hi|hello|hey|sup|greetings|yo|howdy)\s*[!.?]*$/i.test(q)) {
      const opener = vary(ctx, [
        `Hey — good ${tod}.`,
        `Hi there. Good ${tod}.`,
        `Morning. Well, ${tod} technically.`,
        `Hey. ${U.titleCase(tod)} check-in?`,
      ]);
      rb.say(opener);
      if (eff) {
        const score = eff.score || 0;
        const rating = U.scoreToRating(score);
        rb.say(` You're sitting at ${U.formatPercent(score)} right now, which puts you in ${rating} range.`);
      } else {
        rb.say(" I don't see any data loaded yet, but I'm ready when you are.");
      }
      rb.paragraph(vary(ctx, [
        "What do you want to dig into?",
        "Where would you like to start?",
        "Anything you want me to pull up?",
      ]));
      rb.addButtons([
        ["How am I doing?", "How am I doing?"],
        ["What needs attention?", "What needs attention?"],
        ["Critical cases", "Show critical cases"],
        ["How to improve", "How can I improve?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    if (/help/.test(q) || /what can you/i.test(q)) {
      rb.say(vary(ctx, [
        "Honestly, quite a lot — I sit on top of your case data and the efficiency engine, so I can answer most things about how the floor is doing.",
        "I'm wired into your case and performance data, so anything along those lines is fair game.",
        "I can see your cases, scoring, risk predictions, and stage stats — ask away.",
      ]));
      rb.paragraph("A few examples of things to ask: a score check, what's currently at risk, where the bottlenecks are, or a what-if scenario like \"what happens if 3 cases go late?\". I'll also break down case types, rush load, or buffer compliance if you want.");
      rb.addButtons([
        ["Check score", "What's my score?"],
        ["Problems", "What needs attention?"],
        ["At-risk", "Show critical cases"],
        ["Daily brief", "Give me my daily brief"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    // Fallback for nothing-matched — give a useful nudge plus the score so the
    // user always gets something actionable back, never just buttons.
    const eff2 = ctx.getEfficiency();
    const scoreBit = eff2 ? ` For context, you're currently at ${U.formatPercent(eff2.score || 0)} overall.` : "";
    rb.say(vary(ctx, [
      `Honestly, I'm not sure how you want me to take that — want to point me at one of these starting points?${scoreBit}`,
      `Hmm, that one's a bit ambiguous from where I'm sitting. Mind picking an angle so I can dig into the right thing?${scoreBit}`,
      `I can take that a few different ways. Pick one of these and I'll go deeper.${scoreBit}`,
    ], "greeter_fallback"));
    rb.addButtons([
      ["Performance", "How am I doing?"],
      ["Problems", "What needs attention?"],
      ["Critical cases", "Show critical cases"],
      ["Help", "What can you help with?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },

  async handleError(ctx) {
    const rb = new ResponseBuilder();
    rb.say("Something went wrong handling that.");
    rb.addButtons([
      ["Try again", "How am I doing?"],
      ["Get help", "What can you help with?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// MAIN — performance overview
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "main",
  priority: 75,
  category: "CORE",
  requires: ["SCORE", "EFFICIENCY", "STATUS"],
  boosters: [
    { concept: "SCORE", weight: 0.6 },
    { concept: "EFFICIENCY", weight: 0.6 },
    { concept: "STATUS", weight: 0.5 },
  ],
  // Note: "my score" alone is too generic to be a phrase here — SCORE concept
  // already covers it, and phrase-level bonus would crowd out other components
  // for questions like "why did my score drop?" or "is my score improving?"
  phrases: ["how am i doing", "how's it going", "performance update", "quick status"],
  clarifyLabel: "Overview",
  clarifyPrompt: "How am I doing?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    if (!eff) return noDataResponse(ctx, "performance");

    const rb = new ResponseBuilder();
    const score = eff.score || 0;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = eff.throughput?.overall || 0;
    const critical = eff.predictions?.urgent?.length || 0;
    const stage = ctx.getStage();
    const stageCount = ctx.getStageCount();

    const rating = U.scoreToRating(score);
    const stageBit = stage ? ` for ${U.titleCase(stage)}` : "";
    rb.say(vary(ctx, [
      `Right now${stageBit} you're at ${U.formatPercent(score)} — call that ${rating}.`,
      `You're sitting at ${U.formatPercent(score)}${stageBit}, which lands in ${rating} range.`,
      `Currently ${U.formatPercent(score)}${stageBit}. That's ${rating} territory.`,
      `Score's ${U.formatPercent(score)}${stageBit} — ${rating} overall.`,
      `So${stageBit ? stageBit + "," : ""} the score's running ${U.formatPercent(score)}, which I'd call ${rating}.`,
      `Honestly, ${U.formatPercent(score)}${stageBit} puts you in ${rating} shape.`,
      `From what I can see, you're at ${U.formatPercent(score)}${stageBit} — solidly ${rating}.`,
      `Looking at this, ${U.formatPercent(score)}${stageBit} is where you sit, and that's ${rating}.`,
    ], "main_opener"));

    // Inline metric prose instead of a KV dump
    const onTimeWord = onTime >= 85 ? "solid" : onTime >= 75 ? "a bit below target" : "the weak spot";
    const velWord = velocity >= 80 ? "good" : velocity >= 65 ? "okay" : "lagging";
    rb.say(` On-time delivery is ${U.formatPercent(onTime)} (${onTimeWord}) and velocity sits at ${U.formatPercent(velocity)} (${velWord}).`);
    if (stageCount > 0) {
      rb.say(` You've got ${stageCount} active cases in the queue${critical > 0 ? `, and ${critical} of them ${critical === 1 ? "is" : "are"} at critical risk.` : "."}`);
    } else if (critical > 0) {
      rb.say(` ${critical} case${critical !== 1 ? "s" : ""} ${critical === 1 ? "is" : "are"} at critical risk.`);
    }

    // Single diagnostic line
    if (critical > 0) {
      rb.paragraph(`The thing I'd jump on first is the critical cases — each one that goes late costs roughly ${CONFIG.SCORING.LATE_PENALTY_PER_CASE} pts. Want me to pull them up?`);
      // Auto-capture handles "yes" → "Show me critical cases"
      ctx.setPendingOffer("Show me critical cases", "pull up critical cases");
    } else if (onTime < 70) {
      rb.paragraph("Honestly, on-time delivery is the main drag — that's where the points are leaking. Want to talk through how to lift it?");
      ctx.setPendingOffer("How can I improve?", "talk through how to lift on-time");
    } else if (velocity < 65) {
      rb.paragraph("Velocity's low enough that there's probably a bottleneck somewhere worth tracking down. Want me to surface where?");
      ctx.setPendingOffer("Where are the bottlenecks?", "surface the bottleneck");
    } else if (score >= 85) {
      rb.paragraph(vary(ctx, PHRASES.ackOk()));
    }

    rb.addButtons([
      ["Why this score?", "Why is my score what it is?"],
      ["Find issues", "What needs attention?"],
      ["Improve", "How can I improve?"],
      critical > 0 && ["Critical cases", "Show me critical cases"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// IMPROVEMENT ADVISOR
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "improvement_advisor",
  priority: 82,
  category: "PERFORMANCE",
  requires: ["IMPROVE", "RECOMMEND"],
  boosters: [
    { concept: "IMPROVE", weight: 0.7 },
    { concept: "RECOMMEND", weight: 0.5 },
    { concept: "SCORE", weight: 0.2 },
  ],
  phrases: ["how can i improve", "how to improve", "what should i do"],
  clarifyLabel: "Improvement tips",
  clarifyPrompt: "How can I improve?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    if (!eff) return noDataResponse(ctx, "performance");

    const rb = new ResponseBuilder();
    const score = eff.score || 0;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = eff.throughput?.overall || 0;
    const critical = eff.predictions?.urgent?.length || 0;
    const late = eff.onTimeDelivery?.caseInsights?.casesWithPenalties || [];

    rb.say(vary(ctx, PHRASES.recommendOpener()));

    const recs = [];
    if (critical > 0) {
      recs.push([1, `keep the ${critical} critical-risk case${critical !== 1 ? "s" : ""} from going late — each one that slips costs about ${CONFIG.SCORING.LATE_PENALTY_PER_CASE} pts`]);
    }
    if (onTime < CONFIG.SCORING.ON_TIME_TARGET) {
      const gap = CONFIG.SCORING.ON_TIME_TARGET - onTime;
      const gain = (gap * CONFIG.SCORING.ON_TIME_WEIGHT).toFixed(1);
      recs.push([onTime < 70 ? 1 : 2, `lift on-time from ${U.formatPercent(onTime)} up toward ${CONFIG.SCORING.ON_TIME_TARGET}% — that's worth roughly +${gain} pts`]);
    }
    if (velocity < CONFIG.SCORING.VELOCITY_TARGET) {
      const gap = CONFIG.SCORING.VELOCITY_TARGET - velocity;
      const gain = (gap * CONFIG.SCORING.VELOCITY_WEIGHT).toFixed(1);
      recs.push([velocity < 65 ? 2 : 3, `pick up velocity from ${U.formatPercent(velocity)} toward ${CONFIG.SCORING.VELOCITY_TARGET}% (+${gain} pts on the table)`]);
    }
    if (score >= 85 && recs.length === 0) {
      recs.push([3, `finish cases early — the early-completion bonus is worth up to +${CONFIG.SCORING.MAX_EARLY_BONUS} pts per case`]);
    }

    recs.sort((a, b) => a[0] - b[0]);
    if (recs.length === 1) {
      rb.say(` ${recs[0][1]}.`);
    } else if (recs.length === 2) {
      rb.say(` ${recs[0][1]}. After that, ${recs[1][1]}.`);
    } else {
      rb.say(` ${recs[0][1]}.`);
      rb.paragraph(`Once that's settled, the next thing I'd look at is ${recs[1][1]}. And further out, ${recs[2][1]}.`);
    }

    if (late.length > 0) {
      const lost = (late.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE).toFixed(1);
      rb.paragraph(`Worth flagging: ${late.length} already-late case${late.length !== 1 ? "s have" : " has"} cost you about ${lost} pts this period — looking into the why might prevent the next batch.`);
    }

    rb.addButtons([
      critical > 0 && ["Critical cases", "Show me critical cases"],
      ["Explain score", "Why is my score what it is?"],
      ["Run scenario", "What if 3 cases go late?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// PROBLEM FINDER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "problem_finder",
  priority: 80,
  category: "ANALYTICS",
  requires: ["PROBLEM"],
  boosters: [
    { concept: "PROBLEM", weight: 0.8 },
    { concept: "STATUS", weight: 0.2 },
  ],
  phrases: ["what's wrong", "whats wrong", "biggest problem", "needs attention",
    "pain point", "what's broken"],
  clarifyLabel: "Find problems",
  clarifyPrompt: "What needs attention?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    if (!eff) return noDataResponse(ctx, "performance");

    const rb = new ResponseBuilder();
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = eff.throughput?.overall || 0;
    const critical = eff.predictions?.urgent || [];
    const late = eff.onTimeDelivery?.caseInsights?.casesWithPenalties || [];
    const score = eff.score || 0;

    const problems = [];
    if (critical.length > 0) {
      problems.push({
        sev: 1,
        text: `${critical.length} case${critical.length !== 1 ? "s" : ""} at critical risk`,
        detail: critical.slice(0, 3).map((c) => c.caseNumber).join(", "),
      });
    }
    if (late.length > 0) {
      problems.push({
        sev: 2,
        text: `${late.length} case${late.length !== 1 ? "s have" : " has"} completed late (-${(late.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE).toFixed(1)} pts)`,
      });
    }
    if (onTime < 80) {
      problems.push({
        sev: onTime < 65 ? 1 : 2,
        text: `On-time rate ${U.formatPercent(onTime)} (target 85%)`,
      });
    }
    if (velocity < 70) {
      problems.push({
        sev: velocity < 55 ? 2 : 3,
        text: `Velocity ${U.formatPercent(velocity)} (target 80%) — possible bottleneck`,
      });
    }

    if (problems.length === 0) {
      rb.say(vary(ctx, [
        `Honestly, nothing urgent right now — score's ${U.formatPercent(score)}, on-time at ${U.formatPercent(onTime)}, velocity ${U.formatPercent(velocity)}. You're holding steady.`,
        `Good news — I don't see anything critical. The numbers are solid: ${U.formatPercent(score)} score, ${U.formatPercent(onTime)} on-time, ${U.formatPercent(velocity)} velocity.`,
        `Right now there's nothing screaming for attention. Score sits at ${U.formatPercent(score)}, on-time ${U.formatPercent(onTime)}, velocity ${U.formatPercent(velocity)} — all within reasonable range.`,
      ]));
      rb.addButtons([
        ["Check status", "How am I doing?"],
        ["Improve further", "How can I improve further?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    problems.sort((a, b) => a.sev - b.sev);
    // Seed recent case list with the critical cases so "the worst one" or
    // "the first one" follow-ups can resolve to a concrete case.
    if (critical.length) {
      ctx.setRecentList("case", critical.slice(0, 5).map((c) => c.caseNumber));
    }
    rb.say(vary(ctx, [
      `So there ${problems.length === 1 ? "is" : "are"} ${problems.length} thing${problems.length === 1 ? "" : "s"} I'd flag right now, ranked from most urgent down.`,
      `Looking at this, ${problems.length} issue${problems.length === 1 ? " stands" : "s stand"} out — pressing items first.`,
      `Here's what's currently tugging at the score, severity-ranked from worst to mildest.`,
    ], "problem_finder_lead"));
    rb.kv(problems.map((p) => [
      p.sev === 1 ? "Most urgent" : p.sev === 2 ? "Watch closely" : "Lower priority",
      p.detail ? `${p.text} — specifically ${p.detail}` : p.text,
    ]));
    rb.paragraph(vary(ctx, [
      "If you want, I can walk through how to chip away at any of these one by one.",
      "Pick one and I'll dig in further — happy to break down the why or run a what-if.",
      "Worth noting: the most urgent ones tend to compound, so if you only have time for one, start at the top.",
    ], "problem_finder_close"));

    rb.addButtons([
      critical.length > 0 && ["Critical cases", "Show me critical cases"],
      ["How to fix", "How can I improve?"],
      ["Explain score", "Why is my score what it is?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// RISK ANALYZER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "risk_analyzer",
  priority: 85,
  category: "RISK",
  requires: ["RISK", "LATE"],
  boosters: [
    { concept: "RISK", weight: 0.8 },
    { concept: "LATE", weight: 0.5 },
  ],
  phrases: ["at risk", "at-risk", "critical cases", "going to be late",
    "will be late", "urgent cases", "high risk"],
  clarifyLabel: "At-risk cases",
  clarifyPrompt: "Show me critical cases",

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const preds = ctx.getPredictions();
    if (!preds?.predictions?.length) return noDataResponse(ctx, "risk");

    const all = preds.predictions;
    const stageName = ctx.getStage() ? U.titleCase(ctx.getStage()) : "current";

    const crit = all.filter((p) => p.riskLevel === "critical" || p.lateProbability > 0.8);
    const high = all.filter((p) =>
      !crit.includes(p) && (p.riskLevel === "high" ||
        (p.lateProbability > 0.5 && p.lateProbability <= 0.8)));
    const med = all.filter((p) =>
      !crit.includes(p) && !high.includes(p) &&
      (p.riskLevel === "medium" || (p.lateProbability > 0.3 && p.lateProbability <= 0.5)));
    const low = all.length - crit.length - high.length - med.length;

    rb.say(vary(ctx, [
      `Across ${stageName}, ${all.length} cases are in flight — and the risk picture breaks down to ${crit.length} critical, ${high.length} high, ${med.length} moderate, and ${low} comfortably low.`,
      `In ${stageName} you've got ${all.length} active cases. Of those, ${crit.length} are critical, ${high.length} high-risk, ${med.length} moderate, and ${low} low.`,
      `${stageName} is carrying ${all.length} cases right now. Critical: ${crit.length}. High: ${high.length}. Moderate: ${med.length}. Low: ${low}.`,
    ]));

    if (crit.length === 0 && high.length === 0) {
      rb.paragraph(med.length > 0
        ? `Honestly, nothing's screaming yet — there are ${med.length} I'd keep half an eye on, but nothing urgent.`
        : vary(ctx, [
            "Honestly, everything looks on track right now.",
            "Right now, all of them look like they'll land on time.",
          ]));
      rb.addButtons([
        ["Overview", "How am I doing?"],
        ["Scenario", "What if 3 cases go late?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    const list = (crit.length ? crit : high).slice(0, 5);
    rb.paragraph(vary(ctx, [
      "Here's where I'd point your attention first:",
      "These are the ones that need eyes today:",
      "The cases driving most of the risk:",
    ]));
    rb.kv(list.map((c) => {
      const prob = (c.lateProbability * 100).toFixed(0);
      const du = c.daysUntilDue;
      let when;
      if (du == null) when = "due date unknown";
      else if (du < 0) when = `${Math.abs(du).toFixed(1)}d overdue already`;
      else if (du < 1) when = "due today";
      else if (du < 2) when = "due tomorrow";
      else when = `due in about ${du.toFixed(1)}d`;
      return [`Case ${c.caseNumber}`, `${prob}% chance it goes late, ${when}`];
    }));

    list.forEach((c) => ctx.recordMentionedCase(c.caseNumber));
    // Record the list so "the first one" / "tell me about #2" can resolve later
    ctx.setRecentList("case", list.map((c) => c.caseNumber));

    if (crit.length > 5) {
      rb.paragraph(`There are also ${crit.length - 5} more critical cases beyond these — the full risk report has the rest. Want to dig into one in particular?`);
    } else {
      rb.paragraph("Want to dig into one of these in particular? You can also say things like \"the first one\" or \"the worst one\" and I'll pull it up.");
    }
    // Stash a clarification: if the user replies with a number or "first",
    // route into case_lookup with that case.
    ctx.setPendingClarification({
      kind: "case_number",
      command: "Tell me about case {case}",
    });

    rb.addButtons([
      ["Improve", "How can I improve?"],
      ["Scoring", "How does scoring work?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// SCORE EXPLAINER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "score_explainer",
  priority: 78,
  category: "PERFORMANCE",
  // Gate on EXPLAIN only, not SCORE alone. "my score" by itself is not a
  // request for explanation. Change-phrasings are caught via phrases (which
  // also satisfy the gate via phrase-as-gate fallback).
  requires: ["EXPLAIN"],
  boosters: [
    { concept: "EXPLAIN", weight: 0.7 },
    { concept: "SCORE", weight: 0.4 },
    { concept: "CHANGE", weight: 0.3 },
  ],
  phrases: [
    "why is my score", "why my score", "why did my score",
    "explain my score", "score breakdown", "score calculation",
    "how is score calculated", "how does scoring work",
    "how scoring works", "what affects score",
    "score change", "score changed", "score drop", "score dropped",
    "score went up", "score went down", "lost points", "gained points",
  ],
  clarifyLabel: "Explain scoring",
  clarifyPrompt: "How does scoring work?",

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const eff = ctx.getEfficiency();
    const W = CONFIG.SCORING;

    if (!eff) {
      rb.say(vary(ctx, [
        "Without your data loaded I can only walk through how the math works in general.",
        "Happy to explain the formula even without numbers in front of me.",
      ]));
      rb.paragraph(`The score is roughly ${W.ON_TIME_WEIGHT * 100}% on-time rate plus ${W.VELOCITY_WEIGHT * 100}% velocity, then each late case knocks off ${W.LATE_PENALTY_PER_CASE} pts and finishing early can earn you up to ${W.MAX_EARLY_BONUS} pts. Pick a stage from the dropdown and I'll plug in your actual numbers.`);
      rb.addButtons([["Overview", "How am I doing?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    const score = eff.score || 0;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = eff.throughput?.overall || 0;
    const late = eff.onTimeDelivery?.caseInsights?.casesWithPenalties || [];
    const prev = ctx.session.previousScore;

    const otComp = onTime * W.ON_TIME_WEIGHT;
    const velComp = velocity * W.VELOCITY_WEIGHT;
    const penalty = late.length * W.LATE_PENALTY_PER_CASE;

    rb.say(vary(ctx, [
      `Right now the score works out to ${U.formatPercent(score)}, and here's how it gets there.`,
      `So ${U.formatPercent(score)} comes out of a few moving parts — let me lay them out.`,
      `Your ${U.formatPercent(score)} is the sum of a couple of weighted pieces. Here's the math:`,
    ]));
    rb.paragraph(`On-time rate is ${U.formatPercent(onTime)}, weighted at ${W.ON_TIME_WEIGHT}, so it contributes about +${otComp.toFixed(1)}. Velocity sits at ${U.formatPercent(velocity)} and at ${W.VELOCITY_WEIGHT} weight pulls in another +${velComp.toFixed(1)}.${late.length > 0 ? ` On the other side, ${late.length} late case${late.length === 1 ? "" : "s"} cost ${penalty.toFixed(1)} pts in penalties.` : ""}`);

    if (late.length > 0 && late.length <= 5) {
      rb.paragraph(`Specifically the late ones were: ${late.map((c) => c.caseNumber).join(", ")}.`);
    }
    if (prev != null && Math.abs(score - prev) > 0.5) {
      const d = score - prev;
      const dir = d > 0 ? "up" : "down";
      rb.paragraph(`Worth noting — that's ${dir} ${Math.abs(d).toFixed(1)} pts since last time you checked.`);
    }

    rb.addButtons([
      ["At-risk cases", "Show me critical cases"],
      ["Improve", "How can I improve?"],
      ["Scenario", "What if 3 cases go late?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// SCENARIO SIMULATOR
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "scenario_simulator",
  priority: 75,
  category: "PERFORMANCE",
  requires: ["WHATIF", "IMPACT"],
  boosters: [
    { concept: "WHATIF", weight: 0.8 },
    { concept: "IMPACT", weight: 0.4 },
    { concept: "LATE", weight: 0.3 },
    { concept: "EARLY", weight: 0.3 },
  ],
  phrases: ["what if", "what would happen", "project my score", "impact of"],
  clarifyLabel: "Run a scenario",
  clarifyPrompt: "What if 3 cases go late?",

  entityBoost(entities) {
    return entities.scenarioCounts.length > 0 ? 0.5 : 0;
  },

  async handle(ctx, question, entities) {
    const eff = ctx.getEfficiency();
    if (!eff) return noDataResponse(ctx, "performance");

    const rb = new ResponseBuilder();
    const curr = eff.score || 0;
    const ot = eff.onTimeDelivery?.overall?.actualRate || 0;
    const vel = eff.throughput?.overall || 0;
    const completed = eff.completedCases || eff.sampleSize || 100;

    // Infer scenario from entities
    let lateCases = 0, earlyCases = 0, earlyDays = 2;
    for (const s of entities.scenarioCounts) {
      if (s.direction === "late" || s.direction === "overdue") lateCases = s.count;
      if (s.direction === "early" || s.direction === "ahead") earlyCases = s.count;
    }
    if (lateCases === 0 && earlyCases === 0) lateCases = 3;  // default

    const proj = ctx.scoreCalculator.project(
      { score: curr, onTimeRate: ot, velocityScore: vel, completedCases: completed },
      { lateCases, earlyCases, earlyDays }
    );

    const sign = proj.scoreDelta >= 0 ? "+" : "";
    const scenarioBits = [];
    if (lateCases) scenarioBits.push(`${lateCases} late case${lateCases === 1 ? "" : "s"}`);
    if (earlyCases) scenarioBits.push(`${earlyCases} early by ${earlyDays}d`);
    const dir = proj.scoreDelta >= 0 ? "lift" : "drop";
    rb.say(vary(ctx, [
      `So if ${scenarioBits.join(" plus ")} land${(lateCases + earlyCases) === 1 ? "s" : ""}, your score moves from ${U.formatPercent(curr)} to roughly ${U.formatPercent(proj.projectedScore)} — a ${dir} of ${sign}${proj.scoreDelta.toFixed(1)} pts.`,
      `Walking that scenario through (${scenarioBits.join(" plus ")}): you'd go from ${U.formatPercent(curr)} to about ${U.formatPercent(proj.projectedScore)}, which works out to ${sign}${proj.scoreDelta.toFixed(1)} pts overall.`,
      `Right now if I plug in ${scenarioBits.join(" plus ")}, the math works out to ${U.formatPercent(proj.projectedScore)} — that's ${sign}${proj.scoreDelta.toFixed(1)} pts off where you are now (${U.formatPercent(curr)}).`,
    ], "scenario_lead"));
    const pieces = [];
    if (proj.penalties > 0) pieces.push(`penalties run ${proj.penalties.toFixed(1)} pts`);
    if (proj.bonuses > 0) pieces.push(`bonuses pick up ${proj.bonuses.toFixed(1)}`);
    pieces.push(`new on-time would be about ${U.formatPercent(proj.newOnTimeRate)}`);
    rb.paragraph(`So under the hood: ${pieces.join(", ")}.`);

    rb.addButtons([
      ["5 late", "What if 5 cases go late?"],
      ["10 late", "What if 10 cases go late?"],
      ["3 early", "What if 3 cases complete 2 days early?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// DAILY BRIEF
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "daily_brief",
  priority: 72,
  category: "OPERATIONS",
  // BRIEF-only gate. "today"/"morning" alone are too weak and false-positive
  // on things like "what's the weather today".
  requires: ["BRIEF"],
  boosters: [
    { concept: "BRIEF", weight: 0.7 },
    { concept: "MORNING", weight: 0.4 },
  ],
  phrases: ["daily brief", "morning brief", "today's summary", "daily update"],
  clarifyLabel: "Daily brief",
  clarifyPrompt: "Give me my daily brief",

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const eff = ctx.getEfficiency();
    const stage = ctx.getStage();
    const stageCount = ctx.getStageCount();
    const preds = ctx.getPredictions();
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long", month: "short", day: "numeric",
    });

    rb.say(vary(ctx, [
      `Quick brief for ${dateStr}.`,
      `Here's where things stand on ${dateStr}.`,
      `Morning rundown for ${dateStr}:`,
    ]));

    if (!eff) {
      rb.paragraph("I don't have a stage selected, so I can't pull metrics yet — pick one from the dropdown and I'll give you the proper rundown.");
      rb.addButtons([["What can you do?", "What can you help with?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    const score = eff.score || 0;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const crit = preds?.urgent?.length || 0;
    const high = preds?.high?.length || 0;

    rb.paragraph(`You're at ${U.formatPercent(score)} (${U.scoreToRating(score)}) with on-time running ${U.formatPercent(onTime)}.${stage ? ` ${U.titleCase(stage)} stage is carrying ${stageCount} active cases right now.` : ""}${crit > 0 ? ` Of those, ${crit} ${crit === 1 ? "is" : "are"} flagged critical.` : (high > 0 ? ` ${high} ${high === 1 ? "is" : "are"} sitting in the high-risk bucket.` : "")}`);

    if (crit > 0) rb.paragraph(vary(ctx, [
      `Top of your list today: those ${crit} critical case${crit !== 1 ? "s" : ""}. Anything else can wait.`,
      `If you do one thing today, knock down the ${crit} critical case${crit !== 1 ? "s" : ""}.`,
    ]));
    else if (score < 70) rb.paragraph("If I had to pick one thing to focus on today, it would be preventing any more late deliveries.");
    else if (score >= 85) rb.paragraph("Honestly, you're in good shape — finishing a few cases early today could pick up some bonus points.");

    rb.addButtons([
      crit > 0 && ["Critical cases", "Show me critical cases"],
      ["Details", "How am I doing?"],
      ["Improve", "How can I improve?"],
      ["Find issues", "What needs attention?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// CASE LOOKUP
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "case_lookup",
  priority: 78,
  category: "DISCOVERY",
  requires: ["CASE"],
  boosters: [
    { concept: "CASE", weight: 0.5 },
    { concept: "LOOKUP", weight: 0.3 },
    { concept: "STATUS", weight: 0.2 },
  ],
  phrases: ["tell me about case", "find case", "look up case", "status of case",
    "where is case", "case number"],
  clarifyLabel: "Find a case",
  clarifyPrompt: "Find case",

  entityBoost(entities) {
    return entities.caseNumbers.length > 0 ? 0.8 : 0;
  },

  async handle(ctx, question, entities) {
    const rb = new ResponseBuilder();
    const cn = entities.caseNumbers[0] || ctx.getLastMentionedCase();

    if (!cn) {
      rb.say("Which case? Give me a number.");
      rb.paragraph('Example: "tell me about case 12345" or "status of case 67890".');
      rb.addButtons([
        ["Overview", "How am I doing?"],
        ["At-risk", "Show critical cases"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    const data = await DBKnowledge.caseByNumber(cn);

    // Fallback: if the DB had nothing (or returned an empty husk), check the
    // already-injected predictions for this case. That way a follow-up like
    // "tell me about the first one" after a critical-cases listing still
    // gives the user a meaningful answer using the data we already showed.
    if (!data || !data.casenumber) {
      const preds = ctx.getPredictions();
      const allPreds = preds?.predictions || [];
      const lateList = ctx.getEfficiency()?.caseInsights?.lateCases || [];
      const late = lateList.find((c) => String(c.caseNumber) === String(cn));
      const pred = allPreds.find((p) => String(p.caseNumber) === String(cn));
      if (pred) {
        ctx.recordMentionedCase(pred.caseNumber);
        const prob = (pred.lateProbability * 100).toFixed(0);
        const du = pred.daysUntilDue;
        let when;
        if (du == null) when = "no firm due date on record";
        else if (du < 0) when = `already ${Math.abs(du).toFixed(1)}d overdue`;
        else if (du < 1) when = "due today";
        else if (du < 2) when = "due tomorrow";
        else when = `due in about ${du.toFixed(1)}d`;
        rb.say(vary(ctx, [
          `Case ${pred.caseNumber} is the one I had flagged at ${pred.riskLevel} risk — ${prob}% chance of going late, ${when}.`,
          `Looking at this, case ${pred.caseNumber} carries a ${prob}% late probability and is ${when}. That's why it landed at ${pred.riskLevel} risk.`,
          `Right now case ${pred.caseNumber} is sitting at ${pred.riskLevel} risk: ${prob}% likely to be late, and ${when}.`,
        ], "case_lookup_pred"));
        rb.paragraph("If you want, I can run a what-if to see what happens if it slips, or pull up the others in the same risk tier.");
        ctx.setPendingOffer("Show me critical cases", "show others at the same risk");
        rb.addButtons([
          ["Same risk tier", "Show me critical cases"],
          ["Run what-if", "What if 1 case goes late?"],
          ["Overview", "How am I doing?"],
        ]);
        return rb.finalize(ctx.session.turns.length);
      }
      if (late) {
        rb.say(`Case ${late.caseNumber} completed ${late.hoursLate?.toFixed(1) || "?"}h late this period — that's the one I had on the late list.`);
        rb.paragraph(`It's ${late.type ? `a ${String(late.type).toUpperCase()} case` : "logged with no specific type"}, which gives you a sense of where the slip happened.`);
        rb.addButtons([
          ["By case type", "Compare by case type"],
          ["Overview", "How am I doing?"],
        ]);
        return rb.finalize(ctx.session.turns.length);
      }
      rb.say(`No case matches "${cn}" in the data I have loaded right now.`);
      rb.paragraph("It could be archived, in another department, or just not in the active set. Want me to search by department or pull a fresh overview?");
      rb.addButtons([
        ["Try again", "Find case"],
        ["Overview", "How am I doing?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    ctx.recordMentionedCase(data.casenumber);

    const stage = U.stageFromCase(data);
    const type = U.caseTypeFromModifiers(data.modifiers);
    // Normalize the due value once. `parsedDue.deadlineTs` is the correct ms
    // to compare `now` against for overdue/early checks; `parsedDue.calendarDay`
    // is the correct "M/D/YYYY" to show in the response.
    const parsedDue = U.parseDueDate(data.due);
    const dueDeadline = parsedDue ? parsedDue.deadlineTs : null;
    const now = new Date();
    const mods = data.modifiers || [];

    // `data.completed` is a BOOLEAN flag in the schema; the actual timestamp
    // lives in `completed_at`. Treating the boolean as a Date input is what
    // produced the "12/31/1969" rendering. We deliberately do NOT fall back
    // to `updated_at` for completion — that's just the last-edit time and
    // would falsely flag every recently-touched active case as completed.
    const isCompleted = !!data.completed;
    const completedTs = isCompleted ? (data.completed_at || null) : null;
    const completedDate = completedTs ? new Date(completedTs) : null;

    let status;
    if (isCompleted) {
      if (completedDate && dueDeadline && completedDate.getTime() > dueDeadline) {
        const h = (completedDate.getTime() - dueDeadline) / 3600000;
        const when = h > 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
        status = `completed ${U.relativeTime(completedTs)}, ${when} late`;
      } else if (completedDate) {
        status = `completed ${U.relativeTime(completedTs)}, on time`;
      } else if (dueDeadline && now.getTime() > dueDeadline) {
        // Completed flag is set but no completion timestamp — infer lateness
        // from the due date so the response is still useful instead of
        // punting with "no timestamp on record".
        const h = (now.getTime() - dueDeadline) / 3600000;
        const when = h > 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
        status = `marked completed${data.archived ? " and archived" : ""}, was due ${when} ago`;
      } else {
        status = `marked completed${data.archived ? " and archived" : ""}`;
      }
    } else if (data.archived) {
      status = "archived (not marked completed)";
    } else if (dueDeadline && now.getTime() > dueDeadline) {
      const h = (now.getTime() - dueDeadline) / 3600000;
      const amt = h > 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
      status = `overdue by ${amt}, in ${stage}`;
    } else if (dueDeadline) {
      const h = (dueDeadline - now.getTime()) / 3600000;
      if (h < 24) status = `due today, in ${stage}`;
      else if (h < 48) status = `due tomorrow, in ${stage}`;
      else status = `due in ${Math.round(h / 24)}d, in ${stage}`;
    } else {
      status = `in ${stage}`;
    }

    rb.say(`Case ${data.casenumber}: ${status}`);
    rb.kv([
      data.department && ["Department", data.department],
      type !== "general" && ["Type", type.toUpperCase()],
      data.priority && ["Priority", "yes"],
      mods.includes("rush") && ["Flag", "rush"],
      mods.includes("hold") && ["Flag", "on hold"],
      data.created_at && ["Created", U.relativeTime(data.created_at)],
      parsedDue && ["Due", parsedDue.calendarDay],
    ]);

    // Emit the History modal as a STANDALONE tag appended after the body
    // instead of nesting [MODAL:...] inside an [ACTION:...] command. The
    // UI's modal regex strips the nested tag from the cleanText pass, which
    // used to leave behind an empty `[ACTION:History|]` literal in the
    // chat bubble. Keeping the tags flat avoids that collision entirely.
    const buttons = [
      ["Another case", "Find case"],
      ["Overview", "How am I doing?"],
    ];
    rb.addButtons(buttons);
    const finalized = rb.finalize(ctx.session.turns.length);
    if (data.id && data.casenumber) {
      return `${finalized}\n[MODAL:HISTORY|${data.id}|${data.casenumber}]`;
    }
    return finalized;
  },
});

// ----------------------------------------------------------------------------
// BOTTLENECK FINDER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "bottleneck_finder",
  priority: 70,
  category: "ANALYTICS",
  requires: ["BOTTLENECK", "SLOW"],
  boosters: [
    { concept: "BOTTLENECK", weight: 0.8 },
    { concept: "SLOW", weight: 0.5 },
  ],
  phrases: ["where are the bottlenecks", "what's slowing", "slowest stage",
    "slowing things down", "backed up"],
  clarifyLabel: "Find bottlenecks",
  clarifyPrompt: "Where are the bottlenecks?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    const stageStats = ctx.getStageStats();
    const tp = ctx.getThroughput();
    if (!eff && !stageStats && !tp) return noDataResponse(ctx, "workflow");

    const rb = new ResponseBuilder();
    let found = false;

    if (tp?.byType) {
      const types = Object.entries(tp.byType)
        .filter(([, d]) => d.count > 0)
        .sort((a, b) => (a[1].velocityScore || 100) - (b[1].velocityScore || 100));
      if (types.length > 1) {
        const [slow, slowData] = types[0];
        const [fast, fastData] = types[types.length - 1];
        if ((slowData.velocityScore || 100) < 70) {
          found = true;
          const gap = (fastData.velocityScore || 0) - (slowData.velocityScore || 0);
          rb.say(vary(ctx, [
            `Looking at this, ${U.titleCase(slow)} cases are the choke point — they're running at ${U.formatPercent(slowData.velocityScore || 0)} velocity while ${U.titleCase(fast)} is hitting ${U.formatPercent(fastData.velocityScore || 0)}.`,
            `The drag is coming from ${U.titleCase(slow)} cases. They're at ${U.formatPercent(slowData.velocityScore || 0)} compared to ${U.titleCase(fast)} at ${U.formatPercent(fastData.velocityScore || 0)}.`,
            `So ${U.titleCase(slow)} jobs are where things are slowing down — ${U.formatPercent(slowData.velocityScore || 0)} velocity vs ${U.formatPercent(fastData.velocityScore || 0)} for ${U.titleCase(fast)}.`,
          ]));
          if (gap > 20) rb.paragraph(`A ${gap.toFixed(0)}-point gap is big enough that it's worth digging into the why.`);
        }
      }
    }

    if (stageStats?.typeStats && !found) {
      const types = Object.entries(stageStats.typeStats)
        .filter(([, s]) => s.count > 0)
        .sort((a, b) => (b[1].mean || 0) - (a[1].mean || 0));
      if (types.length > 0) {
        const [type, s] = types[0];
        const avg = U.formatDuration(s.mean || 0);
        if (s.mean > (stageStats.averageTime || 0) * 1.3) {
          found = true;
          rb.say(`${U.titleCase(type)} cases are taking the longest right now — averaging ${avg} versus the overall stage average of ${U.formatDuration(stageStats.averageTime || 0)}.`);
        }
      }
    }

    const velocity = eff?.throughput?.overall || 0;
    if (velocity < 70 && !found) {
      found = true;
      rb.say(`Overall velocity is sitting at ${U.formatPercent(velocity)}, and the slowdown looks systemic rather than tied to one case type — I'd check for handoff delays between stages.`);
    }

    if (!found) rb.say(vary(ctx, [
      "Honestly, I don't see an obvious bottleneck — case types are moving at fairly similar rates right now.",
      "Right now, nothing stands out as a clear choke point. The case types are pacing within a normal spread.",
    ]));

    rb.addButtons([
      ["Overview", "How am I doing?"],
      ["Find issues", "What needs attention?"],
      ["Improve", "How can I improve?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// TREND ANALYZER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "trend_analyzer",
  priority: 68,
  category: "PERFORMANCE",
  requires: ["TREND", "CHANGE"],
  boosters: [
    { concept: "TREND", weight: 0.7 },
    { concept: "CHANGE", weight: 0.4 },
    { concept: "TIME", weight: 0.2 },
  ],
  phrases: ["over time", "getting better", "getting worse", "compared to before",
    "historical", "trending up", "trending down", "improving over", "declining over"],
  clarifyLabel: "Trends",
  clarifyPrompt: "What are the trends?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    if (!eff) return noDataResponse(ctx, "performance");

    const rb = new ResponseBuilder();
    const score = eff.score || 0;
    const prev = ctx.session.previousScore;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = eff.throughput?.overall || 0;

    if (prev != null && Math.abs(score - prev) > 0.5) {
      const d = score - prev;
      const dir = d > 0 ? "up" : "down";
      rb.say(vary(ctx, [
        `So you're ${dir} ${Math.abs(d).toFixed(1)} pts since last check — ${d > 0 ? "things are moving in the right direction" : "the slide is something to watch"}.`,
        `Right now you're ${dir} about ${Math.abs(d).toFixed(1)} pts compared to the last time we looked.`,
      ]));
    } else {
      rb.say(vary(ctx, [
        "Score is basically holding steady — I'd want a few more data points before calling it a real trend.",
        "Honestly, things are stable enough that I can't yet say which way it's heading.",
        "The score isn't really moving — I'll need more readings to spot a true direction.",
      ]));
    }

    // Cross-metric pattern
    if (onTime < 80 && velocity >= 75) {
      rb.paragraph("Looking at the pattern: velocity is solid but on-time is lagging, which usually means cases are sitting too long before pickup, or due dates are too tight.");
    } else if (velocity < 70 && onTime >= 80) {
      rb.paragraph("Worth noting — you're meeting deadlines but the throughput is slow. Probably means there's buffer baked into the due dates. Safe, but not ideal.");
    } else if (onTime < 75 && velocity < 70) {
      rb.paragraph("Both metrics are under target right now, which says the issue is systemic rather than isolated to one type of work.");
    }

    rb.paragraph("If you want period-over-period charts, the dashboard has those laid out properly.");
    rb.addButtons([
      ["Overview", "How am I doing?"],
      ["Find issues", "What needs attention?"],
      ["Improve", "How can I improve?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// TRACE VIEWER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "trace_viewer",
  priority: 40,
  category: "DEVELOPER",
  requires: ["DEBUG"],
  boosters: [{ concept: "DEBUG", weight: 0.6 }],
  phrases: ["show trace", "routing history", "which component", "debug mode"],
  clarifyLabel: "Debug trace",
  clarifyPrompt: "Show trace",

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const hist = ctx.session.componentHistory.slice(-10);
    const turns = ctx.session.turns.slice(-10);

    if (hist.length === 0) {
      rb.say("No history yet. Ask some questions first.");
      rb.addButtons([["Overview", "How am I doing?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    rb.say(`Last ${hist.length} turns:`);
    rb.kv(hist.slice().reverse().map((h, i) => {
      const time = new Date(h.timestamp).toLocaleTimeString();
      const turn = turns[turns.length - 1 - i];
      const q = (turn?.q || "").substring(0, 40);
      return [time, `${h.componentId} ← "${q}"`];
    }));

    rb.addButtons([["Overview", "How am I doing?"]]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// SCHEMA EXPLORER
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "schema_explorer",
  priority: 50,
  category: "DATA",
  requires: ["SCHEMA"],
  boosters: [{ concept: "SCHEMA", weight: 0.7 }],
  phrases: ["what tables", "database structure", "data model", "show tables"],
  clarifyLabel: "Schema",
  clarifyPrompt: "Show me the schema",

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const schema = await DBKnowledge.schemaOverview();
    const tables = Object.keys(schema.tables || {});
    rb.say(vary(ctx, [
      `Right now there are ${tables.length} main tables in play: ${tables.join(", ")}.`,
      `The database has ${tables.length} core tables — ${tables.join(", ")}.`,
      `So at the schema level you've got ${tables.length} tables: ${tables.join(", ")}.`,
    ]));
    rb.paragraph("Quick map: `cases` holds the work items themselves, `case_history` is the audit trail of every change, and `active_devices` tracks who's currently online.");
    rb.addButtons([
      ["Overview", "How am I doing?"],
      ["What can you do?", "What can you help with?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// CASE TYPE COMPARATOR (v4.1)
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "case_type_comparator",
  priority: 76,
  category: "ANALYTICS",
  requires: ["CASE_TYPE", "TYPE_COMPARE", "VELOCITY", "EFFICIENCY"],
  boosters: [
    { concept: "CASE_TYPE", weight: 0.6 },
    { concept: "TYPE_COMPARE", weight: 0.5 },
    { concept: "BREAKDOWN", weight: 0.3 },
    { concept: "VELOCITY", weight: 0.2 },
  ],
  phrases: [
    "compare bbs", "compare flex", "by case type", "case type breakdown",
    "bbs vs flex", "flex vs bbs", "which type", "case type comparison",
    "throughput by type", "velocity by type", "general vs bbs", "bbs vs general",
  ],
  clarifyLabel: "Case-type comparison",
  clarifyPrompt: "Compare BBS vs Flex throughput",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    if (!eff?.throughput?.byType) return noDataResponse(ctx, "case-type");

    const rb = new ResponseBuilder();
    const types = Object.entries(eff.throughput.byType)
      .filter(([, d]) => d.count > 0)
      .map(([t, d]) => ({
        type: t,
        count: d.count,
        velocity: d.velocityScore || 0,
        meanH: (d.mean || 0) / 3600000,
      }));

    if (types.length < 2) {
      rb.say("Honestly, there isn't enough data across types to do a meaningful comparison right now — you've got just one type with material volume.");
      rb.addButtons([["Overview", "How am I doing?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    types.sort((a, b) => b.velocity - a.velocity);
    const fast = types[0];
    const slow = types[types.length - 1];

    rb.say(vary(ctx, [
      `Looking across case types, ${U.titleCase(fast.type).toUpperCase()} is your strongest at ${U.formatPercent(fast.velocity)} velocity, while ${U.titleCase(slow.type).toUpperCase()} is the slowest at ${U.formatPercent(slow.velocity)}.`,
      `Right now ${U.titleCase(fast.type).toUpperCase()} cases lead the pack (${U.formatPercent(fast.velocity)} velocity) and ${U.titleCase(slow.type).toUpperCase()} are bringing up the rear at ${U.formatPercent(slow.velocity)}.`,
      `Comparing the case types: ${U.titleCase(fast.type).toUpperCase()} runs fastest at ${U.formatPercent(fast.velocity)}, ${U.titleCase(slow.type).toUpperCase()} is slowest at ${U.formatPercent(slow.velocity)}.`,
    ]));

    rb.paragraph(`Volume-wise, you've got ${types.map((t) => `${t.count} ${U.titleCase(t.type).toUpperCase()}`).join(", ")} cases active. Average completion times run from ${slow.meanH.toFixed(1)}h on the slow end to ${fast.meanH.toFixed(1)}h on the fast end.`);

    const gap = fast.velocity - slow.velocity;
    if (gap > 20) {
      rb.paragraph(`A ${gap.toFixed(0)}-point velocity gap between case types is large enough to be worth investigating — usually that means a workflow or staffing pattern specific to ${U.titleCase(slow.type).toUpperCase()}. Want to drill into one type — BBS, Flex, or General?`);
    } else if (gap < 8) {
      rb.paragraph("Honestly, the spread between types is tight enough that I wouldn't call it out as a problem — case mix isn't really hurting you.");
    } else {
      rb.paragraph("Want to drill into one type — BBS, Flex, or General?");
    }
    // Allow the user to answer with a bare type name
    ctx.setPendingClarification({
      kind: "case_type",
      command: "Compare by case type {type}",
    });
    ctx.setRecentList("case_type", types.map((t) => t.type));

    rb.addButtons([
      ["Bottlenecks", "Where are the bottlenecks?"],
      ["Overview", "How am I doing?"],
      ["Improve", "How can I improve?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// BUFFER COMPLIANCE (v4.1)
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "buffer_compliance",
  priority: 74,
  category: "ANALYTICS",
  requires: ["BUFFER"],
  boosters: [
    { concept: "BUFFER", weight: 0.8 },
    { concept: "PROBLEM", weight: 0.2 },
  ],
  phrases: ["buffer compliance", "design buffer", "production buffer", "handoff buffer",
    "buffer rule", "buffer violation", "meeting buffer", "buffer timing", "transition timing"],
  clarifyLabel: "Buffer compliance",
  clarifyPrompt: "What's our buffer compliance looking like?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    const bc = eff?.onTimeDelivery?.overall?.bufferCompliance;
    const sba = eff?.onTimeDelivery?.stageBufferAnalysis;
    if (!bc && !sba) return noDataResponse(ctx, "buffer compliance");

    const rb = new ResponseBuilder();
    const pct = (x) => U.formatPercent((x || 0) * 100);

    if (bc) {
      const overall = bc.current ?? bc.production ?? bc.design ?? 0;
      const overallTone = overall >= 0.85 ? "in good shape"
        : overall >= 0.7 ? "mostly hitting target with some slippage"
        : "well below where we'd want it";
      rb.say(vary(ctx, [
        `Right now your overall buffer compliance is ${pct(overall)}, which is ${overallTone}.`,
        `Looking at this, you're hitting ${pct(overall)} of your stage handoff buffers — ${overallTone}.`,
        `Buffer compliance sits at ${pct(overall)} overall. That's ${overallTone}.`,
      ]));
      rb.paragraph(`Stage by stage: design is at ${pct(bc.design)}, production at ${pct(bc.production)}, finishing at ${pct(bc.finishing)}.`);
    }

    if (sba) {
      const totalViol = (sba.designViolations || 0) + (sba.productionViolations || 0) + (sba.finishingViolations || 0);
      if (totalViol > 0) {
        const worst = ["design", "production", "finishing"]
          .map((s) => ({ s, n: sba[`${s}Violations`] || 0 }))
          .sort((a, b) => b.n - a.n)[0];
        rb.paragraph(`So far this period there have been ${totalViol} buffer violation${totalViol === 1 ? "" : "s"} across all stages, and the heaviest concentration is in ${worst.s} (${worst.n} of them).${sba.commonPatterns?.length ? ` The pattern I see most often is: ${sba.commonPatterns[0]}.` : ""}`);
      } else {
        rb.paragraph("Good news — no buffer violations recorded this period.");
      }
    }

    // If the user has set a stage in conversation context (e.g. "design
    // specifically?" after the overview), zoom into that stage.
    const stageEntity = ctx.getSubjectEntity("stage");
    if (stageEntity && bc) {
      const v = bc[stageEntity];
      if (v != null) {
        rb.paragraph(`Zooming into ${stageEntity} specifically: compliance there is ${pct(v)}, with ${(sba?.[`${stageEntity}Violations`] || 0)} violation${(sba?.[`${stageEntity}Violations`] || 0) === 1 ? "" : "s"} on the books.`);
      }
    } else {
      rb.paragraph("Want to zoom into one stage — design, production, or finishing?");
      ctx.setPendingClarification({
        kind: "choice",
        choices: [
          { match: "design", command: "Design buffer compliance" },
          { match: "production", command: "Production buffer compliance" },
          { match: "finishing", command: "Finishing buffer compliance" },
        ],
        command: "buffer drilldown",
      });
    }

    rb.addButtons([
      ["Bottlenecks", "Where are the bottlenecks?"],
      ["Find issues", "What needs attention?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// RUSH HANDLER (v4.1)
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "rush_handler",
  priority: 73,
  category: "ANALYTICS",
  requires: ["RUSH"],
  boosters: [
    { concept: "RUSH", weight: 0.8 },
    { concept: "PROBLEM", weight: 0.2 },
    { concept: "IMPACT", weight: 0.2 },
  ],
  phrases: ["rush case", "rush job", "rush load", "rush count", "rush impact",
    "priority case", "high priority case", "rush reduction"],
  clarifyLabel: "Rush analysis",
  clarifyPrompt: "How many rush cases are open?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    const o = eff?.onTimeDelivery?.overall;
    if (!o) return noDataResponse(ctx, "rush");

    const rb = new ResponseBuilder();
    const rushCount = o.rushPriorityCount || 0;
    const reduction = o.rushReductionFactor || 0;

    if (rushCount === 0) {
      rb.say(vary(ctx, [
        "Honestly, there are no rush cases on the board right now — that's actually a healthy place to be.",
        "Right now you've got zero rush cases active. Nothing to compensate for.",
      ]));
      rb.addButtons([["Overview", "How am I doing?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    const tone = rushCount >= 10 ? "heavy load"
      : rushCount >= 5 ? "moderate load"
      : "manageable handful";
    rb.say(vary(ctx, [
      `So you're carrying ${rushCount} rush case${rushCount === 1 ? "" : "s"} on the board — that's a ${tone} for the floor.`,
      `Honestly, ${rushCount} rush case${rushCount === 1 ? "" : "s"} ${rushCount === 1 ? "is" : "are"} a ${tone} — that's where you currently stand.`,
      `From what I can see, ${rushCount} rush case${rushCount === 1 ? "" : "s"} ${rushCount === 1 ? "is" : "are"} active, which lands at a ${tone}.`,
      `The rush picture: ${rushCount} active right now, which I'd describe as a ${tone}.`,
    ], "rush_lead"));

    if (reduction > 0) {
      const pct = (reduction * 100).toFixed(0);
      const impact = reduction >= 0.2 ? "noticeably dragging" : reduction >= 0.1 ? "modestly hurting" : "barely touching";
      rb.paragraph(`The rush reduction factor sits at ${pct}%, meaning the volume of rush work is ${impact} your effective throughput. Each rush case shrinks your normal-priority capacity, so a high count compounds quickly.`);
    }

    if (rushCount >= 5) {
      rb.paragraph("Worth flagging to whoever's accepting rush jobs — sustained rush volume above five tends to leak into late penalties on the regular work.");
    }

    rb.addButtons([
      ["At-risk cases", "Show critical cases"],
      ["Overview", "How am I doing?"],
      ["Improve", "How can I improve?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// LATE-CASE DETAIL (v4.1)
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "late_case_detail",
  priority: 72,
  category: "ANALYTICS",
  requires: ["LATE"],
  boosters: [
    { concept: "LATE", weight: 0.8 },
    { concept: "LOOKUP", weight: 0.3 },
    { concept: "PROBLEM", weight: 0.2 },
  ],
  phrases: ["late cases", "completed late", "list late", "every late case",
    "late case detail", "late pattern", "which cases are late", "late this period"],
  clarifyLabel: "Late cases",
  clarifyPrompt: "List every case that completed late",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    const list = eff?.caseInsights?.lateCases
              || eff?.onTimeDelivery?.caseInsights?.casesWithPenalties
              || [];

    if (!list.length) {
      const rb = new ResponseBuilder();
      rb.say(vary(ctx, [
        "Right now there's nothing to show — no cases have completed late this period.",
        "Honestly, you don't have any late completions on record for this period. That's a clean slate.",
      ]));
      rb.addButtons([["Overview", "How am I doing?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    const rb = new ResponseBuilder();
    const total = list.length;
    const pen = (total * CONFIG.SCORING.LATE_PENALTY_PER_CASE).toFixed(1);

    rb.say(vary(ctx, [
      `So ${total} case${total === 1 ? " has" : "s have"} completed late this period — that's roughly ${pen} pts off the score in penalties.`,
      `Honestly, ${total} late completion${total === 1 ? "" : "s"} ${total === 1 ? "has" : "have"} hit the books this period, costing about ${pen} pts.`,
      `Looking at this, ${total} case${total === 1 ? "" : "s"} ran past due, eating roughly ${pen} pts off the score.`,
      `The late tally for this period: ${total} case${total === 1 ? "" : "s"}, accounting for around ${pen} pts in penalties.`,
    ], "late_lead"));

    const sample = list.slice(0, 6);
    ctx.setRecentList("case", sample.map((c) => c.caseNumber));
    if (sample.some((c) => c.hoursLate != null)) {
      rb.paragraph("Here's the sample by lateness:");
      rb.kv(sample.map((c) => {
        const h = c.hoursLate != null
          ? (c.hoursLate < 24 ? `${c.hoursLate.toFixed(1)}h late` : `${(c.hoursLate / 24).toFixed(1)}d late`)
          : "late";
        const t = c.type ? ` (${String(c.type).toUpperCase()})` : "";
        return [`Case ${c.caseNumber}`, `${h}${t}`];
      }));
      const types = [...new Set(sample.map((c) => c.type).filter(Boolean))];
      if (types.length === 1) {
        rb.paragraph(`Worth noting they're all ${String(types[0]).toUpperCase()} cases — that's a strong hint about where to dig.`);
      } else if (types.length > 1) {
        rb.paragraph(`The mix spans ${types.map((t) => String(t).toUpperCase()).join(" and ")}, so it doesn't look like one case type is solely to blame.`);
      } else {
        rb.paragraph("Looking across these, the spread of severity is what I'd dig into first.");
      }
    } else {
      rb.paragraph(`Cases involved: ${sample.map((c) => c.caseNumber).join(", ")}${total > sample.length ? `, plus ${total - sample.length} more` : ""}.`);
    }

    if (total >= 3) {
      rb.paragraph("If there's a common case type or stage across these, that's usually the most productive place to start a root cause.");
    }

    rb.addButtons([
      ["By case type", "Compare by case type"],
      ["Bottlenecks", "Where are the bottlenecks?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ----------------------------------------------------------------------------
// DATA QUALITY INSPECTOR (v4.1)
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "data_quality",
  priority: 65,
  category: "ANALYTICS",
  requires: ["QUALITY"],
  boosters: [{ concept: "QUALITY", weight: 0.8 }],
  phrases: ["how confident", "how reliable", "trust these numbers", "sample size",
    "data quality", "are these numbers", "is this reliable", "trustworthy"],
  clarifyLabel: "Data confidence",
  clarifyPrompt: "How reliable is the score given our sample size?",

  async handle(ctx) {
    const eff = ctx.getEfficiency();
    const stageStats = ctx.getStageStats();
    const rb = new ResponseBuilder();

    const sample = eff?.sampleSize ?? stageStats?.sampleSize ?? 0;
    const conf = eff?.confidence || (sample >= 80 ? "high" : sample >= 30 ? "moderate" : "low");
    const dq = stageStats?.dataQuality;

    rb.say(vary(ctx, [
      `Honestly, with ${sample} cases in the sample, I'd put my confidence at ${conf}.`,
      `Right now you've got ${sample} cases of data feeding the math — that puts the confidence in ${conf} territory.`,
      `Looking at this, ${sample} sample cases means the numbers are at ${conf} confidence.`,
    ]));

    if (sample < 30) {
      rb.paragraph("With a sample this small, individual cases swing the average a lot — treat the score directionally, not as a precise reading.");
    } else if (sample < 80) {
      rb.paragraph("That's a workable sample for trend-spotting, but the smaller it is the more sensitive the score is to a few outliers.");
    } else {
      rb.paragraph("That's a healthy sample — the score should be stable enough to base decisions on.");
    }

    if (dq?.issues?.length) {
      rb.paragraph(`Worth flagging on the data side: ${dq.issues[0]}.`);
    }

    rb.addButtons([
      ["Score breakdown", "Why is my score what it is?"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
  },
});

// ============================================================================
// EXPORTS
// ============================================================================
let _engineInstance = null;

export default async function askSystem(question, extraContext = {}) {
  if (!_engineInstance) _engineInstance = new AppQAKernel();
  return await _engineInstance.ask(question, extraContext);
}

export {
  AppQAKernel,
  COMPONENTS,
  ScoreCalculator,
  scoreCalc,
  ResponseBuilder,
  Buttons,
  IntentRouter,
  ResponseOrchestrator,
  Cache,
  U as Utils,
  CONFIG,
  DBKnowledge,
  normalize,
  extractEntities,
  CONCEPTS,
  lemma,
};