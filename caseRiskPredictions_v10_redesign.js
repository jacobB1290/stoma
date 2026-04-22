// /src/utils/caseRiskPredictions.js
// =================================================================
// v10 — Unified Quantile Prediction System (with cross-case lab context)
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
//   1. Place xgb_v10_final.json in /public
//   2. Import { loadModels, generateCaseRiskPredictions, CaseRiskAnalyticsModal }
//   3. Call loadModels() once at app init (returns a Promise)
//   4. IMPORTANT: pass `recentCompletedVisits` OR `completedCasesForContext`
//      into generateCaseRiskPredictions options. If you can only pass one
//      list of cases, include completed cases from the last 30 days as well
//      as active ones — otherwise 5 cross-case features silently degrade to
//      zero. See the note above generateCaseRiskPredictions.
//
// v10 vs v9 — same 131-feature schema, drop-in model swap. What changed:
//   • Training backfills concurrent_in_stage + 5 derived features (v9 hardcoded
//     them to 0, silently breaking the train/inference contract for 6 features
//     the UI was already sending).
//   • Recency weighting tightened from 90d → 45d to track workflow drift.
//   • Late classifier label is now whole-case overrun (snapshot-independent),
//     fixing the mid-stage positive-rate collapse. AUC @ sf=0.5 went from
//     0.28 (worse than random) to 0.79-0.99.
//
// Measured on a walk-forward 30-day holdout vs v9:
//   • Pooled stage-exit close@1h|15%: 31.9% → 57.7%
//   • Pooled stage-exit MAE:          4.27h → 3.43h (-20%)
//   • Late classifier AUC design:     0.28  → 0.79
//   • Late classifier AUC production: 0.28  → 0.99
//
// v10: 131 features total (108 base + 23 cross-case context features) —
// unchanged schema. labContext is computed once per render via
// computeLabContextV9() (name retained for back-compat) and shared across
// all cases.
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

const V9_CONTEXT_NAMES = [
  "lab_active", "lab_rush", "lab_overdue", "lab_due_today", "lab_due_3d",
  "stage_active_count", "stage_active_rush",
  "stage_avg_7d", "stage_throughput_7d", "stage_avg_30d", "stage_trend_7d_30d",
  "cases_ahead_earlier_due", "cases_ahead_rush", "target_due_rank",
  "log_lab_active",
];

