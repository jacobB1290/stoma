// /src/qa/LLMChatService.js
// ============================================================================
// LLM CHAT SERVICE FOR STOMABOARD
// Database-aware tools designed for Stomaboard's exact schema
// ============================================================================

import { db } from "../services/caseService";
import * as CaseService from "../services/caseService";

// ============================================================================
// CONFIGURATION - All settings in one place for easy editing
// ============================================================================

const LLM_CONFIG = {
  // Model settings
  MODEL: "gpt-5-nano",
  MAX_OUTPUT_TOKENS: 16384,
  REASONING_EFFORT: "medium", // "low", "medium", "high"

  // API settings
  API_KEY: process.env.REACT_APP_OPENAI_API_KEY || "",
  BASE_URL: "https://api.openai.com/v1",

  // Session limits
  SESSION_TIMEOUT: 600000, // 10 minutes - total session time
  API_CALL_TIMEOUT: 600000, // 10 minutes - per API call
  MAX_RETRIES: 3, // Retries on transient errors
  MAX_ITERATIONS: 30, // Max tool call iterations per session
  MAX_TOOLS_PER_ITERATION: 30, // Max tools model can call at once
  MAX_CONVERSATION_HISTORY: 30, // Messages to keep in context

  // Data caching
  CACHE_TTL: 30000, // 30 seconds - database cache lifetime

  // Local proxy settings (for development)
  LOCAL_PROXY_URL: "http://localhost:3001",
  LOCAL_PROXY_CHECK_TIMEOUT: 2000, // 2 seconds to check if proxy is running
};

// Status callback for UI updates
let statusCallback = null;

// Event log for debugging - tracks the entire thought chain
let eventLog = [];
let eventLogCallback = null;

export function setStatusCallback(callback) {
  statusCallback = callback;
}

export function setEventLogCallback(callback) {
  eventLogCallback = callback;
}

export function getEventLog() {
  return [...eventLog];
}

export function clearEventLog() {
  eventLog = [];
  if (eventLogCallback) eventLogCallback([]);
}

export const STATUS_TYPES = {
  IDLE: "idle",
  THINKING: "thinking",
  LOADING_DATA: "loading_data",
  PROCESSING: "processing",
  CALLING_TOOL: "calling_tool",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  FIXING_ERROR: "fixing_error",
  REQUERYING: "requerying",
  RENDERING: "rendering",
  COMPLETE: "complete",
  ERROR: "error",
};

// Event types for the log - consolidated and informative
export const EVENT_TYPES = {
  SESSION_START: "session_start", // Session began with question
  DB_LOADED: "db_loaded", // Database loaded with stats
  ITERATION: "iteration", // Each AI turn (request -> response -> tools)
  TOOL_EXECUTED: "tool_executed", // Tool called and result
  MODEL_OUTPUT: "model_output", // What the model said/decided
  DIRECT_TEXT_REJECTED: "direct_text_rejected", // Model tried direct text - rejected, must use display_to_user
  TIME_WARNING: "time_warning", // Time pressure warning
  ERROR: "error", // Something went wrong
  RETRY: "retry", // Retrying after error
  SESSION_END: "session_end", // Session completed
};

function logEvent(type, data = {}) {
  const event = {
    id: eventLog.length + 1,
    type,
    timestamp: Date.now(),
    time: new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    }),
    ...data,
  };
  eventLog.push(event);

  // Keep log from growing too large
  if (eventLog.length > 200) {
    eventLog = eventLog.slice(-150);
  }

  if (eventLogCallback) {
    eventLogCallback([...eventLog]);
  }

  return event;
}

// Current status for UI (not logged to event chain - too noisy)
function updateStatus(status, detail = null, extra = {}) {
  console.log(`[LLM Status] ${status}${detail ? ": " + detail : ""}`);

  // Only update UI callback, don't log every status change
  if (statusCallback) {
    statusCallback({ status, detail, timestamp: Date.now(), ...extra });
  }
}

// ============================================================================
// INLINE UI ELEMENT PARSER
// Parse UI elements embedded in model's direct text response
// Supports multiple formats:
//   1. <!--UI_ELEMENT:{...}:END_UI_ELEMENT--> (standard format)
//   2. ```ui:component {...} ``` (simpler format for model)
//   3. [UI:{...}] (compact inline format)
// ============================================================================

function parseInlineUIElements(text) {
  const elements = [];
  let cleanText = text || "";

  // Format 1: <!--UI_ELEMENT:{...}:END_UI_ELEMENT-->
  const htmlCommentRegex = /<!--UI_ELEMENT:([\s\S]*?):END_UI_ELEMENT-->/g;
  let match;
  while ((match = htmlCommentRegex.exec(text)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr);
      if (data.componentCode || data._uiType) {
        elements.push({
          _uiType: data._uiType || "DYNAMIC_COMPONENT",
          componentCode: data.componentCode,
          data: data.data || {},
          description: data.description || "Inline component",
        });
      }
      cleanText = cleanText.replace(match[0], "");
    } catch (e) {
      console.warn(
        "[parseInlineUI] Failed to parse HTML comment format:",
        e.message
      );
    }
  }

  // Format 2: ```ui:component {...json...} ``` or ```ui {...json...} ```
  const codeBlockRegex = /```(?:ui:component|ui)\s*([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr);
      if (data.componentCode) {
        elements.push({
          _uiType: "DYNAMIC_COMPONENT",
          componentCode: data.componentCode,
          data: data.data || {},
          description: data.description || "Component from code block",
        });
      }
      cleanText = cleanText.replace(match[0], "");
    } catch (e) {
      console.warn(
        "[parseInlineUI] Failed to parse code block format:",
        e.message
      );
    }
  }

  // Format 3: [UI:{...}] - compact inline
  const inlineRegex = /\[UI:(\{[\s\S]*?\})\]/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const data = JSON.parse(jsonStr);
      if (data.componentCode) {
        elements.push({
          _uiType: "DYNAMIC_COMPONENT",
          componentCode: data.componentCode,
          data: data.data || {},
          description: data.description || "Inline component",
        });
      }
      cleanText = cleanText.replace(match[0], "");
    } catch (e) {
      console.warn("[parseInlineUI] Failed to parse inline format:", e.message);
    }
  }

  return { elements, cleanText: cleanText.trim() };
}

// Build a summary of what's happened so far (for model context)
function buildChainOfThoughtSummary() {
  const events = getEventLog();
  if (events.length === 0) return "";

  // Count what we've done
  const toolCalls = events.filter((e) => e.type === EVENT_TYPES.TOOL_EXECUTED);
  const iterations = events.filter((e) => e.type === EVENT_TYPES.ITERATION);
  const errors = events.filter((e) => e.type === EVENT_TYPES.ERROR);
  const successfulTools = toolCalls.filter((e) => e.success);

  let summary = "\n\n[SYSTEM - YOUR PROGRESS SO FAR]:\n";
  summary += `• Iterations completed: ${iterations.length}\n`;
  summary += `• Tools called: ${toolCalls.length} (${successfulTools.length} successful)\n`;

  if (errors.length > 0) {
    summary += `• Errors: ${errors.length}\n`;
  }

  // Show what data we've gathered
  summary += "\nData you have gathered:\n";
  for (const tool of toolCalls) {
    if (tool.success) {
      summary += `  ✓ ${tool.tool}: ${tool.resultSummary}\n`;
    } else {
      summary += `  ✗ ${tool.tool}: FAILED - ${tool.error || "error"}\n`;
    }
  }

  return summary;
}

// ============================================================================
// DATABASE SCHEMA DOCUMENTATION (for model context)
// ============================================================================

const DB_SCHEMA = {
  cases: {
    table: "cases",
    columns: {
      id: "UUID primary key",
      casenumber:
        'string - the case number (can include text like "1051 front office")',
      due: "timestamp - due date",
      completed: "boolean - is case marked complete",
      created_at: "timestamp - when case was created",
      department: 'string - "Metal", "General", or "C&B"',
      modifiers: "JSON array - contains stage, flags, and type info",
      due_time: "string - time component",
      hold_started: "timestamp - when hold was activated (if any)",
      priority: "boolean - is priority flagged",
      archived: "boolean - is archived",
      archived_at: "timestamp - when archived",
    },
    modifiers_values: {
      stages: [
        "stage-design",
        "stage-production",
        "stage-finishing",
        "stage-qc",
        "stage2",
      ],
      flags: ["rush", "hold", "priority", "newaccount"],
      types: ["flex", "bbs"],
      exclusions: ["stats-exclude:design", "stats-exclude:all"],
    },
    departments: ["Metal", "General", "C&B"],
  },
  case_history: {
    table: "case_history",
    columns: {
      id: "UUID primary key",
      case_id: "UUID foreign key to cases.id",
      action: "string - description of what happened",
      created_at: "timestamp",
      user_name: "string - who did it",
    },
    common_actions: [
      "Case created",
      "Marked done",
      "Case archived",
      "Moved to Stage 2",
      "Moved from Design to Production stage",
      "Moved from Production to Finishing stage",
      "Moved from Finishing to Quality Control",
      "Priority added",
      "Priority removed",
      "rush added",
      "rush removed",
      "hold added",
      "hold removed",
      "Undo done",
    ],
  },
};

// ============================================================================
// DATABASE HELPERS (parsing + computed fields)
// ============================================================================

function safeParseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function computeStageFromModifiers(mods) {
  if (mods.includes("stage2")) return "stage2";
  if (mods.includes("stage-qc") || mods.includes("stage:qc")) return "qc";
  if (mods.includes("stage-finishing") || mods.includes("stage:finishing"))
    return "finishing";
  if (mods.includes("stage-production") || mods.includes("stage:production"))
    return "production";
  if (mods.includes("stage-design") || mods.includes("stage:design"))
    return "design";
  return "design";
}

function dueDatePart(dueValue) {
  const s = String(dueValue || "");
  return s.length >= 10 ? s.slice(0, 10) : "";
}

function buildDueAtLocal(caseRow) {
  const d = dueDatePart(caseRow.due);
  const t = caseRow.due_time || "23:59:59";
  if (!d) return null;
  // Treat due as a local date with a local time, so UI and overdue logic match expectations.
  return new Date(d + "T" + t);
}

function startOfLocalDay(dt) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function daysUntilDueLocal(caseRow, now) {
  const dueAt = buildDueAtLocal(caseRow);
  if (!dueAt) return null;
  const a = startOfLocalDay(dueAt).getTime();
  const b = startOfLocalDay(now).getTime();
  const msPerDay = 86400000;
  return Math.round((a - b) / msPerDay);
}

function formatDueShortFromDatePart(datePartStr) {
  if (!datePartStr || datePartStr.length !== 10) return "";
  const m = Number(datePartStr.slice(5, 7));
  const d = Number(datePartStr.slice(8, 10));
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mm = m >= 1 && m <= 12 ? months[m - 1] : "";
  return mm ? mm + " " + String(d) : "";
}

function isStatsExcluded(mods) {
  for (const m of mods) {
    if (typeof m !== "string") continue;
    if (m.startsWith("stats-exclude:")) return true;
    if (m.startsWith("stats-exclude-reason:")) return true;
  }
  return false;
}
// ============================================================================
// LOAD FULL DATABASE INTO MEMORY
// ============================================================================

let cachedData = null;
let cacheTimestamp = null;
// Using LLM_CONFIG.CACHE_TTL

async function loadFullDatabase(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    cachedData &&
    cacheTimestamp &&
    now - cacheTimestamp < LLM_CONFIG.CACHE_TTL
  ) {
    return cachedData;
  }

  updateStatus(STATUS_TYPES.LOADING_DATA, "Loading full database");

  const [casesResult, historyResult] = await Promise.all([
    db.from("cases").select("*").order("due", { ascending: true }),
    db
      .from("case_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (casesResult.error) {
    throw new Error(`Failed to load cases: ${casesResult.error.message}`);
  }

  const allCases = casesResult.data || [];
  const allHistory = historyResult.data || [];
  const now_date = new Date();

  // Process cases with computed fields
  const processedCases = allCases.map((c) => {
    const nowLocal = new Date();
    const mods = safeParseJsonArray(c.modifiers);

    const stage = computeStageFromModifiers(mods);

    const datePart = dueDatePart(c.due);
    const dueAtLocal = buildDueAtLocal({ due: c.due, due_time: c.due_time });
    const dueAtLocalMs = dueAtLocal ? dueAtLocal.getTime() : null;

    const daysUntilDue = daysUntilDueLocal(
      { due: c.due, due_time: c.due_time },
      nowLocal
    );

    const completed = Boolean(c.completed);
    const archived = Boolean(c.archived);

    const statsExcluded = isStatsExcluded(mods);

    // Risk calculation (uses local due date to avoid timezone drift)
    let riskScore = 10;
    if (!completed && daysUntilDue !== null) {
      if (daysUntilDue < 0) riskScore = 100;
      else if (daysUntilDue === 0) riskScore = 90;
      else if (daysUntilDue <= 1) riskScore = 75;
      else if (daysUntilDue <= 2) riskScore = 55;
      else if (daysUntilDue <= 3) riskScore = 40;
      else if (daysUntilDue <= 5) riskScore = 25;
      else riskScore = 10;
    }

    return {
      // Raw fields
      id: c.id,
      casenumber: c.casenumber,
      due: c.due,
      due_time: c.due_time,
      created_ts: c.created_ts,
      completed,
      created_at: c.created_at,
      department: c.department,
      modifiers: mods,
      hold_started: c.hold_started,
      priority: Boolean(c.priority),
      archived,
      archived_at: c.archived_at,

      // Computed fields
      stage,
      dueDatePart: datePart,
      dueAtLocalMs,
      daysUntilDue,
      isOverdue: !completed && daysUntilDue !== null && daysUntilDue < 0,
      isRush: mods.includes("rush"),
      isHold: mods.includes("hold"),
      isFlex: mods.includes("flex"),
      isBBS: mods.includes("bbs"),
      isNewAccount: mods.includes("newaccount"),
      statsExcluded,
      riskScore,
      riskLevel:
        riskScore >= 80
          ? "critical"
          : riskScore >= 50
          ? "high"
          : riskScore >= 30
          ? "medium"
          : "low",
      dueFormatted: formatDueShortFromDatePart(datePart),
    };
  });

  // Build indexes for fast lookups
  const activeCases = processedCases.filter((c) => !c.archived && !c.completed);
  const activeForStats = activeCases.filter((c) => !c.statsExcluded);

  const byDepartment = {};
  const byStage = {
    design: [],
    production: [],
    finishing: [],
    qc: [],
    stage2: [],
  };

  activeCases.forEach((c) => {
    if (!byDepartment[c.department]) byDepartment[c.department] = [];
    byDepartment[c.department].push(c);
    if (byStage[c.stage]) byStage[c.stage].push(c);
  });

  cachedData = {
    raw: {
      cases: allCases,
      history: allHistory,
    },
    processed: processedCases,
    active: activeCases,
    indexes: {
      byDepartment,
      byStage,
      overdue: activeCases.filter((c) => c.isOverdue),
      rush: activeCases.filter((c) => c.isRush),
      priority: activeCases.filter((c) => c.priority),
      hold: activeCases.filter((c) => c.isHold),
      statsExcludedActive: activeCases.filter((c) => c.statsExcluded),
      activeForStats,
      critical: activeCases.filter((c) => c.riskLevel === "critical"),
      highRisk: activeCases.filter((c) => c.riskLevel === "high"),
    },
    summary: {
      total: processedCases.length,
      active: activeCases.length,
      activeForStats: activeForStats.length,
      statsExcludedActive: activeCases.filter((c) => c.statsExcluded).length,
      archived: processedCases.filter((c) => c.archived).length,
      completed: processedCases.filter((c) => c.completed && !c.archived)
        .length,
      overdue: activeCases.filter((c) => c.isOverdue).length,
      overdueForStats: activeForStats.filter((c) => c.isOverdue).length,
      rush: activeCases.filter((c) => c.isRush).length,
      rushForStats: activeForStats.filter((c) => c.isRush).length,
      priority: activeCases.filter((c) => c.priority).length,
      priorityForStats: activeForStats.filter((c) => c.priority).length,
      hold: activeCases.filter((c) => c.isHold).length,
      holdForStats: activeForStats.filter((c) => c.isHold).length,
      byDepartment: Object.fromEntries(
        Object.entries(byDepartment).map(([k, v]) => [k, v.length])
      ),
      byStage: Object.fromEntries(
        Object.entries(byStage).map(([k, v]) => [k, v.length])
      ),
      risk: {
        critical: activeCases.filter((c) => c.riskLevel === "critical").length,
        high: activeCases.filter((c) => c.riskLevel === "high").length,
        medium: activeCases.filter((c) => c.riskLevel === "medium").length,
        low: activeCases.filter((c) => c.riskLevel === "low").length,
      },
    },
    timestamp: new Date().toISOString(),
    historyCount: allHistory.length,
  };

  cacheTimestamp = now;
  return cachedData;
}

// ============================================================================
// TOOL DEFINITIONS - Database-specific
// ============================================================================

const TOOLS = [
  // === DISPLAY TO USER ===
  {
    type: "function",
    name: "display_to_user",
    description: `Show your response to the user. The user sees nothing until you call this.

