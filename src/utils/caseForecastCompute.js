/**
 * caseForecastCompute.js
 *
 * Single source of truth for the case-modal "Risk Forecast".
 *
 * Rather than reimplement the prediction pipeline, this function just
 * calls the EXACT functions the Efficiency screen calls and pulls the
 * focal case's prediction out of the result. The case-modal pill and
 * the Efficiency screen are guaranteed to show the same numbers
 * because they go through the same code paths — same DB query, same
 * stage-statistics builder, same lab-context derivation, same engine
 * call. There is no parallel implementation to drift.
 *
 * Used by:
 *   - src/components/CaseHistory.jsx (the in-modal forecast strip)
 *   - scripts/test-forecast-diff.mjs (regression harness)
 */
import { calculateStageStatistics } from "./stageTimeCalculations";
import { calculateDepartmentEfficiency } from "./efficiencyCalculations";

export function stageFromModifiers(mods) {
  if (!Array.isArray(mods)) return null;
  if (mods.includes("stage-qc")) return "qc";
  if (mods.includes("stage-finishing")) return "finishing";
  if (mods.includes("stage-production")) return "production";
  if (mods.includes("stage-design")) return "design";
  return null;
}

// Module-level cache so consecutive case-modal opens for the same
// stage don't re-fetch ~900 cases + their history every time. The
// Efficiency screen also re-runs from scratch on each open today; we
// piggyback on the same cache when both surfaces ask for the same
// stage within the TTL.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // key=stage → {at, statsPromise, efficiencyPromise}

function cacheKey(department, stage) {
  return `${department || "General"}|${stage}`;
}

function getCached(department, stage) {
  const key = cacheKey(department, stage);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function storeCached(department, stage, payload) {
  cache.set(cacheKey(department, stage), { at: Date.now(), ...payload });
}

/**
 * Manually invalidate the cache. Called from DataContext when a
 * cases-table row changes via realtime so stale predictions never
 * outlive a real edit.
 */
export function clearForecastCache() {
  cache.clear();
}

/**
 * @param {object} args
 * @param {object} args.caseData    Focal case row. Must have department
 *                                  and stage-* modifier set.
 * @returns {Promise<object|null>}  The same prediction object the
 *                                  Efficiency screen would show for
 *                                  this case, or null if the engine
 *                                  has no prediction for it.
 */
export async function computeCaseForecast({ caseData }) {
  if (!caseData) return null;
  const stage = stageFromModifiers(caseData.modifiers);
  if (!stage) return null;
  const department = caseData.department || "General";

  // Hit the cache first — within the TTL, return the same predictions
  // object Efficiency just computed (or another in-flight call to this
  // function for the same stage).
  let entry = getCached(department, stage);
  if (!entry) {
    const statsPromise = calculateStageStatistics(stage);
    const efficiencyPromise = statsPromise.then((stats) => {
      if (!stats || stats.noData) return null;
      return calculateDepartmentEfficiency(department, stage, stats, 0);
    });
    storeCached(department, stage, { statsPromise, efficiencyPromise });
    entry = getCached(department, stage);
  }

  const efficiency = await entry.efficiencyPromise;
  if (!efficiency || efficiency.noData) return null;

  // efficiency.predictions is the full result object returned by
  // generateCaseRiskPredictions — { atRisk, predictions: [...], ... }.
  const predictions = efficiency.predictions?.predictions || [];
  return (
    predictions.find(
      (p) =>
        p.id === caseData.id ||
        p.caseNumber === caseData.casenumber ||
        p.caseNumber === caseData.caseNumber
    ) || null
  );
}
