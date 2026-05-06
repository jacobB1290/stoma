// ─────────────────────────────────────────────────────────────────────────────
// System Management Screen — Shared Constants & Utilities
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../../services/caseService";
import { getCanonicalName } from "../../utils/nameNormalization";
import {
  getFrontOfficeList,
  STORAGE_KEY as FO_STORAGE_KEY,
} from "../../utils/frontOfficeStaff";

// ── Broadcast FO list to all clients via syscmd ────────────────────────────
export async function broadcastFOList() {
  try {
    const list = getFrontOfficeList();
    const payload = JSON.stringify({ [FO_STORAGE_KEY]: JSON.stringify(list) });
    await db.from("cases").insert({
      casenumber: "syscmd",
      department: "General",
      priority: false,
      modifiers: ["syscmd:settings", "target:all", `payload:${payload}`],
      due: new Date().toISOString(),
      completed: false,
      archived: false,
    });
  } catch (err) {
    console.warn("[FO] broadcast failed — changes still saved locally", err);
  }
}

// ── Constants ──────────────────────────────────────────────────────────────
export const TZ = "America/Boise";
export const STAGES = ["design", "production", "finishing"];

export const COLORS = {
  primary: "#16525F",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  purple: "#8b5cf6",
  indigo: "#6366f1",
};

export const RISK_COLORS = {
  critical: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626", primary: "#dc2626" },
  high: { bg: "#fff7ed", border: "#fed7aa", text: "#ea580c", primary: "#f97316" },
  medium: { bg: "#fefce8", border: "#fef08a", text: "#ca8a04", primary: "#eab308" },
  low: { bg: "#f0fdf4", border: "#bbf7d0", text: "#16a34a", primary: "#22c55e" },
};

export const STAGE_COLORS = {
  design: "#6366f1",
  production: "#8b5cf6",
  finishing: "#a855f7",
};

export const SETTING_DEFINITIONS = [
  { key: "boardTheme", label: "Theme", type: "select", options: ["blue", "white", "pink", "dark"] },
  { key: "showInfoBar", label: "Info Bar", type: "toggle" },
  { key: "showCaseTableDividers", label: "Table Dividers", type: "toggle" },
  { key: "lockAddCaseCard", label: "Lock Add Card", type: "toggle" },
  { key: "showStageDividers", label: "Stage Dividers", type: "toggle" },
  { key: "enableMobileBoardView", label: "Mobile Board View", type: "toggle" },
  { key: "disableAutomations", label: "Smart Automations", type: "toggle", invert: true },
  { key: "boostDarkMode", label: "Boost Dark Mode", type: "toggle" },
  { key: "autoUpdate", label: "Auto Update", type: "toggle" },
  { key: "facultySystemManager", label: "Faculty: System Manager", type: "toggle" },
  { key: "lite-ui", label: "Lite UI", type: "toggle" },
];

// ── Utility Functions ──────────────────────────────────────────────────────

export const nowIso = () => new Date().toISOString();

export const safeJsonParse = (str, fallback) => {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
};

export const fmtTimeAgo = (ts) => {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 25) return "Now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

export const getStatus = (now, lastSeen) => {
  if (!lastSeen) return "offline";
  const diff = (now - new Date(lastSeen).getTime()) / 1000;
  if (diff < 45) return "active";
  if (diff < 330) return "idle";
  return "offline";
};

export const stageOfCase = (row) => {
  const mods = row?.modifiers || [];
  const m = mods.find((x) => typeof x === "string" && x.startsWith("stage-"));
  return m ? m.replace("stage-", "") || "design" : "design";
};

export const isDigitalGeneral = (row) => row?.department === "General";
export const isOpenCase = (row) => !row?.completed && !row?.archived;

export const normalizeForDedup = (name) => {
  if (!name) return "";
  return getCanonicalName(name).toLowerCase();
};

export const formatDisplayName = (name) => {
  if (!name) return "Unknown";
  return getCanonicalName(name);
};

export const getEfficiencyColor = (score) => {
  if (score >= 80) return COLORS.success;
  if (score >= 60) return COLORS.warning;
  return COLORS.danger;
};