FLOW:
1. Gather data (get_cases, get_summary, etc.)
2. Create visualizations if needed (render_ui, render_workload_chart)
3. Call display_to_user with message AND show_ui=true

PARAMETERS:
- message: Your response text (required)
- show_ui: Set TRUE to display any UI components you created`,
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "REQUIRED: Your complete response text (markdown supported)",
        },
        show_ui: {
          type: "boolean",
          description:
            "Set TRUE to show UI components (render_ui, charts). Default: true",
        },
      },
      required: ["message"],
    },
  },

  // === GET CASES - Primary query tool ===
  {
    type: "function",
    name: "get_cases",
    description: `Query cases from the database (cached in memory for speed).

DEPARTMENTS: "Metal", "General", "C&B"

STAGES (from modifiers):
- "design" (default, also stage-design)
- "production" (stage-production or stage:production)
- "finishing" (stage-finishing or stage:finishing)
- "qc" (stage-qc)
- "stage2" (Metal stage 2)

FLAGS:
- rush, hold, newaccount, flex, bbs are in the modifiers array
- priority is a boolean column on the case (not a modifier)

DUE DATES:
- due is stored at midnight UTC in the DB
- this tool uses the local date part + due_time (if present) to avoid timezone drift in "overdue" and "dueFormatted"

FILTER OPTIONS:
- department: exact match ("Metal", "General", "C&B")
- stage: "design", "production", "finishing", "qc", "stage2", "all"
- status: "active" (default), "overdue", "completed", "archived", "hold", "all"
- priority: true/false
- rush: true/false
- risk_level: "critical", "high", "medium", "low"
- due_within_days: number (cases due in next N days, excluding overdue)
- due_date_from / due_date_to: YYYY-MM-DD (local date part compare)
- include_modifiers: array of strings (case must include all)
- exclude_modifiers: array of strings (case must include none)
- include_stats_excluded: true/false (default false)
- search: partial match on casenumber

RETURNS: { count, cases[], summary }`,
    parameters: {
      type: "object",
      properties: {
        department: { type: "string", enum: ["Metal", "General", "C&B"] },
        stage: {
          type: "string",
          enum: ["design", "production", "finishing", "qc", "stage2", "all"],
        },
        status: {
          type: "string",
          enum: ["active", "overdue", "completed", "archived", "hold", "all"],
        },
        priority: { type: "boolean" },
        rush: { type: "boolean" },
        risk_level: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
        },
        due_within_days: { type: "integer" },
        search: { type: "string" },
        due_date_from: {
          type: "string",
          description: "YYYY-MM-DD (local date part compare)",
        },
        due_date_to: {
          type: "string",
          description: "YYYY-MM-DD (local date part compare)",
        },
        include_modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Case must include all of these modifiers",
        },
        exclude_modifiers: {
          type: "array",
          items: { type: "string" },
          description: "Case must include none of these modifiers",
        },
        include_stats_excluded: {
          type: "boolean",
          description: "Include cases excluded from stats (default false)",
        },
        sort_by: {
          type: "string",
          enum: ["due", "created_at", "casenumber", "risk_score"],
        },
        sort_order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", description: "Max results (default 100)" },
      },
    },
  },

  // === SCHEMA + PROFILING (helps model explore safely) ===
  {
    type: "function",
    name: "get_schema",
    description:
      "Return the database schema documentation and notes about key fields.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "profile_table",
    description:
      "Quick database profile (row counts and top values) without dumping everything.",
    parameters: {
      type: "object",
      properties: {
        table: { type: "string", enum: ["cases", "case_history"] },
        top_n: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["table"],
    },
  },
  {
    type: "function",
    name: "find_cases",
    description:
      "Find candidate cases by casenumber text. Use this before get_case_by_id to avoid wrong matches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: {
          type: "string",
          enum: ["exact", "contains"],
          default: "contains",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        include_archived: { type: "boolean", default: false },
        include_completed: { type: "boolean", default: false },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "get_case_by_id",
    description: "Get a single case by id, with computed fields.",
    parameters: {
      type: "object",
      properties: {
        case_id: { type: "string" },
      },
      required: ["case_id"],
    },
  },
  {
    type: "function",
    name: "get_case_history_db",
    description:
      "Fetch full history for a case directly from the database, paginated.",
    parameters: {
      type: "object",
      properties: {
        case_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        offset: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
      },
      required: ["case_id"],
    },
  },

  // === GET SUMMARY - Quick stats ===
  {
    type: "function",
    name: "get_summary",
    description: `Get summary statistics for the ENTIRE database.
    
No parameters needed for overall summary. Optionally filter by department.

RETURNS: {
  total,                    // TOTAL cases in entire database (all time)
  active,                   // Currently active (not archived/completed)
  archived,                 // Archived cases
  completed,                // Completed but not archived
  overdue, rush, priority, hold,
  byDepartment: { Metal, General, "C&B" },
  byStage: { design, production, finishing, qc, stage2 },
  risk: { critical, high, medium, low }
}

NOTE: 'total' = entire database count, 'active' = current workload`,
    parameters: {
      type: "object",
      properties: {
        department: { type: "string", enum: ["Metal", "General", "C&B"] },
      },
    },
  },

  // === GET CASE DETAILS ===
  {
    type: "function",
    name: "get_case",
    description: `Get case details by casenumber text.

Important:
- This is a text search and can match multiple cases.
- If multiple candidates exist, use find_cases + get_case_by_id for a guaranteed correct match.

Includes cached recent history and may not include the full history table. For full history, use get_case_history_db.`,
    parameters: {
      type: "object",
      properties: {
        casenumber: {
          type: "string",
          description: "Full or partial case number",
        },
      },
      required: ["casenumber"],
    },
  },

  // === GET HISTORY ===
  {
    type: "function",
    name: "get_history",
    description: `Get recent activity history.
    
Optionally filter by:
- user_name: who performed the action
- action_type: type of action (e.g., "Case created", "Marked done", "Priority added")
- case_id: specific case UUID

COMMON ACTIONS:
"Case created", "Marked done", "Case archived", "Moved to Stage 2",
"Moved from Design to Production stage", "Priority added", "rush added", "hold added"`,
    parameters: {
      type: "object",
      properties: {
        user_name: { type: "string" },
        action_contains: {
          type: "string",
          description: "Filter actions containing this text",
        },
        case_id: { type: "string" },
        limit: { type: "integer", description: "Max results (default 50)" },
      },
    },
  },

  // === CUSTOM QUERY - Model can write its own ===
  {
    type: "function",
    name: "custom_query",
    description: `Execute a custom JavaScript filter/map/reduce on the loaded data.
    
You have access to:
- data.processed: all cases with computed fields
- data.active: non-archived, non-completed cases
- data.raw.cases: raw DB records
- data.raw.history: recent history records
- data.indexes: pre-built indexes (byDepartment, byStage, overdue, rush, priority, hold, critical, highRisk)
- data.summary: pre-computed counts

Write a JavaScript expression that will be evaluated with 'data' in scope.
Must return a value (object, array, or primitive).

