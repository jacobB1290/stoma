// /src/utils/caseRiskPredictions.js
// Advanced Case Risk Predictions — v3 Neural Visualization
// Updated: 2025-12-04 - Fixed timezone handling for due dates

import React, {
  useMemo,
  useState,
  useEffect,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

/** ======================= DATE & TIME UTILITIES ======================== **/

export const formatDate = (date, options = {}) => {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";

  if (options.dateOnly) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  if (options.dayTime) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (options.timeOnly) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/**
 * Parse a date string and return the END OF DAY (5 PM) in LOCAL timezone.
 * This is critical for due date handling - we always want 5 PM local time on the specified date.
 */
function dueEOD(due) {
  if (!due) return null;

  // If already a Date object
  if (due instanceof Date && !isNaN(due.getTime())) {
    // Create a new date at 5 PM local time on the same calendar date
    return new Date(
      due.getFullYear(),
      due.getMonth(),
      due.getDate(),
      17,
      0,
      0,
      0
    );
  }

  if (typeof due === "string") {
    // Case 1: Date-only string like "2025-12-05"
    if (!due.includes("T")) {
      const parts = due.split("-");
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
        const day = parseInt(parts[2], 10);
        // Create date directly in local timezone at 5 PM
        return new Date(year, month, day, 17, 0, 0, 0);
      }
    }

    // Case 2: ISO string with time component
    // We need to extract just the date part and ignore the time/timezone
    // because we always want 5 PM local time on the DUE DATE

    // Extract date portion: "2025-12-05T..." -> "2025-12-05"
    const datePart = due.split("T")[0];
    const parts = datePart.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      // Create date directly in local timezone at 5 PM
      return new Date(year, month, day, 17, 0, 0, 0);
    }

    // Fallback: try to parse and extract local date components
    const parsed = new Date(due);
    if (!isNaN(parsed.getTime())) {
      // If the string had timezone info, the parsed date is correct in UTC
      // but we want the LOCAL calendar date that was intended
      // This is tricky - we'll use the local interpretation
      return new Date(
        parsed.getFullYear(),
        parsed.getMonth(),
        parsed.getDate(),
        17,
        0,
        0,
        0
      );
    }
  }

  return null;
}

/**
 * Parse a due date for DISPLAY purposes - shows the actual date the user set
 */
function parseDueDateForDisplay(due) {
  if (!due) return null;

  if (due instanceof Date && !isNaN(due.getTime())) {
    return due;
  }

  if (typeof due === "string") {
    // Date-only string
    if (!due.includes("T")) {
      const parts = due.split("-");
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        return new Date(year, month, day, 17, 0, 0, 0);
      }
    }

    // ISO string - extract date part
    const datePart = due.split("T")[0];
    const parts = datePart.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day, 17, 0, 0, 0);
    }
  }

  return null;
}

/** ======================= BREAK-AWARE CALENDAR ======================== **/

const WORK_WINDOWS = [
  { h0: 8, m0: 0, h1: 9, m1: 30 },
  { h0: 9, m0: 45, h1: 12, m1: 0 },
  { h0: 13, m0: 0, h1: 14, m1: 30 },
  { h0: 14, m0: 45, h1: 17, m1: 0 },
];

const STAGE_CAPACITY = { design: 1, production: 2, finishing: 3, qc: 2 };
const BUFFER_REQ = { design: 2, production: 1, finishing: 0, qc: 0 };
const RESCHEDULE_DISCOUNT_GAMMA = 0.6;

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const normalizeStage = (s) => (s || "design").toString().trim().toLowerCase();
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const dowPy = (d) => (d.getDay() + 6) % 7;
const getCurrentTime = () => new Date();

const yieldToMainThread = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const shouldYield = (index, chunkSize = 25) => (index + 1) % chunkSize === 0;

function dayWindows(d) {
  const y = d.getFullYear(),
    m = d.getMonth(),
    day = d.getDate();
  return WORK_WINDOWS.map((w) => ({
    start: new Date(y, m, day, w.h0, w.m0, 0, 0),
    end: new Date(y, m, day, w.h1, w.m1, 0, 0),
  }));
}

export function daySpanHours(a, b) {
  return (b - a) / 3_600_000;
}

export function businessHoursBetween(start, end) {
  if (!start || !end || end <= start) return 0;
  let cur = new Date(start),
    stop = new Date(end),
    total = 0;
  while (cur < stop) {
    cur = advanceToNextWorkMoment(cur);
    const wins = dayWindows(cur);
    for (const w of wins) {
      if (stop <= w.start) break;
      const s = cur < w.start ? w.start : cur;
      const e = stop < w.end ? stop : w.end;
      if (e > s) total += daySpanHours(s, e);
      if (stop <= w.end) break;
      cur = w.end;
    }
    cur = new Date(
      cur.getFullYear(),
      cur.getMonth(),
      cur.getDate() + 1,
      8,
      0,
      0,
      0
    );
  }
  return Math.max(0, total);
}

export function addBusinessHours(start, hoursToAdd) {
  let cur = new Date(start);
  if (hoursToAdd <= 0) return snapToMinutes(advanceToNextWorkMoment(cur), 5);
  let remaining = hoursToAdd;
  while (remaining > 1e-9) {
    cur = advanceToNextWorkMoment(cur);
    const wins = dayWindows(cur);
    let advanced = false;
    for (const w of wins) {
      if (cur < w.start) cur = w.start;
      if (cur >= w.start && cur < w.end) {
        const span = daySpanHours(cur, w.end);
        if (remaining <= span + 1e-12) {
          cur = new Date(cur.getTime() + remaining * 3_600_000);
          return snapToMinutes(cur, 5);
        } else {
          remaining -= span;
          cur = w.end;
          advanced = true;
        }
      }
    }
    if (!advanced)
      cur = new Date(
        cur.getFullYear(),
        cur.getMonth(),
        cur.getDate() + 1,
        8,
        0,
        0,
        0
      );
  }
  return snapToMinutes(cur, 5);
}

function snapToMinutes(dt, step = 5) {
  const d = new Date(dt);
  d.setMinutes(Math.round(d.getMinutes() / step) * step, 0, 0);
  return d;
}

function advanceToNextWorkMoment(cur) {
  cur = new Date(cur);
  while (true) {
    if (isWeekend(cur)) {
      const add = cur.getDay() === 0 ? 1 : 2;
      cur = new Date(
        cur.getFullYear(),
        cur.getMonth(),
        cur.getDate() + add,
        8,
        0,
        0,
        0
      );
      continue;
    }
    const wins = dayWindows(cur);
    if (cur < wins[0].start) return wins[0].start;
    for (const w of wins) if (cur >= w.start && cur < w.end) return cur;
    cur = new Date(
      cur.getFullYear(),
      cur.getMonth(),
      cur.getDate() + 1,
      8,
      0,
      0,
      0
    );
  }
}

/** ======================= ML WEIGHTS ======================== **/

export const ETA_WEIGHTS = {
  design: {
    intercept: -2.640829,
    log_allowed_wh: 0.673991,
    is_rush: 0.376177,
    entry_hour_from8: 0.073464,
    due_changes: -0.539435,
    stage_moves: 0.046302,
    log_hold_hours: 0.078169,
    dow_0: 0.359067,
    dow_1: 0.959329,
    dow_2: 0.381417,
    dow_3: -0.001334,
    dow_4: -0.761674,
    log_backlog: 0.102261,
    thin_lt6h: 1.985591,
    thin_lt12h: 0.650655,
    thin_lt18h: 0.102337,
  },
  production: {
    intercept: -2.68967,
    log_allowed_wh: 1.384507,
    is_rush: 0.694135,
    entry_hour_from8: -0.055862,
    due_changes: -0.017134,
    stage_moves: -0.139123,
    log_hold_hours: 0.030151,
    dow_0: 0.02859,
    dow_1: 0.266903,
    dow_2: 0.128429,
    dow_3: 0.234442,
    dow_4: -0.598305,
    log_backlog: 0.049686,
    thin_lt6h: 1.58952,
    thin_lt12h: 0.307451,
    thin_lt18h: 0.045829,
  },
  finishing: {
    intercept: -2.545875,
    log_allowed_wh: 1.460449,
    is_rush: 0.678927,
    entry_hour_from8: -0.06837,
    due_changes: -0.538377,
    stage_moves: 0.266929,
    log_hold_hours: 0.063066,
    dow_0: -0.287658,
    dow_1: 0.024906,
    dow_2: 0.234092,
    dow_3: -0.023023,
    dow_4: -0.010952,
    log_backlog: 0.078251,
    thin_lt6h: 0.743563,
    thin_lt12h: 0.182453,
    thin_lt18h: 0.010125,
  },
  qc: {
    intercept: -1.957785,
    log_allowed_wh: 0.965457,
    is_rush: 0.672908,
    entry_hour_from8: -0.024352,
    due_changes: -0.069335,
    stage_moves: 0.036815,
    log_hold_hours: 0.058525,
    dow_0: -0.177764,
    dow_1: -0.234222,
    dow_2: 0.128916,
    dow_3: -0.321999,
    dow_4: 0.057325,
    log_backlog: -0.039022,
    thin_lt6h: 0.665837,
    thin_lt12h: 0.188604,
    thin_lt18h: 0.012429,
  },
};

const ETA_BIAS_BH = {
  design: 3.972104,
  production: 8.218431,
  finishing: 5.056508,
  qc: 1.675231,
};

export const RESCHED_WEIGHTS = {
  design: {
    intercept: -2.089762,
    log_allowed_wh: -0.115738,
    is_rush: 0.23956,
    entry_hour_from8: 0.093549,
    due_changes: -0.460649,
    stage_moves: 0.179508,
    log_hold_hours: 0.069483,
    dow_0: 0.195904,
    dow_1: 0.895072,
    dow_2: 0.104981,
    dow_3: -0.25019,
    dow_4: -0.97208,
    log_backlog: 0.277596,
  },
  production: {
    intercept: -2.898941,
    log_allowed_wh: 0.280508,
    is_rush: 0.304921,
    entry_hour_from8: -0.031877,
    due_changes: 0.031466,
    stage_moves: 0.225873,
    log_hold_hours: 0.208372,
    dow_0: 0.07638,
    dow_1: 0.268953,
    dow_2: 0.057425,
    dow_3: -0.433533,
    dow_4: -0.006247,
    log_backlog: 0.125255,
  },
  finishing: {
    intercept: -3.072409,
    log_allowed_wh: 0.392936,
    is_rush: 0.228209,
    entry_hour_from8: 0.014063,
    due_changes: 0.629781,
    stage_moves: 0.080335,
    log_hold_hours: 0.494662,
    dow_0: -0.356527,
    dow_1: -0.428608,
    dow_2: 0.211926,
    dow_3: 0.519935,
    dow_4: 0.043215,
    log_backlog: -0.211702,
  },
  qc: {
    intercept: 0,
    log_allowed_wh: 0,
    is_rush: 0,
    entry_hour_from8: 0,
    due_changes: 0,
    stage_moves: 0,
    log_hold_hours: 0,
    dow_0: 0,
    dow_1: 0,
    dow_2: 0,
    dow_3: 0,
    dow_4: 0,
    log_backlog: 0,
  },
};

