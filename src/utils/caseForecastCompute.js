/**
 * caseForecastCompute.js
 *
 * Shared compute used by:
 *   - the in-modal "Risk Forecast" strip in CaseHistory.jsx (production)
 *   - scripts/test-forecast-diff.mjs (parity harness against Efficiency)
 *
 * The function takes the same data CaseHistory has on hand (a focal
 * case row with its case_history attached, plus the full active-case
 * pool from DataContext) and runs the production risk-prediction
 * engine the way the Efficiency screen does. The forecast strip and
 * the Efficiency screen produce identical predictions because they
 * call the same engine with the same shapes of inputs.
 *
 * The compute matches Efficiency's pipeline byte-for-byte:
 *   - fetch case_history for every active case in the pool
 *   - enrich every pool row (including the focal) with stage fields
 *     (currentStage / current_stage / stage) derived from modifiers
 *     and with case_history attached. The engine reads two different
 *     stage-field patterns in two different spots; setting all three
 *     covers both.
 *   - feed the *full* active pool (all stages) to extractRecent-
 *     CompletedVisits and computeLabContextV9 — this is what
 *     Efficiency's `labPoolSource` is. Completed cases are NOT in
 *     the pool; visits come from active cases' past stage transitions.
 *   - filter to the same-stage subset for `peerPool` — this is what
 *     Efficiency passes as `activeCases` to the engine, so timesSeen
 *     / sameDayCases / batchSiblings (which the ML model reads) all
 *     scan the identical pool.
 *   - call the engine with [enrichedFocal] as activeCases so it runs
 *     exactly one per-case loop iteration (single ML inference).
 */
import { db as defaultDb } from "../services/caseService";
import {
  generateCaseRiskPredictions,
  extractRecentCompletedVisits,
  computeLabContextV9,
} from "./caseRiskPredictions";

export function stageFromModifiers(mods) {
  if (!Array.isArray(mods)) return null;
  if (mods.includes("stage-qc")) return "qc";
  if (mods.includes("stage-finishing")) return "finishing";
  if (mods.includes("stage-production")) return "production";
  if (mods.includes("stage-design")) return "design";
  return null;
}

function enrichRow(rowFromContext, caseHistory) {
  const s = stageFromModifiers(rowFromContext.modifiers);
  const base = { ...rowFromContext, case_history: caseHistory || [] };
  return s
    ? { ...base, currentStage: s, current_stage: s, stage: s }
    : base;
}

/**
 * @param {object} args
 * @param {object} args.caseData    Focal case row (with case_history attached).
 * @param {array}  args.allRows     The full cases array from DataContext.
 * @param {string} args.id          Focal case id (allRows[i].id === id is the focal).
 * @param {object} [args.dbClient]  Supabase client. Defaults to the app's shared client.
 * @param {Date}   [args.now]       Reference time. Defaults to `new Date()`.
 * @param {function} [args.yieldFn] Optional `() => Promise<void>` called between
 *                                  preparation steps so the caller can yield to
 *                                  scheduler.postTask / requestIdleCallback.
 * @returns {Promise<object|null>}  The prediction object the engine produces for
 *                                  this case, or null if forecast unavailable.
 */
export async function computeCaseForecast({
  caseData,
  allRows,
  id,
  dbClient = defaultDb,
  now = new Date(),
  yieldFn = null,
}) {
  if (!caseData) return null;
  const stage = stageFromModifiers(caseData.modifiers) || "design";
  const maybeYield = async () => {
    if (typeof yieldFn === "function") await yieldFn();
  };

  // Fetch case_history for every active case. Efficiency's pipeline
  // fetches this up front; without it, extractRecentCompletedVisits
  // sees only the focal case's transitions and the stage-timing
  // features come out wrong.
  const activeIds = (allRows || [])
    .filter((r) => r.completed !== true)
    .map((r) => r.id);

  let activeHistRows = [];
  if (activeIds.length > 0) {
    const { data, error } = await dbClient
      .from("case_history")
      .select("id, case_id, action, user_name, created_at")
      .in("case_id", activeIds);
    if (error) throw error;
    activeHistRows = data || [];
  }

  const histByCaseId = new Map();
  for (const h of activeHistRows) {
    if (!histByCaseId.has(h.case_id)) histByCaseId.set(h.case_id, []);
    histByCaseId.get(h.case_id).push(h);
  }
  for (const arr of histByCaseId.values()) {
    arr.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  await maybeYield();

  // Full active pool, enriched. The focal case is replaced with its
  // history-enriched copy (already attached in caseData).
  //
  // Filter note: cases table has a `completed` BOOLEAN column — not
  // `completed_at` (no such column).
  const fullActivePool = (allRows || [])
    .filter(
      (r) => r.completed !== true && !r.modifiers?.includes("excluded")
    )
    .map((c) => {
      const history =
        c.id === id
          ? caseData.case_history || []
          : histByCaseId.get(c.id) || [];
      const source = c.id === id ? caseData : c;
      return enrichRow(source, history);
    });

  // Same-stage subset for peerPool — matches Efficiency's `allCasesInStage`.
  const peerPool = fullActivePool.filter(
    (c) => stageFromModifiers(c.modifiers) === stage
  );

  await maybeYield();

  const visits = extractRecentCompletedVisits(fullActivePool, now, 30);
  await maybeYield();
  const labContext = computeLabContextV9(fullActivePool, visits, now);
  await maybeYield();

  // CRITICAL: pass the *enriched* focal — same stage fields the rest of
  // the pool has — so labContext-driven features and any focal-row
  // stage check sees a consistent stage assignment. Passing raw caseData
  // here was the last remaining source of drift versus Efficiency.
  const enrichedFocal = enrichRow(caseData, caseData.case_history || []);

  const result = generateCaseRiskPredictions(
    [enrichedFocal],
    null,
    stage,
    null,
    { peerPool, labContext, recentCompletedVisits: visits }
  );
  return result?.predictions?.[0] || null;
}