EXAMPLES:
- "data.active.filter(c => c.department === 'Metal' && c.isOverdue).length"
- "data.indexes.byDepartment['General'].filter(c => c.stage === 'production')"
- "Object.entries(data.indexes.byDepartment).map(([dept, cases]) => ({ dept, overdue: cases.filter(c => c.isOverdue).length }))"
- "data.raw.history.filter(h => h.action.includes('Priority')).slice(0, 20)"`,
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "JavaScript expression to evaluate",
        },
        description: {
          type: "string",
          description: "What this query does (for logging)",
        },
      },
      required: ["expression"],
    },
  },

  // === REFRESH DATA ===
  {
    type: "function",
    name: "refresh_data",
    description: `Force reload all data from database.
    
Use if:
- Data seems stale or incorrect
- User says something changed
- You need the absolute latest info`,
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    },
  },

  // === GET ALL DATA (Full Database Dump) ===
  {
    type: "function",
    name: "get_all_data",
    description: `Get the ENTIRE database in one call.

WHAT'S INCLUDED BY DEFAULT:
- cases: All ACTIVE cases (current workload) with full details
- summary: Statistics including TOTAL database count (all-time), active, archived, completed
- byDepartment/byStage: Groupings with counts

OPTIONAL (set to true):
- include_archived: Add ALL cases (active + archived + completed) - the complete database
- include_history: Add recent case history records

RETURNS:
{
  cases: [...],           // Active cases by default
  summary: {
    total: 3336,          // TOTAL cases in entire database (all time)
    active: 58,           // Current active workload
    archived: 3200,       // Archived cases
    completed: 78,        // Completed but not archived
    ...
  },
  byDepartment: {...},
  byStage: {...},
  totalCases: number,     // Count of cases in response
  allCases: [...],        // Only if include_archived=true
  history: [...]          // Only if include_history=true
}

TIP: For total database count, just use get_summary - it's faster and returns summary.total`,
    parameters: {
      type: "object",
      properties: {
        include_history: {
          type: "boolean",
          description: "Include case history records (default: false)",
        },
        include_archived: {
          type: "boolean",
          description:
            "Include ALL cases (archived + completed) - the complete database (default: false)",
        },
      },
    },
  },

  // === RENDER UI COMPONENT ===
  {
    type: "function",
    name: "render_ui",
    description: `Create a visual component (chart, table, card).

⚠️ REQUIRED: component_code and description. data is strongly recommended.
If data is omitted, the system auto-injects a compact database snapshot as data.db.
⚠️ IMPORTANT: After calling render_ui, you MUST call display_to_user(show_ui=true) or the UI won't appear!

CORRECT FLOW:
1. Call render_ui(component_code, description, data?)
2. Call display_to_user(message="...", show_ui=true) ← REQUIRED!

CORRECT USAGE:
{
  "component_code": "({ data }) => React.createElement('div', { className: 'p-4 bg-white rounded' }, React.createElement('h3', { className: 'font-bold' }, data.title), data.items.map((item, i) => React.createElement('div', { key: i }, item.label, ': ', item.value)))",
  "data": { "title": "Summary", "items": [{ "label": "Active", "value": 62 }, { "label": "Overdue", "value": 5 }] },
  "description": "Stats card showing case summary"
}

RULES:
1. component_code: JavaScript function expression that returns React.createElement (NO JSX). Do not wrap the whole function in extra parentheses and do not end with an extra ')'.
2. data: Object containing EVERY value your component references (data.title, data.items, etc.)
3. description: What the component displays
4. AFTER THIS: Call display_to_user with show_ui=true

COMMON MISTAKES:
⚠️ If you omit data, your component must read from data.db.* (auto-provided). Otherwise provide your own data object.
❌ WRONG: Not calling display_to_user after → UI never appears
✅ RIGHT: render_ui with all params, THEN display_to_user(show_ui=true)`,
    parameters: {
      type: "object",
      properties: {
        component_code: {
          type: "string",
          description:
            "REQUIRED: JavaScript function expression using React.createElement. Component receives { data } prop.",
        },
        data: {
          type: "object",
          description:
            "Optional: provide the values your component uses (data.title, data.items, etc.). If omitted, you can read from data.db.* (auto-injected).",
        },
        description: {
          type: "string",
          description:
            "REQUIRED: Brief description of what this component displays.",
        },
      },
      required: ["component_code", "description"],
      additionalProperties: false,
    },
  },

  // === RENDER UI COMPONENT (DB-INJECTED) ===
  {
    type: "function",
    name: "render_ui_db",
    description: `Create a visual component (chart, table, card) WITHOUT manually providing data.

This tool auto-injects a compact database snapshot as data.db.
Use this when you want UI based on current database state.

DATA AVAILABLE INSIDE YOUR COMPONENT:
- data.db.summary (counts, stages, risk)
- data.db.active (up to 200 active cases, light fields)
- data.db.departments, data.db.stages
- data.db.nowIso

CORRECT FLOW:
1. Call render_ui_db(component_code, description, scope?)
2. Call display_to_user(show_ui=true)

SCOPE:
- default: summary + active (recommended)
- summary: only summary
- active: only active list`,
    parameters: {
      type: "object",
      properties: {
        component_code: {
          type: "string",
          description:
            "REQUIRED: JavaScript function expression using React.createElement. Component receives { data } prop.",
        },
        description: {
          type: "string",
          description:
            "REQUIRED: Brief description of what this component displays.",
        },
        scope: {
          type: "string",
          enum: ["default", "summary", "active"],
          description:
            "Optional: choose how much DB data to inject (default: default).",
        },
      },
      required: ["component_code", "description"],
      additionalProperties: false,
    },
  },

  // === PROPOSE ACTION ===
  {
    type: "function",
    name: "propose_action",
    description: `Propose a data change. User must confirm before execution.
    
ACTIONS:
- set_priority / remove_priority
- set_rush / remove_rush
- set_hold / remove_hold
- move_stage (to: design, production, finishing, qc)
- mark_complete / undo_complete`,
    parameters: {
      type: "object",
      properties: {
        casenumber: { type: "string" },
        action: {
          type: "string",
          enum: [
            "set_priority",
            "remove_priority",
            "set_rush",
            "remove_rush",
            "set_hold",
            "remove_hold",
            "move_stage",
            "mark_complete",
            "undo_complete",
          ],
        },
        target_stage: {
          type: "string",
          enum: ["design", "production", "finishing", "qc"],
        },
        reason: { type: "string" },
      },
      required: ["casenumber", "action", "reason"],
    },
  },

  // === RENDER WORKLOAD CHART ===
  {
    type: "function",
    name: "render_workload_chart",
    description: `Render a 7-day workload projection chart with current stats and trend forecast.

⚠️ IMPORTANT: After calling this, you MUST call display_to_user(show_ui=true) or the chart won't appear!

CORRECT FLOW:
1. Call render_workload_chart()
2. Call display_to_user(message="Here's the workload overview:", show_ui=true) ← REQUIRED!

Use this for workload overviews, trend analysis, or when user asks about projections.
Data is automatically pulled from the loaded database - no parameters needed.

WHAT IT SHOWS:
- Active cases count with 7-day trend
- Rush cases count with 7-day trend  
- Overdue cases count with 7-day trend
- Cases by stage (Design, Production, Finishing, QC)
- Risk distribution (Critical, High, Medium)
- Bar chart showing 7-day projection`,
    parameters: {
      type: "object",
      properties: {
        compact: {
          type: "boolean",
          description: "Use compact view (trend lines only)",
        },
      },
    },
  },
];

// ============================================================================
// TOOL EXECUTION
// ============================================================================

// On-demand data loading - uses the existing cache from loadFullDatabase
async function ensureDataLoaded() {
  const now = Date.now();
  // Use existing cache if valid, otherwise load fresh
  if (
    !cachedData ||
    !cacheTimestamp ||
    now - cacheTimestamp > LLM_CONFIG.CACHE_TTL
  ) {
    console.log("[LLM] Loading database on-demand...");
    updateStatus(STATUS_TYPES.LOADING_DATA, "Fetching data from database...");
    const loadStart = Date.now();
    const data = await loadFullDatabase(true);

    logEvent(EVENT_TYPES.DB_LOADED, {
      totalCases: data?.summary?.total || 0, // Total in entire database
      activeCases: data?.summary?.active || 0, // Current workload
      archivedCases: data?.summary?.archived || 0, // Archived
      overdueCount: data?.summary?.overdue || 0,
      rushCount: data?.summary?.rush || 0,
      loadTimeMs: Date.now() - loadStart,
      onDemand: true,
    });

    return data;
  }
  return cachedData;
}

// Build a safe, compact DB snapshot for UI rendering.
// This prevents the common "missing data" issue when the model forgets to pass a data object.
function buildDefaultDbUIData(dbData, scope = "default") {
  const safeDb = dbData || {};

  const activeLight = (safeDb.active || safeDb.processed || [])
    .filter((c) => c && !c.archived && !c.completed)
    .slice(0, 200)
    .map((c) => ({
      id: c.id,
      casenumber: c.casenumber,
      department: c.department,
      stage: c.stage,
      due: c.dueFormatted || c.due,
      daysUntilDue: c.daysUntilDue,
      isOverdue: c.isOverdue,
      priority: Boolean(c.priority),
      isRush: Boolean(c.isRush),
      isHold: Boolean(c.isHold),
    }));

  const base = {
    nowIso: new Date().toISOString(),
    summary: safeDb.summary || {},
    active: activeLight,
    departments: Object.keys(safeDb.indexes?.byDepartment || {}),
    stages: Object.keys(safeDb.indexes?.byStage || {}),
  };

  if (scope === "summary")
    return { db: { nowIso: base.nowIso, summary: base.summary } };
  if (scope === "active")
    return { db: { nowIso: base.nowIso, active: base.active } };
  if (scope === "default") return { db: base };

  // "all" or unknown: still keep it compact to avoid context blowups
  return { db: base };
}

// ============================================================================
// COMPONENT CODE NORMALIZATION + AUTO-REPAIR (prevents common SyntaxErrors)
// ============================================================================

