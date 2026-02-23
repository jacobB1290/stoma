import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { db } from "../services/caseService";
import { ThrottledProcessor } from "./throttledProcessor";

/* Working Hours Calculation Helper */
export const calculateWorkingHours = (startDate, endDate) => {
  let totalWorkingMinutes = 0;
  let current = new Date(startDate);
  const end = new Date(endDate);

  while (current < end) {
    // Use local time methods - automatically handles DST
    const localHours = current.getHours();
    const localDay = current.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Check if it's a weekday (Monday = 1, Friday = 5)
    const isWeekday = localDay >= 1 && localDay <= 5;

    if (isWeekday) {
      // Check if current time is within working hours (8 AM - 5 PM local time)
      if (localHours >= 8 && localHours < 17) {
        totalWorkingMinutes += 1;
      }
    }

    // Move to next minute
    current = new Date(current.getTime() + 60000);
  }

  return totalWorkingMinutes * 60 * 1000; // Convert to milliseconds
};

/* Get stage from modifiers */
const getStageFromModifiers = (modifiers = []) => {
  if (modifiers.includes("stage-qc")) return "qc";
  if (modifiers.includes("stage-finishing")) return "finishing";
  if (modifiers.includes("stage-production")) return "production";
  if (modifiers.includes("stage-design")) return "design";
  return "design"; // Default for new digital cases
};

/* Statistical helper functions */
const calculateMean = (arr) => {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
};

const calculateStdDev = (arr, mean) => {
  if (arr.length < 2) return 0;
  const variance =
    arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    (arr.length - 1);
  return Math.sqrt(variance);
};

const calculatePercentile = (sortedArr, p) => {
  if (sortedArr.length === 0) return 0;
  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
};

const calculateVelocityScore = (times, benchmark) => {
  if (times.length === 0) return 0;
  const atOrBelowBenchmark = times.filter((t) => t <= benchmark).length;
  const baseScore = (atOrBelowBenchmark / times.length) * 100;

  // Bonus for consistency
  const mean = calculateMean(times);
  const stdDev = calculateStdDev(times, mean);
  const cv = mean > 0 ? stdDev / mean : 0;
  const consistencyBonus = Math.max(0, (1 - cv) * 20);

  return Math.min(100, baseScore + consistencyBonus);
};