export const STALL_WEIGHTS = {
  design: {
    intercept: -1.002144,
    log_allowed_wh: -0.182932,
    is_rush: 0.081405,
    entry_hour_from8: 0.034555,
    due_changes: 0.576277,
    stage_moves: -0.206462,
    log_hold_hours: -0.013732,
    dow_0: 0.03339,
    dow_1: 0.310309,
    dow_2: 0.299819,
    dow_3: 0.209462,
    dow_4: -0.852681,
    log_backlog: 0.382757,
  },
  production: {
    intercept: -1.213911,
    log_allowed_wh: -0.210764,
    is_rush: 0.177715,
    entry_hour_from8: 0.009511,
    due_changes: 0.007812,
    stage_moves: 0.026406,
    log_hold_hours: 0.007904,
    dow_0: 0.01749,
    dow_1: 0.06242,
    dow_2: 0.076707,
    dow_3: 0.057608,
    dow_4: -0.174425,
    log_backlog: 0.171958,
  },
  finishing: {
    intercept: -1.319843,
    log_allowed_wh: -0.175374,
    is_rush: 0.184624,
    entry_hour_from8: -0.013206,
    due_changes: -0.149343,
    stage_moves: 0.079618,
    log_hold_hours: -0.031293,
    dow_0: -0.106142,
    dow_1: 0.005437,
    dow_2: 0.163608,
    dow_3: -0.071625,
    dow_4: 0.014146,
    log_backlog: 0.155345,
  },
  qc: {
    intercept: -1.478745,
    log_allowed_wh: -0.189624,
    is_rush: 0.190964,
    entry_hour_from8: 0.019235,
    due_changes: -0.014356,
    stage_moves: 0.243506,
    log_hold_hours: -0.011767,
    dow_0: -0.062546,
    dow_1: 0.050208,
    dow_2: -0.044985,
    dow_3: 0.055539,
    dow_4: 0.002279,
    log_backlog: -0.116675,
  },
};

const CALIB_PLATT = {
  design: { a: 1, b: 0 },
  production: { a: 1, b: 0 },
  finishing: { a: 1, b: 0 },
  qc: { a: 1, b: 0 },
};
const RESCHED_LIKELY_FLOOR = {
  design: 0.3,
  production: 0.3,
  finishing: 0.3,
  qc: 0.3,
};
const RESCHED_PRIOR_LIVE = {
  design: 0.0954,
  production: 0.0696,
  finishing: 0.0328,
  qc: 0.02,
};
const RESCHED_PRIOR_TRAIN = {
  design: 0.0954,
  production: 0.0696,
  finishing: 0.0328,
  qc: 0.02,
};

/** ======================= FEATURE METADATA FOR NEURAL VIZ ======================== **/

const FEATURE_METADATA = {
  intercept: {
    name: "Base Bias",
    description: "Model baseline - always active",
    category: "model",
    icon: "⚡",
  },
  log_allowed_wh: {
    name: "Time Budget",
    description: "Log of allowed work hours until due date",
    category: "time",
    icon: "⏱️",
    interpret: (v) =>
      v > 2
        ? "Generous timeline"
        : v > 1
        ? "Normal timeline"
        : "Tight deadline",
  },
  is_rush: {
    name: "Rush Priority",
    description: "Case marked as rush/priority",
    category: "priority",
    icon: "🚀",
    interpret: (v) =>
      v > 0 ? "RUSH case - expedited processing" : "Standard priority",
  },
  entry_hour_from8: {
    name: "Entry Time",
    description: "Hours after 8 AM when case entered stage",
    category: "time",
    icon: "🕐",
    interpret: (v) =>
      v < 2
        ? "Early morning entry"
        : v < 5
        ? "Mid-day entry"
        : "Late day entry",
  },
  due_changes: {
    name: "Due Date Changes",
    description: "Number of times due date was modified",
    category: "history",
    icon: "📅",
    interpret: (v) =>
      v === 0
        ? "Stable deadline"
        : v === 1
        ? "One reschedule"
        : "Multiple reschedules - unstable",
  },
  stage_moves: {
    name: "Stage Movements",
    description: "Number of stage transitions",
    category: "history",
    icon: "🔄",
    interpret: (v) =>
      v <= 1
        ? "Normal flow"
        : v <= 3
        ? "Some back-and-forth"
        : "High churn - complex case",
  },
  log_hold_hours: {
    name: "Hold Time",
    description: "Log of total hours spent on hold",
    category: "blockers",
    icon: "⏸️",
    interpret: (v) =>
      v < 0.5
        ? "Minimal holds"
        : v < 1.5
        ? "Some hold time"
        : "Significant hold delays",
  },
  dow_0: {
    name: "Monday",
    description: "Case entered on Monday",
    category: "timing",
    icon: "📆",
    interpret: (v) => (v > 0 ? "Monday entry - week start" : null),
  },
  dow_1: {
    name: "Tuesday",
    description: "Case entered on Tuesday",
    category: "timing",
    icon: "📆",
    interpret: (v) => (v > 0 ? "Tuesday entry" : null),
  },
  dow_2: {
    name: "Wednesday",
    description: "Case entered on Wednesday",
    category: "timing",
    icon: "📆",
    interpret: (v) => (v > 0 ? "Wednesday entry - mid-week" : null),
  },
  dow_3: {
    name: "Thursday",
    description: "Case entered on Thursday",
    category: "timing",
    icon: "📆",
    interpret: (v) => (v > 0 ? "Thursday entry" : null),
  },
  dow_4: {
    name: "Friday",
    description: "Case entered on Friday",
    category: "timing",
    icon: "📆",
    interpret: (v) => (v > 0 ? "Friday entry - weekend ahead" : null),
  },
  log_backlog: {
    name: "Queue Depth",
    description: "Log of cases ahead in queue",
    category: "capacity",
    icon: "📊",
    interpret: (v) =>
      v < 0.3 ? "Short queue" : v < 0.7 ? "Moderate queue" : "Heavy backlog",
  },
  thin_lt6h: {
    name: "Critical Timeline",
    description: "Less than 6 hours until due",
    category: "urgency",
    icon: "🔴",
    interpret: (v) => (v > 0 ? "CRITICAL - Under 6 hours remaining!" : null),
  },
  thin_lt12h: {
    name: "Tight Timeline",
    description: "Less than 12 hours until due",
    category: "urgency",
    icon: "🟠",
    interpret: (v) => (v > 0 ? "Tight - Under 12 hours remaining" : null),
  },
  thin_lt18h: {
    name: "Limited Timeline",
    description: "Less than 18 hours until due",
    category: "urgency",
    icon: "🟡",
    interpret: (v) => (v > 0 ? "Limited buffer - Under 18 hours" : null),
  },
};

const CATEGORY_COLORS = {
  model: { bg: "#f3f4f6", border: "#9ca3af", glow: "#6b7280" },
  time: { bg: "#dbeafe", border: "#3b82f6", glow: "#2563eb" },
  priority: { bg: "#fae8ff", border: "#c026d3", glow: "#a855f7" },
  history: { bg: "#fef3c7", border: "#f59e0b", glow: "#d97706" },
  blockers: { bg: "#fee2e2", border: "#ef4444", glow: "#dc2626" },
  timing: { bg: "#e0e7ff", border: "#6366f1", glow: "#4f46e5" },
  capacity: { bg: "#ccfbf1", border: "#14b8a6", glow: "#0d9488" },
  urgency: { bg: "#fecaca", border: "#dc2626", glow: "#b91c1c" },
};

/** ======================= HELPER FUNCTIONS ======================== **/

function learnedCapacity(stage, stageStatsForStage, fallback = 1) {
  const stg = normalizeStage(stage);
  const learned = Math.round(
    stageStatsForStage?.concurrencyP50 ||
      stageStatsForStage?.concurrencyMean ||
      fallback
  );
  const clipped = Math.max(1, Math.min(6, learned || fallback));
  return stg === "design" ? 1 : clipped;
}

function effectiveBacklog(activeCases, c, stage, entryAt, k) {
  const stg = normalizeStage(stage);
  const earlier = activeCases.filter((o) => {
    if (o.id === c.id || o.caseNumber === c.caseNumber) return false;
    const otherStage = normalizeStage(o.currentStage || o.stage);
    if (otherStage !== stg) return false;
    const otherEntry = getStageEnteredAtFor(o, stg);
    return otherEntry && otherEntry < entryAt;
  }).length;
  return Math.max(0, earlier - Math.max(0, (k || 1) - 1));
}

function applyPriorShift(logit, pTrain, pLive) {
  const lt = Math.log(pTrain / (1 - pTrain));
  const ll = Math.log(pLive / (1 - pLive));
  return logit - lt + ll;
}

function shockScore(activeCases, stage, capacityK) {
  const stg = normalizeStage(stage);
  const S = activeCases.filter(
    (c) => normalizeStage(c.currentStage || c.stage) === stg
  );
  const n = S.length || 1;
  const behind = S.filter((c) => (c.slackDays ?? 99) < 0).length / n;
  const heavyHolds =
    S.filter((c) => (c.holdHours || 0) >= 4 || c.onHold).length / n;
  const backlogRatio =
    Math.max(0, n - (capacityK || 1)) / Math.max(1, capacityK || 1);
  return behind > 0.35
    ? clamp(
        0.5 * behind +
          0.3 * Math.tanh(Math.max(0, backlogRatio - 0.3)) +
          0.2 * heavyHolds,
        0,
        1
      )
    : 0;
}

function eventsPerHourSince(c, start, end = getCurrentTime()) {
  const H = (c.case_history || c.history || [])
    .filter((h) => h?.created_at)
    .map((h) => ({
      t: new Date(h.created_at),
      a: String(h.action || "").toLowerCase(),
    }))
    .sort((a, b) => a.t - b.t)
    .filter(
      (h) =>
        h.t >= start &&
        h.t < end &&
        (h.a.includes("moved") ||
          h.a.includes("due changed") ||
          h.a.includes("hold added") ||
          h.a.includes("hold removed"))
    );
  const bh = businessHoursBetween(start, end);
  return bh <= 1e-6 ? 0 : H.length / bh;
}