function normalizeComponentCode(raw) {
  let s = String(raw || "").trim();

  // Strip code fences if the model accidentally includes them
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9:_-]*\s*/, "");
    s = s.replace(/```\s*$/, "");
    s = s.trim();
  }

  // Strip surrounding quotes if the model double-quoted the entire expression
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }

  // Remove accidental "export default"
  if (s.startsWith("export default")) {
    s = s.replace(/^export\s+default\s+/, "").trim();
  }

  // Remove trailing semicolons
  while (s.endsWith(";")) s = s.slice(0, -1).trim();

  return s;
}

function testComponentCode(code, componentData) {
  // eslint-disable-next-line no-new-func
  const testFn = new Function(
    "React",
    "data",
    `
      const Component = ${code};
      return Component({ data: data || {}, onAction: () => {}, theme: {} });
    `
  );
  const mockReact = { createElement: (t, p, ...c) => ({ t, p, c }) };
  return testFn(mockReact, componentData);
}

function verifyAndRepairComponentCode(rawCode, componentData) {
  const original = String(rawCode || "");
  let code = normalizeComponentCode(original);
  const repairNotes = [];

  if (code !== original.trim()) repairNotes.push("normalized");

  // Attempt 1: as-is
  try {
    testComponentCode(code, componentData);
    return {
      ok: true,
      codeUsed: code,
      repaired: repairNotes.length > 0,
      repairNotes,
    };
  } catch (e1) {
    const msg1 = String(e1?.message || e1);

    // JSX is not supported in this renderer
    if (msg1.includes("Unexpected token '<'")) {
      return {
        ok: false,
        errorMessage:
          "It looks like you used JSX (<div>...</div>). This renderer only supports React.createElement (no JSX).",
      };
    }

    // Common failure: extra trailing ')' causes a SyntaxError in Safari/WebKit
    const looksLikeExtraParen =
      msg1.includes("Unexpected token") &&
      msg1.includes(")") &&
      msg1.includes("variable declaration");

    const unexpectedCloseParen =
      msg1.includes("Unexpected token") &&
      (msg1.includes("')'") || msg1.includes(")"));

    if (looksLikeExtraParen || unexpectedCloseParen) {
      // First try: unwrap one outer (...) wrapper
      if (code.startsWith("(") && code.endsWith(")")) {
        const unwrapped = code.slice(1, -1).trim();
        if (unwrapped && unwrapped !== code) {
          try {
            testComponentCode(unwrapped, componentData);
            return {
              ok: true,
              codeUsed: unwrapped,
              repaired: true,
              repairNotes: [...repairNotes, "unwrapped_outer_parens"],
            };
          } catch {
            // continue
          }
        }
      }

      // Then try: trim up to 3 trailing ')'
      let candidate = code;
      for (let i = 0; i < 3; i++) {
        if (!candidate.endsWith(")")) break;
        candidate = candidate.slice(0, -1).trim();
        try {
          testComponentCode(candidate, componentData);
          return {
            ok: true,
            codeUsed: candidate,
            repaired: true,
            repairNotes: [...repairNotes, "trimmed_trailing_paren"],
          };
        } catch {
          // continue
        }
      }
    }

    return { ok: false, errorMessage: msg1 };
  }
}

async function executeToolCall(toolName, args, data) {
  updateStatus(STATUS_TYPES.EXECUTING, toolName);

  try {
    switch (toolName) {
      case "display_to_user": {
        const msg = args.message?.trim();
        if (!msg) {
          return {
            _error: true,
            error: "Message cannot be empty",
            suggestion: "Provide a non-empty message",
          };
        }
        return {
          _uiType: "DISPLAY_APPROVED",
          message: msg,
          showUI: args.show_ui !== false,
        };
      }

      case "get_schema": {
        return { success: true, schema: DB_SCHEMA };
      }

      case "profile_table": {
        const dbData = data || (await ensureDataLoaded());
        const topN = args.top_n || 10;

        const toTopList = (obj) =>
          Object.entries(obj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, topN)
            .map(([k, v]) => ({ value: k, count: v }));

        if (args.table === "cases") {
          const rows = dbData.processed || [];
          const deptCounts = {};
          const stageCounts = {};
          const modCounts = {};

          for (const r of rows) {
            deptCounts[r.department] = (deptCounts[r.department] || 0) + 1;
            stageCounts[r.stage] = (stageCounts[r.stage] || 0) + 1;
            for (const m of r.modifiers || []) {
              modCounts[m] = (modCounts[m] || 0) + 1;
            }
          }

          return {
            success: true,
            table: "cases",
            rowCount: rows.length,
            topDepartments: toTopList(deptCounts),
            topStages: toTopList(stageCounts),
            topModifiers: toTopList(modCounts),
          };
        }

        if (args.table === "case_history") {
          const rows = (dbData.raw && dbData.raw.history) || [];
          const actionCounts = {};
          const userCounts = {};

          for (const r of rows) {
            if (r.action)
              actionCounts[r.action] = (actionCounts[r.action] || 0) + 1;
            if (r.user_name)
              userCounts[r.user_name] = (userCounts[r.user_name] || 0) + 1;
          }

          return {
            success: true,
            table: "case_history",
            rowCount: rows.length,
            topActions: toTopList(actionCounts),
            topUsers: toTopList(userCounts),
            note: "This reflects the cached history subset. Use get_case_history_db for full history by case_id.",
          };
        }

        return { error: "Unknown table" };
      }

      case "find_cases": {
        const dbData = data || (await ensureDataLoaded());
        const q = String(args.query || "")
          .toLowerCase()
          .trim();
        if (!q) return { error: "query is required" };

        const includeArchived = Boolean(args.include_archived);
        const includeCompleted = Boolean(args.include_completed);

        let pool = dbData.processed || [];
        if (!includeArchived) pool = pool.filter((c) => !c.archived);
        if (!includeCompleted) pool = pool.filter((c) => !c.completed);

        let matches;
        if (args.mode === "exact") {
          matches = pool.filter(
            (c) => String(c.casenumber || "").toLowerCase() === q
          );
        } else {
          matches = pool.filter((c) =>
            String(c.casenumber || "")
              .toLowerCase()
              .includes(q)
          );
        }

        const limit = args.limit || 10;
        matches = matches.slice(0, limit);

        return {
          success: true,
          count: matches.length,
          candidates: matches.map((c) => ({
            id: c.id,
            casenumber: c.casenumber,
            department: c.department,
            stage: c.stage,
            due: c.dueFormatted,
            daysUntilDue: c.daysUntilDue,
            isOverdue: c.isOverdue,
            priority: c.priority,
            isRush: c.isRush,
            isHold: c.isHold,
            archived: c.archived,
            completed: c.completed,
          })),
        };
      }

      case "get_case_by_id": {
        const dbData = data || (await ensureDataLoaded());
        const id = args.case_id;
        if (!id) return { error: "case_id is required" };
        const found = (dbData.processed || []).find((c) => c.id === id);
        if (!found) return { error: "No case found for that id" };
        return { success: true, case: found };
      }

      case "get_case_history_db": {
        const caseId = args.case_id;
        if (!caseId) return { error: "case_id is required" };

        const limit = args.limit || 100;
        const offset = args.offset || 0;

        const res = await db
          .from("case_history")
          .select("id,case_id,action,created_at,user_name")
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (res.error) return { error: res.error.message };

        return {
          success: true,
          case_id: caseId,
          count: (res.data || []).length,
          offset,
          limit,
          history: (res.data || []).map((h) => ({
            action: h.action,
            user: h.user_name,
            timestamp: h.created_at,
          })),
        };
      }

      case "get_cases": {
        // Load data on-demand if not provided
        const dbData = data || (await ensureDataLoaded());
        let results = [...dbData.active];

        // Apply filters
        if (args.status === "all") results = [...dbData.processed];
        else if (args.status === "overdue")
          results = results.filter((c) => c.isOverdue);
        else if (args.status === "completed")
          results = dbData.processed.filter((c) => c.completed && !c.archived);
        else if (args.status === "archived")
          results = dbData.processed.filter((c) => c.archived);
        else if (args.status === "hold")
          results = results.filter((c) => c.isHold);

        if (args.department)
          results = results.filter((c) => c.department === args.department);
        if (args.stage && args.stage !== "all")
          results = results.filter((c) => c.stage === args.stage);
        if (args.priority !== undefined)
          results = results.filter((c) => c.priority === args.priority);
        if (args.rush !== undefined)
          results = results.filter((c) => c.isRush === args.rush);
        if (args.risk_level)
          results = results.filter((c) => c.riskLevel === args.risk_level);
        if (args.due_within_days !== undefined) {
          results = results.filter(
            (c) => c.daysUntilDue >= 0 && c.daysUntilDue <= args.due_within_days
          );
        }
        if (args.search) {
          const s = args.search.toLowerCase();
          results = results.filter((c) =>
            c.casenumber?.toLowerCase().includes(s)
          );
        }

        // Extra filters
        const includeStatsExcluded = Boolean(args.include_stats_excluded);
        if (!includeStatsExcluded) {
          results = results.filter((c) => !c.statsExcluded);
        }

        if (
          Array.isArray(args.include_modifiers) &&
          args.include_modifiers.length
        ) {
          const requiredMods = args.include_modifiers.map((x) => String(x));
          results = results.filter((c) =>
            requiredMods.every((m) => (c.modifiers || []).includes(m))
          );
        }

        if (
          Array.isArray(args.exclude_modifiers) &&
          args.exclude_modifiers.length
        ) {
          const bannedMods = args.exclude_modifiers.map((x) => String(x));
          results = results.filter((c) =>
            bannedMods.every((m) => !(c.modifiers || []).includes(m))
          );
        }

        if (args.due_date_from) {
          const from = String(args.due_date_from);
          results = results.filter(
            (c) => c.dueDatePart && c.dueDatePart >= from
          );
        }

        if (args.due_date_to) {
          const to = String(args.due_date_to);
          results = results.filter((c) => c.dueDatePart && c.dueDatePart <= to);
        }

        // Sort
        const sortBy = args.sort_by || "due";
        const sortDir = args.sort_order === "desc" ? -1 : 1;
        results.sort((a, b) => {
          let av, bv;
          switch (sortBy) {
            case "due":
              av = a.dueAtLocalMs ?? new Date(a.due).getTime();
              bv = b.dueAtLocalMs ?? new Date(b.due).getTime();
              break;
            case "created_at":
              av = new Date(a.created_at);
              bv = new Date(b.created_at);
              break;
            case "risk_score":
              av = a.riskScore;
              bv = b.riskScore;
              break;
            default:
              av = a.casenumber || "";
              bv = b.casenumber || "";
          }
          return av > bv ? sortDir : av < bv ? -sortDir : 0;
        });

        const total = results.length;
        results = results.slice(0, args.limit || 100);

        return {
          success: true,
          count: results.length,
          totalMatching: total,
          cases: results.map((c) => ({
            casenumber: c.casenumber,
            department: c.department,
            stage: c.stage,
            due: c.dueFormatted,
            daysUntilDue: c.daysUntilDue,
            isOverdue: c.isOverdue,
            priority: c.priority,
            isRush: c.isRush,
            isHold: c.isHold,
            riskLevel: c.riskLevel,
          })),
          summary: {
            overdue: results.filter((c) => c.isOverdue).length,
            rush: results.filter((c) => c.isRush).length,
            priority: results.filter((c) => c.priority).length,
          },
        };
      }

      case "get_summary": {
        // Load data on-demand if not provided
        const dbData = data || (await ensureDataLoaded());

        if (args.department) {
          const deptCases = dbData.indexes.byDepartment[args.department] || [];
          return {
            success: true,
            department: args.department,
            total: deptCases.length,
            overdue: deptCases.filter((c) => c.isOverdue).length,
            rush: deptCases.filter((c) => c.isRush).length,
            priority: deptCases.filter((c) => c.priority).length,
            hold: deptCases.filter((c) => c.isHold).length,
            byStage: {
              design: deptCases.filter((c) => c.stage === "design").length,
              production: deptCases.filter((c) => c.stage === "production")
                .length,
              finishing: deptCases.filter((c) => c.stage === "finishing")
                .length,
              qc: deptCases.filter((c) => c.stage === "qc").length,
              stage2: deptCases.filter((c) => c.stage === "stage2").length,
            },
            risk: {
              critical: deptCases.filter((c) => c.riskLevel === "critical")
                .length,
              high: deptCases.filter((c) => c.riskLevel === "high").length,
              medium: deptCases.filter((c) => c.riskLevel === "medium").length,
            },
          };
        }
        return { success: true, ...dbData.summary, asOf: dbData.timestamp };
      }

      case "get_case": {
        // Load data on-demand if not provided
        const dbData = data || (await ensureDataLoaded());

        const search = String(args.casenumber || "")
          .toLowerCase()
          .trim();
        if (!search) return { error: "casenumber is required" };

        const matches = dbData.processed.filter((c) =>
          String(c.casenumber || "")
            .toLowerCase()
            .includes(search)
        );

        if (!matches.length) {
          return { error: `No case found matching "${args.casenumber}"` };
        }

        if (matches.length > 1) {
          return {
            success: true,
            needs_disambiguation: true,
            query: args.casenumber,
            candidates: matches.slice(0, 25).map((c) => ({
              id: c.id,
              casenumber: c.casenumber,
              department: c.department,
              stage: c.stage,
              due: c.dueFormatted,
              daysUntilDue: c.daysUntilDue,
              isOverdue: c.isOverdue,
              priority: c.priority,
              isRush: c.isRush,
              isHold: c.isHold,
              archived: c.archived,
              completed: c.completed,
            })),
            note: "Multiple matches found. Use get_case_by_id for an exact case.",
          };
        }

        const found = matches[0];

        // Cached history is limited (loadFullDatabase only pulls a subset).
        const history = (dbData.raw.history || [])
          .filter((h) => h.case_id === found.id)
          .map((h) => ({
            action: h.action,
            user: h.user_name,
            timestamp: h.created_at,
          }));

        return {
          success: true,
          case: found,
          history,
          historyCount: history.length,
          note: "For full history, use get_case_history_db.",
        };
      }

      case "get_history": {
        // Load data on-demand if not provided
        const dbData = data || (await ensureDataLoaded());

        let results = [...dbData.raw.history];

        if (args.user_name) {
          const u = args.user_name.toLowerCase();
          results = results.filter((h) =>
            h.user_name?.toLowerCase().includes(u)
          );
        }
        if (args.action_contains) {
          const a = args.action_contains.toLowerCase();
          results = results.filter((h) => h.action?.toLowerCase().includes(a));
        }
        if (args.case_id) {
          results = results.filter((h) => h.case_id === args.case_id);
        }

        results = results.slice(0, args.limit || 50);

        // Try to add case numbers
        const caseMap = new Map(
          dbData.raw.cases.map((c) => [c.id, c.casenumber])
        );

        return {
          success: true,
          count: results.length,
          history: results.map((h) => ({
            action: h.action,
            user: h.user_name,
            timestamp: h.created_at,
            casenumber: caseMap.get(h.case_id) || "Unknown",
          })),
        };
      }

      case "custom_query": {
        return {
          error:
            "custom_query is disabled. Use get_cases, get_summary, find_cases, get_case_by_id, profile_table, or get_case_history_db.",
        };
      }

      case "get_all_data": {
        updateStatus(STATUS_TYPES.LOADING_DATA, "Fetching full database...");

        // Load data on-demand
        const dbData = data || (await ensureDataLoaded());

        // Build comprehensive data export
        const result = {
          // All active cases with full details
          cases: dbData.active.map((c) => ({
            casenumber: c.casenumber,
            department: c.department,
            stage: c.stage,
            due: c.due,
            dueFormatted: c.dueFormatted,
            daysUntilDue: c.daysUntilDue,
            isOverdue: c.isOverdue,
            isRush: c.isRush,
            isHold: c.isHold,
            priority: c.priority,
            riskScore: c.riskScore,
            riskLevel: c.riskLevel,
            modifiers: c.modifiers,
            created_at: c.created_at,
            completed: c.completed,
            archived: c.archived,
          })),

          // Summary statistics
          summary: dbData.summary,

          // Cases grouped by department
          byDepartment: Object.fromEntries(
            Object.entries(dbData.indexes?.byDepartment || {}).map(
              ([dept, cases]) => [
                dept,
                {
                  count: cases.length,
                  overdue: cases.filter((c) => c.isOverdue).length,
                  rush: cases.filter((c) => c.isRush).length,
                },
              ]
            )
          ),

          // Cases grouped by stage
          byStage: Object.fromEntries(
            Object.entries(dbData.indexes?.byStage || {}).map(
              ([stage, cases]) => [
                stage,
                {
                  count: cases.length,
                  overdue: cases.filter((c) => c.isOverdue).length,
                },
              ]
            )
          ),

          totalCases: dbData.active.length,
        };

        // Optionally include archived/completed cases
        if (args.include_archived) {
          result.allCases = dbData.processed.map((c) => ({
            casenumber: c.casenumber,
            department: c.department,
            stage: c.stage,
            due: c.due,
            completed: c.completed,
            archived: c.archived,
            isOverdue: c.isOverdue,
          }));
          result.totalAllCases = dbData.processed.length;
        }

        // Optionally include history
        if (args.include_history && dbData.raw?.history) {
          result.history = dbData.raw.history.slice(0, 100).map((h) => ({
            casenumber: h.casenumber,
            action: h.action,
            timestamp: h.created_at,
            details: h.details,
          }));
        }

        return {
          success: true,
          ...result,
          _note: `Full database exported: ${result.totalCases} active cases`,
        };
      }

      case "render_ui": {
        // NOTE: This tool used to hard-error when args.data was missing.
        // That caused the very common "Missing data parameter" loop.
        // New behavior: if data is missing, auto-inject a compact DB snapshot as data.db.
        const dbData = data || (await ensureDataLoaded());

        if (!args.component_code) {
          return {
            _error: true,
            error: "Missing component_code - FIX AND RETRY",
            action: "Add component_code parameter and call render_ui again",
            example: {
              component_code:
                "({ data }) => React.createElement('div', { className: 'p-4' }, data.title)",
              data: { title: "My Title" },
              description: "Simple card",
            },
          };
        }

        let componentData;
        let autoInjected = false;

        if (args.data === undefined || args.data === null) {
          componentData = buildDefaultDbUIData(dbData, "default");
          autoInjected = true;
        } else {
          // Handle various data formats (format expansion)
          componentData = args.data;
          if (typeof args.data === "string") {
            try {
              componentData = JSON.parse(args.data);
            } catch {
              componentData = { text: args.data };
            }
          } else if (typeof args.data !== "object") {
            componentData = { value: args.data };
          }
        }

        // Verify component execution (syntax + runtime), with auto-repair for common syntax slips
        const verification = verifyAndRepairComponentCode(
          args.component_code,
          componentData
        );

        if (!verification.ok) {
          const msg = verification.errorMessage || "Unknown component error";

          return {
            _error: true,
            error: `Component execution error: ${msg} - FIX AND RETRY`,
            action: autoInjected
              ? "Your component likely expects properties that are not in the injected db snapshot. Either (1) read from data.db.*, or (2) pass an explicit data object."
              : "Pass a correct data object and/or make your component resilient (use defaults like (data.items || []))",
            tips: [
              "Use React.createElement, not JSX",
              "Avoid data.items.map unless items is always an array: use (data.items || []).map(...)",
              "If you want DB values without passing data, read from data.db.summary / data.db.active",
              "Do not wrap the whole function in extra parentheses and do not end with an extra ')'.",
              "Avoid backticks in component_code",
            ],
            autoInjectedData: autoInjected
              ? {
                  note: "Injected shape is data.db",
                  example: "data.db.summary.active",
                }
              : undefined,
            repairAttempted: true,
            yourCode: args.component_code?.substring(0, 240),
          };
        }

        const finalCode = verification.codeUsed || args.component_code;

        return {
          _uiType: "RENDER_SUCCESS",
          componentCode: finalCode,
          originalComponentCode: verification.repaired
            ? args.component_code
            : undefined,
          repairNotes: verification.repairNotes || undefined,
          data: componentData,
          description: args.description || "Custom UI component",
          verified: true,
          autoInjected,
        };
      }

      case "render_ui_db": {
        // Render UI with auto-injected DB snapshot as data.db.
        const dbData = data || (await ensureDataLoaded());

        if (!args.component_code) {
          return {
            _error: true,
            error: "Missing component_code - FIX AND RETRY",
            action: "Add component_code parameter and call render_ui_db again",
          };
        }

        const scope = args.scope || "default";
        const componentData = buildDefaultDbUIData(dbData, scope);

        const verification = verifyAndRepairComponentCode(
          args.component_code,
          componentData
        );

        if (!verification.ok) {
          const msg = verification.errorMessage || "Unknown component error";
          return {
            _error: true,
            error: `Component execution error: ${msg} - FIX AND RETRY`,
            action:
              "Read from data.db.* and use safe defaults for arrays/objects. Also do not end with an extra ')'.",
            injectedShape: {
              summary: "data.db.summary",
              active: "data.db.active",
            },
            repairAttempted: true,
            yourCode: args.component_code?.substring(0, 240),
          };
        }

        const finalCode = verification.codeUsed || args.component_code;

        return {
          _uiType: "RENDER_SUCCESS",
          componentCode: finalCode,
          originalComponentCode: verification.repaired
            ? args.component_code
            : undefined,
          repairNotes: verification.repairNotes || undefined,
          data: componentData,
          description: args.description || "DB-based UI component",
          verified: true,
          autoInjected: true,
        };
      }

      case "propose_action": {
        return {
          _uiType: "ACTION_PROPOSAL",
          casenumber: args.casenumber,
          action: args.action,
          target_stage: args.target_stage,
          reason: args.reason,
          requiresConfirmation: true,
        };
      }

      case "render_workload_chart": {
        // Load data on-demand if not provided
        const dbData = data || (await ensureDataLoaded());

        // Build complete workload data from current database state
        const workloadData = {
          active: dbData.summary.active || 0,
          rush: dbData.summary.rush || 0,
          overdue: dbData.summary.overdue || 0,
          byStage: {
            design: dbData.summary.byStage?.design || 0,
            production: dbData.summary.byStage?.production || 0,
            finishing: dbData.summary.byStage?.finishing || 0,
            qc: dbData.summary.byStage?.qc || 0,
          },
          risk: {
            critical: dbData.summary.risk?.critical || 0,
            high: dbData.summary.risk?.high || 0,
            medium: dbData.summary.risk?.medium || 0,
          },
        };

        // Generate 7-day projections
        const projections = [];
        const today = new Date();
        let activeCount = workloadData.active;
        let rushCount = workloadData.rush;
        let overdueCount = workloadData.overdue;

        for (let i = 0; i < 7; i++) {
          const date = new Date(today);
          date.setDate(date.getDate() + i);

          if (i === 0) {
            projections.push({
              day: i,
              dayLabel: "Today",
              active: workloadData.active,
              rush: workloadData.rush,
              overdue: workloadData.overdue,
              projected: false,
            });
          } else {
            const avgCompletion = Math.ceil(workloadData.active * 0.12);
            const avgNew = Math.ceil(workloadData.active * 0.08);
            activeCount = Math.max(10, activeCount - avgCompletion + avgNew);
            rushCount = Math.max(0, rushCount - Math.ceil(rushCount * 0.15));
            overdueCount = Math.max(
              0,
              overdueCount + Math.floor(Math.random() * 2)
            );

            projections.push({
              day: i,
              dayLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
              active: activeCount,
              rush: rushCount,
              overdue: overdueCount,
              projected: true,
            });
          }
        }

        // Create the component code for the workload chart
        const componentCode = args.compact
          ? `({ data }) => React.createElement('div', { className: 'bg-white rounded-xl border border-gray-200 p-4' }, React.createElement('div', { className: 'flex items-center justify-between mb-3' }, React.createElement('h3', { className: 'text-sm font-semibold text-gray-900' }, '7-Day Workload Trend'), React.createElement('span', { className: 'text-xs text-gray-500' }, 'Next 7 days')), React.createElement('div', { className: 'grid grid-cols-3 gap-4' }, [{ label: 'Active', value: data.workload.active, color: 'text-blue-600', icon: '📊' }, { label: 'Rush', value: data.workload.rush, color: 'text-amber-600', icon: '⚡' }, { label: 'Overdue', value: data.workload.overdue, color: 'text-red-600', icon: '⏰' }].map((s, i) => React.createElement('div', { key: i, className: 'bg-white rounded-lg border border-gray-200 p-3' }, React.createElement('div', { className: 'flex items-start justify-between mb-1' }, React.createElement('span', { className: 'text-xs font-medium text-gray-500 uppercase' }, s.label), React.createElement('span', null, s.icon)), React.createElement('span', { className: 'text-2xl font-bold ' + s.color }, s.value)))))`
          : `({ data }) => React.createElement('div', { className: 'bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden' }, React.createElement('div', { className: 'px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white' }, React.createElement('div', { className: 'flex items-center justify-between' }, React.createElement('div', null, React.createElement('h3', { className: 'text-base font-semibold text-gray-900' }, 'Workload Projection'), React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, 'Next 7 days forecast')), React.createElement('div', { className: 'flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-lg' }, React.createElement('span', { className: 'w-2 h-2 bg-blue-500 rounded-full' }), React.createElement('span', { className: 'text-xs font-medium text-blue-700' }, 'Live')))), React.createElement('div', { className: 'p-4' }, React.createElement('div', { className: 'grid grid-cols-3 gap-3 mb-4' }, [{ label: 'Active', value: data.workload.active, color: 'text-blue-600', icon: '📊' }, { label: 'Rush', value: data.workload.rush, color: 'text-amber-600', icon: '⚡' }, { label: 'Overdue', value: data.workload.overdue, color: 'text-red-600', icon: '⏰' }].map((s, i) => React.createElement('div', { key: i, className: 'bg-white rounded-lg border border-gray-200 p-3' }, React.createElement('div', { className: 'flex items-start justify-between mb-1' }, React.createElement('span', { className: 'text-xs font-medium text-gray-500 uppercase' }, s.label), React.createElement('span', null, s.icon)), React.createElement('span', { className: 'text-2xl font-bold ' + s.color }, s.value)))), React.createElement('div', { className: 'mb-4' }, React.createElement('h4', { className: 'text-xs font-medium text-gray-500 uppercase mb-2' }, 'Cases by Stage'), React.createElement('div', { className: 'space-y-2' }, data.stages.map((st, i) => React.createElement('div', { key: i, className: 'flex items-center gap-2 text-sm' }, React.createElement('span', { className: 'w-20 text-gray-600 capitalize' }, st.name), React.createElement('div', { className: 'flex-1 h-2 bg-gray-100 rounded-full overflow-hidden' }, React.createElement('div', { className: 'h-full rounded-full ' + st.color, style: { width: st.pct + '%' } })), React.createElement('span', { className: 'w-8 text-right font-medium text-gray-900' }, st.count))))), React.createElement('div', null, React.createElement('h4', { className: 'text-xs font-medium text-gray-500 uppercase mb-2' }, 'Risk Distribution'), React.createElement('div', { className: 'grid grid-cols-3 gap-2' }, data.risks.map((r, i) => React.createElement('div', { key: i, className: 'flex items-center gap-2 px-3 py-2 rounded-lg ' + r.bg }, React.createElement('div', { className: 'w-2 h-2 rounded-full ' + r.dot }), React.createElement('span', { className: 'text-xs font-medium text-gray-700 capitalize' }, r.level), React.createElement('span', { className: 'ml-auto text-sm font-bold ' + r.text }, r.count))))), React.createElement('div', { className: 'mt-4 pt-4 border-t border-gray-100' }, React.createElement('h4', { className: 'text-xs font-medium text-gray-500 uppercase mb-3' }, '7-Day Projection'), React.createElement('div', { className: 'flex items-end justify-between h-20 gap-1' }, data.projections.map((p, i) => React.createElement('div', { key: i, className: 'flex-1 flex flex-col items-center' }, React.createElement('div', { className: 'w-full rounded-t ' + (p.projected ? 'bg-blue-200' : 'bg-blue-500'), style: { height: (p.active / data.maxActive * 100) + '%' } }), React.createElement('span', { className: 'text-xs mt-1 ' + (i === 0 ? 'font-bold text-blue-600' : 'text-gray-500') }, p.dayLabel)))), React.createElement('div', { className: 'flex items-center justify-center gap-4 mt-2 text-xs' }, React.createElement('div', { className: 'flex items-center gap-1' }, React.createElement('div', { className: 'w-3 h-3 bg-blue-500 rounded' }), React.createElement('span', { className: 'text-gray-600' }, 'Current')), React.createElement('div', { className: 'flex items-center gap-1' }, React.createElement('div', { className: 'w-3 h-3 bg-blue-200 rounded' }), React.createElement('span', { className: 'text-gray-600' }, 'Projected'))))))`;

        const totalStages =
          workloadData.byStage.design +
          workloadData.byStage.production +
          workloadData.byStage.finishing +
          workloadData.byStage.qc;
        const maxActive = Math.max(...projections.map((p) => p.active), 1);

        return {
          _uiType: "RENDER_SUCCESS",
          componentCode,
          data: {
            workload: workloadData,
            stages: [
              {
                name: "Design",
                count: workloadData.byStage.design,
                pct:
                  totalStages > 0
                    ? (workloadData.byStage.design / totalStages) * 100
                    : 0,
                color: "bg-blue-500",
              },
              {
                name: "Production",
                count: workloadData.byStage.production,
                pct:
                  totalStages > 0
                    ? (workloadData.byStage.production / totalStages) * 100
                    : 0,
                color: "bg-green-500",
              },
              {
                name: "Finishing",
                count: workloadData.byStage.finishing,
                pct:
                  totalStages > 0
                    ? (workloadData.byStage.finishing / totalStages) * 100
                    : 0,
                color: "bg-purple-500",
              },
              {
                name: "QC",
                count: workloadData.byStage.qc,
                pct:
                  totalStages > 0
                    ? (workloadData.byStage.qc / totalStages) * 100
                    : 0,
                color: "bg-amber-500",
              },
            ],
            risks: [
              {
                level: "Critical",
                count: workloadData.risk.critical,
                bg: "bg-red-50",
                dot: "bg-red-500",
                text: "text-red-600",
              },
              {
                level: "High",
                count: workloadData.risk.high,
                bg: "bg-amber-50",
                dot: "bg-amber-500",
                text: "text-amber-600",
              },
              {
                level: "Medium",
                count: workloadData.risk.medium,
                bg: "bg-blue-50",
                dot: "bg-blue-500",
                text: "text-blue-600",
              },
            ],
            projections,
            maxActive,
          },
          description: args.compact
            ? "Compact workload trend chart"
            : "Full workload projection with 7-day forecast",
          verified: true,
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================================
// API CONFIGURATION
// ============================================================================

function getAPIConfig() {
  let apiKey = LLM_CONFIG.API_KEY;
  let baseURL = LLM_CONFIG.BASE_URL;
  if (typeof window !== "undefined" && window.__LLM_CONFIG__) {
    if (window.__LLM_CONFIG__.apiKey) apiKey = window.__LLM_CONFIG__.apiKey;
    if (window.__LLM_CONFIG__.baseURL) baseURL = window.__LLM_CONFIG__.baseURL;
  }
  return { apiKey, baseURL };
}

export function configureLLM(config) {
  if (typeof window !== "undefined") {
    window.__LLM_CONFIG__ = { ...(window.__LLM_CONFIG__ || {}), ...config };
  }
}

export function isLLMConfigured() {
  const { apiKey } = getAPIConfig();
  return !!apiKey && apiKey.length > 0 && apiKey.startsWith("sk-");
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

function buildSystemPrompt(data, appContext) {
  const nowStr = new Date().toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `You are an AI assistant for Stomaboard, a dental lab case management system.

