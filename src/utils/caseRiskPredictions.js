// /src/utils/caseRiskPredictions.js
// v5 — XGBoost Live Prediction System
// Rebuilt 2026-04-14 — Gradient Boosted Trees, 50 features, continuous live updates
// Model: 200 trees × 4 stages, trained on 1335 cases / 29,748 snapshots
//
// SETUP: Place xgb_production_models.json in the same directory.
// The model file is loaded once at startup and cached.

import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";

// =============================================================================
// MODEL LOADER — Import the XGBoost tree ensemble
// =============================================================================
// Option A (static import — bundled with app):
// import XGB_MODELS from "./xgb_production_models.json";
//
// Option B (lazy load — smaller initial bundle):
let XGB_MODELS = null;
let modelLoadPromise = null;

export async function loadModels() {
  if (XGB_MODELS) return XGB_MODELS;
  if (modelLoadPromise) return modelLoadPromise;
  modelLoadPromise = fetch("/xgb_production_models.json")
    .then((r) => r.json())
    .then((data) => {
      XGB_MODELS = data;
      console.log("[v5] XGBoost models loaded:", Object.keys(data).join(", "));
      return data;
    })
    .catch((err) => {
      console.error("[v5] Failed to load models:", err);
      return null;
    });
  return modelLoadPromise;
}

// Synchronous getter (returns null if not yet loaded)
export function getModels() {
  return XGB_MODELS;
}

// For static import users: call this at app startup
export function setModels(models) {
  XGB_MODELS = models;
}

// =============================================================================
// XGBOOST TREE WALKER
// =============================================================================
function walkTree(node, x) {
  if (node.leaf !== undefined) return node.leaf;
  const idx = parseInt(node.split.replace("f", ""));
  const val = idx < x.length ? (x[idx] ?? 0) : 0;
  // XGBoost: missing/NaN goes to yes_child (children[0] by default)
  if (val === null || val === undefined || Number.isNaN(val)) {
    return walkTree(node.yes !== undefined ? node.children[node.yes === node.children[0]?.nodeid ? 0 : 1] : node.children[0], x);
  }
  return val < node.split_condition
    ? walkTree(node.children[0], x)
    : walkTree(node.children[1], x);
}

function xgbPredict(stageModel, featureArray) {
  if (!stageModel?.trees) return 0.5;
  let sum = 0.5; // base_score
  for (const tree of stageModel.trees) {
    sum += tree.leaf !== undefined ? tree.leaf : walkTree(tree, featureArray);
  }
  return sum;
}

/** ======================= DATE & TIME UTILITIES ======================== **/

export const formatDate = (date, options = {}) => {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  if (options.dateOnly) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (options.dayTime) return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  if (options.timeOnly) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function dueEOD(due) {
  if (!due) return null;
  if (due instanceof Date && !isNaN(due.getTime())) return new Date(due.getFullYear(), due.getMonth(), due.getDate(), 17, 0, 0, 0);
  if (typeof due === "string") {
    const datePart = due.split("T")[0].includes("-") ? due.split("T")[0] : due;
    const parts = datePart.split("-");
    if (parts.length === 3) return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 17, 0, 0, 0);
    const parsed = new Date(due);
    if (!isNaN(parsed.getTime())) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 17, 0, 0, 0);
  }
  return null;
}

function parseDueDateForDisplay(due) {
  if (!due) return null;
  if (due instanceof Date && !isNaN(due.getTime())) return due;
  if (typeof due === "string") {
    const datePart = due.split("T")[0];
    const parts = datePart.split("-");
    if (parts.length === 3) return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 17, 0, 0, 0);
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
const RESCHEDULE_DISCOUNT_GAMMA = 0.6;

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const normalizeStage = (s) => (s || "design").toString().trim().toLowerCase();
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const dowPy = (d) => (d.getDay() + 6) % 7;
const getCurrentTime = () => new Date();

function dayWindows(d) {
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  return WORK_WINDOWS.map((w) => ({ start: new Date(y, m, day, w.h0, w.m0, 0, 0), end: new Date(y, m, day, w.h1, w.m1, 0, 0) }));
}

export function daySpanHours(a, b) { return (b - a) / 3_600_000; }

export function businessHoursBetween(start, end) {
  if (!start || !end || end <= start) return 0;
  let cur = new Date(start), stop = new Date(end), total = 0;
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
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 8, 0, 0, 0);
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
        if (remaining <= span + 1e-12) { cur = new Date(cur.getTime() + remaining * 3_600_000); return snapToMinutes(cur, 5); }
        else { remaining -= span; cur = w.end; advanced = true; }
      }
    }
    if (!advanced) cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 8, 0, 0, 0);
  }
  return snapToMinutes(cur, 5);
}

function snapToMinutes(dt, step = 5) { const d = new Date(dt); d.setMinutes(Math.round(d.getMinutes() / step) * step, 0, 0); return d; }

function advanceToNextWorkMoment(cur) {
  cur = new Date(cur);
  while (true) {
    if (isWeekend(cur)) {
      const add = cur.getDay() === 0 ? 1 : 2;
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + add, 8, 0, 0, 0);
      continue;
    }
    const wins = dayWindows(cur);
    if (cur < wins[0].start) return wins[0].start;
    for (const w of wins) if (cur >= w.start && cur < w.end) return cur;
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1, 8, 0, 0, 0);
  }
}

/** ======================= HELPER FUNCTIONS ======================== **/