function lastActivityAtSince(c, since) {
  const H = (c.case_history || c.history || [])
    .filter((h) => h?.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const s = new Date(since);
  let last = s;
  for (const h of H) {
    const t = new Date(h.created_at);
    if (t < s) continue;
    const a = String(h.action || "").toLowerCase();
    if (
      (a.includes("hold") ||
        a.includes("moved") ||
        a.includes("comment") ||
        a.includes("uploaded") ||
        a.includes("note") ||
        a.includes("repair")) &&
      !isNaN(t.getTime())
    )
      last = t;
  }
  return last;
}

function timeSinceLastActivityHours(c, stageEnteredAt) {
  const last = lastActivityAtSince(c, stageEnteredAt);
  return (getCurrentTime() - last) / 3_600_000;
}

function strSet(mods) {
  if (!mods) return new Set();
  if (Array.isArray(mods))
    return new Set(mods.map((m) => String(m).toLowerCase()));
  return new Set(
    String(mods)
      .toLowerCase()
      .split(/[\,\s]+/g)
  );
}

function histCountUpTo(c, pred, cutoff) {
  const H = (c.case_history || c.history || [])
    .filter((h) => h?.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let n = 0;
  for (const h of H) {
    if (new Date(h.created_at) > cutoff) break;
    if (pred(String(h.action || "").toLowerCase())) n++;
  }
  return n;
}

function holdHoursUntil(c, cutoff) {
  const H = (c.case_history || c.history || [])
    .filter((h) => h?.created_at)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let on = null,
    total = 0;
  for (const h of H) {
    const a = String(h.action || "").toLowerCase();
    const t = new Date(h.created_at);
    if (t > cutoff) break;
    if (a.includes("hold added")) on = t;
    if (a.includes("hold removed") && on) {
      total += t - on;
      on = null;
    }
  }
  if (on) total += cutoff - on;
  return total / 3_600_000;
}

function getStageEnteredAtFor(c, stage) {
  const stg = normalizeStage(stage);
  const visits = Array.isArray(c?.visits) ? c.visits : [];
  for (let i = visits.length - 1; i >= 0; i--) {
    const v = visits[i];
    const name = (v?.stage || v?.name || "").toString().toLowerCase();
    if (name.includes(stg) && v?.enteredAt) {
      const dt = new Date(v.enteredAt);
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  if (c?.stageEnteredAt) {
    const dt = new Date(c.stageEnteredAt);
    if (!isNaN(dt.getTime())) return dt;
  }
  const H = (c?.case_history || c?.history || [])
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (let i = H.length - 1; i >= 0; i--) {
    const a = String(H[i]?.action || "").toLowerCase();
    if (
      a.includes("moved to") &&
      a.includes("stage") &&
      a.includes(stg) &&
      H[i]?.created_at
    ) {
      const dt = new Date(H[i].created_at);
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  const fallback = new Date(c?.created_at || Date.now());
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

function featureVector(c, stage, entry, dueEodDate, extra = {}) {
  const mods = strSet(c.modifiers);
  const isRush = !!(
    c.priority ||
    c.rush ||
    mods.has("rush") ||
    mods.has("priority")
  );
  const allowedWH = dueEodDate ? businessHoursBetween(entry, dueEodDate) : 0;
  const hour = entry.getHours() + entry.getMinutes() / 60;
  const dpy = dowPy(entry);

  return {
    intercept: 1,
    log_allowed_wh: Math.log1p(Math.max(0, allowedWH)),
    is_rush: isRush ? 1 : 0,
    entry_hour_from8: Math.max(0, hour - 8),
    due_changes: histCountUpTo(c, (a) => a.startsWith("due changed"), entry),
    stage_moves: histCountUpTo(c, (a) => a.includes("moved"), entry),
    log_hold_hours: Math.log1p(Math.max(0, holdHoursUntil(c, entry))),
    dow_0: dpy === 0 ? 1 : 0,
    dow_1: dpy === 1 ? 1 : 0,
    dow_2: dpy === 2 ? 1 : 0,
    dow_3: dpy === 3 ? 1 : 0,
    dow_4: dpy === 4 ? 1 : 0,
    log_backlog: extra.log_backlog ?? 0,
    thin_lt6h: allowedWH < 6 ? 1 : 0,
    thin_lt12h: allowedWH < 12 ? 1 : 0,
    thin_lt18h: allowedWH < 18 ? 1 : 0,
  };
}

function dot(w, x) {
  let s = 0;
  for (const k in w) s += (w[k] || 0) * (x[k] || 0);
  return s;
}

/** ======================= DYNAMIC ETA ADJUSTMENT ======================== **/

function calculateDynamicETAExtension(
  c,
  stage,
  stageEnteredAt,
  elapsedWorkHours,
  originalTotalWorkHours,
  activeCases,
  stageStatsForStage
) {
  const now = getCurrentTime();
  const stg = normalizeStage(stage);
  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const overrunHours = Math.max(0, elapsedWorkHours - originalTotalWorkHours);

  if (overrunHours <= 0)
    return { extensionHours: 0, adjustmentReason: null, isAdjusted: false };

  const hoursIdle = timeSinceLastActivityHours(c, stageEnteredAt);
  const currentHoldHours = holdHoursUntil(c, now);
  const holdHoursSinceEntry = holdHoursUntil(c, stageEnteredAt);
  const recentHoldHours = Math.max(0, currentHoldHours - holdHoursSinceEntry);
  const entry = new Date(stageEnteredAt);
  const backlogEff = effectiveBacklog(activeCases, c, stg, entry, k);

  let extensionHours = 0;
  const reasons = [];

  if (hoursIdle >= 2) {
    extensionHours += Math.min(hoursIdle * 0.5, 8);
    reasons.push(`idle ${formatHours(hoursIdle)}`);
  }
  if (recentHoldHours > 0) {
    extensionHours += recentHoldHours * 0.8;
    reasons.push(`hold ${formatHours(recentHoldHours)}`);
  }
  if (backlogEff > 2) {
    extensionHours += (backlogEff - 2) * 0.5;
    reasons.push(`backlog ${backlogEff}`);
  }
  extensionHours += overrunHours * 0.3;
  extensionHours = Math.max(1, Math.min(extensionHours, 24));

  return {
    extensionHours,
    adjustmentReason:
      reasons.length > 0 ? reasons.join(", ") : "exceeded prediction",
    isAdjusted: true,
    overrunHours,
    factors: {
      idleTime: hoursIdle,
      recentHolds: recentHoldHours,
      backlog: backlogEff,
      overrun: overrunHours,
    },
  };
}

/** ======================= CORE PREDICTORS ======================== **/

function predictStageExitML(
  c,
  stage,
  stageEnteredAt,
  activeCases,
  stageStatsForStage
) {
  const now = getCurrentTime();
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : now;
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);
  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const backlogEff = effectiveBacklog(activeCases, c, stg, entry, k);
  const log_backlog = Math.log1p(backlogEff / Math.max(1, k));

  const x = featureVector(c, stg, entry, due, { log_backlog });
  const w = ETA_WEIGHTS[stg] || ETA_WEIGHTS.design;

  // Calculate individual feature contributions
  const featureContributions = {};
  for (const key in x) {
    featureContributions[key] = {
      value: x[key],
      weight: w[key] || 0,
      contribution: (x[key] || 0) * (w[key] || 0),
      metadata: FEATURE_METADATA[key] || {
        name: key,
        description: "Unknown feature",
        category: "model",
        icon: "?",
      },
    };
  }

  const logPrediction = dot(w, x);
  const baseTotalWorkHours = Math.max(0, Math.exp(logPrediction) - 1);
  const biasBH = ETA_BIAS_BH[stg] || 0;
  const originalTotalWorkHours = baseTotalWorkHours + biasBH;
  const elapsedWorkHours = Math.max(0, businessHoursBetween(entry, now));

  const dynamicAdjustment = calculateDynamicETAExtension(
    c,
    stg,
    stageEnteredAt,
    elapsedWorkHours,
    originalTotalWorkHours,
    activeCases,
    stageStatsForStage
  );
  const adjustedTotalWorkHours =
    originalTotalWorkHours + dynamicAdjustment.extensionHours;
  const absoluteETA = addBusinessHours(entry, adjustedTotalWorkHours);
  const remainingWorkHours = Math.max(
    0,
    businessHoursBetween(now, absoluteETA)
  );

  return {
    eta: snapToMinutes(absoluteETA, 5),
    workHours: remainingWorkHours,
    totalWorkHours: adjustedTotalWorkHours,
    originalTotalWorkHours,
    k,
    backlogEff,
    log_backlog,
    isETAAdjusted: dynamicAdjustment.isAdjusted,
    etaAdjustmentReason: dynamicAdjustment.adjustmentReason,
    etaExtensionHours: dynamicAdjustment.extensionHours,
    adjustmentFactors: dynamicAdjustment.factors,
    featureVector: x,
    featureContributions,
    modelWeights: w,
    logPrediction,
    stageBias: biasBH,
  };
}

function rescheduleDriverBump({
  slackDays,
  holdHours,
  shock,
  backlogEff,
  dueChanges,
  stageMoves,
}) {
  let bump = 0;
  if (Number.isFinite(slackDays)) {
    if (slackDays < 0) bump += 0.4;
    else if (slackDays < 0.5) bump += 0.2;
  }
  if ((holdHours || 0) >= 4) bump += 0.2;
  if ((shock || 0) > 0.6) bump += 0.25;
  else if ((shock || 0) > 0.4) bump += 0.15;
  if ((backlogEff || 0) > 3) bump += 0.1;
  if ((dueChanges || 0) + (stageMoves || 0) >= 3) bump += 0.1;
  return bump;
}

function stallBump(hoursIdle) {
  if (hoursIdle >= 36) return 0.6;
  if (hoursIdle >= 18) return 0.35;
  return 0;
}

function predictRescheduleProbML(
  c,
  stage,
  stageEnteredAt,
  activeCases,
  stageStatsForStage
) {
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : getCurrentTime();
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);
  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const backlogEff = effectiveBacklog(activeCases, c, stg, entry, k);
  const log_backlog = Math.log1p(backlogEff / Math.max(1, k));
  const x = featureVector(c, stg, entry, due, { log_backlog });
  const eph = eventsPerHourSince(c, entry, getCurrentTime());
  x.events_per_hour = eph;
  x.stalliness = Math.max(0, 1.5 - eph);
  const w = RESCHED_WEIGHTS[stg] || RESCHED_WEIGHTS.design;
  let logit = dot(w, x);
  logit = applyPriorShift(
    logit,
    clamp(RESCHED_PRIOR_TRAIN[stg] ?? 0.1, 1e-4, 1 - 1e-4),
    clamp(RESCHED_PRIOR_LIVE[stg] ?? 0.1, 1e-4, 1 - 1e-4)
  );
  const shock = shockScore(activeCases, stg, k);
  logit += 0.5 * shock;
  logit += stallBump(timeSinceLastActivityHours(c, entry));
  logit += rescheduleDriverBump({
    slackDays: c.slackDays,
    holdHours: c.holdHours || 0,
    shock,
    backlogEff,
    dueChanges: x.due_changes,
    stageMoves: x.stage_moves,
  });
  if (
    stg === "design" &&
    !(
      (c.holdHours || 0) >= 2 ||
      (c.slackDays ?? 99) < 0 ||
      (x.due_changes || 0) + (x.stage_moves || 0) >= 1
    )
  )
    logit -= 1.4;
  return sigmoid(logit);
}

function predictLateNoRescheduleProbML(
  c,
  stage,
  stageEnteredAt,
  activeCases,
  stageStatsForStage
) {
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : getCurrentTime();
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);
  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const backlogEff = effectiveBacklog(activeCases, c, stg, entry, k);
  const x = featureVector(c, stg, entry, due, {
    log_backlog: Math.log1p(backlogEff / Math.max(1, k)),
  });
  x.events_per_hour = eventsPerHourSince(c, entry, getCurrentTime());
  x.stalliness = Math.max(0, 1.5 - x.events_per_hour);
  const w = STALL_WEIGHTS[stg];
  return w ? sigmoid(dot(w, { ...x, intercept: 1 })) : 0.0;
}

function plattCalibrate(stage, p) {
  const pars = CALIB_PLATT[normalizeStage(stage)] || { a: 1, b: 0 };
  const pp = clamp(p, 1e-6, 1 - 1e-6);
  return clamp(sigmoid(pars.a * Math.log(pp / (1 - pp)) + pars.b), 0, 1);
}

function dynamicReschedThreshold(stage, probs, shock) {
  const stg = normalizeStage(stage);
  const pLive = clamp(RESCHED_PRIOR_LIVE[stg] ?? 0.05, 0.01, 0.5);
  const targetRate = clamp(pLive * (shock > 0.5 ? 2.0 : 1.25), 0.02, 0.35);
  if (!probs.length) return RESCHED_LIKELY_FLOOR[stg] ?? 0.3;
  const sorted = [...probs].sort((a, b) => a - b);
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((1 - targetRate) * sorted.length))
  );
  return Math.max(RESCHED_LIKELY_FLOOR[stg] ?? 0.3, sorted[idx]);
}

function capacityAwareStageSchedule(preds, stage, now = getCurrentTime()) {
  const stg = normalizeStage(stage);
  const k = preds[0]?.stageCapacity || STAGE_CAPACITY[stg] || 1;
  if (!preds.length) return preds;
  const jobs = preds.map((p, i) => ({
    idx: i,
    remaining: Math.max(0.25, Number(p.stageWorkHours) || 0.5),
    priority:
      (p.willBeLate ? 2 : 0) + (p.isRush ? 1 : 0) + (p.lateProbability || 0),
  }));
  jobs.sort(
    (a, b) =>
      b.priority / (b.remaining + 1e-6) - a.priority / (a.remaining + 1e-6)
  );
  const workers = Array.from({ length: k }, () => new Date(now));
  for (const j of jobs) {
    let wi = 0;
    for (let i = 1; i < k; i++) if (workers[i] < workers[wi]) wi = i;
    const start = workers[wi] > now ? workers[wi] : now;
    const finish = snapToMinutes(addBusinessHours(start, j.remaining), 5);
    preds[j.idx].capacityStart = start;
    preds[j.idx].capacityETA = finish;
    preds[j.idx].assignedWorker = wi + 1;
    preds[j.idx].queuePosition = jobs.indexOf(j) + 1;
    workers[wi] = finish;
  }
  return preds;
}

const toLevel = (p) =>
  p >= 0.85 ? "critical" : p >= 0.65 ? "high" : p >= 0.4 ? "medium" : "low";

/** ======================= MAIN PREDICTION GENERATOR ======================== **/

export async function generateCaseRiskPredictions(
  activeCases,
  throughputAnalysis,
  stage = null,
  stageStats = null,
  options = {}
) {
  const { signal } = options;
  const isCancelled = () => !!signal?.aborted;

  if (isCancelled()) return null;
  if (!activeCases || activeCases.length === 0) {
    return {
      atRisk: 0,
      predictions: [],
      urgent: [],
      summary: {
        onTrack: 0,
        atRisk: 0,
        high: 0,
        critical: 0,
        averageCompletionConfidence: 0,
        averageLateProbability: 0,
      },
      byRiskLevel: { critical: [], high: [], medium: [], low: [] },
    };
  }

  const nowTs = getCurrentTime().getTime();
  const currentStage = normalizeStage(stage || "design");
  const k = learnedCapacity(
    currentStage,
    stageStats?.stageStats?.[currentStage],
    STAGE_CAPACITY[currentStage] || 1
  );

  const predictions = [];

  for (let i = 0; i < activeCases.length; i++) {
    if (isCancelled()) return null;
    const c = activeCases[i];
    const caseType =
      c.caseType ||
      (c.modifiers?.includes?.("bbs")
        ? "bbs"
        : c.modifiers?.includes?.("flex")
        ? "flex"
        : "general");
    const stageEnteredAt = getStageEnteredAtFor(c, currentStage);
    const timeInStageMs = Math.max(
      0,
      nowTs - (stageEnteredAt?.getTime?.() || nowTs)
    );
    const mlResult = predictStageExitML(
      c,
      currentStage,
      stageEnteredAt,
      activeCases,
      stageStats?.stageStats?.[currentStage]
    );
    const expectedCompletionDate = mlResult.eta;

    // Use the corrected dueEOD function for calculations
    const dueDate = dueEOD(c.due);

    // Store the original due string for display purposes
    const dueDateDisplay = parseDueDateForDisplay(c.due);

    const isRush = !!(c?.rush || c?.priority);
    const daysUntilDue = dueDate
      ? (dueDate.getTime() - nowTs) / 86_400_000
      : Number.POSITIVE_INFINITY;
    const expectedDaysToComplete =
      (expectedCompletionDate.getTime() - nowTs) / 86_400_000;
    const willBeLate = dueDate ? expectedCompletionDate > dueDate : false;
    const slackDays = daysUntilDue - expectedDaysToComplete;
    const effectiveReqBuf = isRush
      ? Math.max(0.25, (BUFFER_REQ[currentStage] ?? 0) * 0.6)
      : BUFFER_REQ[currentStage] ?? 0;
    const slackAfterBuffer =
      (isFinite(slackDays) ? slackDays : 999) - effectiveReqBuf;

    const p_data = 0.3;
    const p_slack = sigmoid(-0.895 * slackAfterBuffer + 0.405);
    const qcLoops = histCountUpTo(
      c,
      (a) =>
        a.includes("moved to quality control") ||
        a.includes("finishing to quality control"),
      getCurrentTime()
    );
    const holdHrs = holdHoursUntil(c, getCurrentTime());
    const currentLoad = activeCases.length;
    const histAvgLoad = throughputAnalysis?.avgHistoricalActive || currentLoad;
    const ratio = histAvgLoad ? currentLoad / Math.max(1, histAvgLoad) : 1;
    const pHold = 1 - Math.exp(-Math.max(0, holdHrs) / 12);
    const pQc = clamp(qcLoops * 0.18, 0, 0.6);
    const pLoad = ratio > 1 ? clamp((ratio - 1) * 0.25, 0, 0.35) : 0;
    const p_ops = clamp(1 - (1 - pHold) * (1 - pQc) * (1 - pLoad));
    const p_base = clamp(
      1 -
        Math.pow(1 - p_data, 0.6) *
          Math.pow(1 - p_slack, 0.8) *
          Math.pow(1 - p_ops, 0.3)
    );

    c.holdHours = holdHrs;
    c.slackDays = slackDays;
    const p_reschedule = predictRescheduleProbML(
      c,
      currentStage,
      stageEnteredAt,
      activeCases,
      stageStats?.stageStats?.[currentStage]
    );
    const p_stallLate = predictLateNoRescheduleProbML(
      c,
      currentStage,
      stageEnteredAt,
      activeCases,
      stageStats?.stageStats?.[currentStage]
    );
    const reschedDiscount =
      RESCHEDULE_DISCOUNT_GAMMA * p_reschedule * (1 - p_stallLate);
    let p_final = plattCalibrate(
      currentStage,
      clamp(p_base * (1 - reschedDiscount), 0, 1)
    );

    const elapsedWorkHours = Math.max(
      0,
      businessHoursBetween(stageEnteredAt, getCurrentTime())
    );
    const progressPercent = Math.min(
      98,
      (elapsedWorkHours / Math.max(1e-6, mlResult.totalWorkHours)) * 100
    );
    const confidenceScore = 75;
    const hoursIdle = timeSinceLastActivityHours(c, stageEnteredAt);
    predictions.push({
      id: c.id,
      caseNumber: c.caseNumber || c.casenumber,
      caseType,
      currentStage,
      timeInStageMs,
      stageWorkHours: mlResult.workHours,
      totalStageWorkHours: mlResult.totalWorkHours,
      originalTotalWorkHours: mlResult.originalTotalWorkHours,
      elapsedWorkHours,
      progressPercent,
      hoursIdle,
      stageEnteredAt,
      expectedCompletionDate,
      dueDate: dueDateDisplay, // Use the display version for UI
      dueDateCalc: dueDate, // Keep the calculation version for internal use
      willBeLate,
      daysUntilDue: isFinite(daysUntilDue) ? daysUntilDue : null,
      expectedDaysToComplete,
      daysLate: willBeLate
        ? Math.max(0, expectedDaysToComplete - daysUntilDue)
        : 0,
      riskLevel: toLevel(p_final),
      confidence:
        confidenceScore >= 70
          ? "high"
          : confidenceScore >= 50
          ? "medium"
          : "low",
      confidenceScore,
      lateProbability: p_final,
      rescheduleProbability: p_reschedule,
      stallLateProbability: p_stallLate,
      riskScore: Math.round(p_final * 100),
      riskReasons: [],
      riskComponents: {
        data: p_data,
        slack: p_slack,
        ops: p_ops,
        base: p_base,
        rescheduleDiscount: reschedDiscount,
      },
      slackDays,
      slackHours: slackDays * 24,
      slackAfterBuffer,
      dueChanges: histCountUpTo(
        c,
        (a) => a.startsWith("due changed"),
        stageEnteredAt
      ),
      stageMoves: histCountUpTo(c, (a) => a.includes("moved"), stageEnteredAt),
      onHold: holdHrs > 0.1,
      holdHours: holdHrs,
      qcLoops,
      isRush,
      backlogCount: mlResult.backlogEff,
      stageCapacity: mlResult.k,
      log_backlog: mlResult.log_backlog,
      recommendation: "",
      isETAAdjusted: mlResult.isETAAdjusted,
      etaAdjustmentReason: mlResult.etaAdjustmentReason,
      etaExtensionHours: mlResult.etaExtensionHours,
      adjustmentFactors: mlResult.adjustmentFactors,
      featureVector: mlResult.featureVector,
      featureContributions: mlResult.featureContributions,
      modelWeights: mlResult.modelWeights,
      logPrediction: mlResult.logPrediction,
      stageBias: mlResult.stageBias,
    });

    if (shouldYield(i)) {
      await yieldToMainThread();
    }
  }

  if (isCancelled()) return null;

  const shock = shockScore(activeCases, currentStage, k);
  const stageThreshold = dynamicReschedThreshold(
    currentStage,
    predictions.map((p) => p.rescheduleProbability),
    shock
  );
  capacityAwareStageSchedule(predictions, currentStage, getCurrentTime());

  for (const p of predictions) {
    if (isCancelled()) return null;
    const reasons = [];
    if (p.riskComponents.slack >= 0.65)
      reasons.push(
        p.slackAfterBuffer < 0
          ? "no buffer vs stage requirement"
          : "tight buffer"
      );
    if (p.holdHours >= 8) reasons.push("long hold time");
    if (p.qcLoops > 0)
      reasons.push(`${p.qcLoops} QC loop${p.qcLoops > 1 ? "s" : ""}`);
    const drivers = [];
    if (p.slackDays < 0) drivers.push("due pressure");
    else if (p.slackDays < 0.5) drivers.push("thin buffer");
    if (p.holdHours >= 4) drivers.push("hold friction");
    if (shock > 0.6 || p.backlogCount > 3) drivers.push("load");
    if (p.dueChanges + p.stageMoves >= 3) drivers.push("churn");
    if (p.isETAAdjusted) {
      reasons.push(`ETA extended +${formatHours(p.etaExtensionHours)}`);
      drivers.push("eta adjusted");
    } else if (p.hoursIdle >= 18) drivers.push("low activity");
    if (p.rescheduleProbability >= stageThreshold)
      reasons.push(
        drivers.length
          ? `reschedule likely (${drivers.join(", ")})`
          : "reschedule likely"
      );
    if (p.backlogCount > 3)
      reasons.push(`backlog: ${Math.round(p.backlogCount)} cases ahead`);
    p.riskReasons = reasons;
    p.rescheduleThreshold = stageThreshold;
    p.shockScore = shock;
    p.rescheduleDrivers = drivers;
    p.recommendation = generateRecommendation(p, stageThreshold);
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  predictions.sort(
    (a, b) =>
      order[a.riskLevel] - order[b.riskLevel] ||
      (a.queuePosition || 1e9) - (b.queuePosition || 1e9) ||
      b.lateProbability - a.lateProbability
  );

  return {
    atRisk: predictions.filter((p) => p.riskLevel !== "low").length,
    predictions,
    urgent: predictions.filter((p) => p.riskLevel === "critical"),
    high: predictions.filter((p) => p.riskLevel === "high"),
    summary: {
      onTrack: predictions.filter((p) => !p.willBeLate && p.riskLevel === "low")
        .length,
      atRisk: predictions.filter((p) => p.riskLevel === "medium").length,
      high: predictions.filter((p) => p.riskLevel === "high").length,
      critical: predictions.filter((p) => p.riskLevel === "critical").length,
      averageCompletionConfidence: predictions.length
        ? predictions.reduce((s, p) => s + p.confidenceScore, 0) /
          predictions.length
        : 0,
      averageLateProbability: predictions.length
        ? predictions.reduce((s, p) => s + p.lateProbability, 0) /
          predictions.length
        : 0,
      averageRescheduleProbability: predictions.length
        ? predictions.reduce((s, p) => s + p.rescheduleProbability, 0) /
          predictions.length
        : 0,
      likelyReschedules: predictions.filter(
        (p) => p.rescheduleProbability >= stageThreshold
      ).length,
      averageBacklog: predictions.length
        ? predictions.reduce((s, p) => s + p.backlogCount, 0) /
          predictions.length
        : 0,
      stageCapacity: k,
      stageThreshold,
      shockScore: shock,
      adjustedETACases: predictions.filter((p) => p.isETAAdjusted).length,
    },
    byRiskLevel: {
      critical: predictions.filter((p) => p.riskLevel === "critical"),
      high: predictions.filter((p) => p.riskLevel === "high"),
      medium: predictions.filter((p) => p.riskLevel === "medium"),
      low: predictions.filter((p) => p.riskLevel === "low"),
    },
  };
}

function generateRecommendation(p, stageThreshold) {
  if (p.isETAAdjusted) {
    if (p.riskLevel === "critical" || p.riskLevel === "high")
      return `ETA extended (${p.etaAdjustmentReason}) - Immediate attention required`;
    return `ETA adjusted due to ${p.etaAdjustmentReason} - Monitor for further delays`;
  }
  if (p.backlogCount > 5)
    return p.riskLevel === "critical" || p.riskLevel === "high"
      ? "High risk with significant backlog - consider expediting"
      : "In queue with backlog - monitor for delays";
  if (p.rescheduleProbability >= stageThreshold)
    return p.riskLevel === "critical" || p.riskLevel === "high"
      ? "High risk but likely to be rescheduled"
      : "Likely reschedule - communicate expectation";
  if (p.riskLevel === "critical")
    return p.progressPercent < 50
      ? "Immediate escalation required"
      : "Urgent attention needed";
  if (p.riskLevel === "high")
    return p.isRush
      ? "Priority case at risk - reallocate resources"
      : "Monitor closely - may require intervention";
  if (p.riskLevel === "medium")
    return p.progressPercent > 75
      ? "Nearly complete but timing is tight"
      : "On track but limited buffer";
  return "On schedule - continue normal processing";
}

export const calculateRiskWithVelocityEngine = async () => ({
  predictions: [],
  velocityImpact: null,
});

/** ======================= DESIGN SYSTEM ======================== **/

const COLORS = {
  status: {
    critical: {
      primary: "#dc2626",
      light: "#fef2f2",
      border: "#fecaca",
      text: "#991b1b",
    },
    high: {
      primary: "#f59e0b",
      light: "#fffbeb",
      border: "#fde68a",
      text: "#92400e",
    },
    medium: {
      primary: "#eab308",
      light: "#fefce8",
      border: "#fef08a",
      text: "#854d0e",
    },
    low: {
      primary: "#22c55e",
      light: "#f0fdf4",
      border: "#bbf7d0",
      text: "#166534",
    },
  },
};

export const formatPercent = (value, decimals = 0) =>
  `${Math.max(0, Math.min(100, Number(value) || 0)).toFixed(decimals)}%`;

export const formatHours = (hours) => {
  if (!Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

const formatRelativeTime = (date, reference = new Date()) => {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";

  const diffMs = d - reference;
  const isPast = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const hours = absMs / 3600000;
  const days = hours / 24;

  let text;
  if (hours < 1) text = "< 1h";
  else if (hours < 24) text = `${Math.round(hours)}h`;
  else if (days < 7) text = `${Math.round(days)}d`;
  else text = `${Math.round(days / 7)}w`;

  return isPast ? `${text} ago` : `in ${text}`;
};

const getStatusFromPrediction = (p) => {
  const now = new Date();
  const dueDate = p.dueDate ? new Date(p.dueDate) : null;
  const isOverdue = dueDate && dueDate < now;

  if (isOverdue) return "critical";
  if (p.willBeLate) {
    if (p.riskLevel === "low") return "medium";
    if (p.riskLevel === "medium") return "high";
    return "critical";
  }
  return p.riskLevel;
};

/** ======================= ICON COMPONENTS ======================== **/

const Icons = {
  ChevronDown: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  ),
  Clock: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  AlertTriangle: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  ),
  CheckCircle: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  XCircle: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  Info: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  Activity: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <polyline points="22,12 18,12 15,21 9,3 6,12 2,12" />
    </svg>
  ),
  Zap: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  ),
  Pause: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  RefreshCw: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  ),
  X: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  Search: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  ),
  Filter: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
      />
    </svg>
  ),
  BarChart: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
      />
    </svg>
  ),
  Target: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Brain: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  ),
  Expand: ({ className }) => (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  ),
};

