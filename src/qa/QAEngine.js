// /src/qa/AppQAKernel.js
// ============================================================================
// APP-WIDE QA ENGINE KERNEL - ENHANCED ARCHITECTURE v3.1.0
// Comprehensive, extensible, and deeply integrated with your app runtime.
// ============================================================================
//
// PRINCIPLES
// ----------
// 1) Kernel receives context from UI and makes it available to components
// 2) Components provide natural, conversational responses (no bullet points in casual chat)
// 3) Routing matches questions to the best component based on patterns and intent
// 4) All data flows through injected context from the UI layer
// 5) Responses feel like talking to a helpful colleague, not a robot
//
// ============================================================================

import { db } from "../services/caseService";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  VERSION: "3.1.0",
  CACHE_TTL_MS: 5 * 60 * 1000,
  MAX_CONTEXT_TURNS: 30,
  MAX_BUTTONS: 5,
  DEFAULT_DEPARTMENT: "General",

  MULTI_COMPONENT: {
    MAX_COMPONENTS_PER_RESPONSE: 3,
    MIN_CONFIDENCE_THRESHOLD: 0.1,
    SECONDARY_THRESHOLD_RATIO: 0.6,
    COMPONENT_TIMEOUT_MS: 5000,
  },

  DEBUG: {
    SHOW_COMPONENTS: true,
    SHOW_SCORES: false,
    SHOW_TIMING: false,
    SHOW_ROUTING: true,
  },

  COMPONENT_CATEGORIES: {
    CORE: ["main", "greeter"],
    DISCOVERY: [
      "case_lookup",
      "active_cases",
      "case_search",
      "case_timeline",
      "case_comparison",
    ],
    PERFORMANCE: [
      "improvement_advisor",
      "score_explainer",
      "scenario_simulator",
      "trend_analyzer",
      "benchmark_compare",
    ],
    OPERATIONS: [
      "daily_brief",
      "weekly_review",
      "shift_handoff",
      "workload_summary",
    ],
    ANALYTICS: [
      "problem_finder",
      "bottleneck_finder",
      "pattern_detector",
      "root_cause",
    ],
    RISK: ["risk_analyzer", "early_warning", "deadline_monitor"],
    DATA: ["schema_explorer", "table_explorer", "service_introspector"],
    DEVELOPER: ["trace_viewer", "debug_helper"],
    HELP: ["glossary", "faq", "tutorial"],
  },

  SCORING: {
    ON_TIME_WEIGHT: 0.6,
    VELOCITY_WEIGHT: 0.4,
    LATE_PENALTY_PER_CASE: 2.5,
    EARLY_BONUS_PER_DAY: 0.5,
    MAX_EARLY_BONUS: 2.0,
  },

  BUFFERS: {
    design: 2,
    production: 1,
    finishing: 0,
    qc: 0,
  },

  KNOWN_TABLES: ["cases", "case_history", "active_devices"],

  UI_COMMANDS: {
    button: "[ACTION:Label|Command]",
    modal: "[MODAL:NAME|arg1|arg2|...]",
  },

  INTROSPECTION: {
    MAX_FN_CHARS: 2400,
  },
};

// ============================================================================
// UTILITIES
// ============================================================================
const U = {
  now() {
    return new Date();
  },

  daysBetween(a, b) {
    return Math.floor((a - b) / (1000 * 60 * 60 * 24));
  },

  hoursBetween(a, b) {
    return Math.floor((a - b) / (1000 * 60 * 60));
  },

  toLower(s) {
    return (s || "").toLowerCase();
  },

  titleCase(s) {
    return (s || "").replace(/\b[a-z]/g, (m) => m.toUpperCase());
  },

  clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  },

  uniq(arr) {
    return [...new Set(arr || [])];
  },

  compact(arr) {
    return (arr || []).filter(Boolean);
  },

  pct(x) {
    return Math.max(0, Math.min(100, Number(x) || 0));
  },

  cleanText(text) {
    return String(text || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  },

  formatDuration(ms) {
    if (!ms || ms <= 0 || !isFinite(ms)) return "not available";
    const hours = ms / (1000 * 60 * 60);
    if (hours < 1) {
      const mins = Math.round(ms / (1000 * 60));
      return `${mins} minute${mins !== 1 ? "s" : ""}`;
    }
    if (hours < 24) {
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      if (m === 0) return `${h} hour${h !== 1 ? "s" : ""}`;
      return `${h} hour${h !== 1 ? "s" : ""} and ${m} minute${
        m !== 1 ? "s" : ""
      }`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    if (remainingHours === 0) return `${days} day${days !== 1 ? "s" : ""}`;
    return `${days} day${days !== 1 ? "s" : ""} and ${remainingHours} hour${
      remainingHours !== 1 ? "s" : ""
    }`;
  },

  formatNumber(n) {
    if (n === null || n === undefined) return "unknown";
    return n.toLocaleString();
  },

  formatPercent(n) {
    if (n === null || n === undefined || isNaN(n)) return "unknown";
    return `${n.toFixed(1)}%`;
  },

  relativeTime(date) {
    if (!date) return "unknown";
    const now = new Date();
    const then = new Date(date);
    const diffMs = now - then;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;

    if (diffHours < 1) {
      const mins = Math.round(diffMs / (1000 * 60));
      return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
    }
    if (diffHours < 24) {
      const h = Math.round(diffHours);
      return `${h} hour${h !== 1 ? "s" : ""} ago`;
    }
    if (diffDays < 7) {
      const d = Math.round(diffDays);
      return `${d} day${d !== 1 ? "s" : ""} ago`;
    }
    return then.toLocaleDateString();
  },

  async safeDb(queryPromise) {
    try {
      if (!db) return { data: null, error: "Database not initialized" };
      const out = await queryPromise;
      if (out?.error) return { data: null, error: out.error };
      return out;
    } catch (e) {
      console.error("[QAKernel:DB] Exception", e);
      return { data: null, error: e?.message || String(e) };
    }
  },

  stageFromCase(row) {
    const mods = row?.modifiers || [];
    if (mods.includes("stage-finishing")) return "finishing";
    if (mods.includes("stage-production")) return "production";
    if (mods.includes("stage-design")) return "design";
    if (mods.includes("stage-qc")) return "quality control";
    return "unassigned";
  },

  caseTypeFromModifiers(mods) {
    if (!mods || !Array.isArray(mods)) return "general";
    if (mods.includes("bbs")) return "bbs";
    if (mods.includes("flex")) return "flex";
    return "general";
  },

  scoreToRating(score) {
    if (score >= 90) return "excellent";
    if (score >= 80) return "very good";
    if (score >= 70) return "good";
    if (score >= 60) return "fair";
    if (score >= 50) return "needs improvement";
    return "critical";
  },

  riskToWords(probability) {
    if (probability >= 0.8) return "very likely to be late";
    if (probability >= 0.6) return "likely to be late";
    if (probability >= 0.4) return "at moderate risk";
    if (probability >= 0.2) return "at low risk";
    return "on track";
  },
};

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
    if (Date.now() - v.t > this.ttl) {
      this.map.delete(k);
      return null;
    }
    return v.d;
  }

  set(k, d) {
    this.map.set(k, { d, t: Date.now() });
  }

  clear() {
    this.map.clear();
  }

  has(k) {
    return this.get(k) !== null;
  }
}
const Cache = new TTLCache();

// ============================================================================
// BUTTON MANAGER & RESPONSE BUILDER
// ============================================================================
class ButtonManager {
  constructor() {
    this.seen = new Set();
  }

  format(label, command) {
    return `[ACTION:${label}|${command}]`;
  }

  build(buttonPairs) {
    const list = (buttonPairs || [])
      .filter(Boolean)
      .slice(0, CONFIG.MAX_BUTTONS);
    if (!list.length) return "";
    return "\n\n" + list.map(([l, c]) => this.format(l, c)).join(" ");
  }

  dedupe(buttonPairs) {
    const out = [];
    for (const [l, c] of buttonPairs || []) {
      const key = (c || "").toLowerCase().trim();
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      out.push([l, c]);
    }
    return out;
  }

  reset() {
    this.seen.clear();
  }
}
const Buttons = new ButtonManager();

class ResponseBuilder {
  constructor() {
    this.parts = [];
    this.buttons = [];
    this.metadata = {};
  }

  say(s = "") {
    if (s) this.parts.push(String(s));
    return this;
  }

  paragraph(s = "") {
    if (this.parts.length > 0) {
      this.parts.push("");
    }
    if (s) this.parts.push(String(s));
    return this;
  }

  line(s = "") {
    this.parts.push(String(s));
    return this;
  }

  addButtons(btns = []) {
    this.buttons = Buttons.dedupe(this.buttons.concat(btns));
    return this;
  }

  setMetadata(key, value) {
    this.metadata[key] = value;
    return this;
  }

  toString() {
    const text = U.cleanText(this.parts.join("\n"));
    const btn = Buttons.build(this.buttons);

    let metaTags = "";
    if (this.metadata.components?.length > 0) {
      metaTags += `[COMPONENTS:${this.metadata.components.join(",")}]`;
    }
    if (this.metadata.intent) {
      metaTags += `[INTENT:${this.metadata.intent}]`;
    }
    if (this.metadata.followUps?.length > 0) {
      metaTags += `[FOLLOWUPS:${this.metadata.followUps.join("|")}]`;
    }

    return text + btn + metaTags;
  }
}

// ============================================================================
// SCORE CALCULATOR
// ============================================================================
class ScoreCalculator {
  constructor(w = CONFIG.SCORING) {
    this.w = w;
  }