function learnedCapacity(stage, stageStatsForStage, fallback = 1) {
  const stg = normalizeStage(stage);
  const learned = Math.round(stageStatsForStage?.concurrencyP50 || stageStatsForStage?.concurrencyMean || fallback);
  return stg === "design" ? 1 : Math.max(1, Math.min(6, learned || fallback));
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

function strSet(mods) {
  if (!mods) return new Set();
  if (Array.isArray(mods)) return new Set(mods.map((m) => String(m).toLowerCase()));
  return new Set(String(mods).toLowerCase().split(/[\,\s]+/g));
}

function histCountUpTo(c, pred, cutoff) {
  const H = (c.case_history || c.history || []).filter((h) => h?.created_at).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let n = 0;
  for (const h of H) { if (new Date(h.created_at) > cutoff) break; if (pred(String(h.action || "").toLowerCase())) n++; }
  return n;
}

function holdHoursUntil(c, cutoff) {
  const H = (c.case_history || c.history || []).filter((h) => h?.created_at).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let on = null, total = 0;
  for (const h of H) {
    const a = String(h.action || "").toLowerCase();
    const t = new Date(h.created_at);
    if (t > cutoff) break;
    if (a.includes("hold added")) on = t;
    if (a.includes("hold removed") && on) { total += t - on; on = null; }
  }
  if (on) total += cutoff - on;
  return total / 3_600_000;
}

function lastActivityAtSince(c, since) {
  const H = (c.case_history || c.history || []).filter((h) => h?.created_at).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const s = new Date(since);
  let last = s;
  for (const h of H) {
    const t = new Date(h.created_at);
    if (t < s) continue;
    const a = String(h.action || "").toLowerCase();
    if ((a.includes("hold") || a.includes("moved") || a.includes("comment") || a.includes("uploaded") || a.includes("repair")) && !isNaN(t.getTime())) last = t;
  }
  return last;
}

function eventsSinceEntry(c, entry, now) {
  return (c.case_history || c.history || []).filter((h) => {
    const t = new Date(h.created_at);
    if (t < entry || t > now) return false;
    const a = (h.action || "").toLowerCase();
    return a.includes("moved") || a.includes("due changed") || a.includes("hold") || a.includes("comment") || a.includes("uploaded") || a.includes("repair");
  }).length;
}

function getStageEnteredAtFor(c, stage) {
  const stg = normalizeStage(stage);
  const visits = Array.isArray(c?.visits) ? c.visits : [];
  for (let i = visits.length - 1; i >= 0; i--) {
    const v = visits[i];
    const name = (v?.stage || v?.name || "").toString().toLowerCase();
    if (name.includes(stg) && v?.enteredAt) { const dt = new Date(v.enteredAt); if (!isNaN(dt.getTime())) return dt; }
  }
  if (c?.stageEnteredAt) { const dt = new Date(c.stageEnteredAt); if (!isNaN(dt.getTime())) return dt; }
  const H = (c?.case_history || c?.history || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (let i = H.length - 1; i >= 0; i--) {
    const a = String(H[i]?.action || "").toLowerCase();
    if (a.includes("moved to") && a.includes("stage") && a.includes(stg) && H[i]?.created_at) { const dt = new Date(H[i].created_at); if (!isNaN(dt.getTime())) return dt; }
    if (stg === "production" && a.includes("design to production") && H[i]?.created_at) { const dt = new Date(H[i].created_at); if (!isNaN(dt.getTime())) return dt; }
    if (stg === "finishing" && a.includes("production to finishing") && H[i]?.created_at) { const dt = new Date(H[i].created_at); if (!isNaN(dt.getTime())) return dt; }
    if (stg === "qc" && a.includes("quality control") && H[i]?.created_at) { const dt = new Date(H[i].created_at); if (!isNaN(dt.getTime())) return dt; }
  }
  const fallback = new Date(c?.created_at || Date.now());
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/** ======================= v5 FEATURE COMPUTATION (50 features) ======================== **/

const V5_FEATURE_NAMES = [
  "intercept","log_allowed_wh","allowed_wh_raw","is_rush","entry_hour",
  "due_changes","stage_moves","log_hold_pre","dow","is_friday","is_monday",
  "log_backlog","backlog_raw","is_repair","is_flex","is_bbs",
  "log_lead_days","lead_days_raw","has_backward","has_prior_qc","log_times_seen","same_day_cases",
  "elapsed_bh","log_elapsed","frac_budget","frac_budget_sq","remaining_budget","log_remaining_budget",
  "events_count","log_events","activity_rate","hours_idle","log_idle","hold_during",
  "is_overrun","thin_rem_3h","thin_rem_6h","thin_rem_12h",
  "elapsed_x_rush","elapsed_x_flex","elapsed_x_bbs","elapsed_x_repair",
  "elapsed_x_backlog","elapsed_x_idle","frac_x_rush","frac_x_events",
  "allowed_x_flex","allowed_x_repair","lead_x_flex","idle_x_frac",
];

function computeV5Features(c, stage, entry, due, activeCases, stageStatsForStage, now) {
  const stg = normalizeStage(stage);
  const mods = strSet(c.modifiers);
  const isRush = !!(c.priority || c.rush || mods.has("rush") || mods.has("priority"));
  const history = c.case_history || c.history || [];

  // Static features
  const allowedWH = due ? businessHoursBetween(entry, due) : 0;
  const entryHour = entry.getHours() + entry.getMinutes() / 60;
  const dpy = dowPy(entry);
  const dueChanges = histCountUpTo(c, (a) => a.startsWith("due changed"), entry);
  const stageMoves = histCountUpTo(c, (a) => a.includes("moved"), entry);
  const holdPre = holdHoursUntil(c, entry);
  const isRepair = /repair/i.test(c.caseNumber || c.casenumber || "");
  const isFlex = mods.has("flex");
  const isBBS = mods.has("bbs");
  const createdAt = new Date(c.created_at || Date.now());
  const leadDays = due ? Math.max(0, (due - createdAt) / 86400000) : 3;
  const hasBackward = histCountUpTo(c, (a) => a.includes("to design") || a.includes("from finishing to production"), entry) > 0;
  const hasPriorQC = histCountUpTo(c, (a) => a.includes("quality control"), entry) > 0;

  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const backlog = effectiveBacklog(activeCases, c, stg, entry, k);

  const caseNum = (c.caseNumber || c.casenumber || "").replace(/[^0-9]/g, "");
  const timesSeen = caseNum ? activeCases.filter((o) => (o.caseNumber || o.casenumber || "").replace(/[^0-9]/g, "") === caseNum && o.id !== c.id).length : 0;

  const sameDayCases = Math.min(20, activeCases.filter((o) => {
    const oc = new Date(o.created_at || 0);
    return oc.toDateString() === createdAt.toDateString() && o.id !== c.id;
  }).length);

  // Live features
  const elapsedBH = Math.max(0, businessHoursBetween(entry, now));
  const fracBudget = allowedWH > 0 ? Math.min(3, elapsedBH / Math.max(0.1, allowedWH)) : 0;
  const remainingBudget = Math.max(0, allowedWH - elapsedBH);
  const evtCount = eventsSinceEntry(c, entry, now);
  const lastAct = lastActivityAtSince(c, entry);
  const hoursIdle = Math.max(0, (now - lastAct) / 3600000);
  const holdDuring = Math.max(0, holdHoursUntil(c, now) - holdPre);
  const actRate = elapsedBH > 0.1 ? evtCount / Math.max(0.5, elapsedBH) : 0;
  const logBacklog = Math.log1p(backlog / Math.max(1, k));

  return [
    1.0,                                            // intercept
    Math.log1p(Math.max(0, allowedWH)),              // log_allowed_wh
    Math.min(80, Math.max(0, allowedWH)),            // allowed_wh_raw
    isRush ? 1 : 0,                                 // is_rush
    entryHour,                                       // entry_hour
    dueChanges,                                      // due_changes
    stageMoves,                                      // stage_moves
    Math.log1p(Math.max(0, holdPre)),                // log_hold_pre
    dpy,                                             // dow
    dpy === 4 ? 1 : 0,                              // is_friday
    dpy === 0 ? 1 : 0,                              // is_monday
    logBacklog,                                      // log_backlog
    backlog,                                         // backlog_raw
    isRepair ? 1 : 0,                               // is_repair
    isFlex ? 1 : 0,                                 // is_flex
    isBBS ? 1 : 0,                                  // is_bbs
    Math.log1p(Math.max(0, leadDays)),               // log_lead_days
    Math.min(14, Math.max(0, leadDays)),             // lead_days_raw
    hasBackward ? 1 : 0,                            // has_backward
    hasPriorQC ? 1 : 0,                             // has_prior_qc
    Math.log1p(timesSeen),                           // log_times_seen
    sameDayCases,                                    // same_day_cases
    elapsedBH,                                       // elapsed_bh
    Math.log1p(Math.max(0, elapsedBH)),              // log_elapsed
    fracBudget,                                      // frac_budget
    Math.min(9, fracBudget * fracBudget),            // frac_budget_sq
    Math.min(80, remainingBudget),                   // remaining_budget
    Math.log1p(remainingBudget),                     // log_remaining_budget
    evtCount,                                        // events_count
    Math.log1p(evtCount),                            // log_events
    actRate,                                         // activity_rate
    Math.min(48, hoursIdle),                         // hours_idle
    Math.log1p(hoursIdle),                           // log_idle
    Math.min(24, holdDuring),                        // hold_during
    fracBudget > 1.0 ? 1 : 0,                       // is_overrun
    remainingBudget < 3 ? 1 : 0,                    // thin_rem_3h
    remainingBudget < 6 ? 1 : 0,                    // thin_rem_6h
    remainingBudget < 12 ? 1 : 0,                   // thin_rem_12h
    // Interactions
    elapsedBH * (isRush ? 1 : 0),                   // elapsed_x_rush
    elapsedBH * (isFlex ? 1 : 0),                   // elapsed_x_flex
    elapsedBH * (isBBS ? 1 : 0),                    // elapsed_x_bbs
    elapsedBH * (isRepair ? 1 : 0),                 // elapsed_x_repair
    elapsedBH * logBacklog,                          // elapsed_x_backlog
    elapsedBH * Math.log1p(hoursIdle),               // elapsed_x_idle
    fracBudget * (isRush ? 1 : 0),                  // frac_x_rush
    fracBudget * Math.log1p(evtCount),               // frac_x_events
    Math.log1p(allowedWH) * (isFlex ? 1 : 0),       // allowed_x_flex
    Math.log1p(allowedWH) * (isRepair ? 1 : 0),     // allowed_x_repair
    Math.log1p(leadDays) * (isFlex ? 1 : 0),        // lead_x_flex
    Math.log1p(hoursIdle) * Math.min(3, fracBudget), // idle_x_frac
  ];
}

/** ======================= CORE PREDICTOR (v5 — Live) ======================== **/

function predictStageExitML(c, stage, stageEnteredAt, activeCases, stageStatsForStage) {
  const now = getCurrentTime();
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : now;
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);
  const k = learnedCapacity(stg, stageStatsForStage, STAGE_CAPACITY[stg] || 1);
  const backlog = effectiveBacklog(activeCases, c, stg, entry, k);

  // Compute v5 features (50 features, includes live elapsed time)
  const features = computeV5Features(c, stg, entry, due, activeCases, stageStatsForStage, now);
  const elapsedBH = Math.max(0, businessHoursBetween(entry, now));

  // Run XGBoost prediction
  const stageModel = XGB_MODELS?.[stg];
  if (!stageModel) return null;
  const logRemaining = xgbPredict(stageModel, features);
  const remainingHours = Math.max(0, Math.exp(logRemaining) - 1);

  const totalWorkHours = elapsedBH + remainingHours;
  const absoluteETA = addBusinessHours(now, remainingHours);

  // Confidence: based on elapsed fraction (more elapsed = more confident)
  const fracElapsed = totalWorkHours > 0 ? elapsedBH / totalWorkHours : 0;
  const confidenceScore = Math.round(Math.max(35, Math.min(95, 50 + fracElapsed * 45)));

  return {
    eta: snapToMinutes(absoluteETA, 5),
    workHours: remainingHours,
    totalWorkHours,
    elapsedWorkHours: elapsedBH,
    k,
    backlogEff: backlog,
    modelUsed: "xgboost",
    featureArray: features,
    featureNames: V5_FEATURE_NAMES,
    confidenceScore,
  };
}

/** ======================= RESCHEDULE & STALL PREDICTORS ======================== **/
// These still use simple heuristics since the XGBoost model handles the main ETA prediction.
// The reschedule/stall probabilities feed into the risk score composition.

function predictRescheduleProbHeuristic(c, stage, stageEnteredAt, activeCases) {
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : getCurrentTime();
  const due = dueEOD(c.due || null);
  const stg = normalizeStage(stage);
  const mods = strSet(c.modifiers);
  const isRush = !!(c.priority || c.rush || mods.has("rush"));
  const dueChanges = histCountUpTo(c, (a) => a.startsWith("due changed"), entry);
  const stageMoves = histCountUpTo(c, (a) => a.includes("moved"), entry);
  const holdHrs = holdHoursUntil(c, getCurrentTime());

  let score = 0.03; // base rate
  if (isRush) score += 0.04;
  if (dueChanges > 0) score += 0.06 * dueChanges;
  if (holdHrs >= 4) score += 0.08;
  if (stageMoves >= 3) score += 0.05;
  if (c.slackDays !== undefined && c.slackDays < 0) score += 0.1;
  return clamp(score, 0, 0.9);
}

function predictStallProbHeuristic(c, stage, stageEnteredAt) {
  const entry = stageEnteredAt ? new Date(stageEnteredAt) : getCurrentTime();
  const due = dueEOD(c.due || null);
  if (!due) return 0.1;
  const allowedWH = businessHoursBetween(entry, due);
  const elapsedWH = businessHoursBetween(entry, getCurrentTime());
  const fracUsed = allowedWH > 0 ? elapsedWH / allowedWH : 0;

  let score = 0.1;
  if (fracUsed > 1.0) score += 0.4; // overrun
  else if (fracUsed > 0.8) score += 0.2;
  else if (fracUsed > 0.6) score += 0.1;

  const hoursIdle = (getCurrentTime() - lastActivityAtSince(c, entry)) / 3600000;
  if (hoursIdle >= 18) score += 0.15;
  return clamp(score, 0, 0.95);
}

const toLevel = (p) => p >= 0.85 ? "critical" : p >= 0.65 ? "high" : p >= 0.4 ? "medium" : "low";

/** ======================= MAIN PREDICTION GENERATOR ======================== **/

export function generateCaseRiskPredictions(activeCases, throughputAnalysis, stage = null, stageStats = null) {
  if (!activeCases || activeCases.length === 0) {
    return { atRisk: 0, predictions: [], urgent: [], summary: { onTrack: 0, atRisk: 0, high: 0, critical: 0, averageCompletionConfidence: 0, averageLateProbability: 0 }, byRiskLevel: { critical: [], high: [], medium: [], low: [] } };
  }

  const nowTs = getCurrentTime().getTime();
  const currentStage = normalizeStage(stage || "design");
  const k = learnedCapacity(currentStage, stageStats?.stageStats?.[currentStage], STAGE_CAPACITY[currentStage] || 1);

  const predictions = activeCases.map((c) => {
    const caseType = c.caseType || (c.modifiers?.includes?.("bbs") ? "bbs" : c.modifiers?.includes?.("flex") ? "flex" : "general");
    const stageEnteredAt = getStageEnteredAtFor(c, currentStage);
    const timeInStageMs = Math.max(0, nowTs - (stageEnteredAt?.getTime?.() || nowTs));

    const mlResult = predictStageExitML(c, currentStage, stageEnteredAt, activeCases, stageStats?.stageStats?.[currentStage]);
    if (!mlResult) return null;
    const expectedCompletionDate = mlResult.eta;
    const dueDate = dueEOD(c.due);
    const dueDateDisplay = parseDueDateForDisplay(c.due);
    const isRush = !!(c?.rush || c?.priority);
    const daysUntilDue = dueDate ? (dueDate.getTime() - nowTs) / 86_400_000 : Number.POSITIVE_INFINITY;
    const expectedDaysToComplete = (expectedCompletionDate.getTime() - nowTs) / 86_400_000;
    const willBeLate = dueDate ? expectedCompletionDate > dueDate : false;
    const slackDays = daysUntilDue - expectedDaysToComplete;

    // Risk score — simplified from v1, no hardcoded p_data
    const p_slack = sigmoid(-0.895 * slackDays + 0.405);
    const holdHrs = holdHoursUntil(c, getCurrentTime());
    const qcLoops = histCountUpTo(c, (a) => a.includes("moved to quality control") || a.includes("finishing to quality control"), getCurrentTime());
    const pHold = 1 - Math.exp(-Math.max(0, holdHrs) / 12);
    const pQc = clamp(qcLoops * 0.18, 0, 0.6);
    const p_ops = clamp(1 - (1 - pHold) * (1 - pQc));
    const p_base = clamp(1 - Math.pow(1 - p_slack, 0.75) * Math.pow(1 - p_ops, 0.25));

    c.holdHours = holdHrs;
    c.slackDays = slackDays;
    const p_reschedule = predictRescheduleProbHeuristic(c, currentStage, stageEnteredAt, activeCases);
    const p_stallLate = predictStallProbHeuristic(c, currentStage, stageEnteredAt);
    const reschedDiscount = RESCHEDULE_DISCOUNT_GAMMA * p_reschedule * (1 - p_stallLate);
    const p_final = clamp(p_base * (1 - reschedDiscount), 0, 1);

    const elapsedWorkHours = mlResult.elapsedWorkHours;
    const progressPercent = Math.min(98, (elapsedWorkHours / Math.max(1e-6, mlResult.totalWorkHours)) * 100);
    const hoursIdle = (getCurrentTime() - lastActivityAtSince(c, stageEnteredAt)) / 3600000;

    return {
      id: c.id,
      caseNumber: c.caseNumber || c.casenumber,
      caseType,
      currentStage,
      timeInStageMs,
      stageWorkHours: mlResult.workHours,
      totalStageWorkHours: mlResult.totalWorkHours,
      elapsedWorkHours,
      progressPercent,
      hoursIdle,
      stageEnteredAt,
      expectedCompletionDate,
      dueDate: dueDateDisplay,
      dueDateCalc: dueDate,
      willBeLate,
      daysUntilDue: isFinite(daysUntilDue) ? daysUntilDue : null,
      expectedDaysToComplete,
      daysLate: willBeLate ? Math.max(0, expectedDaysToComplete - daysUntilDue) : 0,
      riskLevel: toLevel(p_final),
      confidence: mlResult.confidenceScore >= 70 ? "high" : mlResult.confidenceScore >= 50 ? "medium" : "low",
      confidenceScore: mlResult.confidenceScore,
      lateProbability: p_final,
      rescheduleProbability: p_reschedule,
      stallLateProbability: p_stallLate,
      riskScore: Math.round(p_final * 100),
      riskReasons: [],
      riskComponents: { slack: p_slack, ops: p_ops, base: p_base, rescheduleDiscount: reschedDiscount },
      slackDays,
      slackHours: slackDays * 24,
      dueChanges: histCountUpTo(c, (a) => a.startsWith("due changed"), stageEnteredAt),
      stageMoves: histCountUpTo(c, (a) => a.includes("moved"), stageEnteredAt),
      onHold: holdHrs > 0.1,
      holdHours: holdHrs,
      qcLoops,
      isRush,
      backlogCount: mlResult.backlogEff,
      stageCapacity: mlResult.k,
      recommendation: "",
      modelUsed: mlResult.modelUsed,
      featureArray: mlResult.featureArray,
      featureNames: mlResult.featureNames,
    };
  }).filter(Boolean);

  // Populate risk reasons and recommendations
  for (const p of predictions) {
    const reasons = [];
    if (p.riskComponents.slack >= 0.65) reasons.push(p.slackDays < 0 ? "past due buffer" : "tight buffer");
    if (p.holdHours >= 8) reasons.push("long hold time");
    if (p.qcLoops > 0) reasons.push(`${p.qcLoops} QC loop${p.qcLoops > 1 ? "s" : ""}`);
    if (p.backlogCount > 3) reasons.push(`backlog: ${Math.round(p.backlogCount)} cases ahead`);
    if (p.hoursIdle >= 18) reasons.push("low activity");
    if (p.willBeLate) reasons.push(`predicted ${formatHours(p.daysLate * 24)} late`);
    p.riskReasons = reasons;
    p.recommendation = generateRecommendation(p);
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  predictions.sort((a, b) => order[a.riskLevel] - order[b.riskLevel] || b.lateProbability - a.lateProbability);

  return {
    atRisk: predictions.filter((p) => p.riskLevel !== "low").length,
    predictions,
    urgent: predictions.filter((p) => p.riskLevel === "critical"),
    high: predictions.filter((p) => p.riskLevel === "high"),
    summary: {
      onTrack: predictions.filter((p) => !p.willBeLate && p.riskLevel === "low").length,
      atRisk: predictions.filter((p) => p.riskLevel === "medium").length,
      high: predictions.filter((p) => p.riskLevel === "high").length,
      critical: predictions.filter((p) => p.riskLevel === "critical").length,
      averageCompletionConfidence: predictions.length ? predictions.reduce((s, p) => s + p.confidenceScore, 0) / predictions.length : 0,
      averageLateProbability: predictions.length ? predictions.reduce((s, p) => s + p.lateProbability, 0) / predictions.length : 0,
      averageRescheduleProbability: predictions.length ? predictions.reduce((s, p) => s + p.rescheduleProbability, 0) / predictions.length : 0,
      stageCapacity: k,
    },
    byRiskLevel: {
      critical: predictions.filter((p) => p.riskLevel === "critical"),
      high: predictions.filter((p) => p.riskLevel === "high"),
      medium: predictions.filter((p) => p.riskLevel === "medium"),
      low: predictions.filter((p) => p.riskLevel === "low"),
    },
  };
}

function generateRecommendation(p) {
  if (p.riskLevel === "critical") return p.progressPercent < 50 ? "Immediate escalation required" : "Urgent attention needed";
  if (p.riskLevel === "high") return p.isRush ? "Priority case at risk — reallocate resources" : "Monitor closely — may require intervention";
  if (p.riskLevel === "medium") return p.progressPercent > 75 ? "Nearly complete but timing is tight" : "On track but limited buffer";
  return "On schedule";
}

/** ======================= DESIGN SYSTEM ======================== **/

const COLORS = {
  status: {
    critical: { primary: "#dc2626", light: "#fef2f2", border: "#fecaca", text: "#991b1b" },
    high: { primary: "#f59e0b", light: "#fffbeb", border: "#fde68a", text: "#92400e" },
    medium: { primary: "#eab308", light: "#fefce8", border: "#fef08a", text: "#854d0e" },
    low: { primary: "#22c55e", light: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
  },
};

export const formatPercent = (value, decimals = 0) => `${Math.max(0, Math.min(100, Number(value) || 0)).toFixed(decimals)}%`;
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
  if (p.willBeLate) { if (p.riskLevel === "low") return "medium"; if (p.riskLevel === "medium") return "high"; return "critical"; }
  return p.riskLevel;
};

/** ======================= UI COMPONENTS ======================== **/

const Icons = {
  ChevronDown: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>,
  Clock: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  AlertTriangle: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  CheckCircle: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  XCircle: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Info: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Activity: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>,
  Zap: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  Pause: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  RefreshCw: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  X: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  Search: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
  Filter: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
  BarChart: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  Target: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>,
  Brain: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
  Expand: ({ className }) => <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>,
};

const StatusBadge = ({ status, size = "md" }) => {
  const colors = COLORS.status[status] || COLORS.status.low;
  const sizes = { sm: "px-2 py-0.5 text-xs", md: "px-2.5 py-1 text-xs", lg: "px-3 py-1.5 text-sm" };
  return <span className={`inline-flex items-center font-semibold uppercase tracking-wide rounded-md ${sizes[size]}`} style={{ backgroundColor: colors.light, color: colors.text, border: `1px solid ${colors.border}` }}>{status}</span>;
};

const ProgressBar = ({ value, size = "md", color = "auto" }) => {
  const heights = { sm: "h-1", md: "h-2", lg: "h-3" };
  const percent = Math.max(0, Math.min(100, value || 0));
  let barColor;
  if (color === "auto") barColor = percent > 75 ? "#22c55e" : percent > 50 ? "#3b82f6" : percent > 25 ? "#f59e0b" : "#dc2626";
  else barColor = color;
  return <div className={`w-full bg-gray-100 rounded-full overflow-hidden ${heights[size]}`}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, backgroundColor: barColor }} /></div>;
};

/** ======================= COMPACT CASE ROW ======================== **/

const CompactCaseRow = ({ prediction, onOpenAnalytics }) => {
  const status = getStatusFromPrediction(prediction);
  const colors = COLORS.status[status];
  const now = new Date();
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : null;
  const isOverdue = dueDate && dueDate < now;

  const getTimeDisplay = () => {
    if (isOverdue) return { primary: "OVERDUE", secondary: formatRelativeTime(dueDate), color: colors.primary, urgent: true };
    if (prediction.willBeLate) return { primary: `Late by ${formatHours(prediction.daysLate * 24)}`, secondary: `Due ${formatRelativeTime(dueDate)}`, color: colors.primary, urgent: true };
    return { primary: formatRelativeTime(dueDate), secondary: prediction.slackDays > 0 ? `${formatHours(prediction.slackDays * 24)} buffer` : "On time", color: colors.primary, urgent: false };
  };
  const timeDisplay = getTimeDisplay();

  return (
    <motion.div layout className="group">
      <div className="relative bg-white rounded-xl border border-gray-200 transition-all hover:shadow-md hover:border-gray-300 overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ backgroundColor: colors.primary }} />
        <div className="pl-4 pr-4 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 w-44">
              <div>
                <div className="font-mono text-base font-bold text-gray-900">{prediction.caseNumber}</div>
                <div className="text-xs text-gray-500 capitalize">{prediction.caseType}</div>
              </div>
            </div>
            <div className="w-24"><StatusBadge status={status} /></div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className={`text-lg font-bold ${timeDisplay.urgent ? "" : "text-gray-900"}`} style={timeDisplay.urgent ? { color: timeDisplay.color } : {}}>{timeDisplay.primary}</div>
                <div className="text-xs text-gray-500">{timeDisplay.secondary}</div>
              </div>
            </div>
            <div className="w-32">
              <div className="flex items-center gap-2">
                <ProgressBar value={prediction.progressPercent} size="sm" />
                <span className="text-xs font-medium text-gray-600 w-10">{formatPercent(prediction.progressPercent)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 w-32 justify-end">
              {prediction.isRush && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs font-semibold rounded flex items-center gap-1"><Icons.Zap className="w-3 h-3" />RUSH</span>}
              {prediction.onHold && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded flex items-center gap-1"><Icons.Pause className="w-3 h-3" />HOLD</span>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); onOpenAnalytics(); }} className="p-2 hover:bg-gray-100 rounded-lg transition-colors group/btn">
              <Icons.Expand className="w-5 h-5 text-gray-400 group-hover/btn:text-blue-500" />
            </button>
          </div>
        </div>
        <div className="h-0.5 bg-gray-100"><div className="h-full transition-all duration-500" style={{ width: `${prediction.progressPercent}%`, backgroundColor: colors.primary }} /></div>
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
    { id: "features", label: "Features", icon: Icons.Brain },
  ];

  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden" initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex-none px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl" style={{ backgroundColor: colors.light }}>
                  <div className="text-2xl font-mono font-bold" style={{ color: colors.text }}>{prediction.caseNumber}</div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={status} size="lg" />
                    {prediction.isRush && <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded">RUSH</span>}
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs font-mono rounded">v5 {prediction.modelUsed}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{prediction.currentStage} stage • {formatPercent(prediction.progressPercent)} complete • {prediction.confidenceScore}% confidence</div>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><Icons.X className="w-6 h-6 text-gray-400" /></button>
            </div>
            <div className="mt-4 p-4 rounded-xl" style={{ backgroundColor: colors.light, borderLeft: `4px solid ${colors.primary}` }}>
              <div className="flex items-start gap-3">
                {status === "critical" ? <Icons.XCircle className="w-5 h-5 mt-0.5" style={{ color: colors.text }} /> : status === "high" ? <Icons.AlertTriangle className="w-5 h-5 mt-0.5" style={{ color: colors.text }} /> : <Icons.CheckCircle className="w-5 h-5 mt-0.5" style={{ color: colors.text }} />}
                <div>
                  <div className="font-semibold" style={{ color: colors.text }}>Recommendation</div>
                  <div className="text-sm mt-1" style={{ color: colors.text }}>{prediction.recommendation}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-none border-b border-gray-200 px-6 bg-gray-50">
            <div className="flex gap-1">
              {tabs.map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-blue-500 text-blue-600 bg-white" : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100"} rounded-t-lg`}>
                  <tab.icon className="w-4 h-4" />{tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6 bg-gray-50">
            <AnimatePresence mode="wait">
              {activeTab === "overview" && (
                <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    <div className={`rounded-xl p-4 border ${prediction.riskScore >= 65 ? "bg-red-50 border-red-200" : prediction.riskScore >= 40 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
                      <div className="text-xs text-gray-500 uppercase tracking-wide">Risk Score</div>
                      <div className="text-3xl font-bold mt-1" style={{ color: colors.text }}>{prediction.riskScore}</div>
                    </div>
                    <div className="rounded-xl p-4 bg-white border border-gray-200">
                      <div className="text-xs text-gray-500 uppercase tracking-wide">Predicted Remaining</div>
                      <div className="text-3xl font-bold mt-1 text-gray-900">{formatHours(prediction.stageWorkHours)}</div>
                    </div>
                    <div className={`rounded-xl p-4 border ${prediction.slackDays < 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                      <div className="text-xs text-gray-500 uppercase tracking-wide">Buffer</div>
                      <div className={`text-3xl font-bold mt-1 ${prediction.slackDays < 0 ? "text-red-600" : "text-green-600"}`}>
                        {prediction.slackDays >= 0 ? formatHours(prediction.slackDays * 24) : `−${formatHours(Math.abs(prediction.slackDays) * 24)}`}
                      </div>
                    </div>
                    <div className="rounded-xl p-4 bg-white border border-gray-200">
                      <div className="text-xs text-gray-500 uppercase tracking-wide">Confidence</div>
                      <div className="text-3xl font-bold mt-1 text-gray-900">{prediction.confidenceScore}%</div>
                      <div className="text-xs text-gray-400 mt-1">Updates as case progresses</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Operational Metrics</h4>
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div className="p-3 bg-gray-50 rounded-lg"><div className="text-2xl font-bold text-gray-900">{prediction.stageMoves}</div><div className="text-xs text-gray-500">Stage Moves</div></div>
                        <div className="p-3 bg-gray-50 rounded-lg"><div className="text-2xl font-bold text-gray-900">{prediction.dueChanges}</div><div className="text-xs text-gray-500">Due Changes</div></div>
                        <div className="p-3 bg-gray-50 rounded-lg"><div className="text-2xl font-bold text-gray-900">{prediction.qcLoops}</div><div className="text-xs text-gray-500">QC Loops</div></div>
                        <div className="p-3 bg-gray-50 rounded-lg"><div className="text-2xl font-bold text-gray-900">{formatHours(prediction.holdHours)}</div><div className="text-xs text-gray-500">Hold Time</div></div>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Activity Status</h4>
                      <div className={`p-4 rounded-xl ${prediction.hoursIdle >= 18 ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-gray-600">Last Activity</div>
                            <div className={`text-xl font-bold ${prediction.hoursIdle >= 18 ? "text-amber-600" : "text-green-600"}`}>{prediction.hoursIdle < 1 ? "Active now" : `${formatHours(prediction.hoursIdle)} ago`}</div>
                          </div>
                          <Icons.Activity className={`w-8 h-8 ${prediction.hoursIdle >= 18 ? "text-amber-400" : "text-green-400"}`} />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "timeline" && (
                <motion.div key="timeline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h4 className="text-sm font-semibold text-gray-900 mb-4">Time Breakdown</h4>
                    <div className="space-y-3">
                      {[
                        { label: "Stage Entry", value: formatDate(prediction.stageEnteredAt, { dayTime: true }) },
                        { label: "Time in Stage", value: formatHours(prediction.elapsedWorkHours) },
                        { label: "Predicted Remaining", value: formatHours(prediction.stageWorkHours) },
                        { label: "Predicted Total", value: formatHours(prediction.totalStageWorkHours) },
                        { label: "Expected Exit", value: formatDate(prediction.expectedCompletionDate, { dayTime: true }) },
                        { label: "Due Date", value: formatDate(dueDate, { dayTime: true }) },
                      ].map((row, idx) => (
                        <div key={idx} className="flex justify-between items-center py-2">
                          <span className="text-sm text-gray-600">{row.label}</span>
                          <span className="text-sm font-mono font-semibold text-gray-900">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "risk" && (
                <motion.div key="risk" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Risk Score</h4>
                      <div className="flex items-center justify-center mb-4">
                        <div className="relative w-32 h-32">
                          <svg className="w-full h-full transform -rotate-90"><circle cx="64" cy="64" r="56" fill="none" stroke="#e5e7eb" strokeWidth="12" /><circle cx="64" cy="64" r="56" fill="none" stroke={colors.primary} strokeWidth="12" strokeDasharray={`${prediction.riskScore * 3.52} 352`} strokeLinecap="round" /></svg>
                          <div className="absolute inset-0 flex items-center justify-center"><span className="text-3xl font-bold" style={{ color: colors.text }}>{prediction.riskScore}</span></div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {[{ label: "Slack", value: prediction.riskComponents.slack }, { label: "Operations", value: prediction.riskComponents.ops }].map(({ label, value }) => (
                          <div key={label}><div className="flex justify-between text-sm mb-1"><span className="text-gray-600">{label}</span><span className="font-mono">{formatPercent(value * 100)}</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-gray-400 rounded-full" style={{ width: `${value * 100}%` }} /></div></div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h4 className="text-sm font-semibold text-gray-900 mb-4">Risk Factors</h4>
                      <div className="space-y-2">
                        {prediction.riskReasons.length > 0 ? prediction.riskReasons.map((reason, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-sm text-amber-800">{reason}</span></div>
                        )) : <div className="text-sm text-gray-500 text-center py-4">No significant risk factors</div>}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === "features" && (
                <motion.div key="features" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">v5 Feature Vector ({prediction.featureNames?.length || 50} features)</h4>
                    <p className="text-xs text-gray-500 mb-4">XGBoost model with 200 trees. Predictions update live as the case progresses.</p>
                    <div className="grid grid-cols-3 gap-2 font-mono text-sm">
                      {prediction.featureNames?.map((name, idx) => {
                        const val = prediction.featureArray?.[idx] ?? 0;
                        const isActive = Math.abs(val) > 0.001;
                        return (
                          <div key={name} className={`flex justify-between py-1 px-2 rounded ${isActive ? "bg-blue-50" : "bg-gray-50"}`}>
                            <span className={`truncate ${isActive ? "text-blue-700" : "text-gray-400"}`}>{name}</span>
                            <span className={isActive ? "text-gray-900 font-semibold" : "text-gray-400"}>{typeof val === "number" ? val.toFixed(3) : val}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="flex-none px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between">
              <button onClick={() => onOpenHistory?.()} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">View Case History</button>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Close</button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

/** ======================= MAIN MODAL COMPONENT ======================== **/

export function CaseRiskModal({ open, onClose, predictions = [], stage, onOpenCaseHistory, onDataProcessed }) {
  const [query, setQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("risk");
  const [selectedPrediction, setSelectedPrediction] = useState(null);

  const processedPredictions = useMemo(() => {
    let filtered = [...predictions];
    if (filterStatus !== "all") filtered = filtered.filter((p) => getStatusFromPrediction(p) === filterStatus);
    if (query.trim()) { const q = query.trim().toLowerCase(); filtered = filtered.filter((p) => p.caseNumber?.toLowerCase().includes(q) || p.caseType?.toLowerCase().includes(q)); }
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => {
      if (sortBy === "risk") return order[getStatusFromPrediction(a)] - order[getStatusFromPrediction(b)] || b.lateProbability - a.lateProbability;
      if (sortBy === "due") { const aD = a.dueDate ? new Date(a.dueDate).getTime() : Infinity, bD = b.dueDate ? new Date(b.dueDate).getTime() : Infinity; return aD - bD; }
      if (sortBy === "progress") return a.progressPercent - b.progressPercent;
      return 0;
    });
    return filtered;
  }, [predictions, filterStatus, query, sortBy]);

  const summary = useMemo(() => ({
    total: predictions.length,
    critical: predictions.filter((p) => getStatusFromPrediction(p) === "critical").length,
    high: predictions.filter((p) => getStatusFromPrediction(p) === "high").length,
    medium: predictions.filter((p) => getStatusFromPrediction(p) === "medium").length,
    low: predictions.filter((p) => getStatusFromPrediction(p) === "low").length,
    avgRisk: predictions.length ? (predictions.reduce((s, p) => s + p.lateProbability, 0) / predictions.length) * 100 : 0,
    stageCapacity: predictions[0]?.stageCapacity || 1,
  }), [predictions]);

  useEffect(() => { onDataProcessed?.({ processedPredictions, summary, stage, filterStatus, query, rawPredictions: predictions }); }, [processedPredictions, summary, stage, filterStatus, query, predictions, onDataProcessed]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex-none px-6 py-5 bg-white border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Case Risk Analysis <span className="text-sm font-normal text-gray-400 ml-2">v5 XGBoost</span></h2>
                <p className="text-sm text-gray-500 mt-0.5"><span className="font-medium capitalize">{stage}</span> Stage • {summary.total} cases • Avg Risk: {formatPercent(summary.avgRisk, 1)}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><Icons.X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-4 gap-3 mt-4">
              {Object.entries({ critical: summary.critical, high: summary.high, medium: summary.medium, low: summary.low }).map(([status, count]) => {
                const c = COLORS.status[status];
                const isActive = filterStatus === status;
                return <button key={status} onClick={() => setFilterStatus(filterStatus === status ? "all" : status)} className={`rounded-xl p-3 border-2 transition-all ${isActive ? "scale-105 shadow-md" : "hover:shadow-sm"}`} style={{ backgroundColor: c.light, borderColor: isActive ? c.primary : c.border }}>
                  <div className="text-2xl font-bold" style={{ color: c.text }}>{count}</div>
                  <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: c.text }}>{status}</div>
                </button>;
              })}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mt-4">
              <div className="relative flex-1 max-w-sm">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases..." className="w-full pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
              </div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="risk">Sort by Risk</option><option value="due">Sort by Due Date</option><option value="progress">Sort by Progress</option>
              </select>
              {filterStatus !== "all" && <button onClick={() => setFilterStatus("all")} className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">Clear Filter</button>}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4">
            {processedPredictions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Icons.Search className="w-16 h-16 text-gray-300 mb-4" />
                <p className="text-lg font-semibold text-gray-600">No cases found</p>
                <p className="text-sm text-gray-500 mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="space-y-2">{processedPredictions.map((prediction) => <CompactCaseRow key={prediction.id || prediction.caseNumber} prediction={prediction} onOpenAnalytics={() => setSelectedPrediction(prediction)} />)}</div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-none px-6 py-3 bg-white border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Showing {processedPredictions.length} of {predictions.length} cases</span>
              <span>Capacity: {summary.stageCapacity} workers • Live predictions</span>
            </div>
          </div>
        </motion.div>

        <AnalyticsModal prediction={selectedPrediction} open={!!selectedPrediction} onClose={() => setSelectedPrediction(null)} onOpenHistory={() => { if (selectedPrediction) onOpenCaseHistory?.(selectedPrediction.id, selectedPrediction.caseNumber); }} />
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

/** ======================= EXPORTS ======================== **/

export const StandaloneCompactRow = CompactCaseRow;
export const StandaloneAnalyticsModal = AnalyticsModal;
export { StatusBadge, ProgressBar, COLORS };