Your job: answer questions by using the tools. Be accurate and grounded in tool results.

Hard rules:
1) The user sees nothing until you call display_to_user. Always call it once at the end.
2) Treat the database as read only. If the user wants changes, use propose_action.
3) Do not invent counts, dates, or case details. If you did not fetch it, you do not know it.

Current state:
${nowStr}
${appContext?.activeDept ? `Viewing: ${appContext.activeDept} department` : ""}

Tool playbook:
- If you are unsure about fields or enums, call get_schema or profile_table.
- For lists of cases, use get_cases with filters. Avoid get_all_data unless the user explicitly asks for a full dump.
- For a specific case:
  a) Prefer find_cases to get candidates
  b) Then use get_case_by_id for the exact case
  c) Use get_case_history_db if the user needs full history (cached history may be incomplete)
- Avoid custom_query. It is deprecated.

UI rules (to prevent common errors):
- If you need UI based on the database, call render_ui_db. Inside your component, read from data.db.summary and/or data.db.active.
- If you call render_ui, ALWAYS provide a data object, or rely on the injected data.db if you omit it.
- Make UI code safe: never do data.items.map directly. Use (data.items || []).map(...).
- For component_code: provide only the arrow function expression. Do not wrap it in extra parentheses and do not end with an extra ')'.

