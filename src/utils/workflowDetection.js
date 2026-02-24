// src/utils/workflowDetection.js

import { db } from "../services/caseService";

/**
 * Extract the primary case number (first token) from a full case string.
 * "899 some notes" → "899"
 */
export const extractPrimaryCaseNumber = (caseNumber = "") =>
  caseNumber.trim().split(/\s+/)[0];

/**
 * Normalize department so "General" (DB) and "Digital" (UI) are treated
 * as the same department.
 */
const normalizeDept = (dept) => {
  if (!dept) return "unknown";
  const d = dept.trim().toLowerCase();
  return d === "general" || d === "digital" ? "digital" : d;
};

/**
 * Fetch actual "Marked done" timestamps for a list of case IDs.
 * Returns Map<caseId, ISO timestamp string> using the most recent entry.
 *
 * Primary source: case_history "marked done" entries.
 * Secondary fallback: the case row's updated_at (for completed cases
 * that have no matching history entry).
 */
const fetchCompletionDates = async (caseIds) => {
  const map = new Map();
  if (!caseIds.length) return map;

  const BATCH = 200;
  for (let i = 0; i < caseIds.length; i += BATCH) {
    const batch = caseIds.slice(i, i + BATCH);

    // Primary: case_history "marked done" entries
    const { data } = await db
      .from("case_history")
      .select("case_id, created_at")
      .in("case_id", batch)
      .ilike("action", "%marked done%")
      .order("created_at", { ascending: false });

    if (data) {
      for (const row of data) {
        if (!map.has(row.case_id)) map.set(row.case_id, row.created_at);
      }
    }

    // Secondary: for any completed cases we missed in history,
    // try the case's updated_at as a last resort
    const missing = batch.filter((id) => !map.has(id));
    if (missing.length) {
      const { data: caseData } = await db
        .from("cases")
        .select("id, updated_at")
        .in("id", missing)
        .eq("completed", true);

      if (caseData) {
        for (const row of caseData) {
          if (!map.has(row.id) && row.updated_at) {
            map.set(row.id, row.updated_at);
          }
        }
      }
    }
  }

  return map;
};

/**
 * Module-level cache of completion dates populated by buildWorkflowMap.
 * getWorkflowStatus (synchronous) reads from this so it has access to
 * real timestamps without needing to be async itself.
 */
let _completionDatesCache = new Map();

/**
 * Were two cases genuinely active at the same time?
 *
 * Three scenarios:
 *
 * 1. BOTH completed — check whether their active windows overlapped
 *    using real completion timestamps. Active window for a case is
 *    [created_at, done_at]. Overlap iff A.created < B.done AND
 *    B.created < A.done. If either timestamp is missing, assume
 *    NO overlap (safe default since case numbers are heavily reused).
 *
 * 2. ONE completed, one still active — the completed case must have
 *    been finished AFTER the still-active case was created. If we
 *    have no completion timestamp, assume no overlap.
 *
 * 3. NEITHER completed — overlap is guaranteed (both still active).
 */
const wereCoActive = (a, b, completionDates) => {
  const aT = new Date(a.created_at).getTime();
  const bT = new Date(b.created_at).getTime();

  // ── Scenario 3: neither completed → both still active ──
  if (!a.completed && !b.completed) return true;

  // ── Scenario 1: both completed ──
  if (a.completed && b.completed) {
    const aDoneRaw = completionDates.get(a.id);
    const bDoneRaw = completionDates.get(b.id);

    // We need BOTH timestamps to prove overlap.
    // Case numbers are reused frequently, so without timestamps
    // we cannot assume two completed cases were ever concurrent.
    if (!aDoneRaw || !bDoneRaw) return false;

    const aDone = new Date(aDoneRaw).getTime();
    const bDone = new Date(bDoneRaw).getTime();

    // Proper interval overlap:
    // A active window: [aCreated, aDone]
    // B active window: [bCreated, bDone]
    // Overlap iff aCreated < bDone AND bCreated < aDone
    return aT < bDone && bT < aDone;
  }

  // ── Scenario 2: exactly one completed ──
  const [earlier] = aT <= bT ? [a, b] : [b, a];
  const laterCreated = Math.max(aT, bT);

  // The still-active case was created first → overlap guaranteed
  if (!earlier.completed) return true;

  // Earlier is the completed one — need its timestamp
  const doneRaw = completionDates.get(earlier.id);

  if (!doneRaw) {
    // Completed but no timestamp — cannot prove overlap.
    // Conservatively assume no overlap to prevent false links
    // from reused case numbers.
    return false;
  }

  const doneTime = new Date(doneRaw).getTime();
  return laterCreated <= doneTime;
};

/**
 * Sort comparator for workflow chains.
 * Primary: due date ascending.
 * Tiebreaker: created_at ascending (earlier-created case comes first,
 * so the later-created case is the one that "waits").
 */