const calculateMode = (data) => {
  if (data.length === 0) return 0;

  // Round to nearest day for mode calculation
  const roundedData = data.map(
    (val) => Math.round(val / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
  );

  const frequency = {};
  let maxFreq = 0;
  let mode = roundedData[0];

  roundedData.forEach((value) => {
    frequency[value] = (frequency[value] || 0) + 1;
    if (frequency[value] > maxFreq) {
      maxFreq = frequency[value];
      mode = value;
    }
  });

  return mode;
};

/* Check if a case is excluded from statistics */
const isCaseExcluded = (caseItem, stage = null) => {
  const modifiers = caseItem.modifiers || [];

  // Check for all-stage exclusion
  if (
    modifiers.includes("stats-exclude") ||
    modifiers.includes("stats-exclude:all")
  ) {
    return true;
  }

  // Check for stage-specific exclusion
  if (stage && modifiers.includes(`stats-exclude:${stage}`)) {
    return true;
  }

  return false;
};

/* Get exclusion reason from modifiers */
const getExclusionReason = (modifiers = []) => {
  const reasonModifier = modifiers.find((m) =>
    m.startsWith("stats-exclude-reason:")
  );
  if (reasonModifier) {
    return reasonModifier.replace("stats-exclude-reason:", "");
  }
  return null;
};

/* Enhanced stage time calculation system */
export const calculateStageTime = (caseItem, targetStage, history) => {
  const STAGE_SYSTEM_START_DATE = new Date("2025-07-14T00:00:00Z");
  const caseCreatedDate = new Date(caseItem.created_at);

  // Sort history chronologically
  const sortedHistory = [...history].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  // Build complete stage timeline
  const stageTimeline = [];
  let currentStageInfo = null;

  // For cases created after July 14, 2025, they start in design
  if (
    caseCreatedDate >= STAGE_SYSTEM_START_DATE &&
    caseItem.department === "General"
  ) {
    currentStageInfo = {
      stage: "design",
      enteredAt: caseItem.created_at,
      exitedAt: null,
    };
  }

  // Process all history entries to build timeline
  sortedHistory.forEach((entry) => {
    const action = entry.action.toLowerCase();

    // Detect stage transitions
    if (action.includes("moved from") && action.includes("to")) {
      // Handle "Moved from X to Y stage" format
      if (currentStageInfo && !currentStageInfo.exitedAt) {
        currentStageInfo.exitedAt = entry.created_at;
        stageTimeline.push(currentStageInfo);
      }

      // Extract destination stage
      let newStage = null;
      if (action.includes("to design")) newStage = "design";
      else if (action.includes("to production")) newStage = "production";
      else if (action.includes("to finishing")) newStage = "finishing";
      else if (action.includes("to quality control")) newStage = "qc";

      if (newStage) {
        currentStageInfo = {
          stage: newStage,
          enteredAt: entry.created_at,
          exitedAt: null,
        };
      }
    } else if (action.includes("moved from quality control")) {
      // Handle moving back from QC
      if (currentStageInfo && !currentStageInfo.exitedAt) {
        currentStageInfo.exitedAt = entry.created_at;
        stageTimeline.push(currentStageInfo);
      }

      let newStage = null;
      if (action.includes("back to finishing")) newStage = "finishing";

      if (newStage) {
        currentStageInfo = {
          stage: newStage,
          enteredAt: entry.created_at,
          exitedAt: null,
        };
      }
    } else if (action.includes("assigned to") && action.includes("stage")) {
      // Handle initial stage assignment
      if (!currentStageInfo) {
        let stage = null;
        if (action.includes("design")) stage = "design";
        else if (action.includes("production")) stage = "production";
        else if (action.includes("finishing")) stage = "finishing";

        if (stage) {
          currentStageInfo = {
            stage: stage,
            enteredAt: entry.created_at,
            exitedAt: null,
          };
        }
      }
    } else if (action === "marked done" && currentStageInfo) {
      // Case completed - close current stage
      currentStageInfo.exitedAt = entry.created_at;
      stageTimeline.push(currentStageInfo);
      currentStageInfo = null;
    }
  });

  // Add current stage if still active
  if (currentStageInfo && !currentStageInfo.exitedAt) {
    const currentStageFromModifiers = getStageFromModifiers(caseItem.modifiers);
    if (
      currentStageInfo.stage === currentStageFromModifiers &&
      !caseItem.completed
    ) {
      stageTimeline.push(currentStageInfo);
    } else if (currentStageInfo.stage !== currentStageFromModifiers) {
      // Stage was exited but we missed the transition
      currentStageInfo.exitedAt = new Date().toISOString();
      stageTimeline.push(currentStageInfo);
    }
  }

  // Special handling for finishing stage - stop counting time when moved to QC
  if (targetStage === "finishing") {
    const qcTransition = history.find((h) =>
      h.action.toLowerCase().includes("moved from finishing to quality control")
    );

    if (qcTransition) {
      stageTimeline.forEach((visit) => {
        if (
          visit.stage === "finishing" &&
          (!visit.exitedAt ||
            new Date(visit.exitedAt) > new Date(qcTransition.created_at))
        ) {
          visit.exitedAt = qcTransition.created_at;
        }
      });
    }
  }

  // Calculate total time for target stage (sum all visits)
  const stageVisits = stageTimeline.filter(
    (visit) => visit.stage === targetStage
  );
  let totalTime = 0;
  let totalWorkingTime = 0;
  let visitCount = 0;
  let isCurrentlyActive = false;

  stageVisits.forEach((visit) => {
    visitCount++;
    const startTime = new Date(visit.enteredAt);
    const endTime = visit.exitedAt ? new Date(visit.exitedAt) : new Date();
    const duration = endTime - startTime;
    const workingDuration = calculateWorkingHours(startTime, endTime);

    totalTime += duration;
    totalWorkingTime += workingDuration;

    if (!visit.exitedAt && !caseItem.completed) {
      isCurrentlyActive = true;
    }
  });

  // Calculate hold durations within stage periods
  let totalHoldTime = 0;
  let totalWorkingHoldTime = 0;
  const holdPeriods = [];
  let currentHoldStart = null;

  sortedHistory.forEach((entry) => {
    const action = entry.action.toLowerCase();
    if (action.includes("hold added")) {
      currentHoldStart = entry.created_at;
    } else if (action.includes("hold removed") && currentHoldStart) {
      holdPeriods.push({
        start: new Date(currentHoldStart),
        end: new Date(entry.created_at),
      });
      currentHoldStart = null;
    }
  });

  // If still on hold
  if (currentHoldStart && caseItem.modifiers?.includes("hold")) {
    holdPeriods.push({
      start: new Date(currentHoldStart),
      end: new Date(),
    });
  }

  // Calculate hold time that overlaps with stage visits
  stageVisits.forEach((visit) => {
    const visitStart = new Date(visit.enteredAt);
    const visitEnd = visit.exitedAt ? new Date(visit.exitedAt) : new Date();

    holdPeriods.forEach((hold) => {
      // Check if hold period overlaps with stage visit
      if (hold.start < visitEnd && hold.end > visitStart) {
        const overlapStart = Math.max(hold.start, visitStart);
        const overlapEnd = Math.min(hold.end, visitEnd);
        const holdDuration = overlapEnd - overlapStart;
        const workingHoldDuration = calculateWorkingHours(
          overlapStart,
          overlapEnd
        );

        totalHoldTime += holdDuration;
        totalWorkingHoldTime += workingHoldDuration;
      }
    });
  });

  return {
    totalTime,
    totalWorkingTime,
    adjustedTime: totalTime - totalHoldTime,
    adjustedWorkingTime: totalWorkingTime - totalWorkingHoldTime,
    visitCount,
    isActive: isCurrentlyActive,
    holdTime: totalHoldTime,
    workingHoldTime: totalWorkingHoldTime,
    visits: stageVisits,
    timeline: stageTimeline,
  };
};

/* Calculate stage statistics - THE source of truth for all averages */
export const calculateStageStatistics = async (stage, onProgress) => {
  try {
    console.log(`[calculateStageStatistics] Starting for ${stage} stage`);

    // Create throttled processor
    const processor = new ThrottledProcessor({
      maxExecutionTime: 5, // Only 5ms per chunk for ultra-smooth UI
      yieldInterval: 20, // Yield every 20ms
      onProgress: onProgress || (() => {}),
    });

    // Fetch cases
    console.log("[calculateStageStatistics] Fetching cases from database...");
    const { data: casesWithHistory, error: dbError } = await db
      .from("cases")
      .select("*, case_history(*)")
      .eq("department", "General")
      .order("created_at", { ascending: false });

    if (dbError) {
      console.error("[calculateStageStatistics] Database error:", dbError);
      throw dbError;
    }

    if (!casesWithHistory) {
      console.log("[calculateStageStatistics] No cases returned from database");
      return null;
    }

    console.log(
      `[calculateStageStatistics] Fetched ${casesWithHistory.length} cases`
    );

    // Data quality thresholds
    const MIN_STAGE_TIME = {
      design: 10 * 60 * 1000,
      production: 45 * 60 * 1000,
      finishing: 10 * 60 * 1000,
    };
    const MAX_STAGE_TIME = 30 * 24 * 60 * 60 * 1000;

    // Process cases with throttling
    console.log("[calculateStageStatistics] Processing cases...");
    const processedCases = await processor.processArray(
      casesWithHistory,
      (caseItem) => {
        const history = caseItem.case_history || [];

        // Check for exclusion
        if (isCaseExcluded(caseItem, stage)) {
          return {
            type: "excluded",
            data: {
              caseNumber: caseItem.casenumber,
              reason:
                getExclusionReason(caseItem.modifiers) || "Manually excluded",
              caseId: caseItem.id,
              modifiers: caseItem.modifiers,
              priority: caseItem.priority,
              rush: caseItem.modifiers?.includes("rush"),
            },
          };
        }

        // Calculate stage time
        const stageData = calculateStageTime(caseItem, stage, history);

        if (stageData.visitCount === 0) {
          return { type: "skip" };
        }

        // Validation
        let excludeReason = null;
        if (stageData.adjustedWorkingTime < MIN_STAGE_TIME[stage]) {
          excludeReason = `Time too short (${formatDuration(
            stageData.adjustedWorkingTime
          )})`;
        } else if (stageData.adjustedWorkingTime > MAX_STAGE_TIME) {
          excludeReason = `Time too long (${formatDuration(
            stageData.adjustedWorkingTime
          )})`;
        } else if (stageData.visitCount > 3) {
          excludeReason = `Too many visits (${stageData.visitCount})`;
        }

        if (excludeReason) {
          return {
            type: "excluded",
            data: {
              caseNumber: caseItem.casenumber,
              reason: excludeReason,
              timeInStage: stageData.totalWorkingTime,
              visitCount: stageData.visitCount,
              caseId: caseItem.id,
            },
          };
        }

        const caseType = caseItem.modifiers?.includes("bbs")
          ? "bbs"
          : caseItem.modifiers?.includes("flex")
          ? "flex"
          : "general";

        return {
          type: "valid",
          data: {
            id: caseItem.id,
            caseNumber: caseItem.casenumber,
            timeInStage: stageData.adjustedWorkingTime,
            rawTimeInStage: stageData.totalWorkingTime,
            holdTime: stageData.workingHoldTime,
            visitCount: stageData.visitCount,
            isActive: stageData.isActive,
            priority: caseItem.priority,
            rush: caseItem.modifiers?.includes("rush"),
            caseType: caseType,
            visits: stageData.visits,
            created_at: caseItem.created_at,
            completed_at: caseItem.completed_at,
            completed: caseItem.completed,
            due: caseItem.due,
            modifiers: caseItem.modifiers,
            case_history: history,
            department: caseItem.department,
          },
        };
      }
    );

    console.log(
      `[calculateStageStatistics] Processed ${processedCases.length} cases`
    );

    // Separate results
    const caseDetails = [];
    const excludedCases = [];
    const casesByType = {
      general: { cases: [], times: [] },
      bbs: { cases: [], times: [] },
      flex: { cases: [], times: [] },
    };

    processedCases.forEach((result) => {
      if (result.type === "excluded") {
        excludedCases.push(result.data);
      } else if (result.type === "valid") {
        caseDetails.push(result.data);
        const caseType = result.data.caseType;
        casesByType[caseType].cases.push(result.data);
        casesByType[caseType].times.push(result.data.timeInStage);
      }
    });

    console.log(
      `[calculateStageStatistics] Valid cases: ${caseDetails.length}, Excluded: ${excludedCases.length}`
    );

    // Apply outlier detection in a throttled manner
    if (caseDetails.length > 3) {
      console.log("[calculateStageStatistics] Applying outlier detection...");
      await processor.processInBatches(caseDetails, 50, (batch) => {
        const times = caseDetails
          .map((c) => c.timeInStage)
          .sort((a, b) => a - b);
        const q1 = times[Math.floor(times.length * 0.25)];
        const q3 = times[Math.floor(times.length * 0.75)];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        batch.forEach((detail) => {
          if (
            detail.timeInStage < lowerBound ||
            detail.timeInStage > upperBound
          ) {
            detail.isOutlier = true;
          }
        });

        return batch;
      });
    }

    // Calculate statistics with throttling
    const validCases = caseDetails.filter((c) => !c.isOutlier);
    const validTimes = validCases.map((c) => c.timeInStage);

    console.log(
      `[calculateStageStatistics] Valid cases after outlier removal: ${validCases.length}`
    );

    if (validCases.length === 0) {
      console.log(
        "[calculateStageStatistics] No valid cases found, returning noData"
      );
      return {
        noData: true,
        excludedCases,
        message: "No valid cases found for this stage",
      };
    }

    // Calculate final statistics
    console.log("[calculateStageStatistics] Calculating final statistics...");
    const stats = await calculateFinalStatistics(
      validCases,
      validTimes,
      caseDetails,
      excludedCases,
      casesByType,
      casesWithHistory
    );

    console.log("[calculateStageStatistics] Complete. Returning stats:", {
      averageTime: stats.averageTime,
      medianTime: stats.medianTime,
      sampleSize: stats.sampleSize,
      activeCases: stats.activeCases,
    });

    return stats;
  } catch (error) {
    console.error("[calculateStageStatistics] Error:", error);
    console.error("[calculateStageStatistics] Stack:", error.stack);
    throw error;
  }
};

// Helper function for final statistics
async function calculateFinalStatistics(
  validCases,
  validTimes,
  caseDetails,
  excludedCases,
  casesByType,
  allCases
) {
  const avgTime =
    validTimes.reduce((sum, time) => sum + time, 0) / validTimes.length;
  const sortedTimes = [...validTimes].sort((a, b) => a - b);
  const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)];

  // Calculate percentiles
  const p25 = sortedTimes[Math.floor(sortedTimes.length * 0.25)];
  const p75 = sortedTimes[Math.floor(sortedTimes.length * 0.75)];
  const p90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)];

  // Count cases with multiple visits
  const multiVisitCases = caseDetails.filter((c) => c.visitCount > 1).length;

  // Build type statistics
  const buildTypeStats = (typeData) => {
    if (!typeData.times.length) return null;

    const sorted = [...typeData.times].sort((a, b) => a - b);
    const mean = calculateMean(sorted);
    const median = sorted[Math.floor(sorted.length / 2)];
    const stdDev = calculateStdDev(sorted, mean);
    const velocity = calculateVelocityScore(sorted, median);

    // Priority cases (priority flag, with or without rush)
    const priorityCases = typeData.cases.filter((c) => c.priority);
    let priorityStats = null;

    if (priorityCases.length >= 3) {
      const priorityTimes = priorityCases
        .map((c) => c.timeInStage)
        .sort((a, b) => a - b);

      // Standard cases for comparison (no priority, no rush)
      const standardCases = typeData.cases.filter(
        (c) => !c.priority && !c.rush
      );
      const standardMean =
        standardCases.length > 0
          ? calculateMean(standardCases.map((c) => c.timeInStage))
          : mean;

      priorityStats = {
        mean: calculateMean(priorityTimes),
        median: priorityTimes[Math.floor(priorityTimes.length / 2)],
        percentFaster:
          standardMean > 0
            ? ((standardMean - calculateMean(priorityTimes)) / standardMean) *
              100
            : 0,
        count: priorityCases.length,
        standardComparison: {
          standardMean: standardMean,
          standardCount: standardCases.length,
        },
      };
    }

    // Rush cases (rush flag only, no priority)
    const rushOnlyCases = typeData.cases.filter((c) => c.rush && !c.priority);
    let rushStats = null;

    if (rushOnlyCases.length >= 3) {
      const rushTimes = rushOnlyCases
        .map((c) => c.timeInStage)
        .sort((a, b) => a - b);

      // Standard cases for comparison (no priority, no rush)
      const standardCases = typeData.cases.filter(
        (c) => !c.priority && !c.rush
      );
      const standardMean =
        standardCases.length > 0
          ? calculateMean(standardCases.map((c) => c.timeInStage))
          : mean;

      rushStats = {
        mean: calculateMean(rushTimes),
        median: rushTimes[Math.floor(rushTimes.length / 2)],
        percentFaster:
          standardMean > 0
            ? ((standardMean - calculateMean(rushTimes)) / standardMean) * 100
            : 0,
        count: rushOnlyCases.length,
        standardComparison: {
          standardMean: standardMean,
          standardCount: standardCases.length,
        },
      };
    }

    // Create completions for velocity engine
    const completions = typeData.cases.map((c) => ({
      timeInStageMs: c.timeInStage,
      activeCountAtStart: 0, // Will be calculated if needed
      stageTime: c.timeInStage,
      caseNumber: c.caseNumber,
      caseId: c.id,
    }));

    return {
      count: typeData.times.length,
      mean,
      median,
      stdDev,
      percentiles: {
        p10: calculatePercentile(sorted, 10),
        p25: calculatePercentile(sorted, 25),
        p50: median,
        p75: calculatePercentile(sorted, 75),
        p90: calculatePercentile(sorted, 90),
      },
      velocityScore: velocity,
      priorityStats,
      rushStats,
      cases: typeData.cases,
      completions,
    };
  };

  const typeStats = {
    general: buildTypeStats(casesByType.general),
    bbs: buildTypeStats(casesByType.bbs),
    flex: buildTypeStats(casesByType.flex),
  };

  // Calculate overall statistics
  const overallStats = {
    mean: avgTime,
    median: medianTime,
    mode: calculateMode(validTimes),
    stdDev: calculateStdDev(validTimes, avgTime),
    percentiles: {
      p10: calculatePercentile(sortedTimes, 10),
      p25: p25,
      p50: medianTime,
      p75: p75,
      p90: p90,
    },
  };

  return {
    averageTime: avgTime,
    medianTime: medianTime,
    sampleSize: validCases.length,
    totalCases: caseDetails.length,
    excludedCount: excludedCases.length,
    outlierCount: caseDetails.filter((c) => c.isOutlier).length,
    multiVisitCount: multiVisitCases,
    minTime: Math.min(...validTimes),
    maxTime: Math.max(...validTimes),
    p25Time: p25,
    p75Time: p75,
    p90Time: p90,
    caseDetails: caseDetails, // Includes outliers
    excludedCases: excludedCases,
    activeCases: validCases.filter((c) => c.isActive).length,
    completedCases: validCases.filter((c) => !c.isActive).length,
    dataQuality: {
      score:
        (validCases.length / (caseDetails.length + excludedCases.length)) * 100,
      issues:
        excludedCases.length + caseDetails.filter((c) => c.isOutlier).length,
    },
    // Type statistics for efficiency calculations
    casesByType: casesByType,
    typeStats: typeStats, // Pre-calculated statistics WITH completions
    allValidTimes: validTimes,
    overallStats: overallStats, // Overall statistics for efficiency
    validCases: validCases, // Include valid cases for efficiency calculations
    allCases: allCases, // All cases for department-wide efficiency
  };
}