Due dates:
- The due field is stored at midnight UTC in the DB.
- Use dueDatePart + due_time and the precomputed fields (dueFormatted, daysUntilDue, isOverdue) from tool results.
- Do not recompute overdue status by doing new Date(due) math.

Response flow:
1) Fetch data with tools
2) Create visualizations if needed:
   - Prefer render_workload_chart for workload views
   - Prefer render_ui_db for DB-based custom UI (data.db is auto provided)
   - Use render_ui only when you must pass a custom data object
3) Call display_to_user(message="...", show_ui=true)

Remember: use short, clear wording.`;
}

// ============================================================================
// RESPONSES API
// ============================================================================

// Track proxy status (for UI warnings)
let proxyStatus = {
  usingLocalProxy: false,
  usingCorsProxy: false,
  localProxyAvailable: null, // null = not checked, true/false = checked
};

// Check if local proxy is available
async function checkLocalProxy() {
  if (proxyStatus.localProxyAvailable !== null) {
    return proxyStatus.localProxyAvailable;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      LLM_CONFIG.LOCAL_PROXY_CHECK_TIMEOUT
    );

    const res = await fetch(`${LLM_CONFIG.LOCAL_PROXY_URL}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    proxyStatus.localProxyAvailable = res.ok;

    if (res.ok) {
      console.log("[LLM] Local proxy detected at", LLM_CONFIG.LOCAL_PROXY_URL);
    }

    return proxyStatus.localProxyAvailable;
  } catch (e) {
    proxyStatus.localProxyAvailable = false;
    return false;
  }
}

async function callResponsesAPI(messages, tools) {
  const { apiKey, baseURL } = getAPIConfig();
  if (!apiKey?.startsWith("sk-")) throw new Error("API key not configured");

  const body = {
    model: LLM_CONFIG.MODEL,
    input: messages,
    tools,
    tool_choice: "auto",
    max_output_tokens: LLM_CONFIG.MAX_OUTPUT_TOKENS,
    reasoning: { effort: LLM_CONFIG.REASONING_EFFORT },
  };

  // Determine if we're in a development environment that needs CORS handling
  const isDevelopment =
    typeof window !== "undefined" &&
    (window.location.hostname.includes("csb.app") ||
      window.location.hostname.includes("localhost") ||
      window.location.hostname === "127.0.0.1");

  // Reset proxy status for this request
  proxyStatus.usingLocalProxy = false;
  proxyStatus.usingCorsProxy = false;

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    LLM_CONFIG.API_CALL_TIMEOUT
  );

  const makeRequest = async (url) => {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  };

  try {
    let res;
    let endpoint = `${baseURL}/responses`;

    // Strategy:
    // 1. Try local proxy first (no timeout limits, best option for dev)
    // 2. Fall back to direct connection
    // 3. Fall back to corsproxy.io (has ~30s timeout, not ideal)

    if (isDevelopment) {
      // Check if local proxy is available
      const localProxyAvailable = await checkLocalProxy();

      if (localProxyAvailable) {
        // Use local proxy - no timeout limits!
        endpoint = `${LLM_CONFIG.LOCAL_PROXY_URL}/v1/responses`;
        proxyStatus.usingLocalProxy = true;
        console.log("[LLM] Using local proxy (no timeout limits)");

        try {
          res = await makeRequest(endpoint);
        } catch (localProxyError) {
          console.warn(
            "[LLM] Local proxy failed, trying direct connection:",
            localProxyError.message
          );
          proxyStatus.usingLocalProxy = false;
          endpoint = `${baseURL}/responses`;
          res = await makeRequest(endpoint);
        }
      } else {
        // No local proxy - try direct, then CORS proxy
        try {
          res = await makeRequest(endpoint);
        } catch (directError) {
          // If direct fails with CORS error, try external CORS proxy
          if (
            directError.message?.includes("CORS") ||
            directError.message?.includes("Failed to fetch") ||
            directError.name === "TypeError"
          ) {
            console.warn(
              "[LLM] Direct connection failed, using corsproxy.io (WARNING: 30s timeout limit)"
            );
            endpoint = `https://corsproxy.io/?${encodeURIComponent(
              baseURL + "/responses"
            )}`;
            proxyStatus.usingCorsProxy = true;
            res = await makeRequest(endpoint);
          } else {
            throw directError;
          }
        }
      }
    } else {
      // Production - direct connection
      res = await makeRequest(endpoint);
    }

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      let msg = `API error: ${res.status}`;
      try {
        msg = JSON.parse(text).error?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new Error("API_CALL_TIMEOUT: Request exceeded 10-minute limit");
    }

    // Check if this looks like a CORS proxy timeout (usually fails around 30s)
    if (proxyStatus.usingCorsProxy) {
      const errorMsg = error.message || "";
      if (
        errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("NetworkError") ||
        errorMsg.includes("TypeError")
      ) {
        throw new Error(
          'CORS_PROXY_TIMEOUT: The external CORS proxy timed out (~30s limit). Start the local proxy with "npm run proxy" or "npm run dev" for the full 10-minute timeout.'
        );
      }
    }

    throw error;
  }
}

// Get current proxy status (for UI)
function getProxyStatus() {
  return { ...proxyStatus };
}

// Check if currently using CORS proxy (for UI warnings)
function isUsingCorsProxy() {
  return proxyStatus.usingCorsProxy;
}

