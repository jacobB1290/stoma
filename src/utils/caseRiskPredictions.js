// /src/utils/caseRiskPredictions.js
// =================================================================
// v8 — Unified Quantile Prediction System
// =================================================================
// ALL outputs derived from trained models. Zero hand-tuned constants.
//
// Per case, per stage, the system produces:
//   • Stage exit range    p10 / p50 / p75 / p90  (hours until this stage completes)
//   • Completion range    p10 / p50 / p75 / p90  (hours until case is fully done)
//   • P(reschedule)       probability the due date moves
//
// From those model outputs we derive (via comparison, not formulas):
//   • Risk level          where the due date falls in the total completion range
//   • Buffer              due_date − total_p50
//   • Confidence          how tight p10→p90 is
//   • P(late)             interpolated from the quantile range vs due date
//
// SETUP
//   1. Place xgb_v8_final.json in /public
//   2. Import { loadModels, generateCaseRiskPredictions, CaseRiskAnalyticsModal }
//   3. Call loadModels() once at app init (returns a Promise)
//
// 108 features. 5,920 trees. ~2.4 MB gzipped.
// =================================================================

import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  AlertCircle,
  TrendingUp,
  Clock,
  Activity,
  Sparkles,
  ChevronRight,
  Calendar,
  Target,
  Layers,
  Zap,
  Info,
  CheckCircle2,
  ArrowRight,
  Flame,
  CircleDot,
} from "lucide-react";

/** ========================================================================
 *  CONSTANTS
 *  ======================================================================== */

// Feature order MUST match training: /home/claude/feature_names_v8.json
const V8_FEATURE_NAMES = [
  "intercept", "log_allowed_wh", "allowed_wh_raw", "is_rush", "entry_hour",
  "due_changes", "stage_moves", "log_hold_pre", "dow", "is_friday", "is_monday",
  "concurrent_in_stage", "log_concurrent", "is_repair", "is_flex", "is_bbs",
  "log_lead_days", "lead_days_raw", "has_backward", "has_prior_qc", "log_times_seen", "same_day_cases",
  "elapsed_bh", "log_elapsed", "frac_budget", "frac_budget_sq", "remaining_budget", "log_remaining_budget",
  "events_count", "log_events", "activity_rate", "hours_idle", "log_idle", "hold_during",
  "is_overrun", "thin_rem_3h", "thin_rem_6h", "thin_rem_12h",
  "elapsed_x_rush", "elapsed_x_flex", "elapsed_x_bbs", "elapsed_x_repair",
  "elapsed_x_concurrent", "elapsed_x_idle", "frac_x_rush", "frac_x_events",
  "allowed_x_flex", "allowed_x_repair", "lead_x_flex", "idle_x_frac",
  "concurrent_x_dow", "concurrent_x_friday",
  "log_hours_to_first_action", "hours_to_first_action", "rush_added_late",
  "log_hours_to_rush", "due_changes_closer", "due_changes_further", "due_net_direction",
  "hold_cycles", "batch_siblings", "log_batch_siblings", "early_actions",
  "mid_stage_actions", "log_longest_gap", "longest_gap",
  "created_outside_hours", "gap_before_entry", "log_gap_before_entry",
  "unique_users", "stage_position", "stages_remaining", "backward_count",
  "days_since_due_change", "has_appt",
  "pickup_x_batch", "idle_x_concurrent", "flex_x_stages_remaining",
  "rush_late_x_elapsed", "backward_x_elapsed", "hold_cycles_x_elapsed",
  "h_to_rush_added", "has_rush_added", "count_rush_added",
  "h_to_priority_added", "has_priority_added", "count_priority_added",
  "h_to_hold_added", "has_hold_added", "count_hold_added",
  "h_to_hold_removed", "has_hold_removed", "count_hold_removed",
  "h_to_moved_to_prod", "has_moved_to_prod", "count_moved_to_prod",
  "h_to_moved_to_finish", "has_moved_to_finish", "count_moved_to_finish",
  "h_to_moved_to_qc", "has_moved_to_qc", "count_moved_to_qc",
  "h_to_backward_move", "has_backward_move", "count_backward_move",
  "h_to_due_changed", "has_due_changed", "count_due_changed",
];

// Human-readable labels for the features tab
const FEATURE_LABELS = {
  intercept: "Bias term", log_allowed_wh: "Allowed hours (log)", allowed_wh_raw: "Allowed work hours",
  is_rush: "Rush flag", entry_hour: "Entry time of day", due_changes: "Due changes before entry",
  stage_moves: "Stage moves before entry", log_hold_pre: "Pre-entry hold (log)",
  dow: "Day of week", is_friday: "Entered Friday", is_monday: "Entered Monday",
  concurrent_in_stage: "Concurrent cases in stage", log_concurrent: "Concurrent (log)",
  is_repair: "Repair case", is_flex: "Flex case", is_bbs: "BBS case",
  log_lead_days: "Lead time (log days)", lead_days_raw: "Lead time (days)",
  has_backward: "Had backward move", has_prior_qc: "Prior QC visit",
  log_times_seen: "Seen before count", same_day_cases: "Same-day cases",
  elapsed_bh: "Elapsed business hours", log_elapsed: "Elapsed (log)",
  frac_budget: "% of budget used", frac_budget_sq: "Budget² (non-linear)",
  remaining_budget: "Budget hours remaining", log_remaining_budget: "Budget remaining (log)",
  events_count: "Events during stage", log_events: "Events (log)",
  activity_rate: "Events per hour", hours_idle: "Hours since last activity",
  log_idle: "Idle (log)", hold_during: "Hold hours during stage",
  is_overrun: "Past allowed time", thin_rem_3h: "<3h budget left",
  thin_rem_6h: "<6h budget left", thin_rem_12h: "<12h budget left",
  hours_to_first_action: "Hours until first touch", rush_added_late: "Rush added after creation",
  log_hours_to_rush: "Hours to rush (log)", due_changes_closer: "Due pushed closer",
  due_changes_further: "Due pushed further", due_net_direction: "Net due direction",
  hold_cycles: "Hold on/off cycles", batch_siblings: "Cases created together",
  early_actions: "Actions in first 2h", mid_stage_actions: "Non-transition mid-stage events",
  longest_gap: "Longest activity gap", created_outside_hours: "Created off-hours",
  gap_before_entry: "Gap before stage entry", unique_users: "Unique users touched",
  stage_position: "Pipeline position", stages_remaining: "Stages after current",
  backward_count: "Backward moves", days_since_due_change: "Days since due last changed",
  has_appt: "Appointment-linked case",
};

// Work-day definition must match Python training: 8–9:30, 9:45–12, 1–2:30, 2:45–5
const WORK_WINDOWS = [
  [8, 0, 9, 30], [9, 45, 12, 0], [13, 0, 14, 30], [14, 45, 17, 0],
];

// Color system — warm lux aesthetic (cognac, brass, walnut, cream)
const COLORS = {
  // Surfaces
  cream: "#FAF7F2",
  paper: "#FFFFFF",
  ink: "#1A1612",
  inkSoft: "#6B6358",
  inkFaint: "#A19B8F",
  divider: "#E8E1D4",
  borderSoft: "#EDE7DB",
  // Accents
  cognac: "#A16632",
  cognacLight: "#C98B55",
  cognacGlow: "#F5E9DB",
  brass: "#B8944A",
  // Risk
  rCritical: "#A53F2B",
  rCriticalBg: "#FAEEE9",
  rHigh: "#C77A2E",
  rHighBg: "#FBF1E4",
  rMedium: "#B89355",
  rMediumBg: "#FAF3E3",
  rLow: "#6E8868",
  rLowBg: "#EEF2EC",
};

// Stage index for ordering / position
const STAGE_ORDER = { design: 0, production: 1, finishing: 2, qc: 3 };

/** ========================================================================
 *  BUSINESS HOUR ENGINE (must match Python training exactly)
 *  ======================================================================== */

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

function dayWindows(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  return WORK_WINDOWS.map(([a, b, c, e]) => ({
    start: new Date(y, m, day, a, b, 0, 0),
    end: new Date(y, m, day, c, e, 0, 0),
  }));
}

function advanceToNextWorkMoment(c) {
  for (let i = 0; i < 400; i++) {
    if (isWeekend(c)) {
      const nextMonday = c.getDay() === 6 ? 2 : 1;
      c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + nextMonday, 8, 0, 0, 0);
      continue;
    }
    const w = dayWindows(c);
    if (c < w[0].start) return w[0].start;
    for (const win of w) if (win.start <= c && c < win.end) return c;
    c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1, 8, 0, 0, 0);
  }
  return c;
}

export function businessHoursBetween(start, end) {
  if (!start || !end || end <= start) return 0;
  let c = new Date(start.getTime());
  const stop = new Date(end.getTime());
  let total = 0;
  for (let i = 0; i < 500; i++) {
    if (c >= stop) break;
    c = advanceToNextWorkMoment(c);
    if (c >= stop) break;
    for (const w of dayWindows(c)) {
      if (stop <= w.start) return Math.max(0, total);
      const a = c > w.start ? c : w.start;
      const b = stop < w.end ? stop : w.end;
      if (b > a) total += (b - a) / 3600000;
      if (stop <= w.end) return Math.max(0, total);
    }
    c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1, 8, 0, 0, 0);
  }
  return Math.max(0, total);
}

export function addBusinessHours(start, hoursToAdd) {
  let c = new Date(start.getTime());
  if (hoursToAdd <= 0) return snapToMinutes(advanceToNextWorkMoment(c), 5);
  let remaining = hoursToAdd;
  for (let i = 0; i < 500; i++) {
    if (remaining <= 1e-9) return c;
    c = advanceToNextWorkMoment(c);
    for (const w of dayWindows(c)) {
      if (c < w.start) c = w.start;
      if (w.start <= c && c < w.end) {
        const span = (w.end - c) / 3600000;
        if (remaining <= span + 1e-12) return new Date(c.getTime() + remaining * 3600000);
        remaining -= span;
        c = w.end;
      }
    }
    c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1, 8, 0, 0, 0);
  }
  return c;
}

/** ========================================================================
 *  DATE HELPERS
 *  ======================================================================== */

function getCurrentTime() { return new Date(); }

function snapToMinutes(d, step = 5) {
  const ms = step * 60 * 1000;
  return new Date(Math.round(d.getTime() / ms) * ms);
}

export function dueEOD(dueStr) {
  if (!dueStr) return null;
  const base = String(dueStr).split("T")[0];
  const parts = base.split("-").map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2], 17, 0, 0, 0);
  }
  const d = new Date(dueStr);
  if (isNaN(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, 0, 0, 0);
}

export function parseDueDateForDisplay(dueStr) {
  if (!dueStr) return null;
  const base = String(dueStr).split("T")[0];
  const parts = base.split("-").map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2], 17, 0, 0, 0);
  }
  const d = new Date(dueStr);
  return isNaN(d) ? null : d;
}

function parseTimestamp(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function normalizeStage(s) {
  const x = String(s || "").toLowerCase().trim();
  if (x.startsWith("design")) return "design";
  if (x.startsWith("prod")) return "production";
  if (x.startsWith("finish")) return "finishing";
  if (x.startsWith("qc") || x.includes("quality")) return "qc";
  return "design";
}

function strSet(arr) {
  const s = new Set();
  (arr || []).forEach((x) => s.add(String(x).toLowerCase().trim()));
  return s;
}

/** ========================================================================
 *  CASE HISTORY PARSING
 *  ======================================================================== */

function getHistory(c) {
  return (c.case_history || c.history || []).slice().sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return ta - tb;
  });
}

function histCountUpTo(c, pred, cutoff) {
  return getHistory(c).filter((h) => {
    const t = parseTimestamp(h.created_at);
    return t && t <= cutoff && pred((h.action || "").toLowerCase());
  }).length;
}

function holdHoursUntil(c, cutoff) {
  let on = null, total = 0;
  for (const h of getHistory(c)) {
    const a = (h.action || "").toLowerCase();
    const t = parseTimestamp(h.created_at);
    if (!t || t > cutoff) break;
    if (a.includes("hold added")) on = t;
    if (a.includes("hold removed") && on) { total += (t - on) / 3600000; on = null; }
  }
  if (on) total += (cutoff - on) / 3600000;
  return Math.max(0, total);
}

function eventsSinceEntry(c, entry, now) {
  return getHistory(c).filter((h) => {
    const t = parseTimestamp(h.created_at);
    if (!t || t < entry || t > now) return false;
    const a = (h.action || "").toLowerCase();
    return ["moved", "due changed", "hold", "comment", "uploaded", "repair"].some((k) => a.includes(k));
  }).length;
}