/* Format time duration */
export const formatDuration = (ms) => {
  if (!ms || ms === 0 || !isFinite(ms)) return "—";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
};

/* Stage Details Modal Component - SIMPLIFIED WITHOUT EXCLUSION UI */
export const StageDetailsModal = ({
  showStageDetails,
  setShowStageDetails,
  stageStats,
  currentStageConfig,
  modalOpenRef,
  formatDuration,
  setSelectedCaseForHistory,
}) => {
  useEffect(() => {
    modalOpenRef.current = showStageDetails;
  }, [showStageDetails, modalOpenRef]);

  if (!showStageDetails || !stageStats?.caseDetails) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
        onClick={() => setShowStageDetails(false)}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className={`bg-gradient-to-r ${currentStageConfig.bgGradient} p-6 border-b flex-shrink-0`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3
                  className={`text-2xl font-bold ${currentStageConfig.textColor}`}
                >
                  {currentStageConfig.title} - Time Analysis
                </h3>
                <p className="text-sm mt-1 opacity-80">
                  {stageStats.sampleSize} valid cases analyzed • Data Quality:{" "}
                  {stageStats.dataQuality?.score.toFixed(0)}% • Working hours
                  only (8AM-5PM MST)
                </p>
              </div>
              <button
                onClick={() => setShowStageDetails(false)}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-4 gap-4 p-6 bg-gray-50 border-b flex-shrink-0">
            <div>
              <div className="text-xs text-gray-600">Average</div>
              <div className="text-xl font-bold text-gray-900">
                {formatDuration(stageStats.averageTime)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Median</div>
              <div className="text-xl font-bold text-gray-900">
                {formatDuration(stageStats.medianTime)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Active</div>
              <div className="text-xl font-bold text-blue-600">
                {stageStats.activeCases}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Excluded</div>
              <div className="text-xl font-bold text-gray-500">
                {stageStats.excludedCount + stageStats.outlierCount}
              </div>
            </div>
          </div>

          {/* Case List - Scrollable */}
          <div className="flex-1 overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Case #
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time in Stage
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-center px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stageStats.caseDetails
                  .filter((c) => !c.isOutlier)
                  .map((caseDetail) => (
                    <tr key={caseDetail.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {caseDetail.caseNumber}
                          </span>
                          {caseDetail.priority && (
                            <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                              Priority
                            </span>
                          )}
                          {caseDetail.rush && (
                            <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                              Rush
                            </span>
                          )}
                          {caseDetail.visitCount > 2 && (
                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                              {caseDetail.visitCount} visits
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`font-mono ${
                            caseDetail.isActive
                              ? "text-blue-600 font-semibold"
                              : "text-gray-700"
                          }`}
                        >
                          {formatDuration(caseDetail.timeInStage)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {caseDetail.isActive ? (
                          <span className="inline-flex items-center gap-1 text-blue-600">
                            <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
                            Active
                          </span>
                        ) : (
                          <span className="text-gray-500">Completed</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => {
                              setSelectedCaseForHistory({
                                id: caseDetail.id,
                                caseNumber: caseDetail.caseNumber,
                              });
                              setShowStageDetails(false);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="View case history"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="p-4 border-t bg-gray-50 text-sm text-gray-600">
            <p>
              {stageStats.excludedCount + stageStats.outlierCount} cases
              excluded from statistics. To manage exclusions, click on the
              Active Cases count in the stage banner.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};