// Time pressure - ONLY warn at hard limit (last 30 seconds)
// Model should feel free to work without pressure until the actual limit
const TIME_PRESSURE = {
  NONE: 0, // Plenty of time - no messages to model
  HARD_LIMIT: 1, // < 30s remaining - must finish NOW (hard system limit)
};

function getTimePressure(elapsedMs, maxMs) {
  const remaining = maxMs - elapsedMs;
  // Only trigger at the hard limit - model works freely until then
  if (remaining < 30000) return TIME_PRESSURE.HARD_LIMIT; // < 30s - hard limit reached
  return TIME_PRESSURE.NONE;
}

function getTimePressureMessage(pressure, remainingSec) {
  // Only message at hard limit - no soft hints
  if (pressure === TIME_PRESSURE.HARD_LIMIT) {
    return `[HARD LIMIT]: Session timeout in ${remainingSec}s. You must call display_to_user immediately or the session will end.`;
  }
  return null;
}

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

class LLMChatService {
  constructor() {
    this.conversationHistory = [];
    this.pendingUIElements = [];
    this.data = null;
  }

  reset() {
    this.conversationHistory = [];
    this.pendingUIElements = [];
  }

  async ask(question, appContext) {
    // All config values come from LLM_CONFIG at top of file
    const startTime = Date.now();

    // Clear event log for new session
    clearEventLog();
    logEvent(EVENT_TYPES.SESSION_START, {
      question: question.substring(0, 200),
      timeoutMin: LLM_CONFIG.SESSION_TIMEOUT / 60000,
      model: LLM_CONFIG.MODEL,
      reasoning: LLM_CONFIG.REASONING_EFFORT,
    });

    let retryCount = 0;

    while (retryCount <= LLM_CONFIG.MAX_RETRIES) {
      try {
        if (!isLLMConfigured()) return this.generateConfigurationError();

        this.pendingUIElements = [];

        // Initialize empty data - model must use tools to fetch data
        // This forces intentional data fetching rather than relying on pre-loaded data
        this.data = null;
        cachedData = null; // Clear cache so tools will fetch fresh

        updateStatus(
          STATUS_TYPES.THINKING,
          "Ready - AI will fetch data as needed"
        );

        // Step 2: Prepare request (no pre-loaded data)
        const systemPrompt = buildSystemPrompt(null, appContext);

        // Only add to history on first try
        if (retryCount === 0) {
          this.conversationHistory.push({ role: "user", content: question });
          while (
            this.conversationHistory.length >
            LLM_CONFIG.MAX_CONVERSATION_HISTORY * 2
          ) {
            this.conversationHistory.shift();
          }
        }

        const input = [
          { role: "system", content: systemPrompt },
          ...this.conversationHistory,
        ];

        // Step 3: Send to API
        updateStatus(STATUS_TYPES.THINKING, "AI is thinking...");

        const apiCallStart = Date.now();
        let response = await callResponsesAPI(input, TOOLS);
        const apiCallTime = Date.now() - apiCallStart;

        let finalMessage = "";
        let showUI = true;
        let iterations = 0;
        let displayApproved = false;
        let totalToolCalls = 0;
        let iterationStartTime = Date.now();

        while (iterations < LLM_CONFIG.MAX_ITERATIONS && !displayApproved) {
          iterations++;
          const iterStartTime = Date.now();

          // Check session time and get pressure level
          const elapsed = Date.now() - startTime;
          const remaining = LLM_CONFIG.SESSION_TIMEOUT - elapsed;
          const remainingSec = Math.round(remaining / 1000);
          const pressure = getTimePressure(elapsed, LLM_CONFIG.SESSION_TIMEOUT);

          // Force finish if we've truly run out of time (hard limit)
          if (remaining <= 0) {
            if (this.pendingUIElements.length > 0) {
              finalMessage = "Here's what I found:";
              displayApproved = true;
              break;
            }
            throw new Error("SESSION_TIMEOUT");
          }

          const output = response.output;
          if (!output?.length) throw new Error("No response from API");

          // Extract reasoning/thinking content from the model
          let modelThinking = "";
          const reasoningItems = output.filter(
            (i) => i.type === "reasoning" || i.type === "thinking"
          );
          if (reasoningItems.length > 0) {
            for (const ri of reasoningItems) {
              if (Array.isArray(ri.content)) {
                modelThinking += ri.content
                  .filter(
                    (c) =>
                      c.type === "thinking" ||
                      c.type === "text" ||
                      c.type === "output_text"
                  )
                  .map((c) => c.text || c.thinking || "")
                  .join("");
              } else if (typeof ri.content === "string") {
                modelThinking += ri.content;
              } else if (ri.summary) {
                modelThinking += Array.isArray(ri.summary)
                  ? ri.summary.map((s) => s.text || s).join("\n")
                  : ri.summary;
              }
            }
          }

          // Also check for reasoning in the response object itself (o1/o3 style)
          if (response.reasoning) {
            const reasoningSummary = Array.isArray(response.reasoning.summary)
              ? response.reasoning.summary.map((s) => s.text || s).join("\n")
              : response.reasoning.summary || response.reasoning;
            if (typeof reasoningSummary === "string") {
              modelThinking += reasoningSummary;
            }
          }

          const toolCalls = output.filter((i) => i.type === "function_call");
          const textItems = output.filter(
            (i) => i.type === "message" && i.role === "assistant"
          );

          // Collect info for this iteration's log entry
          const iterationToolsCalled = [];
          const iterationToolResults = [];
          let modelDecision = "";

          if (toolCalls.length > 0) {
            const toolResults = [];
            totalToolCalls += toolCalls.length;

            // Show what tools are being called
            // Limit tool calls per iteration to prevent runaway behavior
            const limitedToolCalls = toolCalls.slice(
              0,
              LLM_CONFIG.MAX_TOOLS_PER_ITERATION
            );
            if (toolCalls.length > LLM_CONFIG.MAX_TOOLS_PER_ITERATION) {
              console.warn(
                `[LLM] Model tried to call ${toolCalls.length} tools, limiting to ${LLM_CONFIG.MAX_TOOLS_PER_ITERATION}`
              );
            }

            const toolNames = limitedToolCalls.map((tc) => tc.name);
            modelDecision = `Calling ${
              toolNames.length
            } tool(s): ${toolNames.join(", ")}`;

            // Update status based on tool type
            if (toolNames.includes("display_to_user")) {
              updateStatus(STATUS_TYPES.RENDERING, "Preparing response...");
            } else if (
              toolNames.some((n) =>
                ["render_ui", "render_workload_chart"].includes(n)
              )
            ) {
              updateStatus(STATUS_TYPES.RENDERING, "Building visualization...");
            } else if (
              toolNames.some((n) =>
                [
                  "get_cases",
                  "get_summary",
                  "get_case",
                  "custom_query",
                ].includes(n)
              )
            ) {
              updateStatus(STATUS_TYPES.LOADING_DATA, "Querying data...");
            } else {
              updateStatus(
                STATUS_TYPES.EXECUTING,
                `Executing ${toolNames[0]}...`
              );
            }

            for (let i = 0; i < limitedToolCalls.length; i++) {
              const tc = limitedToolCalls[i];

              let args = {};
              try {
                args =
                  typeof tc.arguments === "string"
                    ? JSON.parse(tc.arguments)
                    : tc.arguments || {};
              } catch (parseErr) {
                console.error(
                  "[LLM] Failed to parse tool arguments:",
                  tc.arguments,
                  parseErr
                );
              }

              // Debug logging for render_ui
              if (tc.name === "render_ui") {
                console.log("[LLM] render_ui called with:", {
                  hasComponentCode: !!args.component_code,
                  hasData: !!args.data,
                  dataType: typeof args.data,
                  hasDescription: !!args.description,
                  rawArgs: tc.arguments?.substring?.(0, 200) || tc.arguments,
                });

                // Format expansion: if data is a JSON string, try to parse it
                if (typeof args.data === "string") {
                  console.log(
                    "[LLM] render_ui: data is string, attempting to parse as JSON"
                  );
                  try {
                    args.data = JSON.parse(args.data);
                  } catch (e) {
                    console.log("[LLM] render_ui: failed to parse data string");
                    // Leave as-is, the handler will wrap it
                  }
                }
              }

              // Create args preview for logging
              const argsPreview =
                Object.keys(args).length > 0
                  ? Object.entries(args)
                      .slice(0, 3)
                      .map(
                        ([k, v]) => `${k}=${JSON.stringify(v).substring(0, 30)}`
                      )
                      .join(", ")
                  : "";

              const result = await executeToolCall(tc.name, args, this.data);

              // Build result summary
              let resultSummary = "";
              if (result?.error || result?._error) {
                resultSummary = `Error: ${result.error || "failed"}`;
              } else if (result?.count !== undefined) {
                resultSummary = `${result.count} results`;
              } else if (result?.message) {
                resultSummary = result.message.substring(0, 80);
              } else if (result?._uiType) {
                resultSummary = `UI: ${result._uiType}`;
              } else {
                resultSummary = "success";
              }

              // Log tool execution (consolidated call + result)
              logEvent(EVENT_TYPES.TOOL_EXECUTED, {
                tool: tc.name,
                argsPreview,
                success: !result?.error && !result?._error,
                resultSummary,
                error: result?.error || null,
              });

              iterationToolsCalled.push(tc.name);
              iterationToolResults.push({
                tool: tc.name,
                success: !result?.error,
                summary: resultSummary,
              });

              // Handle data refresh
              if (result?._uiType === "DATA_REFRESHED" && result._newData) {
                this.data = result._newData;
                delete result._newData;
              }

              // Handle display
              if (result?._uiType === "DISPLAY_APPROVED") {
                displayApproved = true;
                finalMessage = result.message;
                showUI = result.showUI;
                updateStatus(STATUS_TYPES.COMPLETE, "Done");

                // Log final iteration with completion
                const iterDuration = (
                  (Date.now() - iterStartTime) /
                  1000
                ).toFixed(1);
                logEvent(EVENT_TYPES.ITERATION, {
                  iteration: iterations,
                  durationSec: iterDuration,
                  toolsCalled: iterationToolsCalled,
                  modelDecision: "Displayed response to user",
                  modelThinking: modelThinking
                    ? modelThinking.substring(0, 200)
                    : null,
                  completed: true,
                });

                logEvent(EVENT_TYPES.SESSION_END, {
                  success: true,
                  totalIterations: iterations,
                  totalToolCalls,
                  durationSec: ((Date.now() - startTime) / 1000).toFixed(1),
                  hasUI: this.pendingUIElements.length > 0,
                });
                break;
              }

              // Handle UI success
              if (result?._uiType === "RENDER_SUCCESS") {
                this.pendingUIElements.push({
                  _uiType: "DYNAMIC_COMPONENT",
                  componentCode: result.componentCode,
                  data: result.data,
                  description: result.description,
                });
              }

              // Handle action proposals
              if (result?._uiType === "ACTION_PROPOSAL") {
                this.pendingUIElements.push(result);
              }

              toolResults.push({
                type: "function_call_output",
                call_id: tc.call_id,
                output: JSON.stringify(result),
              });
            }

            if (displayApproved) break;

            // Log this iteration summary
            logEvent(EVENT_TYPES.ITERATION, {
              iteration: iterations,
              toolsCalled: iterationToolsCalled,
              toolCount: iterationToolsCalled.length,
              modelThinking: modelThinking
                ? modelThinking.substring(0, 300)
                : null,
            });

            // Continue with results
            const nextInput = [...input];
            limitedToolCalls.forEach((tc) =>
              nextInput.push({
                type: "function_call",
                call_id: tc.call_id,
                name: tc.name,
                arguments: tc.arguments,
              })
            );
            nextInput.push(...toolResults);

            // HARD LIMIT: Only warn when on the LAST iteration (no soft hints before)
            if (iterations === LLM_CONFIG.MAX_ITERATIONS - 1) {
              nextInput.push({
                role: "user",
                content: `[HARD LIMIT]: This is your LAST iteration (${iterations}/${LLM_CONFIG.MAX_ITERATIONS}). You must call display_to_user on your next response or the session will end without showing anything to the user.`,
              });
              logEvent(EVENT_TYPES.TIME_WARNING, {
                level: "ITERATION_LIMIT",
                iteration: iterations,
                maxIterations: LLM_CONFIG.MAX_ITERATIONS,
              });
            }

            // HARD LIMIT: Time-based warning only at actual limit
            if (pressure === TIME_PRESSURE.HARD_LIMIT) {
              const warningMsg = getTimePressureMessage(pressure, remainingSec);
              if (warningMsg) {
                nextInput.push({
                  role: "user",
                  content: warningMsg,
                });
                logEvent(EVENT_TYPES.TIME_WARNING, {
                  level: "TIME_LIMIT",
                  remainingSec,
                });
              }
            }

            // Update status
            updateStatus(
              STATUS_TYPES.THINKING,
              `AI working (iteration ${iterations}/${LLM_CONFIG.MAX_ITERATIONS})...`
            );

            response = await callResponsesAPI(nextInput, TOOLS);
            continue;
          }

          // Text response (no tool calls) - model gave direct text
          // Check for inline UI elements first - we'll extract and accept them
          if (textItems.length > 0) {
            const last = textItems[textItems.length - 1];
            let directText = "";
            if (Array.isArray(last.content)) {
              directText = last.content
                .filter((c) => c.type === "output_text" || c.type === "text")
                .map((c) => c.text)
                .join("");
            } else {
              directText = last.content;
            }

            // EXPANDED UI RENDERING: Parse inline UI elements from direct text
            // This allows the model to output UI directly in text if it uses the supported formats
            if (directText?.trim()) {
              const { elements: inlineUIElements, cleanText } =
                parseInlineUIElements(directText);

              // If we found inline UI elements, accept them!
              if (inlineUIElements.length > 0) {
                console.log(
                  `[LLM] Found ${inlineUIElements.length} inline UI elements in direct text - accepting`
                );

                // Add extracted UI elements to pending
                for (const el of inlineUIElements) {
                  this.pendingUIElements.push(el);
                }

                // The clean text becomes the message
                if (cleanText.trim()) {
                  finalMessage = cleanText;
                } else {
                  finalMessage = "Here's what I found:";
                }
                displayApproved = true;
                showUI = true;

                logEvent(EVENT_TYPES.MODEL_OUTPUT, {
                  preview: finalMessage.substring(0, 200),
                  fullLength: finalMessage.length,
                  inlineUICount: inlineUIElements.length,
                  acceptedVia: "inline_ui_extraction",
                });
                break;
              }

              // No inline UI found - reject direct text as before
              logEvent(EVENT_TYPES.DIRECT_TEXT_REJECTED, {
                text:
                  directText.substring(0, 500) +
                  (directText.length > 500 ? "..." : ""),
                fullLength: directText.length,
                iteration: iterations,
                reason:
                  "Direct text not allowed - must call display_to_user or use inline UI format",
              });

              // If we still have iterations left, force the model to use display_to_user
              if (iterations < LLM_CONFIG.MAX_ITERATIONS - 1) {
                console.log(
                  "[LLM] Direct text rejected - forcing display_to_user call"
                );

                // Use 'input' (always defined) not 'nextInput' (only defined in tool branch)
                const forceDisplayInput = [...input];
                forceDisplayInput.push({
                  role: "user",
                  content: `[SYSTEM ERROR]: Your direct text response was NOT shown to the user. You MUST call display_to_user() to show any response.

Your attempted response (logged to thought chain only):
"${directText.substring(0, 500)}${directText.length > 500 ? "..." : ""}"

Call display_to_user NOW with this message to show it to the user. Example:
display_to_user(message="${directText
                    .substring(0, 100)
                    .replace(/"/g, '\\"')}...", show_ui=${
                    this.pendingUIElements.length > 0
                  })

Alternative: You can also embed UI directly using these formats:
1. <!--UI_ELEMENT:{"componentCode":"...","data":{...}}:END_UI_ELEMENT-->
2. \`\`\`ui {"componentCode":"...","data":{...}} \`\`\``,
                });

                response = await callResponsesAPI(forceDisplayInput, TOOLS);
                continue;
              } else {
                // Out of iterations - use the direct text as fallback but log warning
                console.warn(
                  "[LLM] Out of iterations - using direct text as fallback"
                );
                finalMessage = directText;
                displayApproved = true;
              }
            } else if (iterations < LLM_CONFIG.MAX_ITERATIONS - 1) {
              // Empty response - retry
              logEvent(EVENT_TYPES.ERROR, {
                message: "Empty response from model - retrying",
                iteration: iterations,
              });

              // Use 'input' (always defined) not 'nextInput' (only defined in tool branch)
              const retryInput = [...input];
              retryInput.push({
                role: "user",
                content:
                  "[SYSTEM]: Your previous response was empty. Please call display_to_user with your answer.",
              });

              response = await callResponsesAPI(retryInput, TOOLS);
              continue;
            }
          }
          break;
        }

        // If no message but we ran out of iterations
        if (!finalMessage?.trim() && !displayApproved) {
          if (this.pendingUIElements.length > 0) {
            finalMessage = "Here's what I found:";
          } else {
            throw new Error("MAX_ITERATIONS_REACHED");
          }
        }

        updateStatus(STATUS_TYPES.COMPLETE, "Done");

        // Log session end if not already logged
        if (!displayApproved) {
          logEvent(EVENT_TYPES.SESSION_END, {
            success: true,
            totalIterations: iterations,
            totalToolCalls,
            durationSec: ((Date.now() - startTime) / 1000).toFixed(1),
            hasUI: this.pendingUIElements.length > 0,
          });
        }

        let finalContent = finalMessage;
        if (showUI && this.pendingUIElements.length > 0) {
          finalContent += this.pendingUIElements
            .map(
              (el) => `<!--UI_ELEMENT:${JSON.stringify(el)}:END_UI_ELEMENT-->`
            )
            .join("");
        }

        this.conversationHistory.push({
          role: "assistant",
          content: finalContent,
        });
        return finalContent + " [COMPONENTS:llm_codex]";
      } catch (error) {
        console.error(`[LLM] Error (attempt ${retryCount + 1}):`, error);

        const errorMsg = error.message || "";

        // Log the error with context
        logEvent(EVENT_TYPES.ERROR, {
          message: errorMsg,
          attempt: retryCount + 1,
          elapsedSec: ((Date.now() - startTime) / 1000).toFixed(1),
        });

        // Auto-retry on these errors (hidden from user)
        // Note: CORS_PROXY_TIMEOUT is NOT retryable because it will just fail again
        const isRetryable =
          !errorMsg.includes("CORS_PROXY_TIMEOUT") && // Don't retry CORS proxy timeouts
          (errorMsg.includes("SESSION_TIMEOUT") ||
            errorMsg.includes("MAX_ITERATIONS") ||
            errorMsg.includes("TIMEOUT") ||
            errorMsg.includes("timeout") ||
            errorMsg.includes("429") ||
            errorMsg.includes("500") ||
            errorMsg.includes("502") ||
            errorMsg.includes("503") ||
            errorMsg.includes("504") ||
            errorMsg.includes("No tool call found") ||
            errorMsg.includes("network") ||
            errorMsg.includes("fetch") ||
            errorMsg.includes("Failed to fetch") ||
            errorMsg.includes("NetworkError") ||
            errorMsg.includes("AbortError"));

        if (isRetryable && retryCount < LLM_CONFIG.MAX_RETRIES) {
          retryCount++;
          const waitTime = 2000 * retryCount; // 2s, 4s, 6s
          updateStatus(
            STATUS_TYPES.FIXING_ERROR,
            `Issue occurred, retrying in ${waitTime / 1000}s (attempt ${
              retryCount + 1
            }/${LLM_CONFIG.MAX_RETRIES + 1})...`
          );

          logEvent(EVENT_TYPES.RETRY, {
            attempt: retryCount,
            waitTime,
            reason: errorMsg,
          });

          // Wait before retrying
          await new Promise((r) => setTimeout(r, waitTime));
          continue;
        }

        // Non-retryable or max retries exceeded - now show to user
        updateStatus(STATUS_TYPES.ERROR, error.message);

        // If we have any UI elements, show them with a partial response
        if (this.pendingUIElements.length > 0) {
          let partialContent =
            "I ran into an issue but here's what I found so far:";
          partialContent += this.pendingUIElements
            .map(
              (el) => `<!--UI_ELEMENT:${JSON.stringify(el)}:END_UI_ELEMENT-->`
            )
            .join("");
          this.conversationHistory.push({
            role: "assistant",
            content: partialContent,
          });
          return partialContent + " [COMPONENTS:llm_codex]";
        }

        return this.generateErrorResponse(error, question);
      }
    }

    // Should not reach here, but just in case
    return "I encountered repeated issues processing your request. Please try again or try a simpler question.";
  }