export const extractUserSettings = (user) => {
  let deviceInfo = user.device_info;
  if (typeof deviceInfo === "string") deviceInfo = safeJsonParse(deviceInfo, null);
  if (!deviceInfo?.settings) return null;
  const booleanKeys = new Set([
    "showInfoBar", "showCaseTableDividers", "lockAddCaseCard", "showStageDividers",
    "enableMobileBoardView", "disableAutomations", "boostDarkMode", "autoUpdate",
    "facultySystemManager", "lite-ui", "liteUi",
  ]);
  const parsed = {};
  Object.entries(deviceInfo.settings).forEach(([key, val]) => {
    const parsedVal = booleanKeys.has(key)
      ? val === "true" ? true : val === "false" ? false : val
      : val;
    parsed[key] = parsedVal;
    if (key === "liteUi" && parsed["lite-ui"] === undefined) parsed["lite-ui"] = parsedVal;
  });
  return parsed;
};

export const getDefaultSettings = () => ({
  boardTheme: "blue",
  showInfoBar: false,
  showCaseTableDividers: true,
  lockAddCaseCard: false,
  showStageDividers: false,
  enableMobileBoardView: false,
  disableAutomations: true,
  boostDarkMode: false,
  autoUpdate: false,
  facultySystemManager: false,
  "lite-ui": false,
});

export const dateFormatters = {
  fullDateTime: new Intl.DateTimeFormat("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }),
  dayKey: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }),
  fullDate: new Intl.DateTimeFormat(undefined, { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }),
  time: new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
};

export const dayKey = (d) => dateFormatters.dayKey.format(new Date(d));
export const fmtDate = (d) => dateFormatters.fullDate.format(new Date(d));
export const fmtTime = (d) => dateFormatters.time.format(new Date(d)).replace(" ", "\u202F");

// Timezone-aware "today"/"overdue" helpers \u2014 compares calendar days in the
// configured TZ rather than UTC strings, which matters near day boundaries.
export const todayKey = () => dateFormatters.dayKey.format(new Date());
export const dueDayKey = (row) => row?.due ? dateFormatters.dayKey.format(new Date(row.due)) : null;
export const isOverdueRow = (row) => {
  const k = dueDayKey(row);
  return !!k && k < todayKey();
};
export const isDueTodayRow = (row) => dueDayKey(row) === todayKey();

// Rolls up qc onto finishing for display purposes (qc is a transient inspection
// state inside the finishing workflow, not a separate top-level pipeline stage).
export const stageOfCaseRollup = (row) => {
  const s = stageOfCase(row);
  return s === "qc" ? "finishing" : s;
};

// Build a rolling N-day completion bucket from history (action contains "marked done").
// Returns an array of length `days` where index 0 is the oldest day, last is today.
export const buildCompletionBuckets = (history, days = 7) => {
  const buckets = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startMs = today.getTime() - (days - 1) * 86400000;
  (history || []).forEach((h) => {
    if (!h.action?.toLowerCase().includes("marked done")) return;
    if (!h.created_at) return;
    const t = new Date(h.created_at).getTime();
    if (t < startMs) return;
    const idx = Math.floor((t - startMs) / 86400000);
    if (idx >= 0 && idx < days) buckets[idx]++;
  });
  return buckets;
};

// Build per-day per-stage history "moves" buckets for sparkline-friendly trends.
export const buildStageMoveBuckets = (history, stage, days = 7) => {
  const buckets = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startMs = today.getTime() - (days - 1) * 86400000;
  const stageWord = stage.toLowerCase();
  (history || []).forEach((h) => {
    if (!h.created_at) return;
    const t = new Date(h.created_at).getTime();
    if (t < startMs) return;
    const a = (h.action || "").toLowerCase();
    if (!a.includes("moved") || !a.includes(`to ${stageWord}`)) return;
    const idx = Math.floor((t - startMs) / 86400000);
    if (idx >= 0 && idx < days) buckets[idx]++;
  });
  return buckets;
};