  project(current, scenario) {
    const {
      score = 0,
      onTimeRate = 0,
      velocityScore = 0,
      completedCases = 80,
    } = current;

    const { lateCases = 0, earlyCases = 0, earlyDays = 0 } = scenario;

    const otCases = (onTimeRate / 100) * completedCases;
    const newOnTimeCases = otCases - lateCases + earlyCases;
    const newOnTimeRate =
      completedCases > 0 ? (newOnTimeCases / completedCases) * 100 : onTimeRate;

    let penalties = lateCases * this.w.LATE_PENALTY_PER_CASE;
    let bonuses = 0;
    if (earlyCases > 0 && earlyDays > 0) {
      bonuses =
        earlyCases *
        Math.min(
          earlyDays * this.w.EARLY_BONUS_PER_DAY,
          this.w.MAX_EARLY_BONUS
        );
    }

    const onTimeComponent = newOnTimeRate * this.w.ON_TIME_WEIGHT;
    const velocityComponent = velocityScore * this.w.VELOCITY_WEIGHT;
    const projected = U.clamp(
      onTimeComponent + velocityComponent - penalties + bonuses,
      0,
      100
    );

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
// DATABASE KNOWLEDGE PROVIDER
// ============================================================================
class DBKnowledge {
  static async quickStats() {
    const key = "quickStats:v2";
    const cached = Cache.get(key);
    if (cached) return cached;

    const out = {};
    for (const t of CONFIG.KNOWN_TABLES) {
      const { data, error } = await U.safeDb(
        db.from(t).select("id", { count: "exact", head: true })
      );
      out[t] = {
        approxRows: data ? data.length || 0 : 0,
        error: error?.message || null,
      };
    }
    Cache.set(key, out);
    return out;
  }

  static async getActiveCases(department = CONFIG.DEFAULT_DEPARTMENT) {
    const { data } = await U.safeDb(
      db
        .from("cases")
        .select("*")
        .eq("department", department)
        .is("completed", null)
        .is("archived", null)
        .order("due", { ascending: true })
    );
    return data || [];
  }

  static async getRecentCompletedCases(
    department = CONFIG.DEFAULT_DEPARTMENT,
    days = 30
  ) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const { data } = await U.safeDb(
      db
        .from("cases")
        .select("*")
        .eq("department", department)
        .not("completed", "is", null)
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
      db
        .from("cases")
        .select("*")
        .ilike("casenumber", `%${cn}%`)
        .order("created_at", { ascending: false })
        .limit(5)
    );
    if (like?.data?.length) return like.data[0];
    return null;
  }

  static async historyForCase(caseId, limit = 50) {
    const { data } = await U.safeDb(
      db
        .from("case_history")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false })
        .limit(limit)
    );
    return data || [];
  }

  static async getOverdueCases(department = CONFIG.DEFAULT_DEPARTMENT) {
    const now = new Date().toISOString();
    const { data } = await U.safeDb(
      db
        .from("cases")
        .select("*")
        .eq("department", department)
        .is("completed", null)
        .is("archived", null)
        .lt("due", now)
        .order("due", { ascending: true })
    );
    return data || [];
  }

  static async getCasesDueSoon(
    department = CONFIG.DEFAULT_DEPARTMENT,
    hours = 24
  ) {
    const now = new Date();
    const soon = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const { data } = await U.safeDb(
      db
        .from("cases")
        .select("*")
        .eq("department", department)
        .is("completed", null)
        .is("archived", null)
        .gte("due", now.toISOString())
        .lte("due", soon.toISOString())
        .order("due", { ascending: true })
    );
    return data || [];
  }

  static async schemaOverview() {
    const key = "schemaOverview:v1";
    const cached = Cache.get(key);
    if (cached) return cached;

    const overview = { tables: {} };

    const guess = {
      cases: [
        "id",
        "casenumber",
        "created_at",
        "due",
        "completed",
        "department",
        "priority",
        "modifiers",
        "archived",
        "archived_at",
      ],
      case_history: ["id", "case_id", "action", "user_name", "created_at"],
      active_devices: ["id", "user_id", "last_seen", "device_info"],
    };

    for (const t of CONFIG.KNOWN_TABLES) {
      overview.tables[t] = {
        columns: guess[t]?.map((n) => ({ name: n, type: "unknown" })) || [],
      };
    }

    Cache.set(key, overview);
    return overview;
  }
}

// ============================================================================
// ENTITY EXTRACTION
// ============================================================================
function extractEntities(text) {
  const t = U.toLower(text);
  const out = {
    caseNumbers: [],
    stages: [],
    timeframes: [],
    metrics: [],
    verbs: [],
    counts: [],
    intents: [],
    caseTypes: [],
  };

  // Extract case numbers (2+ digits)
  const cases = t.match(/\b\d{2,}\b/g);
  if (cases) out.caseNumbers = cases;

  // Extract counts
  const counts = t.match(/\b\d+\b/g);
  if (counts) out.counts = counts.map((n) => parseInt(n, 10));

  // Stages
  const stagePatterns = [
    { pattern: /design/i, stage: "design" },
    { pattern: /production/i, stage: "production" },
    { pattern: /finishing/i, stage: "finishing" },
    { pattern: /qc|quality control/i, stage: "qc" },
  ];
  stagePatterns.forEach(({ pattern, stage }) => {
    if (pattern.test(t)) out.stages.push(stage);
  });

  // Case types
  if (t.includes("bbs")) out.caseTypes.push("bbs");
  if (t.includes("flex") || t.includes("3d flex")) out.caseTypes.push("flex");
  if (t.includes("general")) out.caseTypes.push("general");

  // Timeframes
  const timeframePatterns = [
    "today",
    "yesterday",
    "tomorrow",
    "this week",
    "last week",
    "next week",
    "this month",
    "last month",
    "recently",
    "lately",
  ];
  timeframePatterns.forEach((tf) => {
    if (t.includes(tf)) out.timeframes.push(tf);
  });

  // Metrics
  const metricPatterns = [
    "efficiency",
    "velocity",
    "buffer",
    "score",
    "performance",
    "risk",
    "on-time",
    "on time",
    "late",
    "early",
    "overdue",
    "throughput",
    "average",
    "median",
  ];
  metricPatterns.forEach((m) => {
    if (t.includes(m)) out.metrics.push(m);
  });

  // Verbs/Actions
  const verbPatterns = [
    "show",
    "find",
    "get",
    "tell",
    "explain",
    "analyze",
    "check",
    "compare",
    "list",
    "search",
    "look up",
    "lookup",
  ];
  verbPatterns.forEach((v) => {
    if (t.includes(v)) out.verbs.push(v);
  });

  // Intents
  if (
    t.includes("improve") ||
    t.includes("better") ||
    t.includes("increase") ||
    t.includes("boost")
  ) {
    out.intents.push("improvement");
  }
  if (
    t.includes("problem") ||
    t.includes("issue") ||
    t.includes("wrong") ||
    t.includes("trouble")
  ) {
    out.intents.push("problem");
  }
  if (
    t.includes("risk") ||
    t.includes("critical") ||
    t.includes("danger") ||
    t.includes("urgent")
  ) {
    out.intents.push("risk");
  }
  if (
    t.includes("why") ||
    t.includes("reason") ||
    t.includes("explain") ||
    t.includes("how come")
  ) {
    out.intents.push("explanation");
  }
  if (
    t.includes("trend") ||
    t.includes("pattern") ||
    t.includes("history") ||
    t.includes("over time")
  ) {
    out.intents.push("trend");
  }
  if (
    t.includes("what if") ||
    t.includes("scenario") ||
    t.includes("simulate") ||
    t.includes("hypothetical")
  ) {
    out.intents.push("scenario");
  }
  if (
    t.includes("compare") ||
    t.includes("versus") ||
    t.includes("vs") ||
    t.includes("difference")
  ) {
    out.intents.push("comparison");
  }

  return out;
}

// ============================================================================
// COMPONENT REGISTRY
// ============================================================================
class ComponentRegistry {
  constructor() {
    this.list = [];
    this.byId = new Map();
    this.byCategory = new Map();
  }

  register(comp) {
    if (!comp || !comp.id || typeof comp.handle !== "function") {
      throw new Error("Invalid component: needs id and handle function");
    }
    comp.priority = comp.priority ?? 50;
    comp.capabilities = comp.capabilities || [];
    comp.patterns = comp.patterns || [];
    comp.category = comp.category || "GENERAL";

    this.list.push(comp);
    this.byId.set(comp.id, comp);

    if (!this.byCategory.has(comp.category)) {
      this.byCategory.set(comp.category, []);
    }
    this.byCategory.get(comp.category).push(comp);

    return comp.id;
  }

  get(id) {
    return this.byId.get(id);
  }

  all() {
    return this.list.slice();
  }

  inCategory(cat) {
    return this.byCategory.get(cat) || [];
  }
}
const COMPONENTS = new ComponentRegistry();

// ============================================================================
// KERNEL CONTEXT - STORES INJECTED DATA FROM UI
// ============================================================================
class KernelContext {
  constructor() {
    this.session = {
      startedAt: Date.now(),
      turns: [],
      lastIntent: null,
      previousScore: null,
      componentHistory: [],
      mentionedCases: [],
      askedQuestions: [],
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
        hasStageStats: !!data?.stageStats,
      });
    }
  }

  getEfficiency() {
    const eff = this.injectedData?.efficiency;
    if (eff && !eff.noData) {
      return eff;
    }
    return null;
  }

  getStage() {
    return this.injectedData?.stage || null;
  }

  getStageStats() {
    return this.injectedData?.stageStats || null;
  }

  getActiveDept() {
    return this.injectedData?.activeDept || CONFIG.DEFAULT_DEPARTMENT;
  }

  getStageCount() {
    return this.injectedData?.stageCount || 0;
  }

  getPredictions() {
    return this.injectedData?.efficiency?.predictions || null;
  }

  getThroughput() {
    return this.injectedData?.efficiency?.throughput || null;
  }

  getOnTimeDelivery() {
    return this.injectedData?.efficiency?.onTimeDelivery || null;
  }

  recordComponentUse(componentId) {
    this.session.componentHistory.push({
      componentId,
      timestamp: Date.now(),
    });
  }

  recordMentionedCase(caseNumber) {
    if (!this.session.mentionedCases.includes(caseNumber)) {
      this.session.mentionedCases.push(caseNumber);
      if (this.session.mentionedCases.length > 20) {
        this.session.mentionedCases.shift();
      }
    }
  }

  getLastMentionedCase() {
    return (
      this.session.mentionedCases[this.session.mentionedCases.length - 1] ||
      null
    );
  }

  init({ scoreCalculator, buttons }) {
    this.scoreCalculator = scoreCalculator;
    this.buttons = buttons;
    this.config = CONFIG;
    this.db = DBKnowledge;
    this.utils = {
      formatDuration: U.formatDuration,
      formatNumber: U.formatNumber,
      formatPercent: U.formatPercent,
      relativeTime: U.relativeTime,
      pct: U.pct,
      clamp: U.clamp,
      stageFromCase: U.stageFromCase,
      caseTypeFromModifiers: U.caseTypeFromModifiers,
      scoreToRating: U.scoreToRating,
      riskToWords: U.riskToWords,
      safeDb: U.safeDb,
      titleCase: U.titleCase,
    };
    this.trace = {
      logs: [],
      info: (msg, data) => this.trace.logs.push({ msg, data, t: Date.now() }),
    };
  }
}