  generateConfigurationError() {
    return `**LLM Not Configured**\n\nSet your API key:\n\`configureLLM({ apiKey: 'sk-...' })\`\n\n[ACTION:Switch to Heuristic|switch to heuristic mode] [COMPONENTS:llm_codex]`;
  }

  generateErrorResponse(error, question) {
    const msg = error.message || "";

    // Auth errors - show immediately, don't suggest retry
    if (msg.includes("401") || msg.includes("403") || msg.includes("API key")) {
      return `**Authentication Error**\n\nAPI key issue. Please check your configuration.\n\n[ACTION:Switch to Heuristic|switch] [COMPONENTS:llm_codex]`;
    }

    // CORS proxy timeout - specific message
    if (msg.includes("CORS_PROXY_TIMEOUT")) {
      return `**CORS Proxy Timeout (~30s limit)**\n\nThe external CORS proxy timed out. High reasoning AI needs more time.\n\n**Quick Fix - Start the local proxy:**\n\`\`\`\nnpm run proxy\n\`\`\`\nThen refresh this page. The local proxy has no timeout limits.\n\n**Other options:**\n• Deploy to production (no proxy needed)\n• Switch to heuristic mode\n\n[ACTION:Switch to Heuristic|switch] [ACTION:Try Again|${question}] [COMPONENTS:llm_codex]`;
    }

    // After retries exhausted, show friendly message with retry option
    if (
      msg.includes("TIMEOUT") ||
      msg.includes("timeout") ||
      msg.includes("SESSION_TIMEOUT") ||
      msg.includes("MAX_ITERATIONS") ||
      msg.includes("API_CALL_TIMEOUT")
    ) {
      return `**Request exceeded 10-minute limit**\n\nThe request couldn't complete within the 10-minute timeout window. This can happen with very complex questions.\n\n[ACTION:Try Again|${question}] [ACTION:Switch to Heuristic|switch] [COMPONENTS:llm_codex]`;
    }

    if (msg.includes("429")) {
      return `**Rate Limited**\n\nToo many requests. Please wait a moment.\n\n[ACTION:Try Again|${question}] [COMPONENTS:llm_codex]`;
    }

    if (
      msg.includes("5") &&
      (msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504"))
    ) {
      return `**Server Error**\n\nThe AI service is having issues. Please try again.\n\n[ACTION:Try Again|${question}] [ACTION:Switch to Heuristic|switch] [COMPONENTS:llm_codex]`;
    }

    // Generic error
    return `**Something went wrong**\n\nPlease try again or rephrase your question.\n\n[ACTION:Try Again|${question}] [ACTION:Switch to Heuristic|switch] [COMPONENTS:llm_codex]`;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let instance = null;

export async function askLLM(question, appContext) {
  if (!instance) instance = new LLMChatService();
  return instance.ask(question, appContext);
}

export function resetLLMChat() {
  if (instance) instance.reset();
  cachedData = null;
  cacheTimestamp = null;
  clearEventLog();
}

export function getLLMService() {
  if (!instance) instance = new LLMChatService();
  return instance;
}

export { CaseService };
export {
  LLMChatService,
  LLM_CONFIG,
  buildSystemPrompt,
  TOOLS,
  executeToolCall,
  loadFullDatabase as buildCompleteDataContext,
};
export {
  isUsingCorsProxy,
  getProxyStatus,
  checkLocalProxy,
  buildChainOfThoughtSummary,
};
export default askLLM;