function lastActivityAtSince(c, entry) {
  let last = entry;
  for (const h of getHistory(c)) {
    const t = parseTimestamp(h.created_at);
    if (!t || t < entry) continue;
    const a = (h.action || "").toLowerCase();
    if (["hold", "moved", "comment", "uploaded", "repair"].some((k) => a.includes(k))) last = t;
  }
  return last;
}

function getStageEnteredAtFor(c, stage) {
  const stg = normalizeStage(stage);
  const target = {
    design: /design/,
    production: /production/,
    finishing: /finishing/,
    qc: /quality control|qc/,
  }[stg];
  let entry = parseTimestamp(c.created_at);
  for (const h of getHistory(c)) {
    const a = (h.action || "").toLowerCase();
    if (target.test(a) && a.includes("to ")) {
      const t = parseTimestamp(h.created_at);
      if (t) entry = t;
    }
  }
  return entry;
}

/** ========================================================================
 *  FEATURE COMPUTATION — 108 features matching Python training
 *  ======================================================================== */

function computeV8Features(c, stage, entry, due, activeCases, now) {
  const stg = normalizeStage(stage);
  const mods = strSet(c.modifiers);
  const history = getHistory(c);
  const created = parseTimestamp(c.created_at) || entry;
  const events = history.map((h) => ({
    ts: parseTimestamp(h.created_at),
    action: (h.action || "").toLowerCase().trim(),
    user: h.user_name || "",
  })).filter((e) => e.ts);

  // Base
  const rush = !!(c.priority || c.rush || mods.has("rush") || mods.has("priority"));
  const allowedWH = due ? businessHoursBetween(entry, due) : 0;
  const entryHour = entry.getHours() + entry.getMinutes() / 60;
  const dpy = entry.getDay() === 0 ? 6 : entry.getDay() - 1; // Python: Monday=0
  const isRepair = /repair/i.test(c.caseNumber || c.casenumber || "");
  const isFlex = mods.has("flex");
  const isBBS = mods.has("bbs");
  const leadDays = due && created ? Math.max(0, (due - created) / 86400000) : 3.0;

  const eventsBefore = events.filter((e) => e.ts <= now);
  const dueChanges = eventsBefore.filter((e) => e.ts <= entry && e.action.startsWith("due changed")).length;
  const stageMoves = eventsBefore.filter((e) => e.ts <= entry && e.action.includes("moved")).length;
  const holdPre = holdHoursUntil(c, entry);
  const hasBackward = eventsBefore.some((e) => e.ts <= entry && (e.action.includes("to design") || e.action.includes("from finishing to production")));
  const hasPriorQC = eventsBefore.some((e) => e.ts <= entry && e.action.includes("quality control"));

  // Concurrent count — raw, no capacity division
  const concurrent = (activeCases || []).filter((o) => {
    if (!o || o.id === c.id) return false;
    return normalizeStage(o.currentStage || o.stage) === stg;
  }).length;

  const caseNum = (c.caseNumber || c.casenumber || "").replace(/[^0-9]/g, "");
  const timesSeen = caseNum
    ? (activeCases || []).filter((o) => {
        const on = (o.caseNumber || o.casenumber || "").replace(/[^0-9]/g, "");
        return on === caseNum && o.id !== c.id;
      }).length
    : 0;

  const sameDayCases = Math.min(20,
    (activeCases || []).filter((o) => {
      const oc = parseTimestamp(o.created_at);
      return oc && created && oc.toDateString() === created.toDateString() && o.id !== c.id;
    }).length
  );

  // Live features
  const elapsedBH = Math.max(0, businessHoursBetween(entry, now));
  const fracBudget = allowedWH > 0 ? Math.min(3, elapsedBH / Math.max(0.1, allowedWH)) : 0;
  const remainingBudget = Math.max(0, allowedWH - elapsedBH);
  const evtCount = eventsSinceEntry(c, entry, now);
  const lastAct = lastActivityAtSince(c, entry);
  const hoursIdle = Math.max(0, (now - lastAct) / 3600000);
  const holdDuring = Math.max(0, holdHoursUntil(c, now) - holdPre);
  const actRate = elapsedBH > 0.1 ? evtCount / Math.max(0.5, elapsedBH) : 0;
  const logConcurrent = Math.log1p(concurrent);

  // ==== NEW DEEP FEATURES (v8) ====

  // 1. Hours to first action after creation
  let hoursToFirst = 24;
  const firstNon = events.find((e) => e.ts > created && e.action !== "case created");
  if (firstNon && created) hoursToFirst = Math.max(0, (firstNon.ts - created) / 3600000);

  // 2. Rush added late (>1h after creation)
  let rushAddedLate = 0, hoursToRush = 0;
  for (const e of events) {
    if (e.action.includes("rush added") || e.action.includes("priority added")) {
      if (created && (e.ts - created) / 3600000 > 1) rushAddedLate = 1;
      if (rush && !hoursToRush && created) hoursToRush = Math.max(0, (e.ts - created) / 3600000);
      break;
    }
  }

  // 3. Due date change direction
  let dueCloser = 0, dueFurther = 0;
  for (const h of history) {
    const t = parseTimestamp(h.created_at);
    if (!t || t > now) break;
    const raw = h.action || "";
    if (/^due (date )?changed from/i.test(raw)) {
      const m = raw.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
      if (m) {
        const d1 = new Date(m[1]).getTime(), d2 = new Date(m[2]).getTime();
        if (d2 > d1) dueFurther++;
        else if (d2 < d1) dueCloser++;
      }
    }
  }

  // 4. Hold cycles (count of hold-added events)
  let holdCycles = 0;
  for (const e of events) {
    if (e.ts > now) break;
    if (e.ts >= entry && e.action.includes("hold added")) holdCycles++;
  }

  // 5. Batch siblings — cases created within 10 min
  let batchSiblings = 0;
  if (created) {
    for (const o of (activeCases || [])) {
      if (o.id === c.id) continue;
      const oc = parseTimestamp(o.created_at);
      if (oc && Math.abs(oc - created) < 600000) batchSiblings++;
    }
  }

  // 6. Early actions (first 2h after creation)
  let earlyActions = 0;
  if (created) {
    for (const e of events) {
      if (e.ts > new Date(created.getTime() + 2 * 3600000)) break;
      if (e.ts > created && e.action !== "case created") earlyActions++;
    }
  }

  // 7. Mid-stage actions (non-transition events during visit)
  const midStageActions = events.filter((e) => {
    if (e.ts < entry || e.ts > now) return false;
    return !["moved from", "moved to", "marked done", "case created", "case archived"].some((k) => e.action.includes(k));
  }).length;

  // 8. Longest gap between consecutive events during visit
  let longestGap = 0;
  const relevant = events.filter((e) => e.ts >= entry && e.ts <= now);
  if (relevant.length >= 2) {
    for (let i = 1; i < relevant.length; i++) {
      const gap = (relevant[i].ts - relevant[i - 1].ts) / 3600000;
      if (gap > longestGap) longestGap = gap;
    }
  } else if (now > entry) {
    longestGap = Math.min(48, (now - entry) / 3600000);
  }

  // 9. Created outside work hours
  let createdOutside = 0;
  if (created) {
    const h = created.getHours();
    if (h < 8 || h >= 17 || isWeekend(created)) createdOutside = 1;
  }

  // 10. Gap before stage entry (batch-update detector)
  let gapBeforeEntry = 0;
  const preEntry = events.filter((e) => e.ts <= entry);
  if (preEntry.length >= 2) {
    gapBeforeEntry = (preEntry[preEntry.length - 1].ts - preEntry[preEntry.length - 2].ts) / 3600000;
  }

  // 11. Unique users
  const uniqueUsers = new Set(events.filter((e) => e.ts <= now && e.user).map((e) => e.user)).size;

  // 12. Stage position
  const stagePos = STAGE_ORDER[stg] ?? 0;
  const stagesRemaining = Math.max(0, 3 - stagePos);

  // 13. Backward moves
  const backwardCount = eventsBefore.filter((e) =>
    e.action.includes("to design") || e.action.includes("from finishing to production")
  ).length;

  // 14. Days since last due change
  let daysSinceDueChange = 0;
  for (let i = eventsBefore.length - 1; i >= 0; i--) {
    const a = eventsBefore[i].action;
    if (a.startsWith("due changed") || a.startsWith("due date changed")) {
      daysSinceDueChange = Math.max(0, (now - eventsBefore[i].ts) / 86400000);
      break;
    }
  }

  // 15. Has appointment note
  const hasAppt = /appt|am\b|pm\b|\d+:\d+/i.test(c.caseNumber || c.casenumber || "") ? 1 : 0;

  // Auto-generated action type features
  const actionTypes = {
    rush_added:    (a) => a.includes("rush added"),
    priority_added:(a) => a.includes("priority added"),
    hold_added:    (a) => a.includes("hold added"),
    hold_removed:  (a) => a.includes("hold removed"),
    moved_to_prod: (a) => a.includes("design to production"),
    moved_to_finish:(a) => a.includes("production to finishing"),
    moved_to_qc:   (a) => a.includes("quality control"),
    backward_move: (a) => a.includes("to design") || a.includes("from finishing to production"),
    due_changed:   (a) => a.startsWith("due changed") || a.startsWith("due date changed"),
  };
  const autoFeats = {};
  for (const [atype, pred] of Object.entries(actionTypes)) {
    let firstTs = null, count = 0;
    for (const e of eventsBefore) {
      if (pred(e.action)) {
        if (!firstTs) firstTs = e.ts;
        count++;
      }
    }
    const hToFirst = firstTs && created ? Math.max(0, (firstTs - created) / 3600000) : -1;
    autoFeats[`h_to_${atype}`] = hToFirst >= 0 ? hToFirst : 0;
    autoFeats[`has_${atype}`] = count > 0 ? 1 : 0;
    autoFeats[`count_${atype}`] = count;
  }

  // Build feature dictionary keyed by name (then serialize in V8_FEATURE_NAMES order)
  const f = {
    intercept: 1.0,
    log_allowed_wh: Math.log1p(Math.max(0, allowedWH)),
    allowed_wh_raw: Math.min(80, Math.max(0, allowedWH)),
    is_rush: rush ? 1 : 0,
    entry_hour: entryHour,
    due_changes: dueChanges,
    stage_moves: stageMoves,
    log_hold_pre: Math.log1p(Math.max(0, holdPre)),
    dow: dpy,
    is_friday: dpy === 4 ? 1 : 0,
    is_monday: dpy === 0 ? 1 : 0,
    concurrent_in_stage: concurrent,
    log_concurrent: logConcurrent,
    is_repair: isRepair ? 1 : 0,
    is_flex: isFlex ? 1 : 0,
    is_bbs: isBBS ? 1 : 0,
    log_lead_days: Math.log1p(Math.max(0, leadDays)),
    lead_days_raw: Math.min(14, Math.max(0, leadDays)),
    has_backward: hasBackward ? 1 : 0,
    has_prior_qc: hasPriorQC ? 1 : 0,
    log_times_seen: Math.log1p(timesSeen),
    same_day_cases: sameDayCases,
    elapsed_bh: elapsedBH,
    log_elapsed: Math.log1p(Math.max(0, elapsedBH)),
    frac_budget: fracBudget,
    frac_budget_sq: Math.min(9, fracBudget * fracBudget),
    remaining_budget: Math.min(80, remainingBudget),
    log_remaining_budget: Math.log1p(remainingBudget),
    events_count: evtCount,
    log_events: Math.log1p(evtCount),
    activity_rate: actRate,
    hours_idle: Math.min(48, hoursIdle),
    log_idle: Math.log1p(hoursIdle),
    hold_during: Math.min(24, holdDuring),
    is_overrun: fracBudget > 1.0 ? 1 : 0,
    thin_rem_3h: remainingBudget < 3 ? 1 : 0,
    thin_rem_6h: remainingBudget < 6 ? 1 : 0,
    thin_rem_12h: remainingBudget < 12 ? 1 : 0,
    elapsed_x_rush: elapsedBH * (rush ? 1 : 0),
    elapsed_x_flex: elapsedBH * (isFlex ? 1 : 0),
    elapsed_x_bbs: elapsedBH * (isBBS ? 1 : 0),
    elapsed_x_repair: elapsedBH * (isRepair ? 1 : 0),
    elapsed_x_concurrent: elapsedBH * logConcurrent,
    elapsed_x_idle: elapsedBH * Math.log1p(hoursIdle),
    frac_x_rush: fracBudget * (rush ? 1 : 0),
    frac_x_events: fracBudget * Math.log1p(evtCount),
    allowed_x_flex: Math.log1p(allowedWH) * (isFlex ? 1 : 0),
    allowed_x_repair: Math.log1p(allowedWH) * (isRepair ? 1 : 0),
    lead_x_flex: Math.log1p(leadDays) * (isFlex ? 1 : 0),
    idle_x_frac: Math.log1p(hoursIdle) * Math.min(3, fracBudget),
    concurrent_x_dow: concurrent * dpy,
    concurrent_x_friday: concurrent * (dpy === 4 ? 1 : 0),

    log_hours_to_first_action: Math.log1p(Math.min(72, hoursToFirst)),
    hours_to_first_action: Math.min(72, hoursToFirst),
    rush_added_late: rushAddedLate,
    log_hours_to_rush: rush ? Math.log1p(hoursToRush) : 0,
    due_changes_closer: dueCloser,
    due_changes_further: dueFurther,
    due_net_direction: dueFurther - dueCloser,
    hold_cycles: holdCycles,
    batch_siblings: Math.min(10, batchSiblings),
    log_batch_siblings: Math.log1p(batchSiblings),
    early_actions: Math.min(5, earlyActions),
    mid_stage_actions: Math.min(10, midStageActions),
    log_longest_gap: Math.log1p(Math.min(48, longestGap)),
    longest_gap: Math.min(48, longestGap),
    created_outside_hours: createdOutside,
    gap_before_entry: Math.min(48, gapBeforeEntry),
    log_gap_before_entry: Math.log1p(Math.min(48, gapBeforeEntry)),
    unique_users: uniqueUsers,
    stage_position: stagePos,
    stages_remaining: stagesRemaining,
    backward_count: backwardCount,
    days_since_due_change: Math.min(30, daysSinceDueChange),
    has_appt: hasAppt,

    pickup_x_batch: Math.log1p(Math.min(72, hoursToFirst)) * Math.log1p(batchSiblings),
    idle_x_concurrent: Math.log1p(hoursIdle) * logConcurrent,
    flex_x_stages_remaining: (isFlex ? 1 : 0) * stagesRemaining,
    rush_late_x_elapsed: rushAddedLate * elapsedBH,
    backward_x_elapsed: backwardCount * elapsedBH,
    hold_cycles_x_elapsed: holdCycles * elapsedBH,

    ...autoFeats,
  };

  const array = V8_FEATURE_NAMES.map((n) => (f[n] !== undefined ? f[n] : 0));

  return {
    array,
    dict: f,
    concurrent,
    elapsedBH,
    hoursIdle,
    remainingBudget,
    allowedWH,
    fracBudget,
    rush,
    isFlex,
    isBBS,
    isRepair,
    holdHours: holdPre + holdDuring,
  };
}