// ============================================================================
// PATTERN MATCHING
// ============================================================================
function scoreByPatterns(patterns, text) {
  if (!patterns?.length) return 0;
  let score = 0;
  const t = text.toLowerCase().trim();

  for (const p of patterns) {
    const pl = p.toLowerCase();

    // Exact match
    if (t === pl) {
      score += 1.0;
      continue;
    }

    // Starts with pattern
    if (
      t.startsWith(pl + " ") ||
      t.startsWith(pl + "?") ||
      t.startsWith(pl + ",")
    ) {
      score += 0.8;
      continue;
    }

    // Ends with pattern
    if (t.endsWith(" " + pl) || t.endsWith(" " + pl + "?")) {
      score += 0.7;
      continue;
    }

    // Contains as whole phrase
    if (
      t.includes(" " + pl + " ") ||
      t.includes(" " + pl + "?") ||
      t.includes(" " + pl + ",")
    ) {
      score += 0.6 + pl.split(" ").length * 0.1;
      continue;
    }

    // Contains pattern anywhere
    if (t.includes(pl)) {
      score += 0.4;
    }
  }

  return Math.min(1, score);
}

// ============================================================================
// INTENT ROUTER
// ============================================================================
class IntentRouter {
  constructor() {
    this.contextWindow = [];
  }

  async route(ctx, question) {
    const normalized = question.toLowerCase().trim();
    const entities = extractEntities(normalized);
    const scores = [];

    for (const comp of COMPONENTS.all()) {
      let score = 0;

      // Use custom match function if available
      if (typeof comp.match === "function") {
        try {
          score = Number((await comp.match(ctx, normalized, entities)) || 0);
        } catch (e) {
          console.warn(`[Router] Match error for ${comp.id}:`, e);
        }
      } else if (comp.patterns?.length) {
        score = scoreByPatterns(comp.patterns, normalized);
      }

      // Priority adjustment
      score *= 1 + (comp.priority - 50) / 100;

      // Capability boosts based on entities
      if (comp.capabilities?.length) {
        for (const cap of comp.capabilities) {
          if (cap === "risk" && entities.intents.includes("risk")) {
            score *= 1.6;
          }
          if (
            cap === "improvement" &&
            entities.intents.includes("improvement")
          ) {
            score *= 1.5;
          }
          if (cap === "problem" && entities.intents.includes("problem")) {
            score *= 1.5;
          }
          if (
            cap === "explanation" &&
            entities.intents.includes("explanation")
          ) {
            score *= 1.4;
          }
          if (cap === "scenario" && entities.intents.includes("scenario")) {
            score *= 1.5;
          }
          if (cap === "trend" && entities.intents.includes("trend")) {
            score *= 1.4;
          }
          if (cap === "case" && entities.caseNumbers.length) {
            score *= 1.4;
          }
          if (cap === "metric" && entities.metrics.length) {
            score *= 1.2;
          }
          if (cap === "stage" && entities.stages.length) {
            score *= 1.2;
          }
        }
      }

      // Context boost - if recently used a related component
      if (this.contextWindow.length > 0) {
        const lastComp = this.contextWindow[this.contextWindow.length - 1];
        if (comp.relatedTo?.includes(lastComp) || comp.id === lastComp) {
          score *= 1.1;
        }
      }

      scores.push({ comp, score });
    }

    scores.sort((a, b) => b.score - a.score);

    if (CONFIG.DEBUG.SHOW_SCORES) {
      console.log(
        "[Router] Top scores:",
        scores.slice(0, 6).map((s) => `${s.comp.id}: ${s.score.toFixed(3)}`)
      );
    }

    const primary =
      scores[0]?.score >= CONFIG.MULTI_COMPONENT.MIN_CONFIDENCE_THRESHOLD
        ? scores[0].comp
        : null;

    // Find secondary components
    const secondary = [];
    if (primary) {
      const threshold =
        primary.score * CONFIG.MULTI_COMPONENT.SECONDARY_THRESHOLD_RATIO;
      for (let i = 1; i < scores.length && secondary.length < 2; i++) {
        if (scores[i].score >= threshold && scores[i].score >= 0.2) {
          secondary.push(scores[i].comp);
        }
      }
    }

    // Update context window
    if (primary) {
      this.contextWindow.push(primary.id);
      if (this.contextWindow.length > 5) {
        this.contextWindow.shift();
      }
    }

    return { components: { primary, secondary }, entities, normalized };
  }
}
const router = new IntentRouter();

// ============================================================================
// RESPONSE ORCHESTRATOR
// ============================================================================
class ResponseOrchestrator {
  async orchestrate(ctx, components, question, entities) {
    const greeter = COMPONENTS.get("greeter");

    // Check if greeter should handle
    if (greeter?.shouldHandle) {
      const shouldGreet = await greeter.shouldHandle(ctx, question, entities);
      if (shouldGreet) {
        const response = await greeter.handle(ctx, question, entities);
        ctx.recordComponentUse("greeter");
        return this._addComponentTag(response, ["greeter"]);
      }
    }

    // No component matched
    if (!components.primary) {
      if (greeter) {
        const response = await greeter.handle(ctx, question, entities);
        ctx.recordComponentUse("greeter");
        return this._addComponentTag(response, ["greeter"]);
      }
      return "I'm not quite sure how to help with that. Could you try rephrasing your question, or ask me about performance metrics, cases, or how to improve your score?";
    }

    // Execute primary component
    try {
      const response = await components.primary.handle(ctx, question, entities);
      ctx.recordComponentUse(components.primary.id);
      return this._addComponentTag(response, [components.primary.id]);
    } catch (err) {
      console.error("[Orchestrator] Component error:", err);
      if (greeter?.handleError) {
        return this._addComponentTag(
          await greeter.handleError(ctx, question, entities, err),
          ["greeter"]
        );
      }
      return "I ran into a problem processing your request. Could you try asking in a different way?";
    }
  }

  _addComponentTag(text, components) {
    if (!text.includes("[COMPONENTS:") && CONFIG.DEBUG.SHOW_COMPONENTS) {
      return text + `[COMPONENTS:${components.join(",")}]`;
    }
    return text;
  }
}
const orchestrator = new ResponseOrchestrator();

// ============================================================================
// THE KERNEL ENGINE
// ============================================================================
class AppQAKernel {
  constructor() {
    this.ctx = new KernelContext();
    this._ready = false;
  }

  async ready() {
    if (this._ready) return true;
    this.ctx.init({
      scoreCalculator: scoreCalc,
      buttons: Buttons,
    });
    this._ready = true;
    return true;
  }

  async ask(question, injectedContext = {}) {
    await this.ready();

    // Store the injected context so components can access it
    this.ctx.setInjectedData(injectedContext);

    // Reset buttons for new response
    Buttons.reset();

    const q = String(question || "").trim();

    // Empty question
    if (!q) {
      const greeter = COMPONENTS.get("greeter");
      if (greeter) {
        const response = await greeter.handle(this.ctx, "", {});
        return orchestrator._addComponentTag(response, ["greeter"]);
      }
      return "Hi there! How can I help you today?";
    }

    // Route the question
    const { components, entities, normalized } = await router.route(
      this.ctx,
      q
    );

    if (CONFIG.DEBUG.SHOW_ROUTING) {
      console.log("[QA Engine] Routing:", {
        question: normalized.substring(0, 50),
        primary: components.primary?.id || "none",
        secondary: components.secondary?.map((c) => c.id) || [],
        hasEfficiency: !!this.ctx.getEfficiency(),
        score: this.ctx.getEfficiency()?.score,
      });
    }

    // Get response
    const response = await orchestrator.orchestrate(
      this.ctx,
      components,
      normalized,
      entities
    );

    // Track turn
    this.ctx.session.turns.push({
      t: Date.now(),
      q: q,
      intent: components.primary?.id || "greeter",
    });
    if (this.ctx.session.turns.length > CONFIG.MAX_CONTEXT_TURNS) {
      this.ctx.session.turns.shift();
    }
    this.ctx.session.lastIntent = components.primary?.id;

    // Track score for change detection
    const eff = this.ctx.getEfficiency();
    if (eff?.score != null) {
      this.ctx.session.previousScore = eff.score;
    }

    return response;
  }

  reset() {
    this.ctx = new KernelContext();
    Buttons.reset();
    Cache.clear();
    this._ready = false;
  }
}

// ============================================================================
// COMPONENTS - All with natural language responses
// ============================================================================

