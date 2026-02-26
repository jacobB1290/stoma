// /src/utils/efficiencyCalculations.js

import { formatDuration } from "./stageTimeCalculations";
import { generateCaseRiskPredictions } from "./caseRiskPredictions";

/**
 * =================== OVERVIEW ===================
 * This module calculates the department/stage efficiency score and provides
 * detailed, auditable breakdowns for:
 *  - Throughput velocity benchmarking (with smoothing and load adjustments)
 *  - On-time delivery, stage buffers, and penalty attribution
 *  - Risk predictions for active cases
 *  - A snapshot of runtime assumptions used by the UI's System Configuration section
 *
 * Exported API:
 *  - calculateDepartmentEfficiency(...)  -> main entry point
 *  - CONFIG                              -> public configuration values consumed by the UI
 *  - calculateVelocityScore_Enhanced     -> velocity engine per-cohort calc
 */

/**
 * =================== CONFIGURATION ===================
 * Values shown in the UI's "System Configuration & Operations Guide" are read from here.
 */
export const CONFIG = {
  META: {
    ENGINE_VERSION: "2.1.0",
    LAST_UPDATED: "2025-08-11",
    DESCRIPTION:
      "Velocity Engine v2.1 with percentile targets, EMA smoothing, and active-load correlation. Hysteresis removed.",
  },

  // Number of historical completions considered when computing velocity targets (soft guidance).
  WINDOW_SIZE: 100,

  // The percentile of historical completions used as the target benchmark.
  TARGET_PERCENTILE: 75,

  // Exponential moving average alpha for smoothing the raw target percentile.
  SMOOTHING_ALPHA: 0.2,

  // Weight applied to active-load impact within the velocity score.
  ACTIVE_WEIGHT: 0.15,

  // Historical: no longer used (hysteresis removed), kept for traceability.
  HYSTERESIS_THRESHOLD: 5,

  // Correlation factors by active case counts (for current workload adjustment).
  LOAD_FACTOR_TABLE: [
    { minActive: 0, maxActive: 0, factor: 0.9 },
    { minActive: 1, maxActive: 5, factor: 1.0 },
    { minActive: 6, maxActive: 10, factor: 1.05 },
    { minActive: 11, maxActive: 15, factor: 1.15 },
    { minActive: 16, maxActive: 20, factor: 1.3 },
    { minActive: 21, maxActive: 30, factor: 1.5 },
    { minActive: 31, maxActive: null, factor: 2.0 },
  ],

  // Penalty weights applied when buffer compliance < 100% (stage-scoped).
  BUFFER_PENALTY_WEIGHTS: {
    design: 0.4,
    production: 0.3,
  },

  // Required days of buffer at handoff into the next stage.
  BUFFER_REQUIREMENTS: {
    design: 2,
    production: 1,
    finishing: 0, // finishing completes on the due date
  },
};

/* =================== SMALL UTILS =================== */

const isCaseExcluded = (caseData, stage = null) => {
  const modifiers = caseData?.modifiers || [];
  if (
    modifiers.includes("stats-exclude") ||
    modifiers.includes("stats-exclude:all")
  ) {
    return true;
  }
  if (stage && modifiers.includes(`stats-exclude:${stage}`)) {
    return true;
  }
  return false;
};

const calculateMean = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
};

const calculatePercentileValue = (arr, percentile) => {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((percentile / 100) * (sorted.length - 1));
  return sorted[idx];
};

const endOfDueDay = (caseRow) => {
  const base = new Date(caseRow.due);
  base.setUTCHours(23, 59, 59, 999);
  return base;
};

const yieldToMainThread = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const shouldYield = (index, chunkSize = 25) => (index + 1) % chunkSize === 0;

/** Determine the stage at a given moment ("design" | "production" | "finishing" | null). */
const getStageAtTime = (caseData, targetTime) => {
  const history = caseData.case_history || [];
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  let currentStage = "design";
  const targetDate = new Date(targetTime);
  const STAGE_SYSTEM_START = new Date("2025-07-14T00:00:00Z");
  const caseCreated = new Date(caseData.created_at);

  // Stage-tracking system applicability guard (legacy cases or other departments)
  if (caseCreated < STAGE_SYSTEM_START || caseData.department !== "General") {
    return null;
  }

  for (const entry of sortedHistory) {
    const entryDate = new Date(entry.created_at);
    if (entryDate > targetDate) break;
    const action = (entry.action || "").toLowerCase();

    if (
      action.includes("moved from design to production") ||
      (action.includes("to production stage") && currentStage === "design")
    ) {
      currentStage = "production";
    } else if (
      action.includes("moved from production to finishing") ||
      (action.includes("to finishing stage") && currentStage === "production")
    ) {
      currentStage = "finishing";
    } else if (
      action.includes("moved from production to design") ||
      (action.includes("to design stage") && currentStage === "production")
    ) {
      currentStage = "design";
    } else if (action.includes("moved from finishing to production")) {
      currentStage = "production";
    } else if (action === "marked done") {
      break;
    }
  }

  return currentStage;
};

/* =================== VELOCITY ENGINE =================== */

const timeWeightedLoad = (activeCases, referenceTime = null) => {
  if (!activeCases || activeCases.length === 0) return 0;
  const now = referenceTime || Date.now();
  const weights = activeCases.map((c) => {
    const enteredStage = c.stageEnteredAt || c.created_at || c.createdAt;
    const ageMs = now - new Date(enteredStage);
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.min(2, 1 + ageDays / 7); // grow with age, capped
  });
  return weights.reduce((s, w) => s + w, 0) / activeCases.length;
};

const concurrencyScale = (currentActive, avgHistoricalActive) => {
  if (avgHistoricalActive === 0) return 1;
  if (currentActive === 0) return 0.9;
  const ratio = currentActive / avgHistoricalActive;
  return 0.5 + 0.5 * Math.tanh((ratio - 1) * 0.5) + 0.5;
};

const activeLoadImpact = (currentActive, activeCases, referenceTime = null) => {
  if (currentActive === 0) return 100;
  const tw = timeWeightedLoad(activeCases, referenceTime);
  const row = CONFIG.LOAD_FACTOR_TABLE.find(
    (lf) =>
      currentActive >= lf.minActive &&
      (lf.maxActive === null || currentActive <= lf.maxActive)
  );
  const factor = row ? row.factor : 1.5;
  const base = 100 / (factor * (tw || 1));
  return Math.max(0, Math.min(100, base));
};