/** ========================================================================
 *  XGBOOST TREE EVALUATION
 *  ======================================================================== */

function walkTree(node, features) {
  if (node.leaf !== undefined) return node.leaf;
  const featIdx = typeof node.split === "string"
    ? parseInt(node.split.replace("f", ""), 10)
    : node.split;
  const val = features[featIdx];
  if (val === undefined || val === null || Number.isNaN(val)) {
    const mc = node.missing ?? node.yes ?? (node.children?.[0]?.nodeid);
    const match = node.children?.find((ch) => ch.nodeid === mc);
    return match ? walkTree(match, features) : 0;
  }
  const threshold = node.split_condition;
  const goLeftId = val < threshold ? (node.yes ?? node.children?.[0]?.nodeid) : (node.no ?? node.children?.[1]?.nodeid);
  const child = node.children?.find((ch) => ch.nodeid === goLeftId) ?? node.children?.[val < threshold ? 0 : 1];
  return child ? walkTree(child, features) : 0;
}

function xgbPredictRegression(subModel, features) {
  if (!subModel?.trees) return 0;
  // Per-model base_score (different for each quantile in quantile regression)
  let sum = typeof subModel.base_score === "number" ? subModel.base_score : 0.5;
  for (const tree of subModel.trees) {
    sum += tree.leaf !== undefined ? tree.leaf : walkTree(tree, features);
  }
  return sum;
}

function xgbPredictProba(subModel, features) {
  if (!subModel?.trees) return 0.5;
  // Classification base_score is typically 0 in logit space (logistic loss)
  let sum = typeof subModel.base_score === "number" ? subModel.base_score : 0;
  for (const tree of subModel.trees) {
    sum += tree.leaf !== undefined ? tree.leaf : walkTree(tree, features);
  }
  return 1 / (1 + Math.exp(-sum));
}

/** ========================================================================
 *  MODEL LOADING
 *  ======================================================================== */

let XGB_MODELS = null;
let modelLoadPromise = null;

export function loadModels(modelUrl = "/xgb_v8_3_final.json") {
  if (XGB_MODELS) return Promise.resolve(XGB_MODELS);
  if (modelLoadPromise) return modelLoadPromise;
  modelLoadPromise = fetch(modelUrl)
    .then((r) => { if (!r.ok) throw new Error(`Model fetch ${r.status}`); return r.json(); })
    .then((data) => {
      XGB_MODELS = data;
      if (typeof window !== "undefined") {
        console.log("[v8] Models loaded for stages:", Object.keys(data).join(", "));
      }
      return data;
    })
    .catch((err) => {
      console.error("[v8] Failed to load models:", err);
      return null;
    });
  return modelLoadPromise;
}

export function modelsReady() { return !!XGB_MODELS; }

/** ========================================================================
 *  CORE PREDICTION — runs all quantile models + P(resched)
 *  ======================================================================== */

/** ========================================================================
 *  QUANTILE COMPUTATION — v8.2 distributional (mean + sigma)
 *  ========================================================================
 *  Instead of training 4 independent quantile models (which can cross),
 *  we train a mean model and a sigma model. Quantiles are derived analytically
 *  from the lognormal distribution: q_α = exp(mean + z_α * sigma * scale) − 1
 *  
 *  This guarantees p10 ≤ p50 ≤ p75 ≤ p90 by mathematical construction
 *  (the CDF is strictly monotone).
 *  
 *  Asymmetric scales handle right-skew in duration data:
 *    scale_lower  for z < 0 (p10 side)
 *    scale_upper_75  for z ≈ 0.67 (p75)
 *    scale_upper_90  for z ≈ 1.28 (p90)
 */

// Standard normal z-values for target quantiles
const Z_QUANTILES = {
  p10: -1.2815515655446004,
  p50: 0,
  p75: 0.6744897501960817,
  p90: 1.2815515655446004,
};

function computeQuantiles(meanModel, sigmaModel, features) {
  if (!meanModel || !sigmaModel) {
    return { p10: 0, p50: 0, p75: 0, p90: 0 };
  }
  
  const meanRaw = xgbPredictRegression(meanModel, features);
  const logSigmaRaw = xgbPredictRegression(sigmaModel, features);
  const sigmaBase = Math.exp(logSigmaRaw);
  
  const scales = {
    lower: sigmaModel.scale_lower ?? 1.0,
    up75: sigmaModel.scale_upper_75 ?? 1.0,
    up90: sigmaModel.scale_upper_90 ?? 1.0,
  };
  
  // Conformal adjustments — additive hours to guarantee coverage
  const conformal = {
    p75: sigmaModel.conformal_p75 ?? 0,
    p90: sigmaModel.conformal_p90 ?? 0,
  };
  
  const quantileHours = (z, conformalAdj = 0) => {
    let scale;
    if (z < 0) scale = scales.lower;
    else if (z > 0 && z < 1.0) scale = scales.up75;
    else if (z >= 1.0) scale = scales.up90;
    else scale = 1.0;
    const logHours = meanRaw + z * sigmaBase * scale;
    const hours = Math.max(0, Math.exp(logHours) - 1);
    return hours + conformalAdj;  // conformal layer adds guaranteed buffer
  };
  
  return {
    p10: quantileHours(Z_QUANTILES.p10),
    p50: quantileHours(Z_QUANTILES.p50),
    p75: quantileHours(Z_QUANTILES.p75, conformal.p75),
    p90: quantileHours(Z_QUANTILES.p90, conformal.p90),
  };
}

/**
 * Predicts P(case will exceed its allowed work-hour budget) using the
 * dedicated late classifier. Returns a calibrated probability via isotonic
 * regression lookup.
 */
function predictLateProb(stageModel, features) {
  const lateModel = stageModel?.late_classifier;
  if (!lateModel) return null;
  
  // Raw classifier output
  const rawProb = xgbPredictProba(lateModel, features);
  
  // Apply isotonic calibration if present
  const xPts = lateModel.calibration_x;
  const yPts = lateModel.calibration_y;
  if (!xPts || !yPts || xPts.length !== yPts.length) return rawProb;
  
  // Piecewise linear interpolation through calibration curve
  if (rawProb <= xPts[0]) return yPts[0];
  if (rawProb >= xPts[xPts.length - 1]) return yPts[yPts.length - 1];
  for (let i = 0; i < xPts.length - 1; i++) {
    if (rawProb >= xPts[i] && rawProb <= xPts[i + 1]) {
      const frac = (rawProb - xPts[i]) / Math.max(1e-9, xPts[i + 1] - xPts[i]);
      return yPts[i] + frac * (yPts[i + 1] - yPts[i]);
    }
  }
  return rawProb;
}

function predictCaseML(c, stage, stageEnteredAt, activeCases) {
  const now = getCurrentTime();
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : now;
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);

  const feats = computeV8Features(c, stg, entry, due, activeCases, now);
  const featureArray = feats.array;

  const model = XGB_MODELS?.[stg];
  let stageQ = null, totalQ = null, pResched = 0.05, modelUsed = "fallback";
  let pLateDirect = null;  // From dedicated classifier
  let lateThresholds = null;

  if (model?.stage_mean && model?.stage_sigma) {
    stageQ = computeQuantiles(model.stage_mean, model.stage_sigma, featureArray);
    totalQ = computeQuantiles(model.total_mean, model.total_sigma, featureArray);
    if (model.resched) pResched = xgbPredictProba(model.resched, featureArray);
    
    // NEW in v8.3: dedicated late classifier
    if (model.late_classifier) {
      pLateDirect = predictLateProb(model, featureArray);
      lateThresholds = {
        critical: model.late_classifier.thresh_critical ?? 0.8,
        high: model.late_classifier.thresh_high ?? 0.5,
        medium: model.late_classifier.thresh_medium ?? 0.25,
      };
    }
    
    modelUsed = "xgboost-v8.3";
  } else {
    const rem = Math.max(0.5, feats.remainingBudget || 4);
    stageQ = { p10: rem * 0.5, p50: rem, p75: rem * 1.3, p90: rem * 1.8 };
    totalQ = { p10: rem * 0.8, p50: rem * 1.5, p75: rem * 2, p90: rem * 3 };
  }

  const stageETAs = {
    p10: addBusinessHours(now, stageQ.p10),
    p50: addBusinessHours(now, stageQ.p50),
    p75: addBusinessHours(now, stageQ.p75),
    p90: addBusinessHours(now, stageQ.p90),
  };
  const totalETAs = {
    p10: addBusinessHours(now, totalQ.p10),
    p50: addBusinessHours(now, totalQ.p50),
    p75: addBusinessHours(now, totalQ.p75),
    p90: addBusinessHours(now, totalQ.p90),
  };

  // === RISK LEVEL DETERMINATION ===
  // v8.3 uses a two-signal system:
  //   1. Dedicated classifier P(late) — primary signal, trained directly for this job
  //   2. Quantile position vs due date — secondary signal for geometric sanity
  // When both signals agree, risk is high-confidence.
  
  let riskLevel = "low";
  let pLateFinal = 0.05;
  let riskFromQuantiles = null;  // what quantile geometry says
  let riskFromClassifier = null;  // what classifier says
  let signalsAgree = true;
  
  // Quantile-based risk (secondary signal)
  if (due) {
    if (totalETAs.p10 > due) riskFromQuantiles = "critical";
    else if (totalETAs.p50 > due) riskFromQuantiles = "high";
    else if (totalETAs.p75 > due) riskFromQuantiles = "medium";
    else riskFromQuantiles = "low";
  } else {
    riskFromQuantiles = "low";
  }
  
  // Classifier-based risk (primary signal) — uses calibrated thresholds
  if (pLateDirect !== null && lateThresholds) {
    if (pLateDirect >= lateThresholds.critical) riskFromClassifier = "critical";
    else if (pLateDirect >= lateThresholds.high) riskFromClassifier = "high";
    else if (pLateDirect >= lateThresholds.medium) riskFromClassifier = "medium";
    else riskFromClassifier = "low";
    
    // Primary: use classifier
    riskLevel = riskFromClassifier;
    pLateFinal = pLateDirect;
    
    // Agreement check
    const rankOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const classifierRank = rankOrder[riskFromClassifier];
    const quantileRank = rankOrder[riskFromQuantiles];
    signalsAgree = Math.abs(classifierRank - quantileRank) <= 1;
  } else {
    // Fallback to quantile-derived if classifier unavailable
    riskLevel = riskFromQuantiles;
    pLateFinal = interpolatePLate(totalETAs, due);
  }

  // === CONFIDENCE SCORE ===
  // v8.3 confidence combines: spread tightness + signal agreement + late prob extremity
  const spread = totalQ.p90 - totalQ.p10;
  const relSpread = totalQ.p50 > 0 ? spread / totalQ.p50 : 3;
  let confidenceScore = 95 - relSpread * 25;  // base from spread
  if (signalsAgree) confidenceScore += 5;       // bonus when both signals agree
  else confidenceScore -= 15;                    // penalty when they disagree
  // Boost when classifier is very confident in either direction
  if (pLateDirect !== null) {
    const extremity = Math.abs(pLateDirect - 0.5) * 2;  // 0..1
    confidenceScore += extremity * 10;
  }
  confidenceScore = Math.round(Math.max(35, Math.min(98, confidenceScore)));

  return {
    stageHours: stageQ,
    totalHours: totalQ,
    stageETAs,
    totalETAs,
    pResched,
    pLate: pLateFinal,
    pLateDirect,
    pLateFromQuantiles: due ? interpolatePLate(totalETAs, due) : 0,
    riskLevel,
    riskFromClassifier,
    riskFromQuantiles,
    signalsAgree,
    stageETA: snapToMinutes(stageETAs.p50, 5),
    totalETA: snapToMinutes(totalETAs.p50, 5),
    stageWorkHours: stageQ.p50,
    totalWorkHours: totalQ.p50,
    elapsedWorkHours: feats.elapsedBH,
    concurrent: feats.concurrent,
    hoursIdle: feats.hoursIdle,
    remainingBudget: feats.remainingBudget,
    allowedWH: feats.allowedWH,
    fracBudget: feats.fracBudget,
    holdHours: feats.holdHours,
    confidenceScore,
    modelUsed,
    featureArray,
    featureDict: feats.dict,
    featureNames: V8_FEATURE_NAMES,
  };
}