// ----------------------------------------------------------------------------
// GREETER - Handles greetings and fallback
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "greeter",
  priority: 100,
  category: "CORE",
  patterns: ["hi", "hello", "hey", "help", "what can you do", "start", "menu"],

  async shouldHandle(ctx, question) {
    const q = question.toLowerCase().trim();
    if (q === "" || q.match(/^(hi|hello|hey|sup|greetings|yo|howdy)$/i))
      return true;
    if (
      q.match(
        /^(help|help me|what can you do|what do you do|how do you work)$/i
      )
    )
      return true;
    return false;
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const q = question.toLowerCase().trim();
    const hour = new Date().getHours();
    const efficiency = ctx.getEfficiency();

    // Greeting
    if (q === "" || q.match(/^(hi|hello|hey|sup|greetings|yo|howdy)$/i)) {
      const greeting =
        hour < 12
          ? "Good morning"
          : hour < 17
          ? "Good afternoon"
          : "Good evening";

      rb.say(
        `${greeting}! I'm here to help you stay on top of your operations.`
      );

      if (efficiency) {
        const score = efficiency.score || 0;
        const rating = U.scoreToRating(score);
        rb.paragraph(
          `Right now, your efficiency score is ${U.formatPercent(
            score
          )}, which is ${rating}. I can help you understand what's driving that number and how to improve it.`
        );
      } else {
        rb.paragraph(
          `I can help you track performance, find cases that need attention, and give you recommendations for improvement. Just ask me anything!`
        );
      }

      rb.paragraph(`What would you like to know about?`);

      rb.addButtons([
        ["How am I doing?", "How am I doing?"],
        ["What needs attention?", "What needs attention?"],
        ["Show critical cases", "Show me critical cases"],
        ["Help me improve", "How can I improve?"],
      ]);

      return rb.toString();
    }

    // Help request
    if (q.includes("help") || q.includes("what can you")) {
      rb.say(
        "I'm your operations assistant, and I can help you with quite a few things."
      );

      rb.paragraph(
        "When it comes to performance, I can tell you your current efficiency score, explain what's affecting it, and show you trends over time. I can also run what-if scenarios to help you understand the impact of different outcomes."
      );

      rb.paragraph(
        "For case management, I can find specific cases by number, show you which cases are at risk of being late, identify overdue items, and help you prioritize your workload."
      );

      rb.paragraph(
        "I'm also good at spotting problems. I can identify bottlenecks in your workflow, find patterns in late deliveries, and give you specific recommendations for improvement."
      );

      rb.paragraph("What would you like to explore?");

      rb.addButtons([
        ["Check my score", "What's my efficiency score?"],
        ["Find problems", "What needs attention?"],
        ["At-risk cases", "Show critical cases"],
        ["Daily summary", "Give me my daily brief"],
      ]);

      return rb.toString();
    }

    // Fallback for unmatched
    rb.say(
      "I'm not quite sure what you're asking about, but I'd love to help."
    );

    rb.paragraph(
      "I'm best at answering questions about your efficiency score and performance metrics, finding cases that need attention or are at risk, identifying problems and bottlenecks in your workflow, and providing recommendations for improvement."
    );

    rb.paragraph(
      "Could you try rephrasing your question, or pick one of these topics to get started?"
    );

    rb.addButtons([
      ["Performance", "How am I doing?"],
      ["Problems", "What needs attention?"],
      ["Critical cases", "Show critical cases"],
      ["Help", "What can you help with?"],
    ]);

    return rb.toString();
  },

  async handleError(ctx, question, entities, error) {
    const rb = new ResponseBuilder();

    rb.say(
      "I ran into a problem while trying to answer that. This sometimes happens when there's a lot of data to process or a temporary connection issue."
    );

    rb.paragraph("Let me suggest a few things you could try instead:");

    rb.addButtons([
      ["Try again", "How am I doing?"],
      ["Simpler question", "What's my score?"],
      ["Get help", "What can you help with?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// MAIN - Performance overview and status
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "main",
  priority: 75,
  category: "CORE",
  capabilities: ["metric", "performance"],
  patterns: [
    "how am i doing",
    "how's it going",
    "how is it going",
    "my score",
    "my efficiency",
    "efficiency score",
    "performance",
    "status",
    "overview",
    "what's my score",
    "whats my score",
    "show score",
    "current score",
    "tell me my score",
    "how's my performance",
    "performance update",
    "quick status",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.metrics.length) score += 0.25;
    if (question.includes("doing") || question.includes("status"))
      score += 0.25;
    if (question.includes("score") || question.includes("efficiency"))
      score += 0.2;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();
    const stage = ctx.getStage();
    const stageCount = ctx.getStageCount();

    // No efficiency data available
    if (!efficiency) {
      rb.say("I don't have efficiency data to show you right now.");

      rb.paragraph(
        "This usually happens when no stage is selected. To see your performance metrics, you'll need to select a specific stage like Design, Production, or Finishing from the dropdown menu at the top of the page."
      );

      rb.paragraph(
        "Once you're viewing a stage, I'll be able to tell you all about your efficiency score, on-time delivery rate, velocity, and which cases need attention."
      );

      rb.addButtons([["What can you help with?", "What can you help with?"]]);

      return rb.toString();
    }

    const score = efficiency.score || 0;
    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;
    const predictions = efficiency.predictions;
    const criticalCount = predictions?.urgent?.length || 0;

    // Build natural response based on score level
    if (score >= 90) {
      rb.say(
        `You're doing excellent! Your efficiency score is ${U.formatPercent(
          score
        )}, which puts you in the top tier of performance.`
      );
    } else if (score >= 80) {
      rb.say(
        `You're doing very well. Your efficiency score is ${U.formatPercent(
          score
        )}, which is solid performance.`
      );
    } else if (score >= 70) {
      rb.say(
        `You're doing pretty good. Your efficiency score is ${U.formatPercent(
          score
        )}, though there's definitely room to push it higher.`
      );
    } else if (score >= 60) {
      rb.say(
        `Your efficiency score is ${U.formatPercent(
          score
        )}, which is fair but needs some attention. Let me help you identify what's holding it back.`
      );
    } else {
      rb.say(
        `Your efficiency score is ${U.formatPercent(
          score
        )}, which indicates some significant challenges we should address. The good news is there's a lot of room for improvement.`
      );
    }

    if (stage) {
      rb.say(` This is for the ${U.titleCase(stage)} stage.`);
    }

    // Performance breakdown in natural language
    rb.paragraph(
      `Looking at the details, your on-time delivery rate is ${U.formatPercent(
        onTime
      )} and your velocity score is ${U.formatPercent(velocity)}. ${
        onTime >= 85
          ? "Your on-time delivery is strong."
          : onTime >= 70
          ? "Your on-time delivery could use some improvement."
          : "On-time delivery is a major area to focus on."
      } ${
        velocity >= 80
          ? "Cases are moving through at a good pace."
          : velocity >= 65
          ? "Case processing speed is a bit slower than ideal."
          : "Velocity is quite low, which suggests bottlenecks in the workflow."
      }`
    );

    if (stageCount > 0) {
      rb.paragraph(
        `You currently have ${stageCount} active case${
          stageCount !== 1 ? "s" : ""
        } in this stage.`
      );
    }

    // Risk warning
    if (criticalCount > 0) {
      rb.paragraph(
        `Something to watch out for: I've identified ${criticalCount} case${
          criticalCount !== 1 ? "s" : ""
        } that ${
          criticalCount !== 1 ? "are" : "is"
        } at critical risk of going late. You might want to take a look at ${
          criticalCount !== 1 ? "those" : "that"
        } soon.`
      );
    }

    rb.paragraph("What would you like to explore next?");

    rb.addButtons([
      ["Why this score?", "Why is my score what it is?"],
      ["Find issues", "What's my biggest problem?"],
      ["Improve", "How can I improve?"],
      ["Critical cases", "Show me critical cases"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// IMPROVEMENT ADVISOR - Recommendations for improving score
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "improvement_advisor",
  priority: 82,
  category: "PERFORMANCE",
  capabilities: ["improvement", "recommendation"],
  patterns: [
    "how can i improve",
    "how do i improve",
    "improve my score",
    "improve score",
    "get better",
    "do better",
    "recommendations",
    "suggestions",
    "tips",
    "advice",
    "what should i do",
    "help me improve",
    "increase score",
    "boost score",
    "raise score",
    "how to improve",
    "ways to improve",
    "improvement suggestions",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("improvement")) score += 0.5;
    if (question.includes("improve")) score += 0.4;
    if (
      question.includes("better") ||
      question.includes("increase") ||
      question.includes("boost")
    )
      score += 0.3;
    if (
      question.includes("recommend") ||
      question.includes("suggest") ||
      question.includes("advice")
    )
      score += 0.3;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();

    if (!efficiency) {
      rb.say(
        "I'd love to give you specific recommendations, but I need to see your performance data first."
      );

      rb.paragraph(
        "In general, the best ways to improve your efficiency score are to focus on cases that are approaching their due dates to prevent late deliveries, address any cases that are flagged as high-risk before they become problems, look for patterns in what's causing delays, and try to complete cases ahead of schedule when possible since early completions earn bonus points."
      );

      rb.paragraph(
        "Once you select a stage, I can give you much more targeted advice based on your actual numbers."
      );

      rb.addButtons([
        ["Check status", "How am I doing?"],
        ["What can you help with?", "What can you help with?"],
      ]);

      return rb.toString();
    }

    const score = efficiency.score || 0;
    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;
    const criticalCount = efficiency.predictions?.urgent?.length || 0;
    const lateCases =
      efficiency.onTimeDelivery?.caseInsights?.casesWithPenalties || [];

    rb.say(
      `Based on your current score of ${U.formatPercent(
        score
      )}, here's what I recommend focusing on.`
    );

    // Build prioritized recommendations in natural language
    const recommendations = [];

    // Critical cases - highest priority
    if (criticalCount > 0) {
      recommendations.push({
        priority: 1,
        text: `Your most urgent priority should be the ${criticalCount} case${
          criticalCount !== 1 ? "s" : ""
        } that ${
          criticalCount !== 1 ? "are" : "is"
        } at critical risk of going late. Each case that misses its deadline costs you ${
          CONFIG.SCORING.LATE_PENALTY_PER_CASE
        } points, so preventing even one late delivery can make a real difference. I'd suggest reviewing ${
          criticalCount !== 1 ? "these cases" : "this case"
        } right away to see if anything is blocking progress.`,
      });
    }

    // On-time delivery
    if (onTime < 85) {
      const gap = 85 - onTime;
      const potentialGain = (
        gap *
        CONFIG.SCORING.ON_TIME_WEIGHT *
        0.01
      ).toFixed(1);
      recommendations.push({
        priority: onTime < 70 ? 1 : 2,
        text: `Your on-time delivery rate of ${U.formatPercent(
          onTime
        )} is below the target of 85%. Closing that gap could add roughly ${potentialGain} points to your score. The key is to catch cases before they become late. Try reviewing your workload each morning and prioritizing anything due within the next day or two.`,
      });
    }

    // Velocity
    if (velocity < 80) {
      const gap = 80 - velocity;
      const potentialGain = (
        gap *
        CONFIG.SCORING.VELOCITY_WEIGHT *
        0.01
      ).toFixed(1);
      recommendations.push({
        priority: velocity < 65 ? 2 : 3,
        text: `Your velocity score of ${U.formatPercent(
          velocity
        )} suggests cases are taking longer than expected. Improving this to 80% could add about ${potentialGain} points. Look for bottlenecks in your process, especially if certain case types consistently take longer than others.`,
      });
    }

    // Already doing well
    if (score >= 85 && recommendations.length === 0) {
      recommendations.push({
        priority: 3,
        text: `You're already performing at a high level, so the gains from here are incremental. Focus on maintaining your current practices, and when possible, try to complete cases a day or two early. Early completions can earn bonus points of up to ${CONFIG.SCORING.MAX_EARLY_BONUS} per case.`,
      });
    }

    // Output recommendations
    if (recommendations.length > 0) {
      recommendations.sort((a, b) => a.priority - b.priority);

      recommendations.forEach((rec, i) => {
        rb.paragraph(rec.text);
      });
    }

    // Add context about late cases if relevant
    if (
      lateCases.length > 0 &&
      !recommendations.some((r) => r.text.includes("late"))
    ) {
      rb.paragraph(
        `One thing to note: ${lateCases.length} case${
          lateCases.length !== 1 ? "s have" : " has"
        } already been completed late, which has cost you ${(
          lateCases.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE
        ).toFixed(
          1
        )} points. You can't undo that, but understanding why they were late can help prevent it from happening again.`
      );
    }

    rb.paragraph("Would you like to dive deeper into any of these areas?");

    rb.addButtons([
      ["Show critical cases", "Show me critical cases"],
      ["Explain my score", "Why is my score what it is?"],
      ["Run scenario", "What if 3 cases go late?"],
      ["Check status", "How am I doing?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// PROBLEM FINDER - Identifies operational issues
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "problem_finder",
  priority: 82,
  category: "ANALYTICS",
  capabilities: ["problem", "issue"],
  patterns: [
    "biggest issue",
    "biggest problem",
    "main problem",
    "what's wrong",
    "whats wrong",
    "what needs attention",
    "needs attention",
    "problems",
    "issues",
    "concerns",
    "what's the matter",
    "what's broken",
    "pain points",
    "trouble",
    "challenges",
    "difficulties",
    "what's going wrong",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("problem")) score += 0.5;
    if (question.includes("problem") || question.includes("issue"))
      score += 0.4;
    if (question.includes("attention") || question.includes("wrong"))
      score += 0.3;
    if (question.includes("trouble") || question.includes("challenge"))
      score += 0.2;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();

    if (!efficiency) {
      rb.say(
        "I need to see your performance data to identify problems. Once you select a stage, I'll be able to analyze what's going on and point out anything that needs your attention."
      );

      rb.addButtons([
        ["Check status", "How am I doing?"],
        ["Get help", "What can you help with?"],
      ]);

      return rb.toString();
    }

    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;
    const criticalCases = efficiency.predictions?.urgent || [];
    const lateCases =
      efficiency.onTimeDelivery?.caseInsights?.casesWithPenalties || [];
    const score = efficiency.score || 0;

    // Collect problems
    const problems = [];

    // Critical risk cases
    if (criticalCases.length > 0) {
      problems.push({
        severity: 1,
        title: "cases at critical risk",
        description: `You have ${criticalCases.length} case${
          criticalCases.length !== 1 ? "s" : ""
        } that ${
          criticalCases.length !== 1 ? "are" : "is"
        } very likely to be late if nothing changes. ${
          criticalCases.length !== 1 ? "These cases are" : "This case is"
        } your most urgent concern because each late delivery will cost you ${
          CONFIG.SCORING.LATE_PENALTY_PER_CASE
        } points.`,
        cases: criticalCases.slice(0, 3).map((c) => c.caseNumber),
      });
    }

    // Already late cases
    if (lateCases.length > 0) {
      problems.push({
        severity: 2,
        title: "cases delivered late",
        description: `${lateCases.length} case${
          lateCases.length !== 1 ? "s have" : " has"
        } already been completed late, costing you ${(
          lateCases.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE
        ).toFixed(
          1
        )} points total. While you can't change the past, understanding why these were late can help you prevent future delays.`,
      });
    }

    // Low on-time delivery
    if (onTime < 80) {
      problems.push({
        severity: onTime < 65 ? 1 : 2,
        title: "low on-time delivery",
        description: `Your on-time delivery rate is ${U.formatPercent(
          onTime
        )}, which is well below the 85% target. This is one of the biggest factors pulling down your score. The pattern suggests either cases aren't being prioritized effectively or there are systemic delays in the workflow.`,
      });
    }

    // Low velocity
    if (velocity < 70) {
      problems.push({
        severity: velocity < 55 ? 2 : 3,
        title: "slow processing speed",
        description: `Cases are moving through at ${U.formatPercent(
          velocity
        )} of the expected pace. This slower velocity suggests there might be bottlenecks in your process, or certain case types are taking much longer than they should.`,
      });
    }

    // No problems found
    if (problems.length === 0) {
      rb.say("Good news! I'm not seeing any significant problems right now.");

      rb.paragraph(
        `Your score of ${U.formatPercent(
          score
        )} indicates things are running smoothly. On-time delivery is at ${U.formatPercent(
          onTime
        )} and velocity is at ${U.formatPercent(
          velocity
        )}, both of which are in acceptable ranges.`
      );

      rb.paragraph(
        "That said, it's always good to stay proactive. Keep an eye on cases as they approach their due dates, and address any early warning signs before they become problems."
      );

      rb.addButtons([
        ["Check performance", "How am I doing?"],
        ["How to improve", "How can I improve further?"],
      ]);

      return rb.toString();
    }

    // Sort by severity and report
    problems.sort((a, b) => a.severity - b.severity);

    rb.say(
      `I've identified ${problems.length} issue${
        problems.length !== 1 ? "s" : ""
      } that ${problems.length !== 1 ? "need" : "needs"} your attention.`
    );

    problems.forEach((p, i) => {
      const severityWord =
        p.severity === 1
          ? "The most pressing concern is"
          : p.severity === 2
          ? "Another significant issue is"
          : "Something else to be aware of is";

      rb.paragraph(
        `${i === 0 ? severityWord : i === 1 ? "Additionally," : "Also,"} ${
          p.description
        }`
      );

      if (p.cases?.length) {
        rb.say(` The affected cases include ${p.cases.join(", ")}.`);
      }
    });

    rb.paragraph("What would you like to focus on first?");

    rb.addButtons([
      ["Show critical cases", "Show me critical cases"],
      ["How to fix this", "How can I improve?"],
      ["Explain the score", "Why is my score what it is?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// RISK ANALYZER - Shows at-risk and critical cases
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "risk_analyzer",
  priority: 85,
  category: "RISK",
  capabilities: ["risk", "case", "prediction"],
  patterns: [
    "at-risk cases",
    "at risk cases",
    "at risk",
    "critical cases",
    "risky cases",
    "cases at risk",
    "show critical",
    "show me critical",
    "urgent cases",
    "going to be late",
    "will be late",
    "might be late",
    "high risk",
    "risk assessment",
    "risk analysis",
    "late risk",
    "cases in danger",
    "about to be late",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("risk")) score += 0.5;
    if (question.includes("risk")) score += 0.4;
    if (question.includes("critical")) score += 0.4;
    if (
      question.includes("late") &&
      (question.includes("going") ||
        question.includes("will") ||
        question.includes("might"))
    ) {
      score += 0.4;
    }
    if (question.includes("urgent")) score += 0.3;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const stage = ctx.getStage();
    const predictions = ctx.getPredictions();

    if (!predictions || !predictions.predictions?.length) {
      rb.say("I don't have risk prediction data available right now.");

      rb.paragraph(
        "To analyze which cases are at risk of being late, I need you to be viewing a specific stage like Design, Production, or Finishing. The system uses historical completion times and current progress to predict which active cases might miss their deadlines."
      );

      rb.paragraph(
        "Once you select a stage, I'll be able to show you which cases need the most attention."
      );

      rb.addButtons([
        ["Check status", "How am I doing?"],
        ["Get help", "What can you help with?"],
      ]);

      return rb.toString();
    }

    const allPredictions = predictions.predictions || [];
    const stageName = stage ? U.titleCase(stage) : "current";

    // Categorize by risk level
    const critical = allPredictions.filter(
      (p) => p.riskLevel === "critical" || p.lateProbability > 0.8
    );
    const high = allPredictions.filter(
      (p) =>
        (p.riskLevel === "high" ||
          (p.lateProbability > 0.5 && p.lateProbability <= 0.8)) &&
        !critical.includes(p)
    );
    const medium = allPredictions.filter(
      (p) =>
        (p.riskLevel === "medium" ||
          (p.lateProbability > 0.3 && p.lateProbability <= 0.5)) &&
        !critical.includes(p) &&
        !high.includes(p)
    );
    const low = allPredictions.filter(
      (p) => !critical.includes(p) && !high.includes(p) && !medium.includes(p)
    );

    rb.say(
      `I've analyzed ${allPredictions.length} active case${
        allPredictions.length !== 1 ? "s" : ""
      } in the ${stageName} stage for late-delivery risk.`
    );

    // Summary
    if (critical.length === 0 && high.length === 0) {
      rb.paragraph(
        "The good news is there are no cases at critical or high risk right now. " +
          (medium.length > 0
            ? `There ${medium.length === 1 ? "is" : "are"} ${
                medium.length
              } case${
                medium.length !== 1 ? "s" : ""
              } at moderate risk that you might want to keep an eye on.`
            : "All cases appear to be on track.")
      );
    } else {
      rb.paragraph(
        `Here's the breakdown: ${critical.length} case${
          critical.length !== 1 ? "s are" : " is"
        } at critical risk (more than 80% likely to be late), ${
          high.length
        } at high risk (50-80% likely), ${
          medium.length
        } at moderate risk, and ${low.length} ${
          low.length === 1 ? "is" : "are"
        } currently on track.`
      );
    }

    // Detail critical cases
    if (critical.length > 0) {
      rb.paragraph(
        "Let me tell you about the critical-risk cases that need immediate attention:"
      );

      critical.slice(0, 5).forEach((c, i) => {
        const prob = (c.lateProbability * 100).toFixed(0);
        const daysUntil = c.daysUntilDue;
        let timeStatus;

        if (daysUntil < 0) {
          timeStatus = `already ${Math.abs(daysUntil).toFixed(1)} days overdue`;
        } else if (daysUntil < 1) {
          timeStatus = "due today";
        } else if (daysUntil < 2) {
          timeStatus = "due tomorrow";
        } else {
          timeStatus = `due in ${daysUntil.toFixed(1)} days`;
        }

        rb.paragraph(
          `Case ${
            c.caseNumber
          } is ${timeStatus} and has a ${prob}% chance of being late. ${
            c.reason ||
            "Based on current progress and historical patterns, this one needs attention."
          }`
        );

        ctx.recordMentionedCase(c.caseNumber);
      });

      if (critical.length > 5) {
        rb.paragraph(
          `There are ${
            critical.length - 5
          } more critical cases I haven't listed. You might want to review the full risk report.`
        );
      }
    } else if (high.length > 0) {
      rb.paragraph(
        "While nothing is at critical risk, here are the high-risk cases to watch:"
      );

      high.slice(0, 3).forEach((c) => {
        const prob = (c.lateProbability * 100).toFixed(0);
        rb.say(
          ` Case ${c.caseNumber} has a ${prob}% chance of being late, with ${
            c.daysUntilDue?.toFixed(1) || "unknown"
          } days until due.`
        );
        ctx.recordMentionedCase(c.caseNumber);
      });
    }

    // Recommendations
    rb.paragraph(
      critical.length > 0
        ? `My recommendation is to prioritize these ${
            critical.length
          } critical case${
            critical.length !== 1 ? "s" : ""
          } immediately. Check if anything is blocking progress and see if you can expedite the work. Each case that goes late will cost ${
            CONFIG.SCORING.LATE_PENALTY_PER_CASE
          } points.`
        : high.length > 0
        ? "Keep a close eye on the high-risk cases over the next day or two. A little extra attention now can prevent them from becoming critical."
        : "Things look good for now. Keep up the steady pace and these cases should complete on time."
    );

    rb.addButtons([
      ["How to improve", "How can I improve?"],
      ["Explain scoring", "How does scoring work?"],
      ["Performance overview", "How am I doing?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// SCORE EXPLAINER - Explains how the score is calculated
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "score_explainer",
  priority: 78,
  category: "PERFORMANCE",
  capabilities: ["metric", "explanation"],
  patterns: [
    "why did my score",
    "why my score",
    "why is my score",
    "score change",
    "score changed",
    "score drop",
    "score dropped",
    "score went down",
    "score went up",
    "explain my score",
    "explain score",
    "score breakdown",
    "how is score calculated",
    "how score works",
    "scoring system",
    "what affects score",
    "lost points",
    "gained points",
    "score calculation",
    "how scoring works",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("explanation")) score += 0.4;
    if (
      question.includes("score") &&
      (question.includes("why") ||
        question.includes("how") ||
        question.includes("explain"))
    ) {
      score += 0.5;
    }
    if (
      question.includes("change") ||
      question.includes("drop") ||
      question.includes("went")
    )
      score += 0.3;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();

    if (!efficiency) {
      rb.say(
        "I'd be happy to explain how scoring works, though I can't show you your specific breakdown without data."
      );

      rb.paragraph(
        `Your efficiency score is calculated from two main components. On-time delivery accounts for ${
          CONFIG.SCORING.ON_TIME_WEIGHT * 100
        }% of the base score, which measures the percentage of cases you complete by their due date. Velocity makes up the other ${
          CONFIG.SCORING.VELOCITY_WEIGHT * 100
        }%, comparing how fast you complete cases versus historical benchmarks.`
      );

      rb.paragraph(
        `On top of that base score, there are penalties and bonuses. Each case completed late deducts ${CONFIG.SCORING.LATE_PENALTY_PER_CASE} points from your score. On the flip side, completing cases early can earn you bonus points, up to ${CONFIG.SCORING.MAX_EARLY_BONUS} points per case depending on how many days early.`
      );

      rb.paragraph("Select a stage to see your actual score breakdown.");

      rb.addButtons([["Check status", "How am I doing?"]]);

      return rb.toString();
    }

    const score = efficiency.score || 0;
    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;
    const lateCases =
      efficiency.onTimeDelivery?.caseInsights?.casesWithPenalties || [];
    const prevScore = ctx.session.previousScore;

    rb.say(
      `Let me break down your current score of ${U.formatPercent(score)}.`
    );

    // Base calculation
    const onTimeContribution = onTime * CONFIG.SCORING.ON_TIME_WEIGHT;
    const velocityContribution = velocity * CONFIG.SCORING.VELOCITY_WEIGHT;

    rb.paragraph(
      `The base score comes from two factors. Your on-time delivery rate of ${U.formatPercent(
        onTime
      )} contributes ${onTimeContribution.toFixed(1)} points (that's ${
        CONFIG.SCORING.ON_TIME_WEIGHT * 100
      }% of the on-time rate). Your velocity score of ${U.formatPercent(
        velocity
      )} adds another ${velocityContribution.toFixed(1)} points (${
        CONFIG.SCORING.VELOCITY_WEIGHT * 100
      }% of the velocity rate). Together, that's a base of ${(
        onTimeContribution + velocityContribution
      ).toFixed(1)} points.`
    );

    // Penalties
    if (lateCases.length > 0) {
      const totalPenalty =
        lateCases.length * CONFIG.SCORING.LATE_PENALTY_PER_CASE;
      rb.paragraph(
        `However, ${lateCases.length} case${
          lateCases.length !== 1 ? "s were" : " was"
        } completed late, which costs ${
          CONFIG.SCORING.LATE_PENALTY_PER_CASE
        } points each. That's a total penalty of ${totalPenalty.toFixed(
          1
        )} points deducted from your score.`
      );

      if (lateCases.length <= 5) {
        const caseList = lateCases.map((c) => c.caseNumber).join(", ");
        rb.say(` The late cases were: ${caseList}.`);
      }
    } else {
      rb.paragraph(
        "You don't have any late case penalties, which is great! Every late case would have cost you 2.5 points."
      );
    }

    // Score change context
    if (prevScore != null && Math.abs(score - prevScore) > 0.5) {
      const delta = score - prevScore;
      if (delta < 0) {
        rb.paragraph(
          `I noticed your score has dropped by ${Math.abs(delta).toFixed(
            1
          )} points recently. This is typically caused by new cases being completed late, or a slowdown in processing speed affecting the velocity component.`
        );
      } else {
        rb.paragraph(
          `Your score has actually improved by ${delta.toFixed(
            1
          )} points recently. This could be from better on-time delivery, faster completions, or older late cases falling out of the sample period.`
        );
      }
    }

    // Tips
    rb.paragraph(
      `To improve your score, the most impactful thing you can do is prevent late deliveries, since each one costs ${CONFIG.SCORING.LATE_PENALTY_PER_CASE} points. If you can complete cases a day or two early, you can earn up to ${CONFIG.SCORING.MAX_EARLY_BONUS} bonus points per case.`
    );

    rb.addButtons([
      ["Show at-risk cases", "Show me critical cases"],
      ["How to improve", "How can I improve?"],
      ["Run a scenario", "What if 3 cases go late?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// SCENARIO SIMULATOR - What-if analysis
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "scenario_simulator",
  priority: 75,
  category: "PERFORMANCE",
  capabilities: ["scenario", "prediction"],
  patterns: [
    "what if",
    "what would happen",
    "simulate",
    "scenario",
    "if cases go late",
    "cases go late",
    "project score",
    "impact of",
    "hypothetical",
    "if i",
    "suppose",
    "imagine",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("scenario")) score += 0.5;
    if (question.includes("what if")) score += 0.6;
    if (entities.counts.length > 0 && question.includes("late")) score += 0.4;
    if (question.includes("scenario") || question.includes("simulate"))
      score += 0.3;
    return Math.min(1, score);
  },

  async handle(ctx, question, entities) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();

    if (!efficiency) {
      rb.say(
        "I'd need your current performance data to run a scenario. Once you're viewing a stage, I can show you exactly how different outcomes would affect your score."
      );

      rb.paragraph(
        "For example, I could tell you what would happen if a certain number of cases went late, or how much your score would improve if you completed cases early."
      );

      rb.addButtons([["Check status", "How am I doing?"]]);

      return rb.toString();
    }

    const currentScore = efficiency.score || 0;
    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;
    const completedCases =
      efficiency.completedCases || efficiency.sampleSize || 100;

    // Extract scenario parameters from question
    let lateCases = 0;
    let earlyCases = 0;
    let earlyDays = 2;

    const numbers = entities.counts || [];
    const q = question.toLowerCase();

    if (numbers.length > 0) {
      if (q.includes("late")) {
        lateCases = numbers[0];
      } else if (q.includes("early")) {
        earlyCases = numbers[0];
        if (numbers.length > 1) {
          earlyDays = numbers[1];
        }
      }
    }

    // Default scenario if no numbers provided
    if (lateCases === 0 && earlyCases === 0) {
      lateCases = 3;
    }

    const projection = ctx.scoreCalculator.project(
      {
        score: currentScore,
        onTimeRate: onTime,
        velocityScore: velocity,
        completedCases,
      },
      { lateCases, earlyCases, earlyDays }
    );

    rb.say(`Let's see what would happen in that scenario.`);

    if (lateCases > 0) {
      rb.paragraph(
        `Your current score is ${U.formatPercent(
          currentScore
        )}. If ${lateCases} case${
          lateCases !== 1 ? "s go" : " goes"
        } late, your score would drop to ${U.formatPercent(
          projection.projectedScore
        )}, a decrease of ${Math.abs(projection.scoreDelta).toFixed(1)} points.`
      );

      rb.paragraph(
        `Here's why: each late case incurs a ${
          CONFIG.SCORING.LATE_PENALTY_PER_CASE
        } point penalty, so ${lateCases} late case${
          lateCases !== 1 ? "s would" : " would"
        } cost you ${projection.penalties.toFixed(
          1
        )} points total. Additionally, your on-time delivery rate would drop from ${U.formatPercent(
          onTime
        )} to ${U.formatPercent(
          projection.newOnTimeRate
        )}, further impacting the score.`
      );

      if (lateCases >= 3) {
        rb.paragraph(
          "This really illustrates why preventing late deliveries is so important. The penalties add up quickly."
        );
      }
    } else if (earlyCases > 0) {
      rb.paragraph(
        `Your current score is ${U.formatPercent(
          currentScore
        )}. If ${earlyCases} case${
          earlyCases !== 1 ? "s complete" : " completes"
        } ${earlyDays} day${
          earlyDays !== 1 ? "s" : ""
        } early, your score would increase to ${U.formatPercent(
          projection.projectedScore
        )}, a gain of ${projection.scoreDelta.toFixed(1)} points.`
      );

      rb.paragraph(
        `Early completions earn bonus points. In this scenario, you'd earn ${projection.bonuses.toFixed(
          1
        )} points from the early delivery bonus.`
      );
    }

    rb.paragraph("Want to try a different scenario?");

    rb.addButtons([
      ["5 cases late", "What if 5 cases go late?"],
      ["10 cases late", "What if 10 cases go late?"],
      ["3 cases early", "What if 3 cases complete 2 days early?"],
      ["Back to status", "How am I doing?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// DAILY BRIEF - Morning summary
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "daily_brief",
  priority: 72,
  category: "OPERATIONS",
  capabilities: ["summary", "time"],
  patterns: [
    "daily brief",
    "daily briefing",
    "morning brief",
    "morning briefing",
    "today's summary",
    "todays summary",
    "what's happening today",
    "whats happening today",
    "today's status",
    "daily update",
    "daily summary",
    "give me my brief",
    "start of day",
    "morning update",
    "morning summary",
  ],

  async match(ctx, question) {
    let score = scoreByPatterns(this.patterns, question);
    if (question.includes("brief") || question.includes("morning"))
      score += 0.3;
    if (question.includes("daily") || question.includes("today")) score += 0.2;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();
    const stage = ctx.getStage();
    const stageCount = ctx.getStageCount();
    const predictions = ctx.getPredictions();

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const hour = now.getHours();
    const timeOfDay =
      hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    rb.say(`Good ${timeOfDay}! Here's your brief for ${dateStr}.`);

    // Performance summary
    if (efficiency && !efficiency.noData) {
      const score = efficiency.score || 0;
      const rating = U.scoreToRating(score);
      const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;

      rb.paragraph(
        `Your efficiency score is currently ${U.formatPercent(
          score
        )}, which is ${rating}. On-time delivery is at ${U.formatPercent(
          onTime
        )}.`
      );

      if (stage) {
        rb.say(
          ` You're viewing the ${U.titleCase(
            stage
          )} stage with ${stageCount} active case${
            stageCount !== 1 ? "s" : ""
          }.`
        );
      }

      // Risk highlights
      const criticalCount = predictions?.urgent?.length || 0;
      const highCount = predictions?.high?.length || 0;

      if (criticalCount > 0 || highCount > 0) {
        if (criticalCount > 0) {
          rb.paragraph(
            `Heads up: there ${
              criticalCount === 1 ? "is" : "are"
            } ${criticalCount} case${
              criticalCount !== 1 ? "s" : ""
            } at critical risk of going late. ${
              criticalCount === 1 ? "This is" : "These are"
            } your top priority today.`
          );
        } else if (highCount > 0) {
          rb.paragraph(
            `There ${highCount === 1 ? "is" : "are"} ${highCount} case${
              highCount !== 1 ? "s" : ""
            } at elevated risk that you should keep an eye on today.`
          );
        }
      } else {
        rb.paragraph(
          "No cases are at critical risk right now, which is a good position to be in. Focus on maintaining your current pace."
        );
      }

      // Recommendations based on score
      if (score < 70) {
        rb.paragraph(
          "Given your current score, I'd recommend focusing on preventing any more late deliveries today. Check on any cases approaching their due dates."
        );
      } else if (score < 85) {
        rb.paragraph(
          "Today's focus should be on maintaining quality and trying to get a few cases completed ahead of schedule if possible."
        );
      } else {
        rb.paragraph(
          "You're in great shape. Keep doing what you're doing, and try to complete any easy wins early for bonus points."
        );
      }
    } else {
      rb.paragraph(
        "I don't have performance data loaded right now. Select a stage from the menu to see your full daily brief with metrics and risk analysis."
      );
    }

    rb.paragraph("What would you like to focus on?");

    rb.addButtons([
      ["Show critical cases", "Show me critical cases"],
      ["Performance details", "How am I doing?"],
      ["How to improve", "How can I improve?"],
      ["Find issues", "What needs attention?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// CASE LOOKUP - Find specific cases
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "case_lookup",
  priority: 78,
  category: "DISCOVERY",
  capabilities: ["case"],
  patterns: [
    "case",
    "tell me about case",
    "find case",
    "lookup case",
    "look up case",
    "show case",
    "case number",
    "case details",
    "what's the status of case",
    "whats the status of case",
    "where is case",
    "case info",
    "information about case",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.caseNumbers.length > 0) {
      score += 0.5;
      if (
        question.includes("case") ||
        question.includes("about") ||
        question.includes("status")
      ) {
        score += 0.3;
      }
    }
    return Math.min(1, score);
  },

  async handle(ctx, question, entities) {
    const rb = new ResponseBuilder();

    // Check for case number in entities or try last mentioned
    let caseNumber = entities.caseNumbers[0] || ctx.getLastMentionedCase();

    if (!caseNumber) {
      rb.say(
        "I can look up any case for you. Just tell me the case number and I'll show you its status, stage, and history."
      );

      rb.paragraph(
        'You can ask something like "Tell me about case 12345" or "What\'s the status of case 67890?"'
      );

      rb.addButtons([
        ["Check performance", "How am I doing?"],
        ["Show critical cases", "Show critical cases"],
      ]);

      return rb.toString();
    }

    // Look up the case
    const caseData = await DBKnowledge.caseByNumber(caseNumber);

    if (!caseData) {
      rb.say(`I couldn't find a case matching "${caseNumber}".`);

      rb.paragraph(
        "The case might have a different number, might be archived, or might be in a different department. Double-check the number and try again, or I can help you search differently."
      );

      rb.addButtons([
        ["Try another case", "Find case"],
        ["Check performance", "How am I doing?"],
      ]);

      return rb.toString();
    }

    ctx.recordMentionedCase(caseData.casenumber);

    const stage = U.stageFromCase(caseData);
    const caseType = U.caseTypeFromModifiers(caseData.modifiers);
    const isComplete = !!caseData.completed;
    const isArchived = !!caseData.archived;
    const dueDate = caseData.due ? new Date(caseData.due) : null;
    const now = new Date();

    rb.say(`Here's what I found for case ${caseData.casenumber}.`);

    // Status determination
    let statusDescription;
    if (isComplete) {
      const completedDate = new Date(caseData.completed);
      if (dueDate && completedDate > dueDate) {
        const hoursLate = (completedDate - dueDate) / (1000 * 60 * 60);
        const lateAmount =
          hoursLate > 24
            ? `${Math.round(hoursLate / 24)} day${
                Math.round(hoursLate / 24) !== 1 ? "s" : ""
              }`
            : `${Math.round(hoursLate)} hour${
                Math.round(hoursLate) !== 1 ? "s" : ""
              }`;
        statusDescription = `This case was completed ${U.relativeTime(
          caseData.completed
        )}, but it was ${lateAmount} late.`;
      } else {
        statusDescription = `This case was completed ${U.relativeTime(
          caseData.completed
        )}, on time.`;
      }
    } else if (isArchived) {
      statusDescription = "This case has been archived.";
    } else if (dueDate && now > dueDate) {
      const hoursOverdue = (now - dueDate) / (1000 * 60 * 60);
      const overdueAmount =
        hoursOverdue > 24
          ? `${Math.round(hoursOverdue / 24)} day${
              Math.round(hoursOverdue / 24) !== 1 ? "s" : ""
            }`
          : `${Math.round(hoursOverdue)} hour${
              Math.round(hoursOverdue) !== 1 ? "s" : ""
            }`;
      statusDescription = `This case is overdue by ${overdueAmount} and is currently in the ${stage} stage.`;
    } else if (dueDate) {
      const hoursUntil = (dueDate - now) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        statusDescription = `This case is due today and is currently in the ${stage} stage.`;
      } else if (hoursUntil < 48) {
        statusDescription = `This case is due tomorrow and is currently in the ${stage} stage.`;
      } else {
        const daysUntil = Math.round(hoursUntil / 24);
        statusDescription = `This case is due in ${daysUntil} days and is currently in the ${stage} stage.`;
      }
    } else {
      statusDescription = `This case is in the ${stage} stage.`;
    }

    rb.paragraph(statusDescription);

    // Additional details
    const details = [];
    if (caseData.department)
      details.push(`department is ${caseData.department}`);
    if (caseType !== "general")
      details.push(`it's a ${caseType.toUpperCase()} case`);
    if (caseData.priority) details.push("it's marked as priority");

    const mods = caseData.modifiers || [];
    if (mods.includes("rush")) details.push("it has a rush flag");
    if (mods.includes("hold")) details.push("it's currently on hold");

    if (details.length > 0) {
      rb.paragraph(`Additional details: ${details.join(", ")}.`);
    }

    // Timestamps
    if (caseData.created_at) {
      rb.paragraph(
        `The case was created ${U.relativeTime(caseData.created_at)}${
          dueDate ? ` with a due date of ${dueDate.toLocaleDateString()}` : ""
        }.`
      );
    }

    rb.addButtons([
      ["View history", `[MODAL:HISTORY|${caseData.id}|${caseData.casenumber}]`],
      ["Find another case", "Find case"],
      ["Check performance", "How am I doing?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// BOTTLENECK FINDER - Identifies workflow bottlenecks
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "bottleneck_finder",
  priority: 70,
  category: "ANALYTICS",
  capabilities: ["analysis"],
  patterns: [
    "bottleneck",
    "bottlenecks",
    "where are the bottlenecks",
    "slowest stage",
    "what's slowing",
    "whats slowing",
    "slow down",
    "slowing things down",
    "blocked",
    "stuck",
    "congestion",
    "backup",
    "backed up",
    "piling up",
  ],

  async match(ctx, question) {
    let score = scoreByPatterns(this.patterns, question);
    if (question.includes("bottleneck")) score += 0.4;
    if (question.includes("slow")) score += 0.3;
    if (question.includes("stuck") || question.includes("blocked"))
      score += 0.3;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();
    const stageStats = ctx.getStageStats();
    const throughput = ctx.getThroughput();

    if (!efficiency && !stageStats && !throughput) {
      rb.say(
        "I need performance data to analyze bottlenecks. Once you select a stage, I can look at processing times by case type and identify where things are slowing down."
      );

      rb.addButtons([["Check status", "How am I doing?"]]);

      return rb.toString();
    }

    rb.say("Let me analyze where things might be slowing down.");

    let foundBottleneck = false;

    // Analyze by case type if data available
    if (throughput?.byType) {
      const types = Object.entries(throughput.byType)
        .filter(([_, data]) => data.count > 0)
        .sort(
          (a, b) => (a[1].velocityScore || 100) - (b[1].velocityScore || 100)
        );

      if (types.length > 1) {
        const slowest = types[0];
        const fastest = types[types.length - 1];

        if ((slowest[1].velocityScore || 100) < 70) {
          foundBottleneck = true;
          rb.paragraph(
            `Looking at case types, ${U.titleCase(
              slowest[0]
            )} cases are the slowest, with a velocity of only ${U.formatPercent(
              slowest[1].velocityScore || 0
            )}. In comparison, ${U.titleCase(
              fastest[0]
            )} cases are moving at ${U.formatPercent(
              fastest[1].velocityScore || 0
            )} velocity.`
          );

          const gap =
            (fastest[1].velocityScore || 0) - (slowest[1].velocityScore || 0);
          if (gap > 20) {
            rb.paragraph(
              `That's a significant gap of ${gap.toFixed(
                0
              )} percentage points. You might want to investigate what's different about ${U.titleCase(
                slowest[0]
              )} cases, whether they're more complex, have dependencies, or get stuck waiting for something.`
            );
          }
        } else {
          rb.paragraph(
            `All case types are processing at reasonable velocities. ${U.titleCase(
              types[0][0]
            )} is the slowest at ${U.formatPercent(
              types[0][1].velocityScore || 0
            )}, but that's still within acceptable range.`
          );
        }
      }
    }

    // Analyze stage stats if available
    if (stageStats?.typeStats) {
      const typeStats = Object.entries(stageStats.typeStats)
        .filter(([_, stats]) => stats.count > 0)
        .sort((a, b) => (b[1].mean || 0) - (a[1].mean || 0));

      if (typeStats.length > 0) {
        const slowestType = typeStats[0];
        const avgTime = U.formatDuration(slowestType[1].mean || 0);

        if (slowestType[1].mean > (stageStats.averageTime || 0) * 1.3) {
          foundBottleneck = true;
          rb.paragraph(
            `${U.titleCase(
              slowestType[0]
            )} cases are taking ${avgTime} on average, which is notably longer than the overall average of ${U.formatDuration(
              stageStats.averageTime || 0
            )}. This could be a bottleneck worth investigating.`
          );
        }
      }
    }

    // General velocity check
    const velocity = efficiency?.throughput?.overall || 0;
    if (velocity < 70 && !foundBottleneck) {
      foundBottleneck = true;
      rb.paragraph(
        `Your overall velocity of ${U.formatPercent(
          velocity
        )} is below target. This suggests systemic delays rather than one specific case type causing problems. Consider looking at your overall process flow and whether there are common wait times or handoff delays.`
      );
    }

    if (!foundBottleneck) {
      rb.paragraph(
        "I'm not seeing any obvious bottlenecks right now. All case types are processing at similar rates and within expected timeframes. Keep monitoring, but things look healthy from a workflow perspective."
      );
    }

    rb.addButtons([
      ["Check performance", "How am I doing?"],
      ["Find issues", "What needs attention?"],
      ["How to improve", "How can I improve?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// TREND ANALYZER - Historical trends
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "trend_analyzer",
  priority: 68,
  category: "PERFORMANCE",
  capabilities: ["trend", "time"],
  patterns: [
    "trend",
    "trends",
    "trending",
    "over time",
    "historical",
    "history",
    "pattern",
    "patterns",
    "getting better",
    "getting worse",
    "improving",
    "declining",
    "compared to before",
    "last week",
    "past week",
  ],

  async match(ctx, question, entities) {
    let score = scoreByPatterns(this.patterns, question);
    if (entities.intents.includes("trend")) score += 0.4;
    if (question.includes("trend") || question.includes("pattern"))
      score += 0.3;
    if (entities.timeframes.length > 0) score += 0.2;
    return Math.min(1, score);
  },

  async handle(ctx, question) {
    const rb = new ResponseBuilder();
    const efficiency = ctx.getEfficiency();

    if (!efficiency) {
      rb.say(
        "I'd need your performance data to analyze trends. With data available, I can show you how your metrics have changed over time and whether things are improving or declining."
      );

      rb.addButtons([["Check status", "How am I doing?"]]);

      return rb.toString();
    }

    const score = efficiency.score || 0;
    const prevScore = ctx.session.previousScore;

    rb.say("Let me look at how things have been trending.");

    // Score trend if we have previous data
    if (prevScore != null && Math.abs(score - prevScore) > 0.5) {
      const delta = score - prevScore;
      if (delta > 0) {
        rb.paragraph(
          `Your score has improved by ${delta.toFixed(
            1
          )} points since I last checked. That's a positive trend! This usually means better on-time delivery or faster case completions.`
        );
      } else {
        rb.paragraph(
          `Your score has dropped by ${Math.abs(delta).toFixed(
            1
          )} points recently. This might be due to some cases going late or a slowdown in processing speed. It's worth investigating what changed.`
        );
      }
    } else {
      rb.paragraph(
        "Your score has been relatively stable. Without more historical data points, I can't identify a clear trend direction, but stability is generally a good sign."
      );
    }

    // Component breakdown
    const onTime = efficiency.onTimeDelivery?.overall?.actualRate || 0;
    const velocity = efficiency.throughput?.overall || 0;

    if (onTime < 80 && velocity >= 75) {
      rb.paragraph(
        "An interesting pattern: your velocity is decent but on-time delivery is lagging. This suggests cases are getting done quickly once started, but might be sitting too long before being picked up, or due dates are too aggressive."
      );
    } else if (velocity < 70 && onTime >= 80) {
      rb.paragraph(
        "Your on-time delivery is good despite lower velocity. This means you're meeting deadlines, but cases are taking longer than benchmarks suggest they should. You might have buffer in your due dates, which is smart."
      );
    } else if (onTime < 75 && velocity < 70) {
      rb.paragraph(
        "Both on-time delivery and velocity are below target. This is a pattern that suggests systemic capacity or process issues rather than isolated problems."
      );
    }

    rb.paragraph(
      "For more detailed trend analysis over longer periods, you might want to look at the full efficiency report in the dashboard."
    );

    rb.addButtons([
      ["Check performance", "How am I doing?"],
      ["Find issues", "What needs attention?"],
      ["How to improve", "How can I improve?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// TRACE VIEWER - Debug component routing
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "trace_viewer",
  priority: 40,
  category: "DEVELOPER",
  patterns: [
    "show trace",
    "debug",
    "routing history",
    "component history",
    "which component",
    "debug mode",
  ],

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const history = ctx.session.componentHistory.slice(-10);
    const turns = ctx.session.turns.slice(-10);

    if (history.length === 0) {
      rb.say(
        "There's no routing history yet. As you ask questions, I'll track which components handle them. Come back after asking a few questions and I can show you the trace."
      );

      rb.addButtons([
        ["Ask something", "How am I doing?"],
        ["Get help", "What can you help with?"],
      ]);

      return rb.toString();
    }

    rb.say(
      `Here's a trace of the last ${history.length} question${
        history.length !== 1 ? "s" : ""
      } and which components handled them.`
    );

    history
      .slice()
      .reverse()
      .forEach((h, i) => {
        const time = new Date(h.timestamp).toLocaleTimeString();
        const turn = turns[turns.length - 1 - i];
        const question = turn?.q?.substring(0, 50) || "N/A";

        rb.paragraph(
          `At ${time}, you asked "${question}${
            turn?.q?.length > 50 ? "..." : ""
          }" and it was handled by the ${h.componentId} component.`
        );
      });

    rb.paragraph(`Total questions this session: ${ctx.session.turns.length}`);

    rb.addButtons([
      ["Ask something new", "How am I doing?"],
      ["Get help", "What can you help with?"],
    ]);

    return rb.toString();
  },
});

// ----------------------------------------------------------------------------
// SCHEMA EXPLORER - Database schema info
// ----------------------------------------------------------------------------
COMPONENTS.register({
  id: "schema_explorer",
  priority: 50,
  category: "DATA",
  patterns: [
    "schema",
    "database schema",
    "tables",
    "what tables",
    "database structure",
    "data model",
    "show tables",
  ],

  async handle(ctx) {
    const rb = new ResponseBuilder();
    const schema = await DBKnowledge.schemaOverview();
    const tables = Object.keys(schema.tables || {});

    rb.say("Here's an overview of the database structure.");

    if (tables.length === 0) {
      rb.paragraph(
        "I wasn't able to retrieve the schema information. This might be a permissions issue."
      );
    } else {
      rb.paragraph(
        `The system uses ${tables.length} main tables: ${tables.join(", ")}.`
      );

      rb.paragraph(
        "The cases table stores all the case data including case numbers, due dates, completion status, and modifiers. The case_history table keeps an audit trail of all changes made to cases. The active_devices table tracks user sessions."
      );
    }

    rb.addButtons([
      ["Check status", "How am I doing?"],
      ["Get help", "What can you help with?"],
    ]);

    return rb.toString();
  },
});

// ============================================================================
// PUBLIC EXPORTS
// ============================================================================
let _engineInstance = null;

export default async function askSystem(question, extraContext = {}) {
  if (!_engineInstance) {
    _engineInstance = new AppQAKernel();
  }
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
};