/**
 * Core velocity scoring for a given stage/type cohort.
 * Returns percent score and detailed per-case deltas vs. adjusted benchmark.
 */
export async function calculateVelocityScore_Enhanced(
  stage,
  currentActive,
  activeCases = [],
  prevSmoothedTarget = null,
  recentCompletions = [],
  referenceTime = null
) {
  if (!recentCompletions || recentCompletions.length === 0) {
    return {
      velocityScore: 0,
      nextSmoothedTarget: null,
      adjustedTarget: null,
      noData: true,
      casesOverBenchmark: [],
      casesUnderBenchmark: [],
      caseDetails: [],
      metrics: { sampleSize: 0, isFirstCase: false },
    };
  }

  const times = recentCompletions.map((c) => c.timeInStageMs || c.stageTime);
  const activeCounts = recentCompletions.map(
    (c) => c.activeCountAtStart || c.concurrentCases || 10
  );

  const caseDetails = [];

  // Single-case special-casing (cold start)
  if (recentCompletions.length === 1) {
    const firstCaseTime = times[0];
    const theCase = recentCompletions[0];
    const caseNumber = theCase.caseNumber || theCase.casenumber;

    const baseDetail = {
      caseNumber,
      caseId: theCase.id,
      benchmark: firstCaseTime,
      actual: firstCaseTime,
      percentDiff: "0.0",
      timeDiffMs: 0,
      status: "met",
    };

    caseDetails.push(baseDetail);

    const impact = activeLoadImpact(currentActive, activeCases, referenceTime);
    const rawScore = currentActive === 0 ? 100 : Math.round(90 + impact / 10);

    return {
      velocityScore: Math.round(rawScore),
      nextSmoothedTarget: firstCaseTime,
      adjustedTarget: firstCaseTime,
      casesOverBenchmark: [],
      casesUnderBenchmark: [baseDetail],
      caseDetails,
      metrics: {
        rawTarget: firstCaseTime,
        smoothedTarget: firstCaseTime,
        concurrencyScale: 1,
        correlationFactor: 1,
        avgHistoricalActive: currentActive,
        currentActive,
        timeWeightedLoad: timeWeightedLoad(activeCases, referenceTime),
        loadAdjustment: 1,
        completedVelocity: 100,
        activeImpact: impact,
        rawScore,
        appliedHysteresis: false,
        isFirstCase: true,
        sampleSize: 1,
      },
    };
  }

  // Percentile benchmark -> smooth -> adjust for current load
  const rawTarget = calculatePercentileValue(times, CONFIG.TARGET_PERCENTILE);
  const smoothedTarget =
    prevSmoothedTarget == null
      ? rawTarget
      : CONFIG.SMOOTHING_ALPHA * rawTarget +
        (1 - CONFIG.SMOOTHING_ALPHA) * prevSmoothedTarget;

  const avgHistoricalActive = calculateMean(activeCounts) || currentActive || 1;
  const cScale = concurrencyScale(currentActive, avgHistoricalActive);
  const twLoad = timeWeightedLoad(activeCases, referenceTime);
  const loadAdj = twLoad > 0 ? Math.sqrt(twLoad) : 1;

  const lfRow = CONFIG.LOAD_FACTOR_TABLE.find(
    (lf) =>
      currentActive >= lf.minActive &&
      (lf.maxActive === null || currentActive <= lf.maxActive)
  );
  const corr = lfRow ? lfRow.factor : 1;

  const adjustedTargetMs = smoothedTarget * cScale * corr * loadAdj;

  const casesOverBenchmark = [];
  const casesUnderBenchmark = [];

  recentCompletions.forEach((c, i) => {
    const t = times[i];
    const ratio = adjustedTargetMs / t;
    const caseNumber = c.caseNumber || c.casenumber;
    const detail = {
      caseNumber,
      caseId: c.id,
      benchmark: adjustedTargetMs,
      actual: t,
      percentDiff: ((t / adjustedTargetMs - 1) * 100).toFixed(1),
      timeDiffMs: Math.abs(t - adjustedTargetMs),
    };
    if (ratio < 1) {
      casesOverBenchmark.push({ ...detail, status: "missed" });
      caseDetails.push({ ...detail, status: "missed" });
    } else {
      const status = ratio > 1 ? "exceeded" : "met";
      casesUnderBenchmark.push({ ...detail, status });
      caseDetails.push({ ...detail, status });
    }
  });

  const ratios = times.map((t) => Math.min(1, adjustedTargetMs / t));
  let completedVelocity = Math.round(calculateMean(ratios) * 100);
  if (recentCompletions.length <= 3) {
    completedVelocity = Math.max(50, completedVelocity);
  }

  const impact = activeLoadImpact(currentActive, activeCases, referenceTime);
  const effActiveWeight =
    recentCompletions.length <= 5
      ? CONFIG.ACTIVE_WEIGHT * 0.5
      : CONFIG.ACTIVE_WEIGHT;

  const rawScore =
    completedVelocity * (1 - effActiveWeight) + impact * effActiveWeight;

  return {
    velocityScore: Math.round(rawScore),
    nextSmoothedTarget: smoothedTarget,
    adjustedTarget: adjustedTargetMs,
    casesOverBenchmark,
    casesUnderBenchmark,
    caseDetails,
    metrics: {
      rawTarget,
      smoothedTarget,
      concurrencyScale: cScale,
      correlationFactor: corr,
      avgHistoricalActive,
      currentActive,
      timeWeightedLoad: twLoad,
      loadAdjustment: loadAdj,
      completedVelocity,
      activeImpact: impact,
      rawScore,
      appliedHysteresis: false,
      sampleSize: recentCompletions.length,
    },
  };
}

/* =================== RUSH REDUCTION FACTOR =================== */

const calculateRushReductionFactor = (cases) => {
  const standard = (cases || []).filter((c) => !c.priority && !c.rush);
  const urgent = (cases || []).filter((c) => c.priority || c.rush);

  if (standard.length < 5 || urgent.length < 3) return 0.6;

  const getAvailDays = (c) => {
    const created = new Date(c.created_at);
    const due = endOfDueDay(c);
    return (due - created) / (1000 * 60 * 60 * 24);
  };

  const s = standard.map(getAvailDays).sort((a, b) => a - b);
  const u = urgent.map(getAvailDays).sort((a, b) => a - b);

  const iqrMean = (arr) => {
    const q1 = Math.floor(arr.length * 0.25);
    const q3 = Math.floor(arr.length * 0.75);
    const slice = arr.slice(q1, q3 + 1);
    return calculateMean(slice);
  };

  const sMean = iqrMean(s);
  const uMean = iqrMean(u);
  return Math.max(0.3, Math.min(1.0, uMean / sMean));
};