function interpolatePLate(etas, due) {
  // Treat the 4 quantiles as 4 known points on the CDF:
  //   F(p10) = 0.10, F(p50) = 0.50, F(p75) = 0.75, F(p90) = 0.90
  // For any due date, interpolate/extrapolate the CDF value at that time.
  // P(late) = 1 − F(due)  (probability the case finishes AFTER the due date)
  if (!due) return 0.05;

  const points = [
    { ms: etas.p10.getTime(), q: 0.10 },
    { ms: etas.p50.getTime(), q: 0.50 },
    { ms: etas.p75.getTime(), q: 0.75 },
    { ms: etas.p90.getTime(), q: 0.90 },
  ];
  const dueMs = due.getTime();

  let cdf;
  if (dueMs <= points[0].ms) {
    // Before p10 — extrapolate using slope of the p10→p50 segment
    const segMs = Math.max(1, points[1].ms - points[0].ms);
    const slope = (points[1].q - points[0].q) / segMs; // quantile per ms
    cdf = points[0].q - slope * (points[0].ms - dueMs);
  } else if (dueMs >= points[3].ms) {
    // Past p90 — extrapolate using slope of the p75→p90 segment
    const segMs = Math.max(1, points[3].ms - points[2].ms);
    const slope = (points[3].q - points[2].q) / segMs;
    cdf = points[3].q + slope * (dueMs - points[3].ms);
  } else {
    // Inside the range — linear interpolation between adjacent known points
    cdf = points[0].q;
    for (let i = 0; i < points.length - 1; i++) {
      if (dueMs >= points[i].ms && dueMs <= points[i + 1].ms) {
        const segMs = Math.max(1, points[i + 1].ms - points[i].ms);
        const frac = (dueMs - points[i].ms) / segMs;
        cdf = points[i].q + frac * (points[i + 1].q - points[i].q);
        break;
      }
    }
  }

  // Clamp to a sensible range so tails don't produce pathological values
  cdf = Math.max(0.005, Math.min(0.995, cdf));
  return 1 - cdf;
}

/** ========================================================================
 *  MAIN GENERATOR — produces prediction objects for all active cases
 *  ======================================================================== */

export function generateCaseRiskPredictions(activeCases, throughputAnalysis, stage = null, _stageStats = null) {
  if (!activeCases || activeCases.length === 0) {
    return {
      atRisk: 0, predictions: [], urgent: [],
      summary: { onTrack: 0, atRisk: 0, high: 0, critical: 0, averageCompletionConfidence: 0, averageLateProbability: 0, averageRescheduleProbability: 0, concurrent: 0 },
      byRiskLevel: { critical: [], high: [], medium: [], low: [] },
    };
  }

  const nowTs = getCurrentTime().getTime();
  const currentStage = normalizeStage(stage || "design");

  const predictions = activeCases.map((c) => {
    const caseType = c.caseType ||
      (c.modifiers?.includes?.("bbs") ? "bbs" :
       c.modifiers?.includes?.("flex") ? "flex" : "general");
    const stageEnteredAt = getStageEnteredAtFor(c, currentStage);
    const timeInStageMs = Math.max(0, nowTs - (stageEnteredAt?.getTime?.() || nowTs));

    const ml = predictCaseML(c, currentStage, stageEnteredAt, activeCases);
    const dueDateCalc = dueEOD(c.due);
    const dueDateDisplay = parseDueDateForDisplay(c.due);
    const isRush = !!(c?.rush || c?.priority);
    const daysUntilDue = dueDateCalc ? (dueDateCalc.getTime() - nowTs) / 86400000 : Number.POSITIVE_INFINITY;
    const expectedDaysToComplete = (ml.totalETA.getTime() - nowTs) / 86400000;
    const willBeLate = dueDateCalc ? ml.totalETA > dueDateCalc : false;
    const slackDays = daysUntilDue - expectedDaysToComplete;

    const progressPercent = Math.min(98, (ml.elapsedWorkHours / Math.max(1e-6, ml.elapsedWorkHours + ml.stageWorkHours)) * 100);
    const hoursIdle = ml.hoursIdle;
    const qcLoops = histCountUpTo(c, (a) => a.includes("moved to quality control") || a.includes("finishing to quality control"), getCurrentTime());

    return {
      id: c.id,
      caseNumber: c.caseNumber || c.casenumber,
      caseType,
      currentStage,
      timeInStageMs,
      stageEnteredAt,

      // ETAs (primary)
      stageETA: ml.stageETA,
      completionETA: ml.totalETA,
      expectedCompletionDate: ml.totalETA, // alias for old UI

      // Quantile ranges
      stageHours: ml.stageHours,      // {p10, p50, p75, p90} remaining in stage
      totalHours: ml.totalHours,      // {p10, p50, p75, p90} remaining to done
      stageETAs: ml.stageETAs,        // {p10, p50, p75, p90} as Date objects
      totalETAs: ml.totalETAs,

      // Work-hour shortcuts
      stageWorkHours: ml.stageWorkHours,
      totalStageWorkHours: ml.stageWorkHours + ml.elapsedWorkHours,
      totalCompletionWorkHours: ml.totalWorkHours,
      elapsedWorkHours: ml.elapsedWorkHours,
      progressPercent,
      hoursIdle,

      // Due / risk
      dueDate: dueDateDisplay,
      dueDateCalc,
      willBeLate,
      daysUntilDue: isFinite(daysUntilDue) ? daysUntilDue : null,
      expectedDaysToComplete,
      daysLate: willBeLate ? Math.max(0, expectedDaysToComplete - daysUntilDue) : 0,
      slackDays,
      slackHours: slackDays * 24,

      // Model outputs
      riskLevel: ml.riskLevel,
      lateProbability: ml.pLate,
      lateProbabilityDirect: ml.pLateDirect,  // from dedicated classifier
      lateProbabilityQuantile: ml.pLateFromQuantiles,  // from quantile position
      riskFromClassifier: ml.riskFromClassifier,
      riskFromQuantiles: ml.riskFromQuantiles,
      signalsAgree: ml.signalsAgree,
      rescheduleProbability: ml.pResched,
      confidence: ml.confidenceScore >= 80 ? "high" : ml.confidenceScore >= 60 ? "medium" : "low",
      confidenceScore: ml.confidenceScore,
      riskScore: Math.round(ml.pLate * 100),

      // Context
      isRush,
      qcLoops,
      onHold: ml.holdHours > 0.1,
      holdHours: ml.holdHours,
      dueChanges: histCountUpTo(c, (a) => a.startsWith("due changed"), stageEnteredAt || new Date(0)),
      stageMoves: histCountUpTo(c, (a) => a.includes("moved"), stageEnteredAt || new Date(0)),
      backlogCount: ml.concurrent,
      stageCapacity: ml.concurrent,
      allowedWH: ml.allowedWH,
      fracBudget: ml.fracBudget,

      // Diagnostics / modal data
      riskReasons: [],
      recommendation: "",
      modelUsed: ml.modelUsed,
      featureArray: ml.featureArray,
      featureDict: ml.featureDict,
      featureNames: ml.featureNames,

      // Original case for reference
      _case: c,
    };
  });

  // Build risk reasons from the feature dict (data-driven, not hand-rules)
  for (const p of predictions) {
    const reasons = [];
    const f = p.featureDict;

    // Order matters: list most relevant first
    if (f.rush_added_late) reasons.push("rush added after creation");
    if (f.backward_count >= 1) reasons.push(`${f.backward_count} backward move${f.backward_count > 1 ? "s" : ""}`);
    if (f.due_changes_closer >= 1) reasons.push("due date pushed closer");
    if (f.hold_cycles >= 2) reasons.push(`${f.hold_cycles} hold cycles`);
    else if (p.onHold && f.hold_during >= 4) reasons.push("long hold time");
    if (f.concurrent_in_stage >= 8) reasons.push(`${Math.round(f.concurrent_in_stage)} concurrent cases`);
    if (f.hours_idle >= 18) reasons.push("inactive 18h+");
    if (f.is_overrun) reasons.push("past allowed time");
    if (f.batch_siblings >= 3 && f.lead_days_raw <= 2) reasons.push("tight batch intake");
    if (f.is_flex && f.stages_remaining >= 2) reasons.push("flex case with pipeline ahead");
    if (p.qcLoops > 0) reasons.push(`${p.qcLoops} QC loop${p.qcLoops > 1 ? "s" : ""}`);

    // Recommendations keyed on risk level
    const rec = {
      critical: "Immediate escalation required",
      high: "Actively monitor and prioritize",
      medium: "Check progress today",
      low: "On track — no action needed",
    }[p.riskLevel];

    p.riskReasons = reasons.slice(0, 5);
    p.recommendation = rec;
  }

  const summary = {
    onTrack: predictions.filter((p) => !p.willBeLate && p.riskLevel === "low").length,
    atRisk: predictions.filter((p) => p.riskLevel === "medium").length,
    high: predictions.filter((p) => p.riskLevel === "high").length,
    critical: predictions.filter((p) => p.riskLevel === "critical").length,
    averageCompletionConfidence: predictions.length
      ? predictions.reduce((s, p) => s + p.confidenceScore, 0) / predictions.length : 0,
    averageLateProbability: predictions.length
      ? predictions.reduce((s, p) => s + p.lateProbability, 0) / predictions.length : 0,
    averageRescheduleProbability: predictions.length
      ? predictions.reduce((s, p) => s + p.rescheduleProbability, 0) / predictions.length : 0,
    concurrent: predictions[0]?.backlogCount || 0,
  };

  return {
    atRisk: summary.atRisk + summary.high + summary.critical,
    predictions,
    urgent: predictions.filter((p) => p.riskLevel === "critical" || p.riskLevel === "high"),
    summary,
    byRiskLevel: {
      critical: predictions.filter((p) => p.riskLevel === "critical"),
      high:     predictions.filter((p) => p.riskLevel === "high"),
      medium:   predictions.filter((p) => p.riskLevel === "medium"),
      low:      predictions.filter((p) => p.riskLevel === "low"),
    },
  };
}

/** ========================================================================
 *  UI UTILITIES
 *  ======================================================================== */

const RISK_STYLE = {
  critical: { fg: COLORS.rCritical, bg: COLORS.rCriticalBg, label: "Critical" },
  high:     { fg: COLORS.rHigh,     bg: COLORS.rHighBg,     label: "High" },
  medium:   { fg: COLORS.rMedium,   bg: COLORS.rMediumBg,   label: "Medium" },
  low:      { fg: COLORS.rLow,      bg: COLORS.rLowBg,      label: "Low" },
};