/** ======================= REUSABLE UI COMPONENTS ======================== **/

const StatusBadge = ({ status, size = "md" }) => {
  const colors = COLORS.status[status] || COLORS.status.low;
  const sizes = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-xs",
    lg: "px-3 py-1.5 text-sm",
  };

  return (
    <span
      className={`inline-flex items-center font-semibold uppercase tracking-wide rounded-md ${sizes[size]}`}
      style={{
        backgroundColor: colors.light,
        color: colors.text,
        border: `1px solid ${colors.border}`,
      }}
    >
      {status}
    </span>
  );
};

const ProgressBar = ({ value, size = "md", color = "auto" }) => {
  const heights = { sm: "h-1", md: "h-2", lg: "h-3" };
  const percent = Math.max(0, Math.min(100, value || 0));

  let barColor;
  if (color === "auto") {
    barColor =
      percent > 75
        ? "#22c55e"
        : percent > 50
        ? "#3b82f6"
        : percent > 25
        ? "#f59e0b"
        : "#dc2626";
  } else {
    barColor = color;
  }

  return (
    <div
      className={`w-full bg-gray-100 rounded-full overflow-hidden ${heights[size]}`}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${percent}%`, backgroundColor: barColor }}
      />
    </div>
  );
};

/** ======================= NEURAL NETWORK VISUALIZATION ======================== **/

const NeuralNetworkVisualization = ({
  featureContributions,
  modelWeights,
  logPrediction,
  stageBias,
  currentStage,
}) => {
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const groupedFeatures = useMemo(() => {
    const groups = {};
    Object.entries(featureContributions || {}).forEach(([key, data]) => {
      const category = data.metadata?.category || "other";
      if (!groups[category]) groups[category] = [];
      groups[category].push({ key, ...data });
    });
    return groups;
  }, [featureContributions]);

  const maxContribution = useMemo(() => {
    if (!featureContributions) return 1;
    return Math.max(
      ...Object.values(featureContributions).map((f) =>
        Math.abs(f.contribution)
      ),
      0.1
    );
  }, [featureContributions]);

  const totalSum = useMemo(() => {
    if (!featureContributions) return 0;
    return Object.values(featureContributions).reduce(
      (sum, f) => sum + f.contribution,
      0
    );
  }, [featureContributions]);

  const categoryOrder = [
    "urgency",
    "time",
    "priority",
    "capacity",
    "history",
    "blockers",
    "timing",
    "model",
  ];
  const sortedCategories = categoryOrder.filter((c) => groupedFeatures[c]);

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 relative overflow-hidden">
      {/* Background grid */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.3) 1px, transparent 0)`,
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-xl">
            <Icons.Brain className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">
              Neural Feature Analysis
            </h3>
            <p className="text-sm text-slate-400">
              Real-time model activation for {currentStage} stage
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold text-white">
            {logPrediction?.toFixed(3) || "—"}
          </div>
          <div className="text-xs text-slate-400">Log Prediction</div>
        </div>
      </div>

      {/* Network Visualization */}
      <div className="relative flex items-stretch gap-4">
        {/* Input Layer */}
        <div className="flex-1 space-y-3">
          {sortedCategories.map((category) => {
            const features = groupedFeatures[category];
            const categoryColor =
              CATEGORY_COLORS[category] || CATEGORY_COLORS.model;

            return (
              <div key={category} className="relative">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 pl-2">
                  {category}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {features.map(
                    ({ key, value, weight, contribution, metadata }) => {
                      const isActive = Math.abs(value) > 0.001;
                      const activationLevel =
                        Math.abs(contribution) / maxContribution;
                      const isPositive = contribution > 0;
                      const isHovered = hoveredNode === key;
                      const isSelected = selectedNode === key;

                      return (
                        <motion.div
                          key={key}
                          className={`relative rounded-xl p-3 cursor-pointer transition-all ${
                            isSelected ? "ring-2 ring-blue-400" : ""
                          }`}
                          style={{
                            backgroundColor: isActive
                              ? categoryColor.bg
                              : "rgba(30, 41, 59, 0.5)",
                            borderWidth: 2,
                            borderColor: isActive
                              ? categoryColor.border
                              : "rgba(71, 85, 105, 0.3)",
                            boxShadow:
                              isActive && activationLevel > 0.3
                                ? `0 0 ${20 * activationLevel}px ${
                                    categoryColor.glow
                                  }40`
                                : "none",
                          }}
                          onMouseEnter={() => setHoveredNode(key)}
                          onMouseLeave={() => setHoveredNode(null)}
                          onClick={() =>
                            setSelectedNode(selectedNode === key ? null : key)
                          }
                          animate={{ scale: isHovered ? 1.02 : 1 }}
                          transition={{ duration: 0.15 }}
                        >
                          {isActive && activationLevel > 0.2 && (
                            <motion.div
                              className="absolute inset-0 rounded-xl"
                              style={{ backgroundColor: categoryColor.glow }}
                              animate={{ opacity: [0.1, 0.2, 0.1] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}

                          <div className="relative">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{metadata.icon}</span>
                                <span
                                  className={`text-sm font-medium ${
                                    isActive
                                      ? "text-slate-900"
                                      : "text-slate-500"
                                  }`}
                                >
                                  {metadata.name}
                                </span>
                              </div>
                              {isActive && (
                                <div
                                  className={`w-2 h-2 rounded-full ${
                                    isPositive ? "bg-red-500" : "bg-green-500"
                                  }`}
                                  style={{
                                    boxShadow: `0 0 8px ${
                                      isPositive ? "#ef4444" : "#22c55e"
                                    }`,
                                  }}
                                />
                              )}
                            </div>

                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-mono ${
                                  isActive ? "text-slate-700" : "text-slate-600"
                                }`}
                              >
                                {value.toFixed(3)}
                              </span>
                              <span
                                className={`text-xs font-mono font-semibold ${
                                  isPositive
                                    ? "text-red-600"
                                    : contribution < 0
                                    ? "text-green-600"
                                    : "text-slate-500"
                                }`}
                              >
                                {contribution > 0 ? "+" : ""}
                                {contribution.toFixed(3)}
                              </span>
                            </div>

                            {isActive && (
                              <div className="mt-2 h-1 bg-slate-300 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{
                                    backgroundColor: isPositive
                                      ? "#ef4444"
                                      : "#22c55e",
                                  }}
                                  initial={{ width: 0 }}
                                  animate={{
                                    width: `${activationLevel * 100}%`,
                                  }}
                                  transition={{
                                    duration: 0.5,
                                    ease: "easeOut",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    }
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Central processing */}
        <div className="w-32 flex flex-col items-center justify-center relative">
          <div className="space-y-4">
            <motion.div
              className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg"
              style={{ boxShadow: "0 0 30px rgba(59, 130, 246, 0.4)" }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <span className="text-2xl">🧠</span>
            </motion.div>
            <div className="text-center">
              <div className="text-xs text-slate-400">Weighted Sum</div>
              <div className="text-sm font-mono font-bold text-white">
                {totalSum.toFixed(3)}
              </div>
            </div>
          </div>
        </div>

        {/* Output Layer */}
        <div className="w-48 flex flex-col justify-center">
          <div className="bg-slate-800 rounded-2xl p-4 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">
              Model Output
            </div>

            <div className="space-y-3">
              <div className="bg-slate-700/50 rounded-xl p-3">
                <div className="text-xs text-slate-400">Raw Prediction</div>
                <div className="text-lg font-mono font-bold text-white">
                  {logPrediction?.toFixed(4)}
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-xl p-3">
                <div className="text-xs text-slate-400">Stage Bias</div>
                <div className="text-lg font-mono font-bold text-blue-400">
                  +{stageBias?.toFixed(4)}
                </div>
              </div>

              <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl p-3 border border-blue-500/30">
                <div className="text-xs text-slate-300">Final ETA (hours)</div>
                <div className="text-xl font-mono font-bold text-white">
                  {(
                    Math.exp(logPrediction || 0) -
                    1 +
                    (stageBias || 0)
                  ).toFixed(2)}
                  h
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selected Node Detail */}
      <AnimatePresence>
        {selectedNode && featureContributions?.[selectedNode] && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-4 bg-slate-800 rounded-xl p-4 border border-slate-700"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">
                  {featureContributions[selectedNode].metadata.icon}
                </span>
                <div>
                  <h4 className="text-white font-semibold">
                    {featureContributions[selectedNode].metadata.name}
                  </h4>
                  <p className="text-sm text-slate-400">
                    {featureContributions[selectedNode].metadata.description}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-white"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-4 mt-4">
              <div className="bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-400">Input Value</div>
                <div className="text-lg font-mono font-bold text-white">
                  {featureContributions[selectedNode].value.toFixed(4)}
                </div>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-400">Model Weight</div>
                <div className="text-lg font-mono font-bold text-blue-400">
                  {featureContributions[selectedNode].weight.toFixed(4)}
                </div>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-400">Contribution</div>
                <div
                  className={`text-lg font-mono font-bold ${
                    featureContributions[selectedNode].contribution > 0
                      ? "text-red-400"
                      : "text-green-400"
                  }`}
                >
                  {featureContributions[selectedNode].contribution > 0
                    ? "+"
                    : ""}
                  {featureContributions[selectedNode].contribution.toFixed(4)}
                </div>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-400">Impact</div>
                <div className="text-lg font-bold text-white">
                  {(
                    (Math.abs(featureContributions[selectedNode].contribution) /
                      maxContribution) *
                    100
                  ).toFixed(1)}
                  %
                </div>
              </div>
            </div>

            {featureContributions[selectedNode].metadata.interpret && (
              <div className="mt-3 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="text-sm text-blue-300">
                  💡{" "}
                  {featureContributions[selectedNode].metadata.interpret(
                    featureContributions[selectedNode].value
                  ) || "No specific interpretation"}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full bg-red-500"
            style={{ boxShadow: "0 0 8px #ef4444" }}
          />
          <span>Increases ETA (risk)</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full bg-green-500"
            style={{ boxShadow: "0 0 8px #22c55e" }}
          />
          <span>Decreases ETA (favorable)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-slate-600" />
          <span>Inactive / Zero</span>
        </div>
      </div>
    </div>
  );
};

/** ======================= COMPACT CASE ROW ======================== **/

const CompactCaseRow = ({ prediction, onOpenAnalytics }) => {
  const status = getStatusFromPrediction(prediction);
  const colors = COLORS.status[status];
  const now = new Date();
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : null;
  const isOverdue = dueDate && dueDate < now;

  const getTimeDisplay = () => {
    if (isOverdue)
      return {
        primary: "OVERDUE",
        secondary: formatRelativeTime(dueDate),
        color: colors.primary,
        urgent: true,
      };
    if (prediction.willBeLate) {
      const lateBy = formatHours(prediction.daysLate * 24);
      return {
        primary: `Late by ${lateBy}`,
        secondary: `Due ${formatRelativeTime(dueDate)}`,
        color: colors.primary,
        urgent: true,
      };
    }
    return {
      primary: formatRelativeTime(dueDate),
      secondary:
        prediction.slackDays > 0
          ? `${formatHours(prediction.slackDays * 24)} buffer`
          : "On time",
      color: colors.primary,
      urgent: false,
    };
  };

  const timeDisplay = getTimeDisplay();

  return (
    <motion.div layout className="group">
      <div className="relative bg-white rounded-xl border border-gray-200 transition-all hover:shadow-md hover:border-gray-300 overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
          style={{ backgroundColor: colors.primary }}
        />

        <div className="pl-4 pr-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 w-44">
              <div>
                <div className="font-mono text-base font-bold text-gray-900">
                  {prediction.caseNumber}
                </div>
                <div className="text-xs text-gray-500 capitalize">
                  {prediction.caseType}
                </div>
              </div>
            </div>

            <div className="w-24">
              <StatusBadge status={status} />
            </div>

            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div
                  className={`text-lg font-bold ${
                    timeDisplay.urgent ? "" : "text-gray-900"
                  }`}
                  style={timeDisplay.urgent ? { color: timeDisplay.color } : {}}
                >
                  {timeDisplay.primary}
                </div>
                <div className="text-xs text-gray-500">
                  {timeDisplay.secondary}
                </div>
              </div>
            </div>

            <div className="w-32">
              <div className="flex items-center gap-2">
                <ProgressBar value={prediction.progressPercent} size="sm" />
                <span className="text-xs font-medium text-gray-600 w-10">
                  {formatPercent(prediction.progressPercent)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 w-32 justify-end">
              {prediction.isRush && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded flex items-center gap-1">
                  <Icons.Zap className="w-3 h-3" />
                  RUSH
                </span>
              )}
              {prediction.onHold && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded flex items-center gap-1">
                  <Icons.Pause className="w-3 h-3" />
                  HOLD
                </span>
              )}
              {prediction.isETAAdjusted && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded flex items-center gap-1">
                  <Icons.RefreshCw className="w-3 h-3" />
                  ADJ
                </span>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenAnalytics();
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors group/btn"
            >
              <Icons.Expand className="w-5 h-5 text-gray-400 group-hover/btn:text-blue-500" />
            </button>
          </div>
        </div>

        <div className="h-0.5 bg-gray-100">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${prediction.progressPercent}%`,
              backgroundColor: colors.primary,
            }}
          />
        </div>
      </div>
    </motion.div>
  );
};

/** ======================= ANALYTICS MODAL ======================== **/

const AnalyticsModal = ({ prediction, open, onClose, onOpenHistory }) => {
  const [activeTab, setActiveTab] = useState("overview");

  if (!open || !prediction) return null;

  const status = getStatusFromPrediction(prediction);
  const colors = COLORS.status[status];
  const now = new Date();
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : null;
  const isOverdue = dueDate && dueDate < now;

  const tabs = [
    { id: "overview", label: "Overview", icon: Icons.Target },
    { id: "timeline", label: "Timeline", icon: Icons.Clock },
    { id: "risk", label: "Risk Analysis", icon: Icons.AlertTriangle },
    { id: "neural", label: "Neural View", icon: Icons.Brain },
    { id: "data", label: "Raw Data", icon: Icons.BarChart },
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-none px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div
                  className="p-3 rounded-xl"
                  style={{ backgroundColor: colors.light }}
                >
                  <div
                    className="text-2xl font-mono font-bold"
                    style={{ color: colors.text }}
                  >
                    {prediction.caseNumber}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} size="lg" />
                    {prediction.isRush && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">
                        RUSH
                      </span>
                    )}
                    {prediction.isETAAdjusted && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                        ETA ADJUSTED
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {prediction.currentStage} stage •{" "}
                    {formatPercent(prediction.progressPercent)} complete
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Icons.X className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            {/* Recommendation */}
            <div
              className="mt-4 p-4 rounded-xl"
              style={{
                backgroundColor: colors.light,
                borderLeft: `4px solid ${colors.primary}`,
              }}
            >
              <div className="flex items-start gap-3">
                {status === "critical" ? (
                  <Icons.XCircle
                    className="w-5 h-5 mt-0.5"
                    style={{ color: colors.text }}
                  />
                ) : status === "high" ? (
                  <Icons.AlertTriangle
                    className="w-5 h-5 mt-0.5"
                    style={{ color: colors.text }}
                  />
                ) : status === "low" ? (
                  <Icons.CheckCircle
                    className="w-5 h-5 mt-0.5"
                    style={{ color: colors.text }}
                  />
                ) : (
                  <Icons.Info
                    className="w-5 h-5 mt-0.5"
                    style={{ color: colors.text }}
                  />
                )}
                <div>
                  <div className="font-semibold" style={{ color: colors.text }}>
                    Recommendation
                  </div>
                  <div className="text-sm mt-1" style={{ color: colors.text }}>
                    {prediction.recommendation}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-none border-b border-gray-200 px-6 bg-gray-50">
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600 bg-white"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  } rounded-t-lg`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            <AnimatePresence mode="wait">
              {activeTab === "overview" && (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div
                      className={`rounded-xl p-4 border ${
                        prediction.riskScore >= 65
                          ? "bg-red-50 border-red-200"
                          : prediction.riskScore >= 40
                          ? "bg-amber-50 border-amber-200"
                          : "bg-green-50 border-green-200"
                      }`}
                    >
                      <div className="text-xs text-gray-500 uppercase tracking-wide">
                        Risk Score
                      </div>
                      <div
                        className="text-3xl font-bold mt-1"
                        style={{ color: colors.text }}
                      >
                        {prediction.riskScore}
                      </div>
                    </div>
                    <div className="rounded-xl p-4 bg-white border border-gray-200">
                      <div className="text-xs text-gray-500 uppercase tracking-wide">
                        Time Remaining
                      </div>
                      <div className="text-3xl font-bold mt-1 text-gray-900">
                        {formatHours(prediction.stageWorkHours)}
                      </div>
                    </div>
                    <div
                      className={`rounded-xl p-4 border ${
                        prediction.slackDays < 0
                          ? "bg-red-50 border-red-200"
                          : "bg-green-50 border-green-200"
                      }`}
                    >
                      <div className="text-xs text-gray-500 uppercase tracking-wide">
                        Buffer
                      </div>
                      <div
                        className={`text-3xl font-bold mt-1 ${
                          prediction.slackDays < 0
                            ? "text-red-600"
                            : "text-green-600"
                        }`}
                      >
                        {prediction.slackDays >= 0
                          ? formatHours(prediction.slackDays * 24)
                          : `−${formatHours(
                              Math.abs(prediction.slackDays) * 24
                            )}`}
                      </div>
                    </div>
                    <div className="rounded-xl p-4 bg-white border border-gray-200">
                      <div className="text-xs text-gray-500 uppercase tracking-wide">
                        Queue Position
                      </div>
                      <div className="text-3xl font-bold mt-1 text-gray-900">
                        #{prediction.queuePosition || 1}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Operational Metrics
                      </h4>
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-900">
                            {prediction.stageMoves}
                          </div>
                          <div className="text-xs text-gray-500">
                            Stage Moves
                          </div>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-900">
                            {prediction.dueChanges}
                          </div>
                          <div className="text-xs text-gray-500">
                            Due Changes
                          </div>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-900">
                            {prediction.qcLoops}
                          </div>
                          <div className="text-xs text-gray-500">QC Loops</div>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-gray-900">
                            {formatHours(prediction.holdHours)}
                          </div>
                          <div className="text-xs text-gray-500">Hold Time</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Activity Status
                      </h4>
                      <div
                        className={`p-4 rounded-xl ${
                          prediction.hoursIdle >= 18
                            ? "bg-amber-50 border border-amber-200"
                            : "bg-green-50 border border-green-200"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-gray-600">
                              Last Activity
                            </div>
                            <div
                              className={`text-xl font-bold ${
                                prediction.hoursIdle >= 18
                                  ? "text-amber-600"
                                  : "text-green-600"
                              }`}
                            >
                              {prediction.hoursIdle < 1
                                ? "Active now"
                                : `${formatHours(prediction.hoursIdle)} ago`}
                            </div>
                          </div>
                          <Icons.Activity
                            className={`w-8 h-8 ${
                              prediction.hoursIdle >= 18
                                ? "text-amber-400"
                                : "text-green-400"
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "timeline" && (
                <motion.div
                  key="timeline"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Case Timeline
                      </h4>
                      <div className="relative pl-8 space-y-6">
                        <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gray-200" />

                        {[
                          {
                            label: "Stage Entry",
                            time: formatDate(prediction.stageEnteredAt, {
                              dayTime: true,
                            }),
                            color: "#3b82f6",
                            active: true,
                          },
                          {
                            label: "Current",
                            time: formatDate(now, { dayTime: true }),
                            color: "#8b5cf6",
                            active: true,
                            badge: `${formatHours(
                              prediction.elapsedWorkHours
                            )} elapsed`,
                          },
                          {
                            label: prediction.isETAAdjusted
                              ? "Adjusted ETA"
                              : "Predicted ETA",
                            time: formatDate(
                              prediction.expectedCompletionDate,
                              { dayTime: true }
                            ),
                            color: prediction.willBeLate
                              ? "#f59e0b"
                              : "#22c55e",
                            badge: prediction.isETAAdjusted
                              ? `+${formatHours(prediction.etaExtensionHours)}`
                              : null,
                          },
                          {
                            label: "Due Date",
                            time: formatDate(dueDate, { dayTime: true }),
                            color: isOverdue
                              ? "#dc2626"
                              : prediction.willBeLate
                              ? "#f59e0b"
                              : "#22c55e",
                            badge: isOverdue ? "OVERDUE" : null,
                          },
                        ].map((event, idx) => (
                          <div
                            key={idx}
                            className="relative flex items-start gap-4"
                          >
                            <div
                              className="absolute -left-5 w-4 h-4 rounded-full border-4 border-white"
                              style={{
                                backgroundColor: event.color,
                                boxShadow: event.active
                                  ? `0 0 0 4px ${event.color}20`
                                  : undefined,
                              }}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {event.label}
                                </span>
                                {event.badge && (
                                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                    {event.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">
                                {event.time}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-semibold text-gray-900 mb-4">
                          Time Breakdown
                        </h4>
                        <div className="space-y-3">
                          {[
                            {
                              label: "Stage Entry",
                              value: formatDate(prediction.stageEnteredAt, {
                                dayTime: true,
                              }),
                            },
                            {
                              label: "Time in Stage",
                              value: formatHours(prediction.elapsedWorkHours),
                            },
                            {
                              label: "Original Estimate",
                              value: formatHours(
                                prediction.originalTotalWorkHours
                              ),
                            },
                            prediction.isETAAdjusted && {
                              label: "Extension Added",
                              value: `+${formatHours(
                                prediction.etaExtensionHours
                              )}`,
                              highlight: true,
                            },
                            prediction.isETAAdjusted && {
                              label: "Adjusted Total",
                              value: formatHours(
                                prediction.totalStageWorkHours
                              ),
                              highlight: true,
                            },
                            {
                              label: "Remaining Work",
                              value: formatHours(prediction.stageWorkHours),
                            },
                            {
                              label: "Expected Exit",
                              value: formatDate(
                                prediction.expectedCompletionDate,
                                { dayTime: true }
                              ),
                            },
                            {
                              label: "Due Date",
                              value: formatDate(dueDate, { dayTime: true }),
                            },
                          ]
                            .filter(Boolean)
                            .map((row, idx) => (
                              <div
                                key={idx}
                                className={`flex justify-between items-center py-2 ${
                                  row.highlight
                                    ? "bg-blue-50 -mx-2 px-2 rounded"
                                    : ""
                                }`}
                              >
                                <span className="text-sm text-gray-600">
                                  {row.label}
                                </span>
                                <span
                                  className={`text-sm font-mono font-semibold ${
                                    row.highlight
                                      ? "text-blue-700"
                                      : "text-gray-900"
                                  }`}
                                >
                                  {row.value}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>

                      {prediction.isETAAdjusted &&
                        prediction.adjustmentFactors && (
                          <div className="bg-blue-50 rounded-xl border border-blue-200 p-5">
                            <h4 className="text-sm font-semibold text-blue-900 mb-3">
                              ETA Adjustment Factors
                            </h4>
                            <div className="space-y-2 text-sm">
                              {prediction.adjustmentFactors.idleTime >= 2 && (
                                <div className="flex justify-between">
                                  <span className="text-blue-700">
                                    Idle Time
                                  </span>
                                  <span className="font-mono text-blue-900">
                                    {formatHours(
                                      prediction.adjustmentFactors.idleTime
                                    )}
                                  </span>
                                </div>
                              )}
                              {prediction.adjustmentFactors.recentHolds > 0 && (
                                <div className="flex justify-between">
                                  <span className="text-blue-700">
                                    Hold Time
                                  </span>
                                  <span className="font-mono text-blue-900">
                                    {formatHours(
                                      prediction.adjustmentFactors.recentHolds
                                    )}
                                  </span>
                                </div>
                              )}
                              {prediction.adjustmentFactors.backlog > 2 && (
                                <div className="flex justify-between">
                                  <span className="text-blue-700">Backlog</span>
                                  <span className="font-mono text-blue-900">
                                    {prediction.adjustmentFactors.backlog} cases
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "risk" && (
                <motion.div
                  key="risk"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="grid grid-cols-3 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Risk Score
                      </h4>
                      <div className="flex items-center justify-center mb-4">
                        <div className="relative w-32 h-32">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="64"
                              cy="64"
                              r="56"
                              fill="none"
                              stroke="#e5e7eb"
                              strokeWidth="12"
                            />
                            <circle
                              cx="64"
                              cy="64"
                              r="56"
                              fill="none"
                              stroke={colors.primary}
                              strokeWidth="12"
                              strokeDasharray={`${
                                prediction.riskScore * 3.52
                              } 352`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span
                              className="text-3xl font-bold"
                              style={{ color: colors.text }}
                            >
                              {prediction.riskScore}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {[
                          {
                            label: "Slack",
                            value: prediction.riskComponents.slack,
                          },
                          {
                            label: "Operations",
                            value: prediction.riskComponents.ops,
                          },
                          {
                            label: "Data",
                            value: prediction.riskComponents.data,
                          },
                        ].map(({ label, value }) => (
                          <div key={label}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">{label}</span>
                              <span className="font-mono">
                                {formatPercent(value * 100)}
                              </span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gray-400 rounded-full"
                                style={{ width: `${value * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Probabilities
                      </h4>
                      <div className="space-y-4">
                        {[
                          {
                            label: "Late Probability",
                            value: prediction.lateProbability,
                            color: colors.primary,
                          },
                          {
                            label: "Reschedule Prob",
                            value: prediction.rescheduleProbability,
                            color: "#ec4899",
                          },
                          {
                            label: "Stall Risk",
                            value: prediction.stallLateProbability || 0,
                            color: "#f59e0b",
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-600">{label}</span>
                              <span
                                className="font-mono font-semibold"
                                style={{ color }}
                              >
                                {formatPercent(value * 100, 1)}
                              </span>
                            </div>
                            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${value * 100}%`,
                                  backgroundColor: color,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Risk Factors
                      </h4>
                      <div className="space-y-2">
                        {prediction.riskReasons.length > 0 ? (
                          prediction.riskReasons.map((reason, idx) => (
                            <div
                              key={idx}
                              className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg"
                            >
                              <div className="w-2 h-2 rounded-full bg-amber-500" />
                              <span className="text-sm text-amber-800">
                                {reason}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-gray-500 text-center py-4">
                            No significant risk factors
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "neural" && (
                <motion.div
                  key="neural"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <NeuralNetworkVisualization
                    featureContributions={prediction.featureContributions}
                    modelWeights={prediction.modelWeights}
                    logPrediction={prediction.logPrediction}
                    stageBias={prediction.stageBias}
                    currentStage={prediction.currentStage}
                  />
                </motion.div>
              )}

              {activeTab === "data" && (
                <motion.div
                  key="data"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Feature Vector
                      </h4>
                      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                        {prediction.featureVector &&
                          Object.entries(prediction.featureVector).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between py-1 px-2 bg-gray-50 rounded"
                              >
                                <span className="text-gray-500 truncate">
                                  {key}
                                </span>
                                <span className="text-gray-900">
                                  {typeof value === "number"
                                    ? value.toFixed(4)
                                    : value}
                                </span>
                              </div>
                            )
                          )}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">
                        Model Weights ({prediction.currentStage})
                      </h4>
                      <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                        {prediction.modelWeights &&
                          Object.entries(prediction.modelWeights).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex justify-between py-1 px-2 bg-gray-50 rounded"
                              >
                                <span className="text-gray-500 truncate">
                                  {key}
                                </span>
                                <span
                                  className={
                                    value > 0
                                      ? "text-red-600"
                                      : value < 0
                                      ? "text-green-600"
                                      : "text-gray-900"
                                  }
                                >
                                  {typeof value === "number"
                                    ? value.toFixed(4)
                                    : value}
                                </span>
                              </div>
                            )
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 bg-gray-900 rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-white mb-3">
                      Raw Prediction Data
                    </h4>
                    <pre className="text-xs font-mono text-gray-300 overflow-auto max-h-64">
                      {JSON.stringify(prediction, null, 2)}
                    </pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="flex-none px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <button
                onClick={() => onOpenHistory?.()}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                View Case History
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

/** ======================= MAIN MODAL COMPONENT ======================== **/

export function CaseRiskModal({
  open,
  onClose,
  predictions = [],
  stage,
  onOpenCaseHistory,
  onDataProcessed,
}) {
  const [query, setQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("risk");
  const [selectedPrediction, setSelectedPrediction] = useState(null);

  const processedPredictions = useMemo(() => {
    let filtered = [...predictions];

    if (filterStatus !== "all") {
      filtered = filtered.filter(
        (p) => getStatusFromPrediction(p) === filterStatus
      );
    }

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.caseNumber?.toLowerCase().includes(q) ||
          p.caseType?.toLowerCase().includes(q)
      );
    }

    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => {
      if (sortBy === "risk") {
        return (
          order[getStatusFromPrediction(a)] -
            order[getStatusFromPrediction(b)] ||
          b.lateProbability - a.lateProbability
        );
      }
      if (sortBy === "due") {
        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return aDue - bDue;
      }
      if (sortBy === "progress") return a.progressPercent - b.progressPercent;
      return 0;
    });

    return filtered;
  }, [predictions, filterStatus, query, sortBy]);

  const summary = useMemo(
    () => ({
      total: predictions.length,
      critical: predictions.filter(
        (p) => getStatusFromPrediction(p) === "critical"
      ).length,
      high: predictions.filter((p) => getStatusFromPrediction(p) === "high")
        .length,
      medium: predictions.filter((p) => getStatusFromPrediction(p) === "medium")
        .length,
      low: predictions.filter((p) => getStatusFromPrediction(p) === "low")
        .length,
      adjustedETACases: predictions.filter((p) => p.isETAAdjusted).length,
      likelyReschedules: predictions.filter(
        (p) => p.rescheduleProbability >= (p.rescheduleThreshold ?? 0.5)
      ).length,
      avgRisk: predictions.length
        ? (predictions.reduce((s, p) => s + p.lateProbability, 0) /
            predictions.length) *
          100
        : 0,
      stageCapacity: predictions[0]?.stageCapacity || 1,
    }),
    [predictions]
  );

  useEffect(() => {
    onDataProcessed?.({
      processedPredictions,
      summary,
      stage,
      filterStatus,
      query,
      rawPredictions: predictions,
    });
  }, [
    processedPredictions,
    summary,
    stage,
    filterStatus,
    query,
    predictions,
    onDataProcessed,
  ]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex-none px-6 py-5 bg-white border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Case Risk Analysis
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-medium capitalize">{stage}</span> Stage
                  • {summary.total} cases • Avg Risk:{" "}
                  {formatPercent(summary.avgRisk, 1)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Icons.X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-6 gap-3 mt-4">
              {Object.entries({
                critical: summary.critical,
                high: summary.high,
                medium: summary.medium,
                low: summary.low,
              }).map(([status, count]) => {
                const colors = COLORS.status[status];
                const isActive = filterStatus === status;
                return (
                  <button
                    key={status}
                    onClick={() =>
                      setFilterStatus(filterStatus === status ? "all" : status)
                    }
                    className={`rounded-xl p-3 border-2 transition-all ${
                      isActive ? "scale-105 shadow-md" : "hover:shadow-sm"
                    }`}
                    style={{
                      backgroundColor: colors.light,
                      borderColor: isActive ? colors.primary : colors.border,
                    }}
                  >
                    <div
                      className="text-2xl font-bold"
                      style={{ color: colors.text }}
                    >
                      {count}
                    </div>
                    <div
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: colors.text }}
                    >
                      {status}
                    </div>
                  </button>
                );
              })}
              <div className="rounded-xl p-3 bg-blue-50 border-2 border-blue-200">
                <div className="text-2xl font-bold text-blue-700">
                  {summary.adjustedETACases}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Adjusted
                </div>
              </div>
              <div className="rounded-xl p-3 bg-pink-50 border-2 border-pink-200">
                <div className="text-2xl font-bold text-pink-700">
                  {summary.likelyReschedules}
                </div>
                <div className="text-xs font-semibold uppercase tracking-wide text-pink-700">
                  Resched
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mt-4">
              <div className="relative flex-1 max-w-sm">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search cases..."
                  className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="risk">Sort by Risk</option>
                <option value="due">Sort by Due Date</option>
                <option value="progress">Sort by Progress</option>
              </select>

              {filterStatus !== "all" && (
                <button
                  onClick={() => setFilterStatus("all")}
                  className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Clear Filter
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {processedPredictions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Icons.Search className="w-16 h-16 text-gray-300 mb-4" />
                <p className="text-lg font-semibold text-gray-600">
                  No cases found
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Try adjusting your search or filters
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {processedPredictions.map((prediction) => (
                  <CompactCaseRow
                    key={prediction.id || prediction.caseNumber}
                    prediction={prediction}
                    onOpenAnalytics={() => setSelectedPrediction(prediction)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-none px-6 py-3 bg-white border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>
                Showing {processedPredictions.length} of {predictions.length}{" "}
                cases
              </span>
              <span>Capacity: {summary.stageCapacity} workers</span>
            </div>
          </div>
        </motion.div>

        {/* Analytics Modal */}
        <AnalyticsModal
          prediction={selectedPrediction}
          open={!!selectedPrediction}
          onClose={() => setSelectedPrediction(null)}
          onOpenHistory={() => {
            if (selectedPrediction) {
              onOpenCaseHistory?.(
                selectedPrediction.id,
                selectedPrediction.caseNumber
              );
            }
          }}
        />
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

/** ======================= STANDALONE EXPORTS ======================== **/

export const StandaloneCompactRow = CompactCaseRow;
export const StandaloneAnalyticsModal = AnalyticsModal;
export const NeuralFeatureVisualization = NeuralNetworkVisualization;
export { StatusBadge, ProgressBar, COLORS };