const chainSort = (a, b) => {
  const dueDiff = new Date(a.due) - new Date(b.due);
  if (dueDiff !== 0) return dueDiff;
  return new Date(a.created_at) - new Date(b.created_at);
};

/**
 * Build the complete workflow map in a single pass.
 *
 * Returns Map<caseId, WorkflowStatus> where WorkflowStatus is:
 * {
 *   isWorkflow, chain, stepIndex, isUpstream, isDownstream,
 *   isPending, upstreamCases, downstreamCases, primaryCaseNumber
 * }
 */
export const buildWorkflowMap = async (rows) => {
  const result = new Map();

  // ── Step 1: group eligible cases by primary case number ──
  const groups = new Map();
  for (const row of rows) {
    if (row.archived) continue;
    if ((row.modifiers || []).includes("workflow-unlinked")) continue;

    const key = extractPrimaryCaseNumber(row.caseNumber || row.casenumber);
    if (!key) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  // ── Step 2: keep only groups with 2+ different departments ──
  //    and collect completed IDs we need timestamps for
  const completedIds = [];
  const candidateGroups = new Map();

  for (const [key, cases] of groups) {
    if (cases.length < 2) continue;

    const depts = new Set();
    for (const c of cases) depts.add(normalizeDept(c.department));
    if (depts.size < 2) continue;

    candidateGroups.set(key, cases);
    for (const c of cases) {
      if (c.completed) completedIds.push(c.id);
    }
  }

  if (candidateGroups.size === 0) return result;

  // ── Step 3: single DB call for all completion dates ──
  const completionDates = await fetchCompletionDates(completedIds);

  // Update the module-level cache so getWorkflowStatus (sync) can use it
  _completionDatesCache = completionDates;

  // ── Step 4: for each group, find linked pairs and build chains ──
  for (const [key, cases] of candidateGroups) {
    const sorted = cases.slice().sort(chainSort);

    // Pairwise: different dept + co-active → linked
    const linked = new Set();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (normalizeDept(a.department) === normalizeDept(b.department))
          continue;
        if (!wereCoActive(a, b, completionDates)) continue;
        linked.add(a.id);
        linked.add(b.id);
      }
    }

    if (linked.size < 2) continue;

    const chain = sorted.filter((c) => linked.has(c.id));

    // Verify at least 2 departments survive
    const chainDepts = new Set();
    for (const c of chain) chainDepts.add(normalizeDept(c.department));
    if (chainDepts.size < 2) continue;

    // ── Step 5: derive each case's status from the chain ──
    for (let idx = 0; idx < chain.length; idx++) {
      const c = chain[idx];
      const upstream = chain.slice(0, idx);
      const downstream = chain.slice(idx + 1);

      result.set(c.id, {
        isWorkflow: true,
        chain,
        stepIndex: idx,
        isUpstream: idx === 0,
        isDownstream: idx > 0,
        isPending: upstream.some((u) => !u.completed),
        upstreamCases: upstream,
        downstreamCases: downstream,
        primaryCaseNumber: key,
      });
    }
  }

  return result;
};

/**
 * Standalone helper used by CaseHistory to get workflow status for a
 * single case that may have a remapped department ("Digital" vs "General").
 *
 * SYNCHRONOUS — uses the module-level completion dates cache that
 * buildWorkflowMap populates on each rebuild. This ensures the sync
 * path has access to real timestamps without needing to be async,
 * which avoids breaking any existing callers.
 *
 * Falls back to caller-provided completionDates if given.
 */
export const getWorkflowStatus = (row, allRows, completionDates = null) => {
  if (!row) return null;
  if ((row.modifiers || []).includes("workflow-unlinked")) return null;

  const primaryNum = extractPrimaryCaseNumber(row.caseNumber || row.casenumber);
  if (!primaryNum) return null;

  const rowDept = normalizeDept(row.department);

  const siblings = allRows.filter((r) => {
    if (r.id === row.id || r.archived) return false;
    if ((r.modifiers || []).includes("workflow-unlinked")) return false;
    const rNum = extractPrimaryCaseNumber(r.caseNumber || r.casenumber);
    return rNum === primaryNum && normalizeDept(r.department) !== rowDept;
  });

  if (!siblings.length) return null;

  // Use caller-provided dates, fall back to the module-level cache
  // populated by buildWorkflowMap
  const dates = completionDates || _completionDatesCache;

  const coActive = siblings.filter((s) => wereCoActive(row, s, dates));
  if (!coActive.length) return null;

  const chain = [row, ...coActive].sort(chainSort);

  const stepIndex = chain.findIndex((c) => c.id === row.id);

  return {
    isWorkflow: true,
    chain,
    stepIndex,
    isUpstream: stepIndex === 0,
    isDownstream: stepIndex > 0,
    isPending: chain.slice(0, stepIndex).some((c) => !c.completed),
    upstreamCases: chain.slice(0, stepIndex),
    downstreamCases: chain.slice(stepIndex + 1),
    primaryCaseNumber: primaryNum,
  };
};