// Exported formatters (used internally and by callers)
export function formatHours(h) {
  if (h === undefined || h === null || isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 10) return `${h.toFixed(1)}h`;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 8; // business days
  if (d < 10) return `${d.toFixed(1)}d`;
  return `${Math.round(d)}d`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return "—";
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  return `${Math.round(d * 10) / 10}d`;
}

export function formatDate(d, withTime = true) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return "—";
  const opts = withTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleString("en-US", opts);
}

export function formatPercent(x, digits = 0) {
  if (x === undefined || x === null || isNaN(x)) return "—";
  return `${Number(x).toFixed(digits)}%`;
}

export function formatRelativeTime(date, reference = new Date()) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "—";
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
}

export function daySpanHours(a, b) { return (b - a) / 3600000; }

// Models getters/setters for testing/mocking
export function getModels() { return XGB_MODELS; }
export function setModels(models) { XGB_MODELS = models; }

/** ========================================================================
 *  UI COMPONENTS
 *  ======================================================================== */

function RiskBadge({ level, size = "md" }) {
  const s = RISK_STYLE[level] || RISK_STYLE.low;
  const sizes = {
    sm: "px-2 py-0.5 text-[10px] tracking-[0.12em]",
    md: "px-2.5 py-1 text-[11px] tracking-[0.14em]",
    lg: "px-3 py-1.5 text-xs tracking-[0.16em]",
  };
  return (
    <span
      className={`inline-flex items-center font-medium uppercase rounded-sm ${sizes[size]}`}
      style={{ color: s.fg, backgroundColor: s.bg, border: `1px solid ${s.fg}22` }}
    >
      {s.label}
    </span>
  );
}