/* =================== STAGE TRANSITION / BUFFERS =================== */

const analyzeStageTransitions = (
  history,
  dueDate,
  currentStage = null,
  caseCreatedDate = null,
  isRushOrPriority = false,
  rushReductionFactor = 0.6
) => {
  const analysis = {
    metFinishingBuffer: true,
    metProductionBuffer: true,
    metDesignBuffer: true,
    finishingBufferHours: null,
    productionBufferHours: null,
    designBufferHours: null,
    adjustedBufferRequirement: null,
    isRushOrPriority,
  };

  if (!history || history.length === 0) return analysis;

  const dueEOD = new Date(dueDate);
  dueEOD.setHours(23, 59, 59, 999);

  let req = { ...CONFIG.BUFFER_REQUIREMENTS };
  if (isRushOrPriority) {
    req = {
      design: Math.max(
        0.5,
        CONFIG.BUFFER_REQUIREMENTS.design * rushReductionFactor
      ),
      production: Math.max(
        0.25,
        CONFIG.BUFFER_REQUIREMENTS.production * rushReductionFactor
      ),
      finishing: 0,
    };
    analysis.adjustedBufferRequirement = req;
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  const tx = {
    designToProduction: null,
    productionToFinishing: null,
    finishingToComplete: null,
  };

  sorted.forEach((entry) => {
    const action = (entry.action || "").toLowerCase();
    if (
      /moved\s+from\s+design\s+to\s+production/.test(action) ||
      (/to\s+production\s+stage/.test(action) &&
        !action.includes("from finishing"))
    ) {
      tx.designToProduction = new Date(entry.created_at);
    }
    if (
      /moved\s+from\s+production\s+to\s+finishing/.test(action) ||
      (/to\s+finishing\s+stage/.test(action) && !action.includes("from design"))
    ) {
      tx.productionToFinishing = new Date(entry.created_at);
    }
    if (action === "marked done") {
      tx.finishingToComplete = new Date(entry.created_at);
    }
  });

  // Design buffer
  if (tx.designToProduction) {
    const required = new Date(dueEOD);
    required.setDate(required.getDate() - req.design);
    analysis.metDesignBuffer = tx.designToProduction <= required;
    analysis.designBufferHours =
      (dueEOD - tx.designToProduction) / (1000 * 60 * 60);
    analysis.requiredDesignBuffer = req.design;
  }

  // Production buffer
  if (tx.productionToFinishing) {
    const required = new Date(dueEOD);
    required.setDate(required.getDate() - req.production);
    analysis.metProductionBuffer = tx.productionToFinishing <= required;
    analysis.productionBufferHours =
      (dueEOD - tx.productionToFinishing) / (1000 * 60 * 60);
    analysis.requiredProductionBuffer = req.production;
  }

  // Finishing/on-time
  if (tx.finishingToComplete) {
    const latenessHours = (tx.finishingToComplete - dueEOD) / (1000 * 60 * 60);
    analysis.metFinishingBuffer = tx.finishingToComplete <= dueEOD;
    analysis.finishingBufferHours = -latenessHours; // positive = early, negative = late
  }

  return analysis;
};

/* =================== ON-TIME DELIVERY (stage-aware) =================== */

const penaltyUnitsForStage = (d, stage) => {
  let units = 0;
  const lateAtStage = d.stageAtDue;

  if (stage === "design") {
    if (!d.stageAnalysis?.metDesignBuffer) units += 0.5;
    if (lateAtStage === "design") units += 0.5;
  } else if (stage === "production") {
    if (!d.stageAnalysis?.metProductionBuffer) units += 0.5;
    if (lateAtStage === "production") units += 0.5;
  } else if (stage === "finishing") {
    if (lateAtStage === "finishing") units = 1.0;
  }

  return units;
};

const calculateOnTimeDelivery = async (
  cases,
  currentStage = null,
  stageStatistics = null,
  velocityDetails = []
) => {
  if (!cases || cases.length === 0) {
    return {
      overall: {
        count: 0,
        actualOnTime: 0,
        actualRate: 0,
        effectiveOnTime: 0,
        effectiveRate: 0,
        avgScore: 0,
        bufferCompliance: {
          design: 100,
          production: 100,
          finishing: 100,
          current: 100,
        },
        avgHoursLate: 0,
        criticalViolations: 0,
        rushPriorityCount: 0,
        rushReductionFactor: 0.6,
      },
      byType: {},
      byPriority: {},
      stageBufferAnalysis: {
        designViolations: 0,
        productionViolations: 0,
        finishingViolations: 0,
        commonPatterns: [],
      },
      recommendations: [],
      standardTime: 5,
      caseInsights: {
        casesWithPenalties: [],
        velocityCases: { exceeded: [], met: [], missed: [] },
        bufferViolations: { design: [], production: [] },
        lateCases: [],
        activeCases: [],
        summary: {
          totalCases: 0,
          completedCases: 0,
          activeCases: 0,
          casesWithPenalties: 0,
          bufferViolations: { design: 0, production: 0 },
          lateCases: 0,
          excludedCases: 0,
        },
      },
    };
  }

  const nonExcluded = cases.filter((c) => !isCaseExcluded(c, currentStage));
  const rushReductionFactor = calculateRushReductionFactor(nonExcluded);

  const deliveryData = [];

  for (let i = 0; i < nonExcluded.length; i++) {
    const c = nonExcluded[i];
      const caseDue = endOfDueDay(c);
      const completionEntry = c.case_history?.find(
        (h) => (h.action || "").toLowerCase() === "marked done"
      );
      const isCompleted = !!completionEntry;
      if (!currentStage && !isCompleted) {
        if (shouldYield(i)) {
          await yieldToMainThread();
        }
        continue;
      }

      const isRushOrPriority = !!(c.priority || c.rush);

      const stageAnalysis = analyzeStageTransitions(
        c.case_history,
        caseDue,
        currentStage,
        c.created_at,
        isRushOrPriority,
        rushReductionFactor
      );

      let actualDelivery = true;
      let hoursEarlyLate = 0;
      let completedDate = null;
      let stageAtDue = null;

      if (isCompleted) {
        const completedAt = new Date(completionEntry.created_at);
        completedDate = completedAt;
        actualDelivery = completedAt <= caseDue;
        hoursEarlyLate = (completedAt - caseDue) / (1000 * 60 * 60);
        stageAtDue = getStageAtTime(c, caseDue);

        if (currentStage && !actualDelivery) {
          if (stageAtDue !== currentStage) {
            actualDelivery = true; // not counted against this stage
            hoursEarlyLate = 0;
          }
        }
      }

      let score = 100;
      const caseIsLate = isCompleted && !actualDelivery;
      const lateStage = caseIsLate ? stageAtDue : null;

      if (currentStage === "design") {
        if (!stageAnalysis.metDesignBuffer) score -= 15;
        if (lateStage === "design")
          score -= Math.min(50, Math.abs(hoursEarlyLate) * 2);
      } else if (currentStage === "production") {
        if (!stageAnalysis.metProductionBuffer) score -= 10;
        if (lateStage === "production")
          score -= Math.min(50, Math.abs(hoursEarlyLate) * 2);
      } else if (currentStage === "finishing") {
        if (lateStage === "finishing")
          score -= Math.min(50, Math.abs(hoursEarlyLate) * 2);
      }

      if (!currentStage && isCompleted) {
        if (!actualDelivery)
          score -= Math.min(50, Math.abs(hoursEarlyLate) * 2);
        if (!stageAnalysis.metDesignBuffer) score -= 15;
        if (!stageAnalysis.metProductionBuffer) score -= 10;
      }

      const effectiveDelivery = score >= 70;

      const bufferShortages = {};
      if (!stageAnalysis.metDesignBuffer) {
        const requiredDays =
          stageAnalysis.adjustedBufferRequirement?.design ??
          CONFIG.BUFFER_REQUIREMENTS.design;
        const actualDays = (stageAnalysis.designBufferHours ?? 0) / 24;
        bufferShortages.design = {
          hoursShort: Math.max(0, (requiredDays - actualDays) * 24),
          required: requiredDays,
          actual: actualDays,
        };
      }
      if (!stageAnalysis.metProductionBuffer) {
        const requiredDays =
          stageAnalysis.adjustedBufferRequirement?.production ??
          CONFIG.BUFFER_REQUIREMENTS.production;
        const actualDays = (stageAnalysis.productionBufferHours ?? 0) / 24;
        bufferShortages.production = {
          hoursShort: Math.max(0, (requiredDays - actualDays) * 24),
          required: requiredDays,
          actual: actualDays,
        };
      }

      const penaltyUnits = currentStage
        ? penaltyUnitsForStage(
            {
              isCompleted,
              actualDelivery,
              stageAtDue,
              stageAnalysis,
            },
            currentStage
          )
        : 0;

      deliveryData.push({
        id: c.id,
        caseNumber: c.caseNumber || c.casenumber,
        caseType: c.caseType || "general",
        priority: !!c.priority,
        rush: !!c.rush,
        isCompleted,
        completedDate,
        dueDate: caseDue,
        actualDelivery,
        score: Math.max(0, Math.min(100, score)),
        effectiveDelivery,
        hoursEarlyLate,
        stageAtDue,
        penaltyUnits,
        bufferViolations: [
          !stageAnalysis.metDesignBuffer && "design",
          !stageAnalysis.metProductionBuffer && "production",
          !stageAnalysis.metFinishingBuffer && "finishing",
        ].filter(Boolean),
        stageAnalysis,
        bufferShortages,
        isExcluded: isCaseExcluded(c, currentStage),
      });

      if (shouldYield(i)) {
        await yieldToMainThread();
      }
    }

  // Attach velocity info to cases (fast lookup by case number)
  const velMap = new Map((velocityDetails || []).map((v) => [v.caseNumber, v]));
  deliveryData.forEach((d) => {
    const v = velMap.get(d.caseNumber);
    if (v) {
      d.velocityPerformance = {
        status: v.status,
        performance: (v.actual / v.benchmark) * 100,
        benchmark: v.benchmark,
        actual: v.actual,
        percentDiff: v.percentDiff,
        timeDiffMs: v.timeDiffMs,
      };
      if (v.status === "missed") {
        const velocityPenalty = Math.min(
          20,
          Math.floor((d.velocityPerformance.performance - 100) / 5)
        );
        d.score = Math.max(0, d.score - velocityPenalty);
      }
    }
  });

  // Stage-specific filter (only attribute penalties to the active stage)
  const stageSpecific = currentStage
    ? deliveryData.filter((d) => {
        if (d.velocityPerformance?.status === "missed") return true; // processed in this stage
        if (d.bufferViolations.includes(currentStage)) return true;
        if (d.hoursEarlyLate > 0 && d.stageAtDue === currentStage) return true;
        return false;
      })
    : deliveryData;

  const casesWithPenalties = stageSpecific
    .filter((d) => {
      const buf =
        d.bufferViolations.length > 0 &&
        (!currentStage || d.bufferViolations.includes(currentStage));
      const ontime =
        d.hoursEarlyLate > 0 &&
        (!currentStage || d.stageAtDue === currentStage);
      const vel = d.velocityPerformance?.status === "missed";
      return buf || ontime || vel;
    })
    .map((d) => ({
      caseNumber: d.caseNumber,
      penaltyUnits: d.penaltyUnits,
      score: d.score,
      bufferViolations: d.bufferViolations,
      bufferShortages: d.bufferShortages,
      isCompleted: d.isCompleted,
      stageAtDue: d.stageAtDue,
      hoursLate: d.hoursEarlyLate > 0 ? d.hoursEarlyLate : 0,
      daysLate: d.hoursEarlyLate > 0 ? (d.hoursEarlyLate / 24).toFixed(1) : 0,
      metDesignBuffer: d.stageAnalysis?.metDesignBuffer,
      metProductionBuffer: d.stageAnalysis?.metProductionBuffer,
      rush: d.rush,
      priority: d.priority,
      velocityPerformance: d.velocityPerformance,
      velocityPenalty:
        d.velocityPerformance?.status === "missed"
          ? {
              percentOver: d.velocityPerformance.percentDiff,
              timeOver: d.velocityPerformance.timeDiffMs,
              impact: Math.min(
                20,
                Math.floor((d.velocityPerformance.performance - 100) / 5)
              ),
            }
          : null,
    }));

  const caseInsights = {
    casesWithPenalties,
    velocityCases: {
      exceeded: (velocityDetails || [])
        .filter((v) => v.status === "exceeded")
        .map((v) => ({
          caseNumber: v.caseNumber,
          status: v.status,
          percentDiff: v.percentDiff,
          timeDiffMs: v.timeDiffMs,
          benchmark: v.benchmark,
          actual: v.actual,
        })),
      met: (velocityDetails || [])
        .filter((v) => v.status === "met")
        .map((v) => ({
          caseNumber: v.caseNumber,
          status: v.status,
          percentDiff: v.percentDiff,
          timeDiffMs: v.timeDiffMs,
          benchmark: v.benchmark,
          actual: v.actual,
        })),
      missed: (velocityDetails || [])
        .filter((v) => v.status === "missed")
        .map((v) => ({
          caseNumber: v.caseNumber,
          status: v.status,
          percentDiff: v.percentDiff,
          timeDiffMs: v.timeDiffMs,
          benchmark: v.benchmark,
          actual: v.actual,
        })),
    },
    bufferViolations: {
      design: stageSpecific
        .filter(
          (d) =>
            !d.stageAnalysis?.metDesignBuffer &&
            (!currentStage || currentStage === "design")
        )
        .map((d) => ({
          caseNumber: d.caseNumber,
          requiredBuffer: d.stageAnalysis?.requiredDesignBuffer,
          actualBuffer: d.stageAnalysis?.designBufferHours,
          isRush: d.rush || d.priority,
          bufferShortages: d.bufferShortages,
        })),
      production: stageSpecific
        .filter(
          (d) =>
            !d.stageAnalysis?.metProductionBuffer &&
            (!currentStage || currentStage === "production")
        )
        .map((d) => ({
          caseNumber: d.caseNumber,
          requiredBuffer: d.stageAnalysis?.requiredProductionBuffer,
          actualBuffer: d.stageAnalysis?.productionBufferHours,
          isRush: d.rush || d.priority,
          bufferShortages: d.bufferShortages,
        })),
    },
    lateCases: stageSpecific
      .filter(
        (d) =>
          d.isCompleted &&
          (!currentStage
            ? !d.actualDelivery
            : d.stageAtDue === currentStage && !d.actualDelivery)
      )
      .map((d) => ({
        caseNumber: d.caseNumber,
        stageAtDue: d.stageAtDue,
        hoursLate: d.hoursEarlyLate,
        daysLate: (d.hoursEarlyLate / 24).toFixed(1),
        score: d.score,
      })),
    activeCases: deliveryData
      .filter((d) => !d.isCompleted)
      .map((d) => ({
        caseNumber: d.caseNumber,
        daysUntilDue: (
          (d.dueDate - Date.now()) /
          (1000 * 60 * 60 * 24)
        ).toFixed(1),
        currentStage,
        bufferStatus: {
          design: d.stageAnalysis?.metDesignBuffer,
          production: d.stageAnalysis?.metProductionBuffer,
        },
      })),
    summary: {
      totalCases: deliveryData.length,
      completedCases: deliveryData.filter((d) => d.isCompleted).length,
      activeCases: deliveryData.filter((d) => !d.isCompleted).length,
      casesWithPenalties: casesWithPenalties.length,
      bufferViolations: {
        design: stageSpecific.filter(
          (d) =>
            !d.stageAnalysis?.metDesignBuffer &&
            (!currentStage || currentStage === "design")
        ).length,
        production: stageSpecific.filter(
          (d) =>
            !d.stageAnalysis?.metProductionBuffer &&
            (!currentStage || currentStage === "production")
        ).length,
      },
      lateCases: stageSpecific.filter(
        (d) =>
          d.isCompleted &&
          (!currentStage
            ? !d.actualDelivery
            : d.stageAtDue === currentStage && !d.actualDelivery)
      ).length,
      excludedCases: (cases || []).filter((c) =>
        isCaseExcluded(c, currentStage)
      ).length,
    },
  };

  const completed = deliveryData.filter((d) => d.isCompleted);
  const lateCompleted = completed.filter((d) => !d.actualDelivery);

  const overall = {
    count: deliveryData.length,
    actualOnTime: currentStage
      ? deliveryData.filter((d) =>
          d.isCompleted
            ? !(d.stageAtDue === currentStage && !d.actualDelivery)
            : true
        ).length
      : deliveryData.filter((d) => (d.isCompleted ? d.actualDelivery : true))
          .length,
    actualRate: 0,
    effectiveOnTime: completed.filter((d) => d.effectiveDelivery).length,
    effectiveRate:
      completed.length > 0
        ? (completed.filter((d) => d.effectiveDelivery).length /
            completed.length) *
          100
        : 0,
    avgScore: calculateMean(deliveryData.map((d) => d.score)),
    bufferCompliance: {
      design:
        (!currentStage || currentStage === "design") && deliveryData.length > 0
          ? (deliveryData.filter((d) => d.stageAnalysis?.metDesignBuffer)
              .length /
              deliveryData.length) *
            100
          : 100,
      production:
        (!currentStage || currentStage === "production") &&
        deliveryData.length > 0
          ? (deliveryData.filter((d) => d.stageAnalysis?.metProductionBuffer)
              .length /
              deliveryData.length) *
            100
          : 100,
      finishing:
        (!currentStage || currentStage === "finishing") &&
        deliveryData.length > 0
          ? (deliveryData.filter((d) => d.stageAnalysis?.metFinishingBuffer)
              .length /
              deliveryData.length) *
            100
          : 100,
      current: 100, // set below for the active stage
    },
    avgHoursLate:
      lateCompleted.length > 0
        ? calculateMean(lateCompleted.map((d) => d.hoursEarlyLate))
        : 0,
    criticalViolations: completed.filter(
      (d) =>
        d.stageAnalysis &&
        !d.stageAnalysis.metProductionBuffer &&
        d.hoursEarlyLate > 0
    ).length,
    rushPriorityCount: deliveryData.filter(
      (d) => d.stageAnalysis?.isRushOrPriority
    ).length,
    rushReductionFactor,
  };

  // Derive current stage compliance for the active tab
  if (deliveryData.length > 0) {
    if (currentStage === "design") {
      overall.bufferCompliance.current =
        (deliveryData.filter((d) => d.stageAnalysis?.metDesignBuffer).length /
          deliveryData.length) *
        100;
    } else if (currentStage === "production") {
      overall.bufferCompliance.current =
        (deliveryData.filter((d) => d.stageAnalysis?.metProductionBuffer)
          .length /
          deliveryData.length) *
        100;
    } else if (currentStage === "finishing") {
      overall.bufferCompliance.current =
        (deliveryData.filter((d) => d.stageAnalysis?.metFinishingBuffer)
          .length /
          deliveryData.length) *
        100;
    }
  }

  overall.actualRate =
    deliveryData.length > 0
      ? (overall.actualOnTime / deliveryData.length) * 100
      : 0;

  // By Type summaries (only when at least minimal sample)
  const byType = {};
  ["general", "bbs", "flex"].forEach((type) => {
    const typeData = deliveryData.filter((d) => d.caseType === type);
    if (typeData.length >= 3) {
      const completedType = typeData.filter((d) => d.isCompleted);
      byType[type] = {
        count: typeData.length,
        actualOnTime: completedType.filter((d) => d.actualDelivery).length,
        actualRate:
          completedType.length > 0
            ? (completedType.filter((d) => d.actualDelivery).length /
                completedType.length) *
              100
            : 0,
        effectiveOnTime: completedType.filter((d) => d.effectiveDelivery)
          .length,
        effectiveRate:
          completedType.length > 0
            ? (completedType.filter((d) => d.effectiveDelivery).length /
                completedType.length) *
              100
            : 0,
        avgScore: calculateMean(typeData.map((d) => d.score)),
        bufferCompliance:
          typeData.length > 0
            ? (typeData.filter(
                (d) =>
                  d.stageAnalysis?.metDesignBuffer &&
                  d.stageAnalysis?.metProductionBuffer &&
                  d.stageAnalysis?.metFinishingBuffer
              ).length /
                typeData.length) *
              100
            : 100,
      };
    }
  });

  const priorityCompleted = deliveryData.filter(
    (d) => d.isCompleted && (d.priority || d.rush)
  );
  const byPriority =
    priorityCompleted.length > 0
      ? {
          count: priorityCompleted.length,
          actualOnTime: priorityCompleted.filter((d) => d.actualDelivery)
            .length,
          actualRate:
            (priorityCompleted.filter((d) => d.actualDelivery).length /
              priorityCompleted.length) *
            100,
          effectiveRate:
            (priorityCompleted.filter((d) => d.effectiveDelivery).length /
              priorityCompleted.length) *
            100,
          avgScore: calculateMean(priorityCompleted.map((d) => d.score)),
        }
      : {};

  return {
    overall,
    byType,
    byPriority,
    stageBufferAnalysis: {
      designViolations: deliveryData.filter(
        (d) => !d.stageAnalysis?.metDesignBuffer
      ).length,
      productionViolations: deliveryData.filter(
        (d) => !d.stageAnalysis?.metProductionBuffer
      ).length,
      finishingViolations: deliveryData.filter(
        (d) => !d.stageAnalysis?.metFinishingBuffer
      ).length,
      commonPatterns: [],
    },
    recommendations: [], // populated elsewhere if needed
    standardTime: 5,
    caseInsights,
  };
};

/* =================== THROUGHPUT =================== */

const overallThroughputScore = (typeStats) => {
  if (!typeStats) return 0;
  const weights = { general: 0.5, bbs: 0.3, flex: 0.2 };
  let weighted = 0;
  let totalW = 0;
  Object.entries(typeStats).forEach(([type, stats]) => {
    if (!stats) return;
    if (
      stats.velocityScore !== undefined &&
      stats.count > 0 &&
      !stats.excludedFromScoring
    ) {
      weighted += stats.velocityScore * (weights[type] || 0);
      totalW += weights[type] || 0;
    }
  });
  return totalW > 0 ? weighted / totalW : 0;
};

const throughputInsights = (typeStats) => {
  const out = [];
  if (!typeStats) return out;
  Object.entries(typeStats).forEach(([type, stats]) => {
    if (!stats || stats.velocityScore === undefined) return;
    if (stats.velocityScore < 50) {
      out.push({
        type: "warning",
        message: `${type} cases are taking longer than expected. Median time: ${formatDuration(
          stats.median
        )}`,
      });
    } else if (stats.velocityScore > 90) {
      out.push({
        type: "success",
        message: `${type} cases are performing excellently with ${stats.velocityScore}% velocity score.`,
      });
    }
  });
  return out;
};

/* =================== COMBINED SCORE / EXPLANATION =================== */

const combinedScore = (throughput, onTime, currentStage = null) => {
  const tScore = throughput?.overall || 0;
  const oScore = onTime?.overall?.actualRate || 0;

  if (!onTime || onTime.overall.count === 0) return tScore;

  let base = oScore * 0.6 + tScore * 0.4;

  if (
    currentStage &&
    currentStage !== "finishing" &&
    onTime.overall.bufferCompliance
  ) {
    const bufferCompliance = onTime.overall.bufferCompliance.current;
    if (bufferCompliance < 100) {
      const penaltyWeight = CONFIG.BUFFER_PENALTY_WEIGHTS[currentStage] || 0.2;
      const gap = (100 - bufferCompliance) / 100;
      base *= 1 - gap * penaltyWeight;
    }
  }

  if ((onTime.overall.avgHoursLate || 0) > 48) base *= 0.95;
  const priorityOnTime = onTime.byPriority?.actualRate || 0;
  if (priorityOnTime > 90) base = Math.min(100, base * 1.02);

  const criticalRate =
    (onTime.overall.criticalViolations || 0) /
    Math.max(1, onTime.overall.count || 1);
  if (criticalRate > 0.1) base *= 0.9;

  return Math.round(Math.max(0, Math.min(100, base)) * 10) / 10;
};

const confidenceLabel = (n) => {
  if (n < 10) return "Low";
  if (n < 30) return "Medium";
  if (n < 100) return "High";
  return "Very High";
};

const explanationFor = (
  throughput,
  onTime,
  score,
  sampleSize,
  currentStage
) => {
  const exp = { overall: [], throughput: [], onTime: [], factors: [] };

  exp.overall.push({
    text: `The ${score}% efficiency score is calculated from ${sampleSize} cases${
      currentStage ? ` in the ${currentStage} stage` : ""
    }.`,
    type: "info",
  });
  exp.overall.push({
    text: `This combines on-time delivery (60% weight) and throughput velocity (40% weight).`,
    type: "info",
  });

  if (onTime?.overall) {
    const onRate = onTime.overall.actualRate || 0;
    const completedCount =
      onTime.overall.actualOnTime +
      ((onTime.overall.count || 0) - onTime.overall.actualOnTime);
    if (completedCount > 0) {
      exp.onTime.push({
        text: `${
          onTime.overall.actualOnTime
        } out of ${completedCount} cases (${onRate.toFixed(
          1
        )}%) were delivered on time.`,
        type: onRate >= 80 ? "success" : onRate >= 60 ? "warning" : "error",
      });
    }
    if ((onTime.overall.avgHoursLate || 0) > 0) {
      exp.onTime.push({
        text: `Late cases averaged ${(onTime.overall.avgHoursLate / 24).toFixed(
          1
        )} days past due.`,
        type: "warning",
      });
    }
    if (
      currentStage &&
      currentStage !== "finishing" &&
      onTime.overall.bufferCompliance
    ) {
      const bc = onTime.overall.bufferCompliance.current || 0;
      exp.onTime.push({
        text: `${bc.toFixed(
          0
        )}% of cases met buffer requirements. Rush/priority cases use ${(
          (onTime.overall.rushReductionFactor || 0.6) * 100
        ).toFixed(0)}% of standard buffer time.`,
        type: bc >= 80 ? "success" : bc >= 60 ? "warning" : "error",
      });
    }
  }

  if (throughput?.byType) {
    Object.entries(throughput.byType).forEach(([type, stats]) => {
      if (!stats) return;
      const typeName =
        type === "bbs" ? "BBS" : type === "flex" ? "3D Flex" : "General";
      exp.throughput.push({
        text: `${typeName} cases: ${
          stats.count
        } completed with ${formatDuration(stats.median)} median time (${(
          stats.velocityScore || 0
        ).toFixed(0)}% velocity score).`,
        type:
          stats.velocityScore >= 70
            ? "success"
            : stats.velocityScore >= 50
            ? "warning"
            : "error",
      });
    });
  }

  if (score < 50) {
    exp.factors.push({
      text: `Low efficiency is primarily due to ${
        (onTime?.overall?.actualRate || 0) < 50
          ? "poor on-time delivery"
          : "slow throughput velocity"
      }.`,
      type: "error",
    });
  } else if (score > 80) {
    exp.factors.push({
      text: `High efficiency indicates good balance between speed and reliability.`,
      type: "success",
    });
  }

  if (
    currentStage &&
    currentStage !== "finishing" &&
    (onTime?.overall?.bufferCompliance?.current || 100) < 100
  ) {
    const bc = onTime.overall.bufferCompliance.current;
    const pw = CONFIG.BUFFER_PENALTY_WEIGHTS[currentStage] || 0.2;
    const penalty = ((100 - bc) / 100) * pw * 100;
    exp.factors.push({
      text: `Buffer compliance (${bc.toFixed(
        1
      )}%) is reducing the efficiency score by ${penalty.toFixed(1)}%.`,
      type: "warning",
    });
  }

  return exp;
};

/* =================== OPS SNAPSHOT =================== */

const buildOperationsSnapshot = ({
  currentStage,
  throughput,
  onTime,
  efficiencyScore,
  sampleSize,
  referenceTime,
}) => {
  const bufferComplianceCurrent =
    onTime?.overall?.bufferCompliance?.current ?? 100;
  const rushReductionFactor = onTime?.overall?.rushReductionFactor ?? 0.6;
  const criticalViolationRate =
    (onTime?.overall?.criticalViolations ?? 0) /
    Math.max(1, onTime?.overall?.count ?? 1);

  return {
    engine: {
      version: CONFIG.META.ENGINE_VERSION,
      lastUpdated: CONFIG.META.LAST_UPDATED,
      description: CONFIG.META.DESCRIPTION,
      targetPercentile: CONFIG.TARGET_PERCENTILE,
      smoothingAlpha: CONFIG.SMOOTHING_ALPHA,
      activeWeight: CONFIG.ACTIVE_WEIGHT,
      loadFactorTable: CONFIG.LOAD_FACTOR_TABLE,
    },
    weights: {
      onTime: 0.6,
      velocity: 0.4,
      bufferPenaltyWeights: CONFIG.BUFFER_PENALTY_WEIGHTS,
    },
    stageContext: currentStage || null,
    computed: {
      score: efficiencyScore,
      sampleSize,
      calculatedAt: referenceTime,
      bufferComplianceCurrent,
      rushReductionFactor,
      severeLatenessDampener: (onTime?.overall?.avgHoursLate ?? 0) > 48,
      criticalViolationsPenalty: criticalViolationRate > 0.1,
      throughputOverall: throughput?.overall ?? 0,
      onTimeRate: onTime?.overall?.actualRate ?? 0,
    },
  };
};

/* =================== MAIN: calculateDepartmentEfficiency =================== */

export const calculateDepartmentEfficiency = async (
  department,
  currentStage = null,
  stageStatistics = null,
  stageCount = 0,
  onProgress = null
) => {
  const referenceTime = Date.now();

  const report = (pct) => {
    if (typeof onProgress === "function") onProgress(pct);
  };

  if (currentStage && (!stageStatistics || stageStatistics.noData)) {
    return {
      score: 0,
      noData: true,
      message: "No stage statistics available",
      activeCases: 0,
      completedCases: 0,
      department: department || "Digital",
      stage: currentStage,
      calculatedAt: referenceTime,
    };
  }

  if (!currentStage || !stageStatistics) {
    // Department-level (no stage) — treat as noData unless you have your own aggregator upstream
    return {
      score: 0,
      noData: true,
      message: "No data for department-level calculation",
      activeCases: 0,
      completedCases: 0,
      department: department || "Digital",
      stage: currentStage,
      calculatedAt: referenceTime,
    };
  }

  // Stage-level
  report(10);

  // Get filtered cases for statistics calculations
  const allValidCases = stageStatistics.validCases || [];
  const completedCases = allValidCases.filter((c) => !c.isActive);
  const activeCases = allValidCases.filter((c) => c.isActive);

  // CRITICAL FIX: Get ALL active cases for risk predictions (including excluded)
  // But ONLY cases that are CURRENTLY in this stage
  let allActiveCasesForRisk = [];

  // Helper function to check if a case is currently in the specified stage
  const isCurrentlyInStage = (caseData, targetStage) => {
    // Check modifiers first (most reliable for current state)
    const modifiers = caseData.modifiers || [];
    const stageModifier = modifiers.find((m) => m.startsWith("stage-"));

    if (stageModifier) {
      const currentCaseStage = stageModifier.replace("stage-", "");
      return currentCaseStage === targetStage;
    }

    // Fallback: check if it's active and in this stage based on visits
    if (caseData.isActive && caseData.currentStage) {
      return caseData.currentStage === targetStage;
    }

    // If no stage info, don't include
    return false;
  };

  // First, add all active cases from caseDetails that are CURRENTLY in this stage
  if (stageStatistics.caseDetails) {
    stageStatistics.caseDetails.forEach((caseDetail) => {
      // Must be active AND currently in this stage
      if (caseDetail.isActive && !caseDetail.completed) {
        // Check if actually in current stage
        if (isCurrentlyInStage(caseDetail, currentStage)) {
          allActiveCasesForRisk.push(caseDetail);
        }
      }
    });
  }

  // Second, add active excluded cases that are currently in this stage
  if (stageStatistics.excludedCases) {
    stageStatistics.excludedCases.forEach((excludedCase) => {
      // Check if this excluded case is active and in current stage
      const caseId = excludedCase.caseId || excludedCase.id;

      // Skip if already added
      const exists = allActiveCasesForRisk.find((c) => c.id === caseId);
      if (exists) return;

      // Must be active (not completed, has visits)
      const isActive =
        !excludedCase.isCompleted &&
        !excludedCase.completed &&
        excludedCase.visitCount > 0;

      if (isActive) {
        // Check if currently in this stage
        const caseWithModifiers = {
          ...excludedCase,
          modifiers: excludedCase.modifiers || [],
        };

        if (isCurrentlyInStage(caseWithModifiers, currentStage)) {
          allActiveCasesForRisk.push({
            ...excludedCase,
            id: caseId,
            caseNumber: excludedCase.caseNumber,
            isActive: true,
            currentStage: currentStage,
            timeInStage: excludedCase.timeInStage || 0,
            modifiers: excludedCase.modifiers || [],
            priority: excludedCase.priority || false,
            rush: excludedCase.rush || false,
            due: excludedCase.due,
            case_history: excludedCase.case_history || [],
            created_at: excludedCase.created_at,
            caseType: excludedCase.caseType || "general",
            completed: false,
          });
        }
      }
    });
  }

  // If we still don't have cases, fallback to filtered active cases
  // (these should already be properly filtered for the current stage)
  if (allActiveCasesForRisk.length === 0) {
    console.warn(
      "No active cases found including excluded ones, using filtered active cases"
    );
    allActiveCasesForRisk = activeCases;
  }

  console.log(
    `[Risk Predictions] Stage: ${currentStage}, Using ${allActiveCasesForRisk.length} total active cases (including excluded)`
  );
  console.log(
    `[Statistics] Using ${activeCases.length} valid active cases (excluding outliers/excluded)`
  );

  // Debug: Log a sample of cases to verify they're in the right stage
  if (allActiveCasesForRisk.length > 0) {
    const sample = allActiveCasesForRisk.slice(0, 3);
    console.log(
      "[Risk Predictions] Sample cases:",
      sample.map((c) => ({
        caseNumber: c.caseNumber,
        modifiers: c.modifiers,
        currentStage: c.currentStage,
        isActive: c.isActive,
        completed: c.completed,
      }))
    );
  }

  report(20);

  // Velocity per type with details
  const enhancedTypeStats = {};
  const allVelocityDetails = [];

  const types = ["general", "bbs", "flex"];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    const stats = stageStatistics.typeStats?.[type];
    if (
      stats &&
      Array.isArray(stats.completions) &&
      stats.completions.length > 0
    ) {
      const velocityResult = await calculateVelocityScore_Enhanced(
        currentStage,
        activeCases.filter((c) => c.caseType === type).length ||
          stats.count ||
          0,
        activeCases.filter((c) => c.caseType === type),
        null,
        stats.completions,
        referenceTime
      );

      if (velocityResult.caseDetails?.length) {
        allVelocityDetails.push(...velocityResult.caseDetails);
      }

      const hasMinimumCases = stats.completions.length >= 10;

      enhancedTypeStats[type] = {
        ...stats,
        velocityScore: velocityResult.velocityScore,
        velocityMetrics: {
          ...velocityResult.metrics,
          sampleSize:
            velocityResult.metrics?.sampleSize ?? stats.completions.length,
        },
        casesOverBenchmark: velocityResult.casesOverBenchmark,
        casesUnderBenchmark: velocityResult.casesUnderBenchmark,
        hasMinimumCases,
        actualCaseCount: stats.completions.length,
        excludedFromScoring: !hasMinimumCases,
        median: stats.median, // ensure UI has this
      };
    }
    report(20 + (i + 1) * 20); // 40, 60, 80
  }

  const throughputAnalysis = {
    byType: enhancedTypeStats,
    overall: overallThroughputScore(enhancedTypeStats),
    insights: throughputInsights(enhancedTypeStats),
    averageTime: stageStatistics.averageTime,
    medianTime: stageStatistics.medianTime,
    overallStats: stageStatistics.overallStats,
    avgHistoricalActive: activeCases.length, // Add this for risk predictions
  };

  report(90);

  const onTimeAnalysis = await calculateOnTimeDelivery(
    allValidCases,
    currentStage,
    stageStatistics,
    allVelocityDetails
  );

  const efficiencyScore = combinedScore(
    throughputAnalysis,
    onTimeAnalysis,
    currentStage
  );

  // Use ALL active cases for risk predictions
  const predictions = await generateCaseRiskPredictions(
    allActiveCasesForRisk, // This now includes excluded cases but ONLY those currently in stage
    throughputAnalysis,
    currentStage,
    stageStatistics
  );

  const explanation = explanationFor(
    throughputAnalysis,
    onTimeAnalysis,
    efficiencyScore,
    allValidCases.length,
    currentStage
  );

  const operationsSnapshot = buildOperationsSnapshot({
    currentStage,
    throughput: throughputAnalysis,
    onTime: onTimeAnalysis,
    efficiencyScore,
    sampleSize: allValidCases.length,
    referenceTime,
  });

  report(100);

  return {
    score: efficiencyScore,
    throughput: throughputAnalysis,
    onTimeDelivery: onTimeAnalysis,
    predictions,
    sampleSize: allValidCases.length,
    confidence: confidenceLabel(allValidCases.length),
    activeCases: activeCases.length, // For statistics (filtered)
    completedCases: completedCases.length,
    department: department || "Digital",
    stage: currentStage,
    explanation,
    noData: false,
    calculatedAt: referenceTime,
    velocityEngine: {
      enabled: true,
      config: CONFIG,
    },
    operationsSnapshot,
    caseInsights: onTimeAnalysis.caseInsights,
    // Debug info
    totalActiveCasesForRisk: allActiveCasesForRisk.length,
  };
};