const V9_INTERACTION_NAMES = [
  "hour_sin", "hour_cos", "dow_sin", "dow_cos",
  "lab_x_stage_active", "lab_x_stage_trend", "sqrt_lab_active",
  "stage_load_ratio_vs_typical",
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
  // Surfaces — mapped to CSS theme variables so the modal follows the active theme
  cream:       "var(--w-surface-2, #f3f4f6)",
  paper:       "var(--w-surface, #ffffff)",
  bg:          "var(--w-bg, #f7f8fb)",
  ink:         "var(--w-text, #0f172a)",
  inkSoft:     "var(--w-text-muted, #475569)",
  inkFaint:    "var(--w-text-subtle, #64748b)",
  divider:     "var(--w-border, rgba(15,23,42,0.12))",
  borderSoft:  "var(--w-border, rgba(15,23,42,0.12))",
  surface:     "var(--w-surface-2, #f3f4f6)",
  // Accents
  cognac:      "var(--w-accent, #16525f)",
  cognacLight: "var(--w-accent-hover, #1f6f7c)",
  cognacGlow:  "var(--w-accent-surface, #a7bec2)",
  brass:       "var(--w-text-muted, #475569)",
  // Risk
  rCritical:   "var(--w-priority-ink, #9f1239)",
  rCriticalBg: "var(--w-priority-surface, #ffe4e6)",
  rHigh:       "var(--w-rush-ink, #9a3412)",
  rHighBg:     "var(--w-rush-surface, #ffedd5)",
  rMedium:     "var(--w-hold-ink, #92400e)",
  rMediumBg:   "var(--w-hold-surface, #fef3c7)",
  rLow:        "#16a34a",
  rLowBg:      "#f0fdf4",
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

export function loadModels(modelUrl = "/xgb_v10_final.json") {
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


// ============================================================================
// v10 CROSS-CASE CONTEXT & INTERACTION FEATURES (unchanged schema vs v9)
// ============================================================================

/**
 * Parse case_history arrays and return every stage visit that ended
 * within the past `windowDays` days. Output shape matches computeLabContextV9:
 *   [{ stage, entry, exit, case }, ...]
 *
 * Stage transitions are detected from history actions like
 *   "moved from design to production"  (ends a design visit, starts a production visit)
 *   "moved from quality control back to finishing"
 *   "marked done" (ends the current visit)
 *
 * Completed visits = visits with both entry and exit timestamps; in-progress
 * (still-active) visits are skipped here — they're counted via activeCases.
 */
export function extractRecentCompletedVisits(cases, now = null, windowDays = 30) {
  const effectiveNow = now || getCurrentTime();
  const cutoff = new Date(effectiveNow.getTime() - windowDays * 86400000);
  const visits = [];

  for (const c of (cases || [])) {
    const history = c.case_history || c.caseHistory || [];
    if (!history.length) continue;

    const sorted = [...history].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    let currentStage = null;
    let currentEntry = null;

    const close = (exitDate) => {
      if (currentStage && currentEntry && exitDate && exitDate >= cutoff) {
        visits.push({ stage: currentStage, entry: currentEntry, exit: exitDate, case: c });
      }
      currentStage = null;
      currentEntry = null;
    };

    for (const entry of sorted) {
      const action = String(entry.action || "").toLowerCase();
      const ts = new Date(entry.created_at);
      if (isNaN(ts)) continue;

      let newStage = null;
      if (action.includes("moved from") && action.includes("to")) {
        if (action.includes("to design")) newStage = "design";
        else if (action.includes("to production")) newStage = "production";
        else if (action.includes("to finishing")) newStage = "finishing";
        else if (action.includes("to quality control")) newStage = "qc";
      } else if (action.includes("assigned to") && action.includes("stage")) {
        if (action.includes("design")) newStage = "design";
        else if (action.includes("production")) newStage = "production";
        else if (action.includes("finishing")) newStage = "finishing";
      } else if (action === "marked done") {
        close(ts);
        continue;
      }

      if (newStage) {
        close(ts);
        currentStage = newStage;
        currentEntry = ts;
      }
    }
  }

  return visits;
}

/**
 * Compute the 15 cross-case context features from the full dashboard state.
 * These depend on what OTHER cases are doing right now + recent completions.
 * Compute once per render and reuse across all case predictions.
 *
 * @param {Array} activeCases - all non-completed cases
 * @param {Array} recentCompletedVisits - visits completed in past 30 days
 *   [{stage, entry, exit, case}, ...]
 * @param {Date} now - current time
 * @returns {Object} labContext — shared across all cases
 */
export function computeLabContextV9(activeCases, recentCompletedVisits, now = null) {
  now = now || getCurrentTime();
  
  // Lab-wide load (same for every case on this render)
  let labActive = 0, labRush = 0, labOverdue = 0, labDueToday = 0, labDue3d = 0;
  for (const c of (activeCases || [])) {
    if (c.completed || c.archived) continue;
    labActive++;
    const mods = strSet(c.modifiers);
    if (mods.has("rush") || c.priority) labRush++;
    const due = dueEOD(c.due);
    if (due) {
      const daysToDue = (due - now) / 86400000;
      if (daysToDue < 0) labOverdue++;
      else if (daysToDue < 1) labDueToday++;
      if (daysToDue < 3) labDue3d++;
    }
  }
  
  // Per-stage load + recent performance
  const stages = ["design", "production", "finishing", "qc"];
  const perStage = {};
  
  for (const stg of stages) {
    let stageActiveCount = 0, stageActiveRush = 0;
    const stageActiveCases = [];
    for (const c of (activeCases || [])) {
      if (c.completed || c.archived) continue;
      const cStage = normalizeStage(c.stage || c.current_stage);
      if (cStage !== stg) continue;
      stageActiveCount++;
      const mods = strSet(c.modifiers);
      if (mods.has("rush") || c.priority) stageActiveRush++;
      stageActiveCases.push(c);
    }
    
    // Recent completed visits for this stage
    const stg7dCutoff = new Date(now - 7 * 86400000);
    const stg30dCutoff = new Date(now - 30 * 86400000);
    let stg7d = [], stg30d = [];
    for (const v of (recentCompletedVisits || [])) {
      if (v.stage !== stg) continue;
      if (v.exit >= stg7dCutoff) stg7d.push(v);
      if (v.exit >= stg30dCutoff) stg30d.push(v);
    }
    
    let stageAvg7d = 0, stageThroughput7d = 0, stageAvg30d = 0;
    if (stg7d.length > 0) {
      stageAvg7d = stg7d.reduce((s, v) => 
        s + businessHoursBetween(v.entry, v.exit), 0) / stg7d.length;
      stageThroughput7d = stg7d.length / 7.0;
    }
    if (stg30d.length > 0) {
      stageAvg30d = stg30d.reduce((s, v) => 
        s + businessHoursBetween(v.entry, v.exit), 0) / stg30d.length;
    } else {
      stageAvg30d = stageAvg7d;
    }
    const stageTrend = stageAvg7d / Math.max(0.5, stageAvg30d);
    
    perStage[stg] = {
      stageActiveCount, stageActiveRush, stageActiveCases,
      stageAvg7d, stageThroughput7d, stageAvg30d, stageTrend,
    };
  }
  
  return {
    now,
    labActive, labRush, labOverdue, labDueToday, labDue3d,
    perStage,
  };
}

/**
 * Compute per-case v10 extras (15 context + 8 interaction = 23 features).
 * Uses the shared labContext for efficiency.
 * 
 * @param {Object} caseObj - the target case
 * @param {string} stage - normalized stage
 * @param {Date} entryTime - when case entered this stage
 * @param {Object} labContext - output of computeLabContextV9
 * @returns {Array<number>} 23 feature values in exact order
 */
export function computeV9ExtraFeatures(caseObj, stage, entryTime, labContext) {
  const { labActive, labRush, labOverdue, labDueToday, labDue3d, perStage } = labContext;
  const stageCtx = perStage[stage] || {
    stageActiveCount: 0, stageActiveRush: 0, stageActiveCases: [],
    stageAvg7d: 0, stageThroughput7d: 0, stageAvg30d: 0, stageTrend: 1.0,
  };
  
  const targetDue = dueEOD(caseObj.due);
  
  // Queue position within target stage
  let casesAheadEarlierDue = 0, casesAheadRush = 0;
  for (const other of stageCtx.stageActiveCases) {
    if (other.id === caseObj.id) continue;
    const otherEntry = getStageEnteredAtFor(other, stage);
    if (!otherEntry || otherEntry >= entryTime) continue;
    const otherDue = dueEOD(other.due);
    if (otherDue && targetDue && otherDue <= targetDue) casesAheadEarlierDue++;
    const otherMods = strSet(other.modifiers);
    if (otherMods.has("rush") || other.priority) casesAheadRush++;
  }
  
  // Due-date rank (0 = earliest, 1 = latest)
  let targetDueRank = 0.5;
  if (targetDue && stageCtx.stageActiveCases.length > 0) {
    const otherDues = [];
    for (const other of stageCtx.stageActiveCases) {
      const d = dueEOD(other.due);
      if (d) otherDues.push(d);
    }
    if (otherDues.length > 0) {
      targetDueRank = otherDues.filter(d => d < targetDue).length / otherDues.length;
    }
  }
  
  // 15 context features (exact order matches V9_CONTEXT_NAMES in training)
  const contextFeatures = [
    labActive, labRush, labOverdue, labDueToday, labDue3d,
    stageCtx.stageActiveCount, stageCtx.stageActiveRush,
    stageCtx.stageAvg7d, stageCtx.stageThroughput7d, stageCtx.stageAvg30d,
    stageCtx.stageTrend,
    casesAheadEarlierDue, casesAheadRush, targetDueRank,
    Math.log1p(labActive),
  ];
  
  // 8 interaction/cyclical features
  const entryHour = entryTime.getHours() + entryTime.getMinutes() / 60;
  const dow = entryTime.getDay(); // 0=Sun..6=Sat. Note: Python uses 0=Mon..6=Sun
  // Match Python weekday() convention: Mon=0..Sun=6
  const pyDow = (dow + 6) % 7;
  
  const interactionFeatures = [
    Math.sin(2 * Math.PI * entryHour / 24),
    Math.cos(2 * Math.PI * entryHour / 24),
    Math.sin(2 * Math.PI * pyDow / 7),
    Math.cos(2 * Math.PI * pyDow / 7),
    labActive * stageCtx.stageActiveCount,
    labActive * stageCtx.stageTrend,
    Math.sqrt(labActive),
    stageCtx.stageActiveCount / Math.max(0.1, stageCtx.stageAvg7d),
  ];
  
  return [...contextFeatures, ...interactionFeatures];
}

function predictCaseML(c, stage, stageEnteredAt, activeCases, labContext = null, recentCompletedVisits = null) {
  const now = getCurrentTime();
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : now;
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);

  const feats = computeV8Features(c, stg, entry, due, activeCases, now);
  const v83Features = feats.array;
  
  // v10: compute 23 extra features (15 context + 8 interaction)
  // labContext can be precomputed once per render; falls back to per-case computation
  let v9Extras;
  try {
    const ctx = labContext || computeLabContextV9(activeCases || [], recentCompletedVisits || [], now);
    v9Extras = computeV9ExtraFeatures(c, stg, entry, ctx);
  } catch (e) {
    console.warn("v10 extras failed, falling back to zeros:", e);
    v9Extras = new Array(23).fill(0);
  }
  
  const featureArray = [...v83Features, ...v9Extras];

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
    
    modelUsed = "xgboost-v10";
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
    featureNames: [...V8_FEATURE_NAMES, ...V9_CONTEXT_NAMES, ...V9_INTERACTION_NAMES],
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

export function generateCaseRiskPredictions(
  activeCases,
  throughputAnalysis,
  stage = null,
  _stageStats = null,
  options = {},
) {
  if (!activeCases || activeCases.length === 0) {
    return {
      atRisk: 0, predictions: [], urgent: [],
      summary: { onTrack: 0, atRisk: 0, high: 0, critical: 0, averageCompletionConfidence: 0, averageLateProbability: 0, averageRescheduleProbability: 0, concurrent: 0 },
      byRiskLevel: { critical: [], high: [], medium: [], low: [] },
    };
  }

  const now = getCurrentTime();
  const nowTs = now.getTime();
  const currentStage = normalizeStage(stage || "design");

  // v10: compute lab-wide context once per render and reuse across all cases.
  //
  // Resolution order for recentCompletedVisits:
  //   1. options.recentCompletedVisits — caller already extracted visits.
  //   2. options.completedCasesForContext — caller passes completed cases
  //      with case_history and we extract visits here.
  //   3. Fallback: extract from activeCases. This WILL return [] (activeCases
  //      have no "marked done" events by definition) and degrades 5 cross-case
  //      features to zero. We warn loudly so the caller fixes it.
  //
  // Fixing this silent bug was measured to be the difference between the
  // 5 features (stageAvg7d, stageThroughput7d, stageAvg30d, stageTrend7d30d,
  // stageLoadRatioVsTypical) carrying real signal vs. being silently zero.
  let recentCompletedVisits;
  if (Array.isArray(options.recentCompletedVisits)) {
    recentCompletedVisits = options.recentCompletedVisits;
  } else if (Array.isArray(options.completedCasesForContext)) {
    recentCompletedVisits = extractRecentCompletedVisits(
      options.completedCasesForContext, now
    );
  } else {
    recentCompletedVisits = extractRecentCompletedVisits(activeCases, now);
    if (recentCompletedVisits.length === 0 && typeof console !== "undefined") {
      console.warn(
        "[v10] recentCompletedVisits is empty. Pass options.recentCompletedVisits " +
        "or options.completedCasesForContext (completed cases with case_history " +
        "from the last 30 days). Without it, 5 cross-case features degrade to zero."
      );
    }
  }
  const labContext = options.labContext
    || computeLabContextV9(activeCases, recentCompletedVisits, now);

  if (typeof console !== "undefined") {
    const stgCtx = labContext.perStage?.[currentStage] || {};
    console.log("[v10 labContext]", {
      stage: currentStage,
      labActive: labContext.labActive,
      labRush: labContext.labRush,
      labOverdue: labContext.labOverdue,
      labDueToday: labContext.labDueToday,
      labDue3d: labContext.labDue3d,
      stageActiveCount: stgCtx.stageActiveCount,
      stageActiveRush: stgCtx.stageActiveRush,
      stageAvg7d: stgCtx.stageAvg7d,
      stageThroughput7d: stgCtx.stageThroughput7d,
      stageAvg30d: stgCtx.stageAvg30d,
      stageTrend: stgCtx.stageTrend,
      recentCompletedVisitsCount: recentCompletedVisits.length,
    });
  }

  const predictions = activeCases.map((c) => {
    const caseType = c.caseType ||
      (c.modifiers?.includes?.("bbs") ? "bbs" :
       c.modifiers?.includes?.("flex") ? "flex" : "general");
    const stageEnteredAt = getStageEnteredAtFor(c, currentStage);
    const timeInStageMs = Math.max(0, nowTs - (stageEnteredAt?.getTime?.() || nowTs));

    const ml = predictCaseML(c, currentStage, stageEnteredAt, activeCases, labContext, recentCompletedVisits);
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
 *  UI HELPERS — verdict, bands, inline viz primitives
 *  ======================================================================== */

/**
 * computeVerdict — turns the four quantiles + due date into a plain-English
 * one-liner. "Where does the due date fall in the p10→p90 band?" is the
 * question the user actually wants answered, and we answer it geometrically
 * instead of through a single probability number.
 *
 * tone maps to RISK_STYLE keys so the visual language stays consistent with
 * the rest of the UI (badge colors etc.).
 */
function computeVerdict(prediction) {
  const now = getCurrentTime();
  const due = prediction.dueDateCalc;
  const eta = prediction.completionETA || prediction.totalETAs?.p50;
  const p50 = prediction.totalETAs?.p50?.getTime();
  const p75 = prediction.totalETAs?.p75?.getTime();
  const p90 = prediction.totalETAs?.p90?.getTime();

  if (!due || !eta || !p50) {
    return { key: "unknown", label: "No due date", tone: "low",
             sub: "Cannot evaluate on-time risk.", etaLabel: eta ? formatDate(eta, false) : "—" };
  }

  const dueTs = due.getTime();
  const nowTs = now.getTime();
  const etaLabel = formatDate(eta, false);

  // Already past the due date wall-clock
  if (dueTs < nowTs) {
    return { key: "overdue", label: "Overdue",
             tone: "critical", sub: `Due ${formatRelativeTime(due, now)}.`, etaLabel };
  }
  // P50 itself is past due → ≥50% chance of missing
  if (p50 > dueTs) {
    return { key: "miss", label: "Likely to miss",
             tone: "critical",
             sub: `Best-estimate finish ${formatRelativeTime(eta, now)}; due ${formatRelativeTime(due, now)}.`,
             etaLabel };
  }
  // Due falls inside p50-p75 band — tight
  if (p75 && p75 > dueTs) {
    return { key: "tight", label: "Tight",
             tone: "high",
             sub: `Due falls inside the likely-finish band — coin flip to ~75%.`,
             etaLabel };
  }
  // Due inside p75-p90 — cautious
  if (p90 && p90 > dueTs) {
    return { key: "cautious", label: "Watch",
             tone: "medium",
             sub: "Due falls inside the upper uncertainty band — slippage possible.",
             etaLabel };
  }
  return { key: "ontime", label: "On track",
           tone: "low",
           sub: `Expected ${formatRelativeTime(eta, now)}; due ${formatRelativeTime(due, now)}.`,
           etaLabel };
}

/**
 * VerdictChip — pill that renders the verdict label with its tone color.
 * Used in the analytics modal header and inside each list row.
 */
function VerdictChip({ verdict, size = "md" }) {
  if (!verdict) return null;
  const style = RISK_STYLE[verdict.tone] || RISK_STYLE.low;
  const dims = {
    sm: { pad: "px-2 py-0.5", text: "text-[10px]", track: "tracking-[0.1em]" },
    md: { pad: "px-2.5 py-1",  text: "text-[11px]", track: "tracking-[0.12em]" },
    lg: { pad: "px-3 py-1.5",  text: "text-xs",    track: "tracking-[0.14em]" },
  }[size];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-medium uppercase ${dims.pad} ${dims.text} ${dims.track}`}
      style={{
        color: style.fg,
        backgroundColor: style.bg,
        border: `1px solid ${style.fg}33`,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: style.fg }}
      />
      {verdict.label}
    </span>
  );
}

/**
 * bandGeometry — given a target (stage|total), now, due date and full-axis span,
 * compute percent positions for the p10, p50, p75, p90, now and due markers,
 * plus widths of the core (p10-p75) and confidence (p10-p90) bands.
 *
 * Centralizing this keeps RangeBar and TimelineHero drawing the same axis math.
 */
function bandGeometry({ etas, now, due, minTs, maxTs }) {
  const span = Math.max(1, maxTs - minTs);
  const pct = (ts) => Math.max(0, Math.min(100, ((ts - minTs) / span) * 100));
  const p10 = etas.p10.getTime();
  const p50 = etas.p50.getTime();
  const p75 = etas.p75.getTime();
  const p90 = etas.p90.getTime();
  const nowTs = (now || new Date()).getTime();
  const dueTs = due ? due.getTime() : null;
  return {
    pct,
    p10Pct: pct(p10),
    p50Pct: pct(p50),
    p75Pct: pct(p75),
    p90Pct: pct(p90),
    nowPct: pct(nowTs),
    duePct: dueTs ? pct(dueTs) : null,
    coreWidth: pct(p75) - pct(p10),
    outerWidth: pct(p90) - pct(p10),
    dueInsideCore: dueTs && dueTs >= p10 && dueTs <= p75,
    dueInsideOuter: dueTs && dueTs >= p10 && dueTs <= p90,
    dueBeforeP50: dueTs && dueTs < p50,
    dueBeforeP75: dueTs && dueTs < p75,
    dueAfterP90: dueTs && dueTs > p90,
  };
}

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
      className={`inline-flex items-center font-medium uppercase rounded-md ${sizes[size]}`}
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
      className="relative p-5 rounded-xl"
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
          fontWeight: 600,
          fontFeatureSettings: "'ss01', 'tnum'",
        }}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={`${sizes.sub} mt-2 font-normal`}
          style={{ color: COLORS.inkSoft }}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

/**
 * TimelineHero — the centerpiece visual.
 * Shows stage exit band → completion band on a single time axis, with Now and
 * Due markers. Each band is drawn as a nested pair (outer p10-p90, core
 * p10-p75) so the uncertainty shape is readable from across the room.
 *
 * Top-right: Verdict chip answering "will it be late?"
 * Bottom: sentence answering "when will it finish?"
 */
function TimelineHero({ prediction }) {
  const { stageETAs, totalETAs, dueDateCalc, stageEnteredAt, elapsedWorkHours } = prediction;
  const now = getCurrentTime();
  const verdict = computeVerdict(prediction);

  const entryTs = (stageEnteredAt || now).getTime();
  const nowTs = now.getTime();
  const dueTs = dueDateCalc ? dueDateCalc.getTime() : null;
  const totalP10 = totalETAs.p10.getTime();
  const totalP90 = totalETAs.p90.getTime();

  // Axis: from stage entry to max(due, p90, now+1h)
  const minTs = Math.min(entryTs, nowTs);
  const maxTs = Math.max(dueTs || 0, totalP90, nowTs + 3600000);

  const stageG = bandGeometry({
    etas: stageETAs, now, due: dueDateCalc, minTs, maxTs,
  });
  const totalG = bandGeometry({
    etas: totalETAs, now, due: dueDateCalc, minTs, maxTs,
  });

  // Draw a labeled date tick on the axis every ~20% across the span.
  const ticks = [];
  for (let i = 0; i <= 4; i++) {
    const pctPos = (i / 4) * 100;
    const tickTs = minTs + ((maxTs - minTs) * i) / 4;
    ticks.push({ pct: pctPos, ts: tickTs });
  }

  const stageTone = RISK_STYLE[verdict.tone]?.fg || COLORS.inkSoft;

  return (
    <div
      className="relative p-8 rounded-2xl"
      style={{
        background: `linear-gradient(135deg, ${COLORS.paper} 0%, ${COLORS.cognacGlow}55 100%)`,
        border: `1px solid ${COLORS.borderSoft}`,
      }}
    >
      {/* Header: label + verdict */}
      <div className="flex items-start justify-between mb-6 gap-6">
        <div className="flex-1">
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-medium mb-1"
            style={{ color: COLORS.inkFaint }}
          >
            Prediction Timeline
          </div>
          <div className="text-sm" style={{ color: COLORS.ink }}>
            <span style={{ fontWeight: 500 }}>{verdict.label}</span>
            <span className="mx-2" style={{ color: COLORS.inkFaint }}>·</span>
            <span style={{ color: COLORS.inkSoft }}>{verdict.sub}</span>
          </div>
        </div>
        <VerdictChip verdict={verdict} size="lg" />
      </div>

      {/* Axis container — two rows (stage on top, total on bottom) */}
      <div className="relative" style={{ height: 180 }}>
        {/* Axis tick marks */}
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-8 border-l"
            style={{
              left: `${t.pct}%`,
              borderColor: COLORS.divider,
              borderStyle: "dashed",
              opacity: 0.5,
            }}
          />
        ))}

        {/* Stage exit band — upper row (22-32% height) */}
        <div className="absolute" style={{ top: "18%", left: 0, right: 0 }}>
          <div
            className="text-[9px] uppercase tracking-[0.18em] mb-1"
            style={{ color: COLORS.inkSoft, fontWeight: 500 }}
          >
            Stage exit · {prediction.currentStage}
          </div>
          <div className="relative" style={{ height: 14 }}>
            {/* Outer (p10-p90) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${stageG.p10Pct}%`,
                width: `${stageG.outerWidth}%`,
                height: 4,
                backgroundColor: COLORS.cognacGlow,
                opacity: 0.9,
              }}
            />
            {/* Core (p10-p75) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${stageG.p10Pct}%`,
                width: `${stageG.coreWidth}%`,
                height: 8,
                background: `linear-gradient(90deg, ${COLORS.brass}aa 0%, ${COLORS.cognac} 100%)`,
              }}
            />
            {/* P50 pin */}
            <div
              className="absolute top-1/2 rounded-full"
              style={{
                left: `${stageG.p50Pct}%`,
                transform: "translate(-50%, -50%)",
                width: 10, height: 10,
                backgroundColor: COLORS.paper,
                border: `2px solid ${COLORS.cognac}`,
              }}
            />
          </div>
        </div>

        {/* Total completion band — lower row (60-72% height) */}
        <div className="absolute" style={{ top: "58%", left: 0, right: 0 }}>
          <div
            className="text-[9px] uppercase tracking-[0.18em] mb-1"
            style={{ color: COLORS.inkSoft, fontWeight: 500 }}
          >
            Case complete
          </div>
          <div className="relative" style={{ height: 18 }}>
            {/* Outer */}
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${totalG.p10Pct}%`,
                width: `${totalG.outerWidth}%`,
                height: 6,
                backgroundColor: COLORS.cognacGlow,
                opacity: 0.9,
              }}
            />
            {/* Core */}
            <div
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${totalG.p10Pct}%`,
                width: `${totalG.coreWidth}%`,
                height: 12,
                background: `linear-gradient(90deg, ${COLORS.cognacLight} 0%, ${COLORS.cognac} 100%)`,
                boxShadow: `0 1px 4px ${COLORS.cognac}33`,
              }}
            />
            {/* P50 pin */}
            <div
              className="absolute top-1/2 rounded-full"
              style={{
                left: `${totalG.p50Pct}%`,
                transform: "translate(-50%, -50%)",
                width: 16, height: 16,
                backgroundColor: COLORS.paper,
                border: `2.5px solid ${COLORS.cognac}`,
                boxShadow: `0 1px 6px ${COLORS.cognac}66`,
              }}
            />
            {/* P50 date label below the pin */}
            <div
              className="absolute text-[10px] uppercase tracking-[0.12em] whitespace-nowrap"
              style={{
                top: "100%",
                left: `${totalG.p50Pct}%`,
                transform: "translate(-50%, 4px)",
                color: COLORS.cognac,
                fontWeight: 500,
                fontFamily: "monospace",
              }}
            >
              {formatDate(totalETAs.p50, false)}
            </div>
          </div>
        </div>

        {/* NOW marker — full-height vertical */}
        {totalG.nowPct >= 0 && totalG.nowPct <= 100 && (
          <>
            <div
              className="absolute top-0 bottom-8 w-px"
              style={{
                left: `${totalG.nowPct}%`,
                backgroundColor: COLORS.ink,
                opacity: 0.7,
              }}
            />
            <div
              className="absolute text-[9px] uppercase tracking-[0.2em] font-medium whitespace-nowrap"
              style={{
                top: 0,
                left: `${totalG.nowPct}%`,
                transform: "translate(-50%, -120%)",
                color: COLORS.ink,
              }}
            >
              Now
            </div>
          </>
        )}

        {/* DUE marker — full-height, colored by verdict */}
        {dueTs && (
          <>
            <div
              className="absolute top-0 bottom-8"
              style={{
                left: `${totalG.duePct}%`,
                width: 2,
                backgroundColor: stageTone,
                borderRadius: 1,
              }}
            />
            <div
              className="absolute flex flex-col items-center whitespace-nowrap"
              style={{
                top: 0,
                left: `${totalG.duePct}%`,
                transform: "translate(-50%, -105%)",
                color: stageTone,
              }}
            >
              <div className="text-[9px] uppercase tracking-[0.2em] font-medium">
                Due
              </div>
              <div
                className="text-[11px]"
                style={{ fontWeight: 600, fontFamily: "monospace" }}
              >
                {dueDateCalc.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
          </>
        )}

        {/* Axis baseline — the thin line under both bands */}
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: 26,
            height: 1,
            backgroundColor: COLORS.divider,
          }}
        />

        {/* Tick labels */}
        {ticks.map((t, i) => (
          <div
            key={`l${i}`}
            className="absolute text-[9px] uppercase tracking-[0.1em] whitespace-nowrap"
            style={{
              bottom: 8,
              left: `${t.pct}%`,
              transform: i === 0 ? "translateX(0)" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              color: COLORS.inkFaint,
              fontFamily: "monospace",
            }}
          >
            {formatDate(new Date(t.ts), false)}
          </div>
        ))}
      </div>

      {/* Legend / footer strip */}
      <div
        className="mt-6 pt-4 flex items-center gap-6 text-[10px] uppercase tracking-[0.15em]"
        style={{ color: COLORS.inkSoft, borderTop: `1px solid ${COLORS.divider}` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-[10px] rounded-full"
            style={{
              background: `linear-gradient(90deg, ${COLORS.cognacLight}, ${COLORS.cognac})`,
            }}
          />
          <span>Core p10–p75</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-[4px] rounded-full"
            style={{ backgroundColor: COLORS.cognacGlow, opacity: 0.9 }}
          />
          <span>Uncertainty p75–p90</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[2px] h-3 rounded-sm" style={{ backgroundColor: stageTone }} />
          <span>Due</span>
        </div>
        {elapsedWorkHours > 0.5 && (
          <div className="ml-auto" style={{ color: COLORS.inkFaint }}>
            {formatHours(elapsedWorkHours)} elapsed in stage
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * RangeBar — layered range viz. Two nested bands make the uncertainty shape
 * readable at a glance: the darker "core" band is p10→p75 (the middle 65% of
 * probability mass) and the pale "outer" band is p75→p90 (tail). A P50 pin
 * sits at the middle-estimate. Now and Due are vertical markers; Due is
 * colored by whether it sits inside the core, the tail, or past p90.
 *
 *  legend (left→right on the axis):
 *    now ────────── [░░ core p10-p75 ░░][.. tail ..p90] ──── due?
 *
 * The footer line below the bar states the answer in plain English:
 * "Likely Aug 14 – Aug 18; could slip to Aug 21."
 */
function RangeBar({
  title,
  quantiles,
  etas,
  dueDate,
  now,
  compact = false,
  showFooter = true,
}) {
  const p10 = etas.p10.getTime();
  const p75 = etas.p75.getTime();
  const p90 = etas.p90.getTime();
  const nowTs = (now || new Date()).getTime();
  const dueTs = dueDate ? dueDate.getTime() : null;

  const minTs = Math.min(nowTs, p10) - 15 * 60000;
  const maxTs = Math.max(dueTs || 0, p90) + 15 * 60000;

  const g = bandGeometry({ etas, now, due: dueDate, minTs, maxTs });

  const dueColor = !dueTs
    ? COLORS.ink
    : g.dueBeforeP50
      ? COLORS.rCritical
      : g.dueBeforeP75
        ? COLORS.rHigh
        : g.dueInsideOuter
          ? COLORS.rMedium
          : COLORS.rLow;

  const barHeight = compact ? 22 : 32;
  const coreH = compact ? 8 : 12;
  const outerH = compact ? 4 : 6;

  // Footer sentence — the "answer"
  const footerText = (() => {
    const p50S = formatDate(etas.p50, false);
    const p75S = formatDate(etas.p75, false);
    const p90S = formatDate(etas.p90, false);
    if (p50S === p75S) {
      return `Likely ${p50S}; could slip to ${p90S}.`;
    }
    return `Likely ${p50S}–${p75S}; could slip to ${p90S}.`;
  })();

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {title && (
        <div className="flex items-baseline justify-between">
          <div
            className="text-[11px] uppercase tracking-[0.18em] font-medium"
            style={{ color: COLORS.inkSoft }}
          >
            {title}
          </div>
          <div
            className="text-[11px] tabular-nums"
            style={{ color: COLORS.inkSoft, fontFamily: "monospace" }}
          >
            {formatHours(quantiles.p50)} <span style={{ color: COLORS.inkFaint }}>±</span>{" "}
            {formatHours(quantiles.p90 - quantiles.p10)} wide
          </div>
        </div>
      )}

      <div
        className="relative rounded-full"
        style={{ height: barHeight, backgroundColor: COLORS.cream }}
      >
        {/* Outer band — p10 → p90 (full uncertainty) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${g.p10Pct}%`,
            width: `${g.outerWidth}%`,
            height: outerH,
            backgroundColor: COLORS.cognacGlow,
            opacity: 0.8,
          }}
        />
        {/* Core band — p10 → p75 (the "likely" zone) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${g.p10Pct}%`,
            width: `${g.coreWidth}%`,
            height: coreH,
            background: `linear-gradient(90deg, ${COLORS.cognacLight} 0%, ${COLORS.cognac} 100%)`,
          }}
        />
        {/* P50 pin — middle estimate */}
        <div
          className="absolute top-1/2 rounded-full"
          style={{
            left: `${g.p50Pct}%`,
            width: compact ? 10 : 14,
            height: compact ? 10 : 14,
            transform: "translate(-50%, -50%)",
            backgroundColor: COLORS.paper,
            border: `2.5px solid ${COLORS.cognac}`,
            boxShadow: `0 1px 4px ${COLORS.cognac}55`,
          }}
        />
        {/* Now line */}
        {g.nowPct >= 0 && g.nowPct <= 100 && (
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: `${g.nowPct}%`,
              width: 1,
              backgroundColor: COLORS.ink,
              opacity: 0.45,
            }}
          />
        )}
        {/* Due marker — vertical line with flag */}
        {dueTs && (
          <>
            <div
              className="absolute top-0 bottom-0"
              style={{
                left: `${g.duePct}%`,
                width: 2,
                backgroundColor: dueColor,
                borderRadius: 1,
              }}
            />
            {!compact && (
              <div
                className="absolute text-[9px] uppercase tracking-[0.15em] font-medium"
                style={{
                  left: `${g.duePct}%`,
                  top: -16,
                  transform: "translateX(-50%)",
                  color: dueColor,
                  whiteSpace: "nowrap",
                }}
              >
                Due
              </div>
            )}
          </>
        )}
      </div>

      {showFooter && !compact && (
        <div
          className="flex justify-between items-center text-[10px]"
          style={{ color: COLORS.inkFaint }}
        >
          <span className="uppercase tracking-[0.15em]">Now</span>
          <span
            className="italic"
            style={{
              color: COLORS.inkSoft,
              fontFeatureSettings: "'ss01'",
              fontSize: 11,
              fontStyle: "italic",
            }}
          >
            {footerText}
          </span>
          {dueDate && (
            <span
              className="uppercase tracking-[0.15em] tabular-nums"
              style={{
                color: dueColor,
                fontFamily: "monospace",
              }}
            >
              Due {formatDate(dueDate, false)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Back-compat alias — existing call sites still work.
const QuantileBar = RangeBar;

/**
 * RiskFactors — shows the reasons the model flagged this case, with feature values.
 */
function RiskFactors({ prediction }) {
  const { riskReasons, featureDict, riskLevel } = prediction;
  const style = RISK_STYLE[riskLevel];

  if (!riskReasons || riskReasons.length === 0) {
    return (
      <div
        className="p-6 rounded-xl flex items-start gap-3"
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
          className="flex items-start gap-3 p-4 rounded-xl"
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
            className="text-[11px] uppercase tracking-[0.14em] px-3 py-1.5 rounded-lg transition-colors"
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
        className="rounded-xl overflow-hidden"
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
                      fontFamily: "monospace",
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

  if (!prediction) return null;
  const style = RISK_STYLE[prediction.riskLevel];
  const now = getCurrentTime();

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] overflow-y-auto flex items-start justify-center p-6 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl my-8 glass-nb rounded-2xl overflow-hidden shadow-2xl"
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
            className="absolute top-6 right-6 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
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
                  fontWeight: 600,
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
              <div className="flex items-center gap-2">
                <VerdictChip verdict={computeVerdict(prediction)} size="md" />
                <RiskBadge level={prediction.riskLevel} size="lg" />
              </div>
              <div className="text-[10px]" style={{ color: COLORS.inkFaint }}>
                Risk score {prediction.riskScore}
              </div>
            </div>
          </div>

          {/* Recommendation banner */}
          <div
            className="flex items-start gap-3 px-5 py-4 rounded-xl"
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
            className="px-5 py-2 text-sm rounded-lg transition-colors"
            style={{
              color: COLORS.paper,
              backgroundColor: COLORS.ink,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** ========================================================================
 *  TAB PANES
 *  ======================================================================== */

function OverviewTab({ prediction }) {
  const { totalHours, stageHours, lateProbability, rescheduleProbability,
          confidenceScore, hoursIdle, backlogCount, qcLoops } = prediction;
  const verdict = computeVerdict(prediction);
  const verdictStyle = RISK_STYLE[verdict.tone] || RISK_STYLE.low;

  const slackH = (prediction.dueDateCalc && prediction.completionETA)
    ? (prediction.dueDateCalc.getTime() - prediction.completionETA.getTime()) / 3600000
    : null;

  // Uncertainty width in hours — the "how certain" answer in a single number
  const uncertaintyH = (totalHours.p90 - totalHours.p10);
  const uncertaintyText = uncertaintyH < 2 ? "tight" : uncertaintyH < 6 ? "typical" : "wide";

  // P(late) precision
  const latePctRaw = (lateProbability || 0) * 100;
  const latePctDisplay =
    latePctRaw < 1 ? "<1" : latePctRaw < 10 ? latePctRaw.toFixed(1) : String(Math.round(latePctRaw));

  return (
    <div className="space-y-8">
      {/* === THE FOUR ANSWERS — front and center === */}
      <div className="grid grid-cols-4 gap-3">
        {/* 1 · Will it be late? */}
        <div
          className="p-5 rounded-xl relative overflow-hidden"
          style={{
            backgroundColor: verdictStyle.bg,
            border: `1px solid ${verdictStyle.fg}33`,
          }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-medium mb-2"
            style={{ color: verdictStyle.fg }}
          >
            Will it be late?
          </div>
          <div className="flex items-baseline gap-2">
            <div
              className="text-4xl leading-none tabular-nums"
              style={{
                fontWeight: 600,
                color: verdictStyle.fg,
                fontFeatureSettings: "'tnum'",
              }}
            >
              {latePctDisplay}
              <span className="text-lg" style={{ fontWeight: 400, marginLeft: 2 }}>%</span>
            </div>
            <VerdictChip verdict={verdict} size="sm" />
          </div>
          <div
            className="text-xs mt-2"
            style={{ color: COLORS.inkSoft }}
          >
            {verdict.sub}
          </div>
        </div>

        {/* 2 · When will it finish? */}
        <div
          className="p-5 rounded-xl"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-medium mb-2"
            style={{ color: COLORS.inkFaint }}
          >
            When will it finish?
          </div>
          <div
            className="text-2xl leading-tight"
            style={{
              fontWeight: 600,
              color: COLORS.ink,
              fontFamily: "monospace",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {formatDate(prediction.completionETA, false)}
          </div>
          <div
            className="text-xs mt-2"
            style={{ color: COLORS.inkSoft }}
          >
            p50 · {formatHours(totalHours.p50)} remaining work
          </div>
        </div>

        {/* 3 · How certain? */}
        <div
          className="p-5 rounded-xl"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-medium mb-2"
            style={{ color: COLORS.inkFaint }}
          >
            How certain?
          </div>
          <div className="flex items-baseline gap-1">
            <div
              className="text-4xl leading-none"
              style={{ fontWeight: 600, color: COLORS.ink }}
            >
              {confidenceScore}
              <span className="text-lg" style={{ fontWeight: 400 }}>%</span>
            </div>
          </div>
          <div className="text-xs mt-2" style={{ color: COLORS.inkSoft }}>
            ±{formatHours(uncertaintyH / 2)} range · {uncertaintyText}
          </div>
        </div>

        {/* 4 · Buffer / slack */}
        <div
          className="p-5 rounded-xl"
          style={{
            backgroundColor: slackH !== null && slackH < 0 ? COLORS.rCriticalBg : COLORS.paper,
            border: `1px solid ${slackH !== null && slackH < 0 ? `${COLORS.rCritical}33` : COLORS.borderSoft}`,
          }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.2em] font-medium mb-2"
            style={{
              color: slackH !== null && slackH < 0 ? COLORS.rCritical : COLORS.inkFaint,
            }}
          >
            {slackH !== null && slackH < 0 ? "Past due by" : "Buffer"}
          </div>
          <div
            className="text-3xl leading-none"
            style={{
              fontWeight: 600,
              color: slackH !== null && slackH < 0 ? COLORS.rCritical : COLORS.ink,
              fontFamily: "monospace",
              fontFeatureSettings: "'tnum'",
            }}
          >
            {slackH !== null ? formatHours(Math.abs(slackH)) : "—"}
          </div>
          <div className="text-xs mt-2" style={{ color: COLORS.inkSoft }}>
            {slackH === null
              ? "no due date"
              : slackH < 0
                ? "overrun of the due date"
                : "slack before due date"}
          </div>
        </div>
      </div>

      {/* === HERO TIMELINE === */}
      <TimelineHero prediction={prediction} />

      {/* === RANGE BREAKDOWN — stage exit + full completion === */}
      <div
        className="p-6 rounded-xl"
        style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
      >
        <div
          className="flex items-baseline justify-between mb-5"
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em]"
            style={{ color: COLORS.inkFaint }}
          >
            Prediction ranges
          </div>
          <div className="text-[10px]" style={{ color: COLORS.inkFaint }}>
            Core p10–p75 · Tail p75–p90
          </div>
        </div>
        <div className="space-y-6">
          <RangeBar
            title={`Stage exit · ${prediction.currentStage}`}
            quantiles={stageHours}
            etas={prediction.stageETAs}
            dueDate={prediction.dueDateCalc}
            now={getCurrentTime()}
          />
          <RangeBar
            title="Case complete"
            quantiles={totalHours}
            etas={prediction.totalETAs}
            dueDate={prediction.dueDateCalc}
            now={getCurrentTime()}
          />
        </div>
      </div>

      {/* === SECONDARY SIGNALS + OPERATIONAL CONTEXT === */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className="p-5 rounded-xl"
          style={{ backgroundColor: COLORS.paper, border: `1px solid ${COLORS.borderSoft}` }}
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] mb-3"
            style={{ color: COLORS.inkFaint }}
          >
            Probabilities
          </div>
          <div className="space-y-3">
            <ProbRow label="Late" value={lateProbability} color={verdictStyle.fg} />
            <ProbRow label="Due rescheduled" value={rescheduleProbability} color={COLORS.brass} />
          </div>
        </div>

        <div
          className="p-5 rounded-xl col-span-2"
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
        className="rounded-xl overflow-hidden"
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
                    style={{ color: COLORS.inkFaint, fontFamily: "monospace" }}
                  >
                    {row.sub}
                  </div>
                )}
                <div
                  className="text-sm tabular-nums"
                  style={{
                    color: row.highlight ? COLORS.cognac : COLORS.ink,
                    fontFamily: "monospace",
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
          className="p-6 rounded-xl"
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
            className="p-5 rounded-xl"
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
          className="p-6 rounded-xl"
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
        className="p-4 rounded-xl text-[12px] leading-relaxed"
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
          style={{ color, fontFamily: "monospace", fontWeight: 500 }}
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
          fontWeight: 600,
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
            fontWeight: 600,
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

/**
 * CompactCaseRow — list row with the four answers visible without clicking:
 *   1. Will it be late?  →  RiskBadge + VerdictChip + late% pill
 *   2. When will it finish?  →  Completion ETA (monospace date)
 *   3. How certain?  →  Inline mini RangeBar (widths tell the story)
 *   4. What to do?  →  Rush/Hold/Review flags + next-step chip from verdict
 *
 * Layout (fixed-width zones so rows align cleanly):
 *
 *  [stripe][ STATUS 180 ][ CASE 160 ][ ETA + RANGE flex 320 ][ LATE% 72 ][ FLAGS 120 ][ → ]
 */
function CompactCaseRow({ prediction, onOpenAnalytics, onOpenHistory }) {
  const status = getStatusFromPrediction(prediction);
  const style = RISK_STYLE[status] || RISK_STYLE.low;
  const verdict = computeVerdict(prediction);
  const now = new Date();
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : prediction.dueDateCalc;
  const completionETA = prediction.completionETA || prediction.expectedCompletionDate;
  const isOverdue = dueDate && dueDate < now;

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
      className="group relative w-full text-left rounded-xl transition-all"
      style={{
        backgroundColor: COLORS.paper,
        border: `1px solid ${COLORS.borderSoft}`,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.cognacLight; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.borderSoft; }}
    >
      {/* Left accent stripe (tone-colored) */}
      <div
        className="absolute left-0 top-0 bottom-0 rounded-l-xl"
        style={{ width: 3, backgroundColor: style.fg }}
      />

      <div className="pl-5 pr-4 py-3.5">
        <div className="flex items-center gap-4">

          {/* STATUS — badge + verdict stacked (180px) */}
          <div className="w-[180px] flex-shrink-0 flex flex-col gap-1.5">
            <RiskBadge level={status} size="sm" />
            <VerdictChip verdict={verdict} size="sm" />
          </div>

          {/* CASE — number + type + stage (160px) */}
          <div className="w-[160px] flex-shrink-0 min-w-0">
            <div
              className="text-lg leading-tight truncate"
              style={{
                color: COLORS.ink,
                fontWeight: 500,
                letterSpacing: "-0.005em",
              }}
            >
              {prediction.caseNumber}
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.15em] mt-0.5 truncate"
              style={{ color: COLORS.inkFaint }}
            >
              {prediction.caseType || "general"} · {prediction.currentStage}
            </div>
          </div>

          {/* ETA + inline mini range (flex, main zone) */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 mb-2">
              <div
                className="text-[10px] uppercase tracking-[0.16em]"
                style={{ color: COLORS.inkFaint }}
              >
                Done by
              </div>
              <div
                className="text-sm tabular-nums"
                style={{
                  color: isOverdue ? style.fg : COLORS.ink,
                  fontFamily: "monospace",
                  fontWeight: 500,
                }}
              >
                {completionETA ? formatDate(completionETA, false) : "—"}
              </div>
              {dueDate && (
                <div
                  className="text-[11px]"
                  style={{ color: COLORS.inkSoft }}
                >
                  due {formatDate(dueDate, false)}
                  <span className="ml-1.5" style={{ color: COLORS.inkFaint }}>
                    ({formatRelativeTime(dueDate, now)})
                  </span>
                </div>
              )}
            </div>
            {/* Inline mini RangeBar — height 22 */}
            {prediction.totalETAs && (
              <RangeBar
                quantiles={prediction.totalHours}
                etas={prediction.totalETAs}
                dueDate={dueDate}
                now={now}
                compact={true}
                showFooter={false}
              />
            )}
          </div>

          {/* Late % — big number (72px) */}
          <div className="w-[72px] flex-shrink-0 text-right">
            <div
              className="leading-none tabular-nums"
              style={{
                fontSize: 28,
                fontWeight: 300,
                color: style.fg,
                fontFeatureSettings: "'tnum'",
              }}
            >
              {latePctDisplay}
              <span style={{ fontSize: 14, color: COLORS.inkFaint, marginLeft: 1 }}>%</span>
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.14em] mt-0.5"
              style={{ color: COLORS.inkFaint }}
            >
              Late risk
            </div>
          </div>

          {/* Flags column (120px) */}
          <div className="w-[120px] flex-shrink-0 flex flex-wrap items-center gap-1 justify-end">
            {prediction.isRush && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-md"
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
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-md"
                style={{
                  color: COLORS.rMedium,
                  backgroundColor: COLORS.rMediumBg,
                  fontWeight: 500,
                }}
              >
                Hold
              </span>
            )}
            {prediction.qcLoops > 0 && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-md"
                style={{
                  color: COLORS.inkSoft,
                  backgroundColor: COLORS.cream,
                  fontWeight: 500,
                }}
                title="QC loops"
              >
                QC×{prediction.qcLoops}
              </span>
            )}
            {prediction.signalsAgree === false && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] rounded-md"
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

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenHistory && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenHistory(prediction.id, prediction.caseNumber); }}
                className="text-[11px] uppercase tracking-[0.12em] px-2.5 py-1 rounded-lg transition-colors"
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

      {/* Bottom stage-progress sliver */}
      <div style={{ height: 1.5, backgroundColor: COLORS.divider }}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${Math.min(100, prediction.progressPercent || 0)}%`,
            backgroundColor: style.fg,
            opacity: 0.55,
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
        className="fixed inset-0 z-[10001] flex items-center justify-center p-6 overflow-y-auto bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="w-full max-w-6xl my-8 glass-nb rounded-2xl shadow-2xl flex flex-col overflow-hidden"
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
              className="absolute top-6 right-6 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
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
                    fontWeight: 600,
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
                    className="relative rounded-xl px-4 py-3 text-left transition-all"
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
                        fontWeight: 600,
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
                  className="w-full px-4 py-2 text-sm rounded-lg focus:outline-none transition-colors"
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
                className="px-3 py-2 text-sm rounded-lg focus:outline-none cursor-pointer"
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
                  className="text-[11px] uppercase tracking-[0.14em] px-3 py-2 rounded-lg transition-colors"
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
                    fontWeight: 600,
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
              className="px-5 py-2 text-sm rounded-lg transition-colors"
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