function MetricCard({ label, value, sublabel, accent = false, size = "md" }) {
  const sizes = {
    sm: { label: "text-[10px]", value: "text-2xl", sub: "text-xs" },
    md: { label: "text-[11px]", value: "text-4xl", sub: "text-xs" },
    lg: { label: "text-[11px]", value: "text-5xl", sub: "text-sm" },
  }[size];

  return (
    <div
      className="relative p-5 rounded-sm"
      style={{
        backgroundColor: COLORS.paper,
        border: `1px solid ${COLORS.borderSoft}`,
      }}
    >
      <div
        className={`${sizes.label} uppercase tracking-[0.18em] font-medium mb-2`}
        style={{ color: COLORS.inkFaint }}
      >
        {label}
      </div>
      <div
        className={`${sizes.value} font-light leading-none`}
        style={{
          color: accent ? COLORS.cognac : COLORS.ink,
          fontFamily: "'Instrument Serif', 'Tiempos Headline', Georgia, serif",
          fontFeatureSettings: "'ss01', 'tnum'",
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={`${sizes.sub} mt-2 font-normal`}
          style={{ color: COLORS.inkSoft, fontFamily: "'Söhne', -apple-system, sans-serif" }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

/**
 * TimelineHero — the centerpiece visual.
 * Shows NOW → stage exit range → completion range → due date on one axis.
 * Due date is a vertical marker; where it falls relative to the completion
 * range is how the user reads risk visually.
 */
function TimelineHero({ prediction }) {
  const { stageETAs, totalETAs, dueDateCalc, stageEnteredAt, elapsedWorkHours } = prediction;
  const now = getCurrentTime();

  // Build a timeline axis spanning from entry to max(due, p90)
  const entryTs = (stageEnteredAt || now).getTime();
  const nowTs = now.getTime();
  const dueTs = dueDateCalc ? dueDateCalc.getTime() : null;
  const stagePoints = [stageETAs.p10, stageETAs.p50, stageETAs.p75, stageETAs.p90].map((d) => d.getTime());
  const totalPoints = [totalETAs.p10, totalETAs.p50, totalETAs.p75, totalETAs.p90].map((d) => d.getTime());

  const minTs = entryTs;
  const maxTs = Math.max(
    dueTs || 0,
    totalPoints[3],
    nowTs + 3600000,
  );
  const span = Math.max(1, maxTs - minTs);
  const pct = (ts) => Math.max(0, Math.min(100, ((ts - minTs) / span) * 100));

  const dueInRange = dueTs && dueTs >= totalPoints[0] && dueTs <= totalPoints[3];
  const dueBeforeRange = dueTs && dueTs < totalPoints[0];
  const dueAfterRange = dueTs && dueTs > totalPoints[3];

  return (
    <div
      className="relative p-8 rounded-sm"
      style={{
        background: `linear-gradient(135deg, ${COLORS.paper} 0%, ${COLORS.cognacGlow}66 100%)`,
        border: `1px solid ${COLORS.borderSoft}`,
      }}
    >
      <div className="flex items-baseline justify-between mb-6">
        <div
          className="text-[10px] uppercase tracking-[0.2em] font-medium"
          style={{ color: COLORS.inkFaint }}
        >
          Prediction Timeline
        </div>
        <div className="text-[10px]" style={{ color: COLORS.inkFaint }}>
          Range shows p10 → p90 of model predictions
        </div>
      </div>

      {/* Axis container */}
      <div className="relative" style={{ height: 180 }}>
        {/* Background axis line */}
        <div
          className="absolute left-0 right-0 top-1/2 h-px"
          style={{ backgroundColor: COLORS.divider, transform: "translateY(-0.5px)" }}
        />

        {/* Stage exit range bar (thinner, top) */}
        <div
          className="absolute"
          style={{
            top: "30%",
            left: `${pct(stagePoints[0])}%`,
            width: `${pct(stagePoints[3]) - pct(stagePoints[0])}%`,
            height: 3,
            background: `linear-gradient(90deg, ${COLORS.brass}55, ${COLORS.brass}cc, ${COLORS.brass}55)`,
            borderRadius: 1,
          }}
        />
        {/* Stage P50 marker */}
        <div
          className="absolute w-2 h-2 rounded-full"
          style={{
            top: "30%",
            left: `${pct(stagePoints[1])}%`,
            transform: "translate(-50%, -50%)",
            marginTop: 1.5,
            backgroundColor: COLORS.brass,
            boxShadow: `0 0 0 3px ${COLORS.paper}`,
          }}
        />
        <div
          className="absolute text-[9px] uppercase tracking-[0.15em]"
          style={{
            top: "30%",
            left: `${pct(stagePoints[1])}%`,
            transform: "translate(-50%, -140%)",
            color: COLORS.brass,
            fontWeight: 500,
          }}
        >
          Stage exit
        </div>

        {/* Total completion range bar (thicker, bottom) */}
        <div
          className="absolute"
          style={{
            top: "60%",
            left: `${pct(totalPoints[0])}%`,
            width: `${pct(totalPoints[3]) - pct(totalPoints[0])}%`,
            height: 6,
            background: `linear-gradient(90deg, ${COLORS.cognacLight}66, ${COLORS.cognac}, ${COLORS.cognacLight}66)`,
            borderRadius: 1,
          }}
        />
        {/* Total P50 marker */}
        <div
          className="absolute rounded-full"
          style={{
            top: "60%",
            left: `${pct(totalPoints[1])}%`,
            transform: "translate(-50%, -50%)",
            marginTop: 3,
            width: 14,
            height: 14,
            backgroundColor: COLORS.cognac,
            boxShadow: `0 0 0 3px ${COLORS.paper}, 0 2px 6px ${COLORS.cognac}44`,
          }}
        />
        <div
          className="absolute text-[10px] uppercase tracking-[0.15em] font-medium"
          style={{
            top: "60%",
            left: `${pct(totalPoints[1])}%`,
            transform: "translate(-50%, 180%)",
            color: COLORS.cognac,
          }}
        >
          Case done
        </div>

        {/* NOW marker */}
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{ left: `${pct(nowTs)}%`, backgroundColor: COLORS.ink }}
        />
        <div
          className="absolute"
          style={{
            top: 0,
            left: `${pct(nowTs)}%`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div
            className="text-[9px] uppercase tracking-[0.2em] font-medium whitespace-nowrap pb-1"
            style={{ color: COLORS.ink }}
          >
            Now
          </div>
        </div>

        {/* DUE marker */}
        {dueTs && (
          <>
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: `${pct(dueTs)}%`,
                width: 2,
                backgroundColor: dueAfterRange ? COLORS.rLow : dueBeforeRange ? COLORS.rCritical : COLORS.ink,
                borderRadius: 1,
              }}
            />
            <div
              className="absolute"
              style={{
                top: 0,
                left: `${pct(dueTs)}%`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div
                className="flex flex-col items-center pb-2"
                style={{ color: dueAfterRange ? COLORS.rLow : dueBeforeRange ? COLORS.rCritical : COLORS.ink }}
              >
                <div className="text-[9px] uppercase tracking-[0.2em] font-medium whitespace-nowrap">
                  Due
                </div>
                <div
                  className="text-xs font-light mt-0.5 whitespace-nowrap"
                  style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
                >
                  {dueDateCalc.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer explanation */}
      <div
        className="mt-6 pt-4 flex items-center gap-6 text-[10px] uppercase tracking-[0.15em]"
        style={{ color: COLORS.inkSoft, borderTop: `1px solid ${COLORS.divider}` }}
      >
        <div className="flex items-center gap-2">
          <div className="w-6 h-[3px] rounded-sm" style={{ backgroundColor: COLORS.brass }} />
          <span>Stage exit p10–p90</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[6px] rounded-sm" style={{ backgroundColor: COLORS.cognac }} />
          <span>Completion p10–p90</span>
        </div>
        {elapsedWorkHours > 0.5 && (
          <div className="ml-auto" style={{ color: COLORS.inkFaint }}>
            Elapsed: {formatHours(elapsedWorkHours)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * QuantileBar — compact visualization of a single quantile range with due date.
 * Used in the Detail tab to show both stage exit and total separately.
 */
function QuantileBar({ title, quantiles, etas, dueDate, now }) {
  const p10 = etas.p10.getTime();
  const p50 = etas.p50.getTime();
  const p75 = etas.p75.getTime();
  const p90 = etas.p90.getTime();
  const dueTs = dueDate ? dueDate.getTime() : null;
  const nowTs = now.getTime();

  const minTs = Math.min(nowTs, p10) - 60000;
  const maxTs = Math.max(dueTs || p90, p90) + 60000;
  const span = Math.max(1, maxTs - minTs);
  const pct = (ts) => ((ts - minTs) / span) * 100;

  const dueInRange = dueTs && dueTs >= p10 && dueTs <= p90;
  const dueBehindP50 = dueTs && dueTs < p50;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] font-medium" style={{ color: COLORS.inkSoft }}>
          {title}
        </div>
        <div
          className="text-xs tabular-nums"
          style={{ color: COLORS.ink, fontFamily: "'JetBrains Mono', monospace" }}
        >
          {formatHours(quantiles.p10)} — {formatHours(quantiles.p90)}
        </div>
      </div>
      <div className="relative h-8 rounded-sm" style={{ backgroundColor: COLORS.cream }}>
        {/* Full range (p10 to p90) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-sm"
          style={{
            left: `${pct(p10)}%`,
            width: `${pct(p90) - pct(p10)}%`,
            background: `linear-gradient(90deg, ${COLORS.cognacLight}80, ${COLORS.cognac}, ${COLORS.cognacLight}80)`,
          }}
        />
        {/* Core range (p50 to p75) emphasized */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 rounded-sm"
          style={{
            left: `${pct(p50)}%`,
            width: `${pct(p75) - pct(p50)}%`,
            backgroundColor: COLORS.cognac,
          }}
        />
        {/* P50 dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
          style={{
            left: `${pct(p50)}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor: COLORS.paper,
            border: `2px solid ${COLORS.cognac}`,
          }}
        />
        {/* NOW line */}
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: `${pct(nowTs)}%`,
            width: 1,
            backgroundColor: COLORS.ink,
          }}
        />
        {/* DUE marker */}
        {dueTs && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${pct(dueTs)}%`,
              width: 2,
              backgroundColor: dueBehindP50 ? COLORS.rCritical : COLORS.ink,
            }}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px]" style={{ color: COLORS.inkFaint }}>
        <span>Now</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          p50: {formatDate(etas.p50, true)}
        </span>
        {dueDate && <span>Due {formatDate(dueDate, false)}</span>}
      </div>
    </div>
  );
}

/**
 * RiskFactors — shows the reasons the model flagged this case, with feature values.
 */
function RiskFactors({ prediction }) {
  const { riskReasons, featureDict, riskLevel } = prediction;
  const style = RISK_STYLE[riskLevel];

  if (!riskReasons || riskReasons.length === 0) {
    return (
      <div
        className="p-6 rounded-sm flex items-start gap-3"
        style={{ backgroundColor: COLORS.rLowBg, border: `1px solid ${COLORS.rLow}22` }}
      >
        <CheckCircle2 size={18} style={{ color: COLORS.rLow, marginTop: 2 }} />
        <div>
          <div className="text-sm font-medium" style={{ color: COLORS.rLow }}>
            No risk signals detected
          </div>
          <div className="text-xs mt-1" style={{ color: COLORS.inkSoft }}>
            The model sees this case as operating within normal parameters.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {riskReasons.map((reason, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-4 rounded-sm"
          style={{
            backgroundColor: COLORS.paper,
            border: `1px solid ${COLORS.borderSoft}`,
          }}
        >
          <div
            className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: style.fg }}
          />
          <div className="text-sm leading-relaxed" style={{ color: COLORS.ink }}>
            {reason}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Feature table — all 108 features sorted by abs value, with human labels.
 */
function FeatureTable({ prediction }) {
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const arr = prediction.featureNames.map((name, i) => ({
      name,
      label: FEATURE_LABELS[name] || name.replace(/_/g, " "),
      value: prediction.featureArray[i],
    }));
    const nonzero = arr.filter((r) => Math.abs(r.value) > 1e-9);
    const sorted = nonzero.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    if (filter === "nonzero") return sorted;
    if (filter === "auto") return sorted.filter((r) => r.name.startsWith("h_to_") || r.name.startsWith("has_") || r.name.startsWith("count_"));
    if (filter === "deep") return sorted.filter((r) =>
      ["rush_added_late","hours_to_first_action","batch_siblings","early_actions","hold_cycles",
       "longest_gap","gap_before_entry","due_changes_closer","due_changes_further","due_net_direction",
       "mid_stage_actions","stage_position","stages_remaining","backward_count","unique_users",
       "created_outside_hours","has_appt"].includes(r.name));
    return arr;
  }, [prediction, filter]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {[
          { k: "all",     label: "All 108" },
          { k: "nonzero", label: "Active" },
          { k: "deep",    label: "Deep signals" },
          { k: "auto",    label: "Event timing" },
        ].map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className="text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 rounded-sm transition-colors"
            style={{
              color: filter === k ? COLORS.paper : COLORS.inkSoft,
              backgroundColor: filter === k ? COLORS.cognac : COLORS.cream,
              border: `1px solid ${filter === k ? COLORS.cognac : COLORS.borderSoft}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="rounded-sm overflow-hidden"
        style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
      >
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead
              className="sticky top-0 z-10"
              style={{ backgroundColor: COLORS.cream }}
            >
              <tr>
                <th
                  className="text-left px-4 py-2.5 text-[10px] uppercase tracking-[0.15em] font-medium"
                  style={{ color: COLORS.inkFaint }}
                >
                  Feature
                </th>
                <th
                  className="text-right px-4 py-2.5 text-[10px] uppercase tracking-[0.15em] font-medium"
                  style={{ color: COLORS.inkFaint }}
                >
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.name}
                  style={{
                    borderTop: i === 0 ? "none" : `1px solid ${COLORS.divider}`,
                    backgroundColor: Math.abs(r.value) > 1e-9 ? undefined : COLORS.cream,
                  }}
                >
                  <td className="px-4 py-2">
                    <div
                      className="text-sm"
                      style={{ color: Math.abs(r.value) > 1e-9 ? COLORS.ink : COLORS.inkFaint }}
                    >
                      {r.label}
                    </div>
                    <div className="text-[10px]" style={{ color: COLORS.inkFaint }}>
                      {r.name}
                    </div>
                  </td>
                  <td
                    className="px-4 py-2 text-right font-light"
                    style={{
                      color: Math.abs(r.value) > 1e-9 ? COLORS.cognac : COLORS.inkFaint,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                    }}
                  >
                    {typeof r.value === "number"
                      ? (Math.abs(r.value) < 0.001 && r.value !== 0
                          ? r.value.toExponential(2)
                          : r.value.toFixed(3))
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * Main Analytics Modal
 */
export function CaseRiskAnalyticsModal({ prediction, onClose }) {
  const [tab, setTab] = useState("overview");

  // Inject fonts once
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "v8-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400&display=swap";
    document.head.appendChild(link);
  }, []);

  if (!prediction) return null;
  const style = RISK_STYLE[prediction.riskLevel];
  const now = getCurrentTime();

  return (
    <div
      className="fixed inset-0 z-[10002] overflow-y-auto flex items-start justify-center p-6"
      style={{
        backgroundColor: "rgba(26, 22, 18, 0.55)",
        backdropFilter: "blur(4px)",
        fontFamily: "'DM Sans', -apple-system, system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-8 rounded-sm overflow-hidden shadow-2xl"
        style={{ backgroundColor: COLORS.cream }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============ HEADER ============ */}
        <div
          className="relative px-10 pt-10 pb-8"
          style={{ backgroundColor: COLORS.paper, borderBottom: `1px solid ${COLORS.divider}` }}
        >
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-1.5 rounded-sm hover:opacity-70 transition-opacity"
            style={{ color: COLORS.inkSoft }}
          >
            <X size={18} />
          </button>

          <div className="flex items-start justify-between mb-6">
            <div>
              <div
                className="text-[10px] uppercase tracking-[0.25em] font-medium mb-3"
                style={{ color: COLORS.inkFaint }}
              >
                Case Analysis · {prediction.modelUsed}
              </div>
              <div
                className="text-5xl font-light leading-none mb-3"
                style={{
                  color: COLORS.ink,
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  letterSpacing: "-0.01em",
                }}
              >
                {prediction.caseNumber}
              </div>
              <div className="flex items-center gap-3 text-sm" style={{ color: COLORS.inkSoft }}>
                <span className="capitalize">{prediction.currentStage} stage</span>
                <span style={{ color: COLORS.inkFaint }}>·</span>
                <span>{Math.round(prediction.progressPercent)}% elapsed</span>
                <span style={{ color: COLORS.inkFaint }}>·</span>
                <span>{prediction.confidenceScore}% confidence</span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <RiskBadge level={prediction.riskLevel} size="lg" />
              <div className="text-[10px]" style={{ color: COLORS.inkFaint }}>
                Risk score {prediction.riskScore}
              </div>
            </div>
          </div>

          {/* Recommendation banner */}
          <div
            className="flex items-start gap-3 px-5 py-4 rounded-sm"
            style={{
              backgroundColor: style.bg,
              border: `1px solid ${style.fg}22`,
            }}
          >
            <div
              className="mt-0.5 w-1 self-stretch rounded-full flex-shrink-0"
              style={{ backgroundColor: style.fg, width: 2 }}
            />
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-[0.18em] font-medium mb-1" style={{ color: style.fg }}>
                Recommendation
              </div>
              <div className="text-sm font-medium" style={{ color: COLORS.ink }}>
                {prediction.recommendation}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-8 mt-8" style={{ borderBottom: "none" }}>
            {[
              { k: "overview",  label: "Overview",    icon: Target },
              { k: "timeline",  label: "Timeline",    icon: Clock },
              { k: "signals",   label: "Risk signals",icon: AlertCircle },
              { k: "features",  label: "Features",    icon: Sparkles },
            ].map(({ k, label, icon: Icon }) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="relative flex items-center gap-2 pb-3 text-sm transition-colors"
                style={{
                  color: tab === k ? COLORS.cognac : COLORS.inkSoft,
                  borderBottom: tab === k ? `2px solid ${COLORS.cognac}` : "2px solid transparent",
                  marginBottom: -1,
                  fontWeight: tab === k ? 500 : 400,
                }}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ============ BODY ============ */}
        <div className="px-10 py-8">
          {tab === "overview" && <OverviewTab prediction={prediction} />}
          {tab === "timeline" && <TimelineTab prediction={prediction} />}
          {tab === "signals"  && <SignalsTab  prediction={prediction} />}
          {tab === "features" && <FeaturesTab prediction={prediction} />}
        </div>

        {/* ============ FOOTER ============ */}
        <div
          className="px-10 py-5 flex items-center justify-between"
          style={{ backgroundColor: COLORS.paper, borderTop: `1px solid ${COLORS.divider}` }}
        >
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: COLORS.inkFaint }}>
            Predictions update live · {prediction.backlogCount} concurrent in stage
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm rounded-sm transition-colors"
            style={{
              color: COLORS.paper,
              backgroundColor: COLORS.ink,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** ========================================================================
 *  TAB PANES
 *  ======================================================================== */

function OverviewTab({ prediction }) {
  const { totalHours, stageHours, lateProbability, rescheduleProbability,
          confidenceScore, hoursIdle, backlogCount, qcLoops, stageMoves } = prediction;

  const slackH = (prediction.dueDateCalc && prediction.completionETA)
    ? (prediction.dueDateCalc.getTime() - prediction.completionETA.getTime()) / 3600000
    : null;

  return (
    <div className="space-y-8">
      {/* Hero timeline */}
      <TimelineHero prediction={prediction} />

      {/* Key metrics row */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard
          label="Risk score"
          value={prediction.riskScore}
          sublabel={`${formatPercent(lateProbability * 100, 0)} chance of being late`}
          accent={prediction.riskLevel === "critical" || prediction.riskLevel === "high"}
        />
        <MetricCard
          label="Completion ETA"
          value={formatDate(prediction.completionETA, false)}
          sublabel={`p50 · ${formatHours(totalHours.p50)} work remaining`}
        />
        <MetricCard
          label={slackH !== null && slackH < 0 ? "Past due by" : "Buffer"}
          value={slackH !== null ? formatHours(Math.abs(slackH)) : "—"}
          sublabel={slackH !== null
            ? (slackH < 0 ? "overrun of due date" : "time left before due")
            : "no due date"}
          accent={slackH !== null && slackH < 0}
        />
        <MetricCard
          label="Confidence"
          value={`${confidenceScore}%`}
          sublabel="increases as case progresses"
        />
      </div>

      {/* Secondary row: Reschedule + Operational */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className="p-5 rounded-sm"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] mb-3"
            style={{ color: COLORS.inkFaint }}
          >
            Probability matrix
          </div>
          <div className="space-y-3">
            <ProbRow label="Late" value={lateProbability} color={COLORS.cognac} />
            <ProbRow label="Due rescheduled" value={rescheduleProbability} color={COLORS.brass} />
          </div>
        </div>

        <div
          className="p-5 rounded-sm col-span-2"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] mb-3"
            style={{ color: COLORS.inkFaint }}
          >
            Operational context
          </div>
          <div className="grid grid-cols-4 gap-4">
            <KVStat label="Concurrent" value={backlogCount} />
            <KVStat label="Hours idle" value={formatHours(hoursIdle)} />
            <KVStat label="Hold time" value={formatHours(prediction.holdHours || 0)} />
            <KVStat label="QC loops" value={qcLoops} />
          </div>
        </div>
      </div>

      {/* Stage-level breakdown */}
      <div
        className="p-6 rounded-sm"
        style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
      >
        <div
          className="text-[10px] uppercase tracking-[0.18em] mb-5"
          style={{ color: COLORS.inkFaint }}
        >
          Prediction breakdown
        </div>
        <div className="space-y-6">
          <QuantileBar
            title={`Stage exit · ${prediction.currentStage}`}
            quantiles={stageHours}
            etas={prediction.stageETAs}
            dueDate={prediction.dueDateCalc}
            now={getCurrentTime()}
          />
          <QuantileBar
            title="Total completion · to done"
            quantiles={totalHours}
            etas={prediction.totalETAs}
            dueDate={prediction.dueDateCalc}
            now={getCurrentTime()}
          />
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ prediction }) {
  const { stageHours, totalHours, stageETAs, totalETAs } = prediction;
  const now = getCurrentTime();

  const rows = [
    { label: "Stage entered", value: formatDate(prediction.stageEnteredAt), muted: true },
    { label: "Time in stage", value: formatDuration(prediction.timeInStageMs), muted: true },
    { label: "Elapsed work", value: formatHours(prediction.elapsedWorkHours), muted: true },
    { divider: true },
    { label: "Stage exit · p10 (optimistic)",   value: formatDate(stageETAs.p10), sub: formatHours(stageHours.p10) },
    { label: "Stage exit · p50 (best estimate)", value: formatDate(stageETAs.p50), sub: formatHours(stageHours.p50), bold: true },
    { label: "Stage exit · p75 (conservative)", value: formatDate(stageETAs.p75), sub: formatHours(stageHours.p75) },
    { label: "Stage exit · p90 (pessimistic)",  value: formatDate(stageETAs.p90), sub: formatHours(stageHours.p90) },
    { divider: true },
    { label: "Completion · p10 (optimistic)",   value: formatDate(totalETAs.p10), sub: formatHours(totalHours.p10) },
    { label: "Completion · p50 (best estimate)", value: formatDate(totalETAs.p50), sub: formatHours(totalHours.p50), bold: true },
    { label: "Completion · p75 (conservative)", value: formatDate(totalETAs.p75), sub: formatHours(totalHours.p75) },
    { label: "Completion · p90 (pessimistic)",  value: formatDate(totalETAs.p90), sub: formatHours(totalHours.p90) },
    { divider: true },
    { label: "Due date", value: formatDate(prediction.dueDateCalc, false), highlight: true },
  ];

  return (
    <div className="space-y-8">
      <TimelineHero prediction={prediction} />

      <div
        className="rounded-sm overflow-hidden"
        style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
      >
        {rows.map((row, i) => {
          if (row.divider) {
            return <div key={i} style={{ height: 1, backgroundColor: COLORS.divider }} />;
          }
          return (
            <div
              key={i}
              className="flex items-center justify-between px-6 py-3.5"
              style={{
                borderTop: i === 0 ? "none" : `1px solid ${COLORS.divider}`,
                backgroundColor: row.highlight ? COLORS.cognacGlow : "transparent",
              }}
            >
              <div
                className="text-sm"
                style={{
                  color: row.muted ? COLORS.inkSoft : row.highlight ? COLORS.cognac : COLORS.ink,
                  fontWeight: row.bold ? 500 : 400,
                }}
              >
                {row.label}
              </div>
              <div className="flex items-center gap-4">
                {row.sub && (
                  <div
                    className="text-xs tabular-nums"
                    style={{ color: COLORS.inkFaint, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {row.sub}
                  </div>
                )}
                <div
                  className="text-sm tabular-nums"
                  style={{
                    color: row.highlight ? COLORS.cognac : COLORS.ink,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: row.bold || row.highlight ? 500 : 400,
                  }}
                >
                  {row.value}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignalsTab({ prediction }) {
  const { riskLevel, lateProbability, rescheduleProbability,
          lateProbabilityDirect, lateProbabilityQuantile,
          riskFromClassifier, riskFromQuantiles, signalsAgree } = prediction;
  const style = RISK_STYLE[riskLevel];
  const hasClassifier = lateProbabilityDirect !== undefined && lateProbabilityDirect !== null;

  return (
    <div className="grid grid-cols-5 gap-6">
      {/* Left: Probability gauges */}
      <div className="col-span-2 space-y-4">
        <div
          className="p-6 rounded-sm"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div className="text-[10px] uppercase tracking-[0.18em] mb-4" style={{ color: COLORS.inkFaint }}>
            Model outputs
          </div>

          <div className="flex justify-center py-4">
            <RingGauge value={prediction.riskScore} max={100} color={style.fg} size={160} />
          </div>

          <div className="mt-4 space-y-3">
            <ProbRow label="P(late)" value={lateProbability} color={COLORS.cognac} showPercent />
            <ProbRow label="P(reschedule)" value={rescheduleProbability} color={COLORS.brass} showPercent />
            <ProbRow label="Confidence" value={prediction.confidenceScore / 100} color={COLORS.rLow} showPercent />
          </div>

          <div
            className="mt-5 pt-4 text-[11px] leading-relaxed"
            style={{ color: COLORS.inkSoft, borderTop: `1px solid ${COLORS.divider}` }}
          >
            {hasClassifier ? (
              <>P(late) comes from a dedicated binary classifier trained
              directly on historical outcomes. The risk level reflects calibrated
              operational thresholds.</>
            ) : (
              <>Risk level derived from where the due date falls in the
              predicted completion range.</>
            )}
          </div>
        </div>

        {/* Signal agreement — the trust-building panel */}
        {hasClassifier && (
          <div
            className="p-5 rounded-sm"
            style={{
              backgroundColor: signalsAgree ? COLORS.rLowBg : COLORS.rMediumBg,
              border: `1px solid ${signalsAgree ? COLORS.rLow : COLORS.rMedium}44`,
            }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.18em] mb-3"
              style={{ color: signalsAgree ? COLORS.rLow : COLORS.rMedium, fontWeight: 500 }}
            >
              {signalsAgree ? "Model signals agree" : "Model signals disagree"}
            </div>
            <div className="space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span style={{ color: COLORS.inkSoft }}>Classifier says:</span>
                <span style={{ color: COLORS.ink, fontWeight: 500, textTransform: "capitalize" }}>
                  {riskFromClassifier} ({(lateProbabilityDirect * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: COLORS.inkSoft }}>Quantile view says:</span>
                <span style={{ color: COLORS.ink, fontWeight: 500, textTransform: "capitalize" }}>
                  {riskFromQuantiles} ({(lateProbabilityQuantile * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
            <div
              className="mt-3 pt-3 text-[11px] leading-relaxed"
              style={{ color: COLORS.inkSoft, borderTop: `1px solid ${COLORS.divider}` }}
            >
              {signalsAgree
                ? "Both the direct classifier and the quantile geometry reach the same conclusion — high-confidence signal."
                : "The classifier and quantile views disagree — this case has ambiguous signals and warrants human review."}
            </div>
          </div>
        )}
      </div>

      {/* Right: Reasons */}
      <div className="col-span-3 space-y-4">
        <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: COLORS.inkFaint }}>
          What the model keys on for this case
        </div>
        <RiskFactors prediction={prediction} />

        <div
          className="p-6 rounded-sm"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div className="text-[10px] uppercase tracking-[0.18em] mb-4" style={{ color: COLORS.inkFaint }}>
            Case attributes
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <AttrRow label="Type" value={prediction.caseType} />
            <AttrRow label="Rush" value={prediction.isRush ? "Yes" : "No"} />
            <AttrRow label="On hold" value={prediction.onHold ? "Yes" : "No"} />
            <AttrRow label="Stage moves" value={prediction.stageMoves} />
            <AttrRow label="Due changes" value={prediction.dueChanges} />
            <AttrRow label="QC loops" value={prediction.qcLoops} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturesTab({ prediction }) {
  return (
    <div className="space-y-4">
      <div
        className="p-4 rounded-sm text-[12px] leading-relaxed"
        style={{ backgroundColor: COLORS.cognacGlow, color: COLORS.ink, border: `1px solid ${COLORS.cognac}22` }}
      >
        <strong style={{ color: COLORS.cognac, fontWeight: 500 }}>108 features</strong> are computed
        fresh on every render. 52 base features + 20 verified deep features (pickup speed, batch
        detection, hold cycles, due-change direction) + ~36 auto-generated event timing features.
        XGBoost's 5,920 trees learned which combinations predict outcomes.
      </div>

      <FeatureTable prediction={prediction} />
    </div>
  );
}

/** ========================================================================
 *  SMALL UI HELPERS
 *  ======================================================================== */

function ProbRow({ label, value, color, showPercent = false }) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span style={{ color: COLORS.inkSoft }}>{label}</span>
        <span
          className="tabular-nums"
          style={{ color, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500 }}
        >
          {pct.toFixed(showPercent ? 1 : 0)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: COLORS.cream }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function KVStat({ label, value }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.15em] mb-1"
        style={{ color: COLORS.inkFaint }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-light leading-none"
        style={{
          color: COLORS.ink,
          fontFamily: "'Instrument Serif', Georgia, serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function AttrRow({ label, value }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.15em] mb-0.5"
        style={{ color: COLORS.inkFaint }}
      >
        {label}
      </div>
      <div className="text-sm" style={{ color: COLORS.ink }}>
        {value}
      </div>
    </div>
  );
}

function RingGauge({ value, max, color, size = 120 }) {
  const radius = (size - 14) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  const dash = pct * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLORS.divider}
          strokeWidth={4}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeDashoffset={0}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <div
          style={{
            fontSize: size * 0.32,
            fontWeight: 300,
            color,
            fontFamily: "'Instrument Serif', Georgia, serif",
            lineHeight: 1,
          }}
        >
          {Math.round(value)}
        </div>
        <div
          className="text-[10px] uppercase tracking-[0.18em] mt-1"
          style={{ color: COLORS.inkFaint }}
        >
          Risk
        </div>
      </div>
    </div>
  );
}

/** ========================================================================
 *  LIST MODAL — beautifully designed, v8-aware list of all cases
 *  ======================================================================== */

function getStatusFromPrediction(p) {
  // Risk level already comes from the model; elevate to "critical" if overdue
  const now = new Date();
  const due = p.dueDate ? new Date(p.dueDate) : p.dueDateCalc;
  const isOverdue = due && due < now;
  if (isOverdue && p.riskLevel === "low") return "medium";
  if (isOverdue) return "critical";
  return p.riskLevel || "low";
}

export function ProgressBar({ value, size = "md", color }) {
  const heights = { sm: 2, md: 4, lg: 6 };
  const h = heights[size] ?? 4;
  const percent = Math.max(0, Math.min(100, value || 0));
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height: h, backgroundColor: COLORS.cream }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${percent}%`, backgroundColor: color || COLORS.cognac }}
      />
    </div>
  );
}

/** Alias for backwards compatibility with v7's StatusBadge API */
export const StatusBadge = ({ status, size = "md" }) => (
  <RiskBadge level={status} size={size} />
);

function CompactCaseRow({ prediction, onOpenAnalytics, onOpenHistory }) {
  const status = getStatusFromPrediction(prediction);
  const style = RISK_STYLE[status] || RISK_STYLE.low;
  const now = new Date();
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : prediction.dueDateCalc;
  const completionETA = prediction.completionETA || prediction.expectedCompletionDate;
  const isOverdue = dueDate && dueDate < now;

  // Wall-clock buffer in same units as "due in X" so they don't contradict each other
  const bufferMs = dueDate && completionETA ? dueDate.getTime() - completionETA.getTime() : null;
  const bufferText = (() => {
    if (bufferMs === null) return null;
    const absMs = Math.abs(bufferMs);
    const h = absMs / 3600000;
    const d = h / 24;
    if (h < 1) return "< 1h";
    if (h < 24) return `${Math.round(h)}h`;
    if (d < 7) return `${Math.round(d)}d`;
    return `${Math.round(d / 7)}w`;
  })();

  const timeDisplay = (() => {
    if (isOverdue) {
      return { primary: "OVERDUE", secondary: formatRelativeTime(dueDate), urgent: true };
    }
    if (prediction.willBeLate) {
      return {
        primary: `Late ${bufferText}`,
        secondary: `Due ${formatRelativeTime(dueDate)}`,
        urgent: true,
      };
    }
    return {
      primary: formatRelativeTime(dueDate),
      secondary: bufferText ? `${bufferText} before due` : "on time",
      urgent: false,
    };
  })();

  // Late probability display — more precision for small values
  const latePctRaw = (prediction.lateProbability || 0) * 100;
  const latePctDisplay = (() => {
    if (latePctRaw < 1) return "<1";
    if (latePctRaw < 10) return latePctRaw.toFixed(1);
    return String(Math.round(latePctRaw));
  })();

  return (
    <button
      type="button"
      onClick={onOpenAnalytics}
      className="group relative w-full text-left rounded-sm transition-all"
      style={{
        backgroundColor: COLORS.paper,
        border: `1px solid ${COLORS.borderSoft}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.cognacLight; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.borderSoft; }}
    >
      {/* Left accent stripe */}
      <div
        className="absolute left-0 top-0 bottom-0"
        style={{ width: 3, backgroundColor: style.fg }}
      />

      <div className="pl-5 pr-4 py-4">
        <div className="flex items-center gap-5">
          {/* Risk badge */}
          <div className="w-24 flex-shrink-0">
            <RiskBadge level={status} size="sm" />
          </div>

          {/* Case number + type */}
          <div className="w-40 flex-shrink-0">
            <div
              className="text-xl leading-tight"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                color: COLORS.ink,
                fontWeight: 400,
                letterSpacing: "-0.005em",
              }}
            >
              {prediction.caseNumber}
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.15em] mt-0.5"
              style={{ color: COLORS.inkFaint }}
            >
              {prediction.caseType || "general"}
            </div>
          </div>

          {/* Due / late info */}
          <div className="flex-1 min-w-0">
            <div
              className="text-sm"
              style={{
                color: timeDisplay.urgent ? style.fg : COLORS.ink,
                fontWeight: timeDisplay.urgent ? 500 : 400,
                fontFamily: timeDisplay.urgent
                  ? "'DM Sans', sans-serif"
                  : "'Instrument Serif', Georgia, serif",
                fontSize: timeDisplay.urgent ? 13 : 16,
              }}
            >
              {timeDisplay.primary}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: COLORS.inkSoft }}>
              {timeDisplay.secondary}
            </div>
          </div>

          {/* Progress */}
          <div className="w-28 flex-shrink-0">
            <div className="flex items-center gap-2">
              <ProgressBar value={prediction.progressPercent || 0} size="sm" color={style.fg} />
              <span
                className="text-[11px] tabular-nums"
                style={{
                  color: COLORS.inkSoft,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {Math.round(prediction.progressPercent || 0)}%
              </span>
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.15em] mt-1"
              style={{ color: COLORS.inkFaint }}
            >
              Elapsed
            </div>
          </div>

          {/* Flags */}
          <div className="flex items-center gap-1.5 w-20 justify-end flex-shrink-0">
            {prediction.isRush && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-sm"
                style={{
                  color: COLORS.cognac,
                  backgroundColor: COLORS.cognacGlow,
                  fontWeight: 500,
                }}
              >
                <Zap size={9} />
                Rush
              </span>
            )}
            {prediction.onHold && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-sm"
                style={{
                  color: COLORS.brass,
                  backgroundColor: COLORS.rMediumBg,
                  fontWeight: 500,
                }}
              >
                Hold
              </span>
            )}
            {prediction.signalsAgree === false && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-sm"
                style={{
                  color: COLORS.inkSoft,
                  backgroundColor: COLORS.cream,
                  border: `1px dashed ${COLORS.inkFaint}`,
                  fontWeight: 500,
                }}
                title="Model signals disagree — review manually"
              >
                Review
              </span>
            )}
          </div>

          {/* Late probability — big, beautiful */}
          <div className="w-20 flex-shrink-0 text-right">
            <div
              className="leading-none"
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 26,
                fontWeight: 300,
                color: style.fg,
              }}
            >
              {latePctDisplay}
              <span style={{ fontSize: 14, color: COLORS.inkFaint }}>%</span>
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.15em] mt-0.5"
              style={{ color: COLORS.inkFaint }}
            >
              Late risk
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenHistory && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenHistory(prediction.id, prediction.caseNumber); }}
                className="text-[11px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-sm transition-colors"
                style={{
                  color: COLORS.inkSoft,
                  border: `1px solid ${COLORS.borderSoft}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = COLORS.cognac; e.currentTarget.style.borderColor = COLORS.cognacLight; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = COLORS.inkSoft; e.currentTarget.style.borderColor = COLORS.borderSoft; }}
              >
                History
              </button>
            )}
            <ChevronRight
              size={16}
              style={{ color: COLORS.inkFaint }}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </div>
        </div>
      </div>

      {/* Bottom progress sliver */}
      <div style={{ height: 1.5, backgroundColor: COLORS.divider }}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${Math.min(100, prediction.progressPercent || 0)}%`,
            backgroundColor: style.fg,
            opacity: 0.6,
          }}
        />
      </div>
    </button>
  );
}

/**
 * CaseRiskModal — the list view. Shows all cases with search, filter, sort.
 * Opens CaseRiskAnalyticsModal on click for full detail.
 */
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

  // Inject fonts once (safe no-op if already present)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "v8-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400&display=swap";
    document.head.appendChild(link);
  }, []);

  const processedPredictions = useMemo(() => {
    let filtered = [...(predictions || [])];
    if (filterStatus !== "all") {
      filtered = filtered.filter((p) => getStatusFromPrediction(p) === filterStatus);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter((p) =>
        String(p.caseNumber || "").toLowerCase().includes(q) ||
        String(p.caseType || "").toLowerCase().includes(q)
      );
    }
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => {
      if (sortBy === "risk") {
        return (
          order[getStatusFromPrediction(a)] - order[getStatusFromPrediction(b)] ||
          (b.lateProbability || 0) - (a.lateProbability || 0)
        );
      }
      if (sortBy === "due") {
        const aD = a.dueDateCalc || (a.dueDate ? new Date(a.dueDate) : null);
        const bD = b.dueDateCalc || (b.dueDate ? new Date(b.dueDate) : null);
        const at = aD ? aD.getTime() : Infinity;
        const bt = bD ? bD.getTime() : Infinity;
        return at - bt;
      }
      if (sortBy === "progress") return (a.progressPercent || 0) - (b.progressPercent || 0);
      if (sortBy === "case")     return String(a.caseNumber || "").localeCompare(String(b.caseNumber || ""));
      return 0;
    });
    return filtered;
  }, [predictions, filterStatus, query, sortBy]);

  const summary = useMemo(() => ({
    total: predictions.length,
    critical: predictions.filter((p) => getStatusFromPrediction(p) === "critical").length,
    high:     predictions.filter((p) => getStatusFromPrediction(p) === "high").length,
    medium:   predictions.filter((p) => getStatusFromPrediction(p) === "medium").length,
    low:      predictions.filter((p) => getStatusFromPrediction(p) === "low").length,
    avgRisk:  predictions.length
      ? (predictions.reduce((s, p) => s + (p.lateProbability || 0), 0) / predictions.length) * 100
      : 0,
    avgConfidence: predictions.length
      ? predictions.reduce((s, p) => s + (p.confidenceScore || 0), 0) / predictions.length
      : 0,
    concurrent: predictions[0]?.backlogCount || 0,
  }), [predictions]);

  useEffect(() => {
    onDataProcessed?.({
      processedPredictions, summary, stage, filterStatus, query,
      rawPredictions: predictions,
    });
  }, [processedPredictions, summary, stage, filterStatus, query, predictions, onDataProcessed]);

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[10001] flex items-center justify-center p-6 overflow-y-auto"
        style={{
          backgroundColor: "rgba(26, 22, 18, 0.55)",
          backdropFilter: "blur(4px)",
          fontFamily: "'DM Sans', -apple-system, system-ui, sans-serif",
        }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-6xl my-8 rounded-sm shadow-2xl flex flex-col overflow-hidden"
          style={{ backgroundColor: COLORS.cream, maxHeight: "90vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex-none px-10 pt-9 pb-7"
            style={{
              backgroundColor: COLORS.paper,
              borderBottom: `1px solid ${COLORS.divider}`,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-6 right-6 p-1.5 rounded-sm transition-opacity"
              style={{ color: COLORS.inkSoft }}
            >
              <X size={18} />
            </button>

            <div className="flex items-baseline justify-between mb-5">
              <div>
                <div
                  className="text-[10px] uppercase tracking-[0.25em] font-medium mb-3"
                  style={{ color: COLORS.inkFaint }}
                >
                  Case Risk Predictions · v8
                </div>
                <div
                  className="text-4xl font-light leading-none"
                  style={{
                    color: COLORS.ink,
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {summary.total} {summary.total === 1 ? "case" : "cases"}
                  {stage && (
                    <span
                      className="ml-3 text-lg capitalize"
                      style={{ color: COLORS.inkSoft, fontStyle: "italic" }}
                    >
                      in {stage}
                    </span>
                  )}
                </div>
                <div
                  className="mt-2 flex items-center gap-3 text-sm"
                  style={{ color: COLORS.inkSoft }}
                >
                  <span>Avg risk {formatPercent(summary.avgRisk, 1)}</span>
                  <span style={{ color: COLORS.inkFaint }}>·</span>
                  <span>Avg confidence {Math.round(summary.avgConfidence)}%</span>
                  <span style={{ color: COLORS.inkFaint }}>·</span>
                  <span>{summary.concurrent} concurrent</span>
                </div>
              </div>
            </div>

            {/* Filter pills */}
            <div className="grid grid-cols-5 gap-2.5">
              {[
                { k: "all",      label: "All",      count: summary.total,    color: COLORS.ink,       bg: COLORS.cream },
                { k: "critical", label: "Critical", count: summary.critical, color: COLORS.rCritical, bg: COLORS.rCriticalBg },
                { k: "high",     label: "High",     count: summary.high,     color: COLORS.rHigh,     bg: COLORS.rHighBg },
                { k: "medium",   label: "Medium",   count: summary.medium,   color: COLORS.rMedium,   bg: COLORS.rMediumBg },
                { k: "low",      label: "Low",      count: summary.low,      color: COLORS.rLow,      bg: COLORS.rLowBg },
              ].map(({ k, label, count, color, bg }) => {
                const active = filterStatus === k || (k === "all" && filterStatus === "all");
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilterStatus(filterStatus === k ? "all" : k)}
                    className="relative rounded-sm px-4 py-3 text-left transition-all"
                    style={{
                      backgroundColor: active ? bg : COLORS.paper,
                      border: `1px solid ${active ? color + "55" : COLORS.borderSoft}`,
                    }}
                  >
                    <div
                      className="text-[10px] uppercase tracking-[0.18em] font-medium mb-1"
                      style={{ color: active ? color : COLORS.inkFaint }}
                    >
                      {label}
                    </div>
                    <div
                      className="text-3xl font-light leading-none"
                      style={{
                        color: active ? color : COLORS.ink,
                        fontFamily: "'Instrument Serif', Georgia, serif",
                      }}
                    >
                      {count}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Search + sort */}
            <div className="flex items-center gap-3 mt-5">
              <div className="relative flex-1 max-w-xs">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search cases..."
                  className="w-full px-4 py-2 text-sm rounded-sm focus:outline-none transition-colors"
                  style={{
                    color: COLORS.ink,
                    backgroundColor: COLORS.cream,
                    border: `1px solid ${COLORS.borderSoft}`,
                  }}
                  onFocus={(e) => { e.target.style.borderColor = COLORS.cognacLight; }}
                  onBlur={(e) => { e.target.style.borderColor = COLORS.borderSoft; }}
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 text-sm rounded-sm focus:outline-none cursor-pointer"
                style={{
                  color: COLORS.ink,
                  backgroundColor: COLORS.cream,
                  border: `1px solid ${COLORS.borderSoft}`,
                }}
              >
                <option value="risk">Sort by risk</option>
                <option value="due">Sort by due date</option>
                <option value="progress">Sort by progress</option>
                <option value="case">Sort by case number</option>
              </select>
              {filterStatus !== "all" && (
                <button
                  type="button"
                  onClick={() => setFilterStatus("all")}
                  className="text-[11px] uppercase tracking-[0.14em] px-3 py-2 rounded-sm transition-colors"
                  style={{
                    color: COLORS.inkSoft,
                    backgroundColor: COLORS.paper,
                    border: `1px solid ${COLORS.borderSoft}`,
                  }}
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-8 py-6" style={{ backgroundColor: COLORS.cream }}>
            {processedPredictions.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-20"
                style={{ color: COLORS.inkFaint }}
              >
                <CircleDot size={32} style={{ color: COLORS.inkFaint }} />
                <div
                  className="mt-4 text-2xl font-light"
                  style={{
                    color: COLORS.ink,
                    fontFamily: "'Instrument Serif', Georgia, serif",
                  }}
                >
                  No cases match
                </div>
                <div className="mt-1 text-sm">Try adjusting your filters or search</div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {processedPredictions.map((p) => (
                  <CompactCaseRow
                    key={p.id || p.caseNumber}
                    prediction={p}
                    onOpenAnalytics={() => setSelectedPrediction(p)}
                    onOpenHistory={onOpenCaseHistory}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex-none px-10 py-4 flex items-center justify-between"
            style={{
              backgroundColor: COLORS.paper,
              borderTop: `1px solid ${COLORS.divider}`,
            }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.18em]"
              style={{ color: COLORS.inkFaint }}
            >
              {processedPredictions.length} of {predictions.length} cases · Live predictions update every render
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm rounded-sm transition-colors"
              style={{ color: COLORS.paper, backgroundColor: COLORS.ink }}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Analytics detail modal opens on top */}
      {selectedPrediction && (
        <CaseRiskAnalyticsModal
          prediction={selectedPrediction}
          onClose={() => setSelectedPrediction(null)}
        />
      )}
    </>,
    document.body
  );
}

/** ========================================================================
 *  BACKWARDS-COMPAT EXPORTS
 *  ======================================================================== */

// Stub — kept so any old code calling this doesn't break
export const calculateRiskWithVelocityEngine = async () => ({
  predictions: [],
  velocityImpact: null,
});

// Aliases for the standalone components so external code can import them
export const StandaloneCompactRow = CompactCaseRow;
export const StandaloneAnalyticsModal = CaseRiskAnalyticsModal;
export { COLORS };

/** ========================================================================
 *  DEFAULT EXPORT
 *  ======================================================================== */

export default CaseRiskAnalyticsModal;
