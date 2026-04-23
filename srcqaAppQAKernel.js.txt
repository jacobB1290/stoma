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
  VERSION: "4.0.0",
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
  IMPROVE: ["improve", "better", "boost", "raise", "increase", "enhance", "lift", "gain"],
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

  static async caseByNumber(cn) {
    const exact = await U.safeDb(
      db.from("cases").select("*").eq("casenumber", cn).limit(1).single()
    );
    if (exact?.data) return exact.data;
    const like = await U.safeDb(
      db.from("cases").select("*")
        .ilike("casenumber", `%${cn}%`)
        .order("created_at", { ascending: false }).limit(5)
    );
    if (like?.data?.length) return like.data[0];
    return null;
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
    };
    this.injectedData = null;
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
  pickVariation(options) {
    const i = this.session.variationIdx++ % options.length;
    return options[i];
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
    rb.paragraph(
      `Your score is ${U.formatNumber(score)} and ${critCount} case${critCount === 1 ? "" : "s"} ${critCount === 1 ? "is" : "are"} critical right now — want to look at those?`
    );
    rb.addButtons([
      ["Show critical cases", "Which cases are critical?"],
      ["Why is my score where it is?", "Explain my score"],
    ]);
  } else if (score != null) {
    rb.paragraph(
      `Your score is ${U.formatNumber(score)}. I can break that down, flag risks, or walk through what's slowing things down.`
    );
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
    const greeting = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

    if (q === "" || /^(hi|hello|hey|sup|greetings|yo|howdy)\s*[!.?]*$/i.test(q)) {
      rb.say(`${greeting}.`);
      if (eff) {
        const score = eff.score || 0;
        rb.say(` Score is ${U.formatPercent(score)} (${U.scoreToRating(score)}).`);
      }
      rb.paragraph("What do you want to check?");
      rb.addButtons([
        ["How am I doing?", "How am I doing?"],
        ["What needs attention?", "What needs attention?"],
        ["Critical cases", "Show critical cases"],
        ["How to improve", "How can I improve?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    if (/help/.test(q) || /what can you/i.test(q)) {
      rb.say("I can answer questions about your performance, cases, and workflow.");
      rb.paragraph("Try: score check, at-risk cases, bottlenecks, or a what-if scenario.");
      rb.addButtons([
        ["Check score", "What's my score?"],
        ["Problems", "What needs attention?"],
        ["At-risk", "Show critical cases"],
        ["Daily brief", "Give me my daily brief"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    // Fallback for nothing-matched
    rb.say("Not sure what you're asking. Pick one of these?");
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
    const header = `${U.formatPercent(score)} — ${rating}` + (stage ? ` (${U.titleCase(stage)})` : "");
    rb.say(header);

    rb.kv([
      ["On-time", U.formatPercent(onTime)],
      ["Velocity", U.formatPercent(velocity)],
      stageCount > 0 && ["Active cases", stageCount],
      critical > 0 && ["At critical risk", critical],
    ]);

    // One-line diagnosis
    if (critical > 0) {
      rb.paragraph(`${critical} case${critical !== 1 ? "s" : ""} need attention now.`);
    } else if (onTime < 70) {
      rb.paragraph("On-time delivery is the main drag.");
    } else if (velocity < 65) {
      rb.paragraph("Velocity is low — likely a bottleneck somewhere.");
    } else if (score >= 85) {
      rb.paragraph("Looking solid.");
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

    rb.say(`Current score: ${U.formatPercent(score)}. Biggest levers:`);

    const recs = [];
    if (critical > 0) {
      recs.push([1, `Address ${critical} critical-risk case${critical !== 1 ? "s" : ""} (each late = -${CONFIG.SCORING.LATE_PENALTY_PER_CASE} pts)`]);
    }
    if (onTime < CONFIG.SCORING.ON_TIME_TARGET) {
      const gap = CONFIG.SCORING.ON_TIME_TARGET - onTime;
      const gain = (gap * CONFIG.SCORING.ON_TIME_WEIGHT).toFixed(1);
      recs.push([onTime < 70 ? 1 : 2, `Raise on-time from ${U.formatPercent(onTime)} → ${CONFIG.SCORING.ON_TIME_TARGET}% (+${gain} pts)`]);
    }
    if (velocity < CONFIG.SCORING.VELOCITY_TARGET) {
      const gap = CONFIG.SCORING.VELOCITY_TARGET - velocity;
      const gain = (gap * CONFIG.SCORING.VELOCITY_WEIGHT).toFixed(1);
      recs.push([velocity < 65 ? 2 : 3, `Improve velocity from ${U.formatPercent(velocity)} → ${CONFIG.SCORING.VELOCITY_TARGET}% (+${gain} pts)`]);
    }
    if (score >= 85 && recs.length === 0) {
      recs.push([3, `Finish cases early for up to +${CONFIG.SCORING.MAX_EARLY_BONUS} pts per case`]);
    }

    recs.sort((a, b) => a[0] - b[0]);
    rb.kv(recs.map(([p, t]) => [`P${p}`, t]));

    if (late.length > 0) {
      const lost = (late.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE).toFixed(1);
      rb.paragraph(`${late.length} already-late case${late.length !== 1 ? "s have" : " has"} cost ${lost} pts this period. Investigate why.`);
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
      rb.say(`Nothing urgent. Score ${U.formatPercent(score)}, on-time ${U.formatPercent(onTime)}, velocity ${U.formatPercent(velocity)}.`);
      rb.addButtons([
        ["Check status", "How am I doing?"],
        ["Improve further", "How can I improve further?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    problems.sort((a, b) => a.sev - b.sev);
    rb.say(`${problems.length} issue${problems.length !== 1 ? "s" : ""} in order of severity:`);
    rb.kv(problems.map((p) => [
      `P${p.sev}`,
      p.detail ? `${p.text} (${p.detail})` : p.text,
    ]));

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

    rb.say(`${stageName}: ${all.length} active, ${crit.length} critical, ${high.length} high, ${med.length} moderate, ${low} low.`);

    if (crit.length === 0 && high.length === 0) {
      rb.paragraph(med.length > 0
        ? `${med.length} to keep an eye on, nothing urgent.`
        : "All on track.");
      rb.addButtons([
        ["Overview", "How am I doing?"],
        ["Scenario", "What if 3 cases go late?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    const list = (crit.length ? crit : high).slice(0, 5);
    rb.kv(list.map((c) => {
      const prob = (c.lateProbability * 100).toFixed(0);
      const du = c.daysUntilDue;
      let when;
      if (du == null) when = "due date unknown";
      else if (du < 0) when = `${Math.abs(du).toFixed(1)}d overdue`;
      else if (du < 1) when = "due today";
      else if (du < 2) when = "due tomorrow";
      else when = `due in ${du.toFixed(1)}d`;
      return [`Case ${c.caseNumber}`, `${prob}% late, ${when}`];
    }));

    list.forEach((c) => ctx.recordMentionedCase(c.caseNumber));

    if (crit.length > 5) {
      rb.paragraph(`+${crit.length - 5} more critical. See full risk report.`);
    }

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
      rb.say("How scoring works, without your data:");
      rb.kv([
        ["On-time rate weight", `${W.ON_TIME_WEIGHT * 100}%`],
        ["Velocity weight", `${W.VELOCITY_WEIGHT * 100}%`],
        ["Per-late penalty", `-${W.LATE_PENALTY_PER_CASE} pts`],
        ["Early-completion bonus", `up to +${W.MAX_EARLY_BONUS} pts`],
      ]);
      rb.paragraph("Select a stage to see your actual breakdown.");
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

    rb.say(`Score breakdown: ${U.formatPercent(score)}`);
    rb.kv([
      [`On-time × ${W.ON_TIME_WEIGHT}`, `${U.formatPercent(onTime)} → +${otComp.toFixed(1)}`],
      [`Velocity × ${W.VELOCITY_WEIGHT}`, `${U.formatPercent(velocity)} → +${velComp.toFixed(1)}`],
      late.length > 0 && [`Late penalties (${late.length})`, `-${penalty.toFixed(1)}`],
      ["Base total", `${(otComp + velComp - penalty).toFixed(1)}`],
    ]);

    if (late.length > 0 && late.length <= 5) {
      rb.paragraph(`Late cases: ${late.map((c) => c.caseNumber).join(", ")}.`);
    }
    if (prev != null && Math.abs(score - prev) > 0.5) {
      const d = score - prev;
      rb.paragraph(`${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(1)} pts since last check.`);
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
    rb.say(`Scenario: ${lateCases ? `${lateCases} late` : ""}${earlyCases ? `${earlyCases} early by ${earlyDays}d` : ""}`);
    rb.kv([
      ["Current", U.formatPercent(curr)],
      ["Projected", U.formatPercent(proj.projectedScore)],
      ["Delta", `${sign}${proj.scoreDelta.toFixed(1)} pts`],
      proj.penalties > 0 && ["Penalty", `-${proj.penalties.toFixed(1)}`],
      proj.bonuses > 0 && ["Bonus", `+${proj.bonuses.toFixed(1)}`],
      ["New on-time", U.formatPercent(proj.newOnTimeRate)],
    ]);

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

    rb.say(`Brief — ${dateStr}`);

    if (!eff) {
      rb.paragraph("No stage selected. Pick one from the dropdown for metrics.");
      rb.addButtons([["What can you do?", "What can you help with?"]]);
      return rb.finalize(ctx.session.turns.length);
    }

    const score = eff.score || 0;
    const onTime = eff.onTimeDelivery?.overall?.actualRate || 0;
    const crit = preds?.urgent?.length || 0;
    const high = preds?.high?.length || 0;

    rb.kv([
      ["Score", `${U.formatPercent(score)} (${U.scoreToRating(score)})`],
      ["On-time", U.formatPercent(onTime)],
      stage && ["Stage", `${U.titleCase(stage)} (${stageCount} active)`],
      crit > 0 && ["Critical", crit],
      !crit && high > 0 && ["High risk", high],
    ]);

    if (crit > 0) rb.paragraph(`Top priority: ${crit} critical case${crit !== 1 ? "s" : ""}.`);
    else if (score < 70) rb.paragraph("Focus on preventing late deliveries today.");
    else if (score >= 85) rb.paragraph("Solid. Early completions can pick up bonus points.");

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
    if (!data) {
      rb.say(`No case matches "${cn}".`);
      rb.paragraph("Could be archived or in another department. Check the number.");
      rb.addButtons([
        ["Try again", "Find case"],
        ["Overview", "How am I doing?"],
      ]);
      return rb.finalize(ctx.session.turns.length);
    }

    ctx.recordMentionedCase(data.casenumber);

    const stage = U.stageFromCase(data);
    const type = U.caseTypeFromModifiers(data.modifiers);
    const due = data.due ? new Date(data.due) : null;
    const now = new Date();
    const mods = data.modifiers || [];

    let status;
    if (data.completed) {
      const cd = new Date(data.completed);
      if (due && cd > due) {
        const h = (cd - due) / 3600000;
        const when = h > 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
        status = `completed ${U.relativeTime(data.completed)}, ${when} late`;
      } else {
        status = `completed ${U.relativeTime(data.completed)}, on time`;
      }
    } else if (data.archived) {
      status = "archived";
    } else if (due && now > due) {
      const h = (now - due) / 3600000;
      const amt = h > 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`;
      status = `overdue by ${amt}, in ${stage}`;
    } else if (due) {
      const h = (due - now) / 3600000;
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
      due && ["Due", due.toLocaleDateString()],
    ]);

    rb.addButtons([
      ["History", `[MODAL:HISTORY|${data.id}|${data.casenumber}]`],
      ["Another case", "Find case"],
      ["Overview", "How am I doing?"],
    ]);
    return rb.finalize(ctx.session.turns.length);
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
          rb.say(`${U.titleCase(slow)} cases are the choke point (${U.formatPercent(slowData.velocityScore || 0)} vs ${U.formatPercent(fastData.velocityScore || 0)} for ${U.titleCase(fast)}).`);
          if (gap > 20) rb.paragraph(`Gap of ${gap.toFixed(0)} pts — worth investigating.`);
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
          rb.say(`${U.titleCase(type)} cases take ${avg} (vs ${U.formatDuration(stageStats.averageTime || 0)} avg).`);
        }
      }
    }

    const velocity = eff?.throughput?.overall || 0;
    if (velocity < 70 && !found) {
      found = true;
      rb.say(`Overall velocity ${U.formatPercent(velocity)} — looks systemic, not one case type. Check for handoff delays.`);
    }

    if (!found) rb.say("No obvious bottleneck. Case types are moving at similar rates.");

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
      rb.say(`${d > 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(1)} pts since last check.`);
    } else {
      rb.say("Score stable. Need more data points to see a real trend.");
    }

    // Cross-metric pattern
    if (onTime < 80 && velocity >= 75) {
      rb.paragraph("Velocity solid, on-time lagging → cases sit too long before pickup, or due dates are too tight.");
    } else if (velocity < 70 && onTime >= 80) {
      rb.paragraph("Meeting deadlines but slow → probably buffer in the dates. Safe but not ideal.");
    } else if (onTime < 75 && velocity < 70) {
      rb.paragraph("Both below target — systemic, not isolated.");
    }

    rb.paragraph("Open the dashboard for period-over-period charts.");
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
    rb.say(`${tables.length} main tables: ${tables.join(", ")}.`);
    rb.paragraph("`cases` holds work items, `case_history` is the audit trail, `active_devices` tracks sessions.");
    rb.addButtons([
      ["Overview", "How am I doing?"],
      ["What can you do?", "What can you help with?"],
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