// src/components/CaseManagementModal.jsx
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { useMut } from "../context/DataContext";
import { db } from "../services/caseService";
import {
  formatDuration,
  calculateStageTime,
} from "../utils/stageTimeCalculations";

// Icon Components
const IconSearch = () => (
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
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const IconClock = () => (
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
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const IconExclude = () => (
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
      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
    />
  </svg>
);

const IconInclude = () => (
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
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const IconAlert = () => (
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
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

const IconReset = () => (
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
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const IconDatabase = () => (
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
      d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
    />
  </svg>
);

// Helper functions - Updated to handle legacy formats
const isCaseExcluded = (caseItem, stage = null) => {
  const modifiers = caseItem.modifiers || [];

  // Check for all-stage exclusions
  if (
    modifiers.includes("stats-exclude") ||
    modifiers.includes("stats-exclude:all")
  ) {
    return true;
  }

  // Check for stage-specific exclusions (including legacy formats)
  if (stage) {
    if (modifiers.includes(`stats-exclude:${stage}`)) return true;
    if (modifiers.includes(`stats-exclude-${stage}`)) return true; // Legacy format

    // Check for old single-stage exclusion format
    // (where stats-exclude without :all meant current stage only)
    if (
      modifiers.includes("stats-exclude") &&
      !modifiers.includes("stats-exclude:all") &&
      !modifiers.some((m) => m.startsWith("stats-exclude:"))
    ) {
      return true;
    }
  }

  return false;
};

const getExclusionReason = (modifiers = []) => {
  const reasonModifier = modifiers.find((m) =>
    m.startsWith("stats-exclude-reason:")
  );
  if (reasonModifier) {
    return reasonModifier.replace("stats-exclude-reason:", "");
  }
  return null;
};

// Reset confirmation dialog
const ResetConfirmationDialog = ({ onConfirm, onCancel, stage, scope }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <IconAlert className="text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            Reset Manual Exclusions
          </h3>
        </div>

        <p className="text-gray-600 mb-6">
          {scope === "stage" ? (
            <>
              This will remove all manual exclusions for the{" "}
              <strong>{stage}</strong> stage only. Automatic exclusions based on
              data quality will remain.
            </>
          ) : (
            <>
              This will remove <strong>ALL</strong> manual exclusions across the
              entire database. Automatic exclusions based on data quality will
              remain.
            </>
          )}
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-800">
            <strong>Warning:</strong> This action cannot be undone. All manual
            exclusion decisions will be lost.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Reset Exclusions
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Exclusion scope dialog
const ExclusionScopeDialog = ({
  caseNumber,
  currentStage,
  onConfirm,
  onCancel,
}) => {
  const [scope, setScope] = useState("stage");
  const [reason, setReason] = useState("");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Exclude Case #{caseNumber}
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Exclusion Scope
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="scope"
                  value="stage"
                  checked={scope === "stage"}
                  onChange={(e) => setScope(e.target.value)}
                  className="text-blue-600"
                />
                <div>
                  <div className="font-medium">
                    This stage only ({currentStage})
                  </div>
                  <div className="text-sm text-gray-500">
                    Case will only be excluded from {currentStage} statistics
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={(e) => setScope(e.target.value)}
                  className="text-blue-600"
                />
                <div>
                  <div className="font-medium">All stages</div>
                  <div className="text-sm text-gray-500">
                    Case will be excluded from all stage statistics
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason for exclusion..."
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(scope, reason)}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Exclude Case
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Main Case Management Modal
export const CaseManagementModal = ({ show, onClose, stage, stageStats }) => {
  const { toggleCaseExclusion, batchToggleExclusions } = useMut();
  const [searchQuery, setSearchQuery] = useState("");
  const [showExclusionDialog, setShowExclusionDialog] = useState(null);
  const [showResetDialog, setShowResetDialog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeScreen, setActiveScreen] = useState("active");
  const [selectedCases, setSelectedCases] = useState(new Set());
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [manuallyExcludedCases, setManuallyExcludedCases] = useState([]);

  // Fetch manually excluded cases from database
  useEffect(() => {
    if (!show || !stage) return;

    const fetchManuallyExcludedCases = async () => {
      try {
        // Query for all cases with exclusion modifiers
        const { data } = await db
          .from("cases")
          .select("*, case_history(*)")
          .eq("department", "General")
          .or(
            `modifiers.cs.{stats-exclude,stats-exclude:all,stats-exclude:${stage},stats-exclude-${stage}}`
          );

        if (data) {
          const processed = data
            .filter((caseItem) => isCaseExcluded(caseItem, stage))
            .map((caseItem) => {
              const history = caseItem.case_history || [];
              const stageData = calculateStageTime(caseItem, stage, history);

              return {
                id: caseItem.id,
                caseNumber: caseItem.casenumber,
                timeInStage: stageData.adjustedWorkingTime,
                visitCount: stageData.visitCount,
                isActive: stageData.isActive && !caseItem.completed,
                priority: caseItem.priority,
                rush: caseItem.modifiers?.includes("rush"),
                modifiers: caseItem.modifiers || [],
                exclusionType: caseItem.modifiers?.includes("stats-exclude:all")
                  ? "manual-all"
                  : "manual-stage",
                exclusionReason:
                  getExclusionReason(caseItem.modifiers) || "Manually excluded",
                isExcluded: true,
                completed: caseItem.completed,
                archived: caseItem.archived,
              };
            });

          setManuallyExcludedCases(processed);
        }
      } catch (error) {
        console.error("Error fetching manually excluded cases:", error);
      }
    };

    fetchManuallyExcludedCases();
  }, [show, stage]);

  // Process cases from stageStats and merge with manually excluded cases
  const processedCases = useMemo(() => {
    if (!stageStats || !stageStats.caseDetails) {
      return { active: [], completed: [], excluded: [] };
    }

    const categorized = {
      active: [],
      completed: [],
      excluded: [],
    };

    // Create a map to track processed cases
    const processedCaseIds = new Set();

    // First, process all cases from stageStats.caseDetails
    stageStats.caseDetails.forEach((caseDetail) => {
      processedCaseIds.add(caseDetail.id);

      const isManuallyExcluded = isCaseExcluded(caseDetail, stage);
      let exclusionReason = null;
      let exclusionType = null;

      if (isManuallyExcluded) {
        exclusionReason =
          getExclusionReason(caseDetail.modifiers) || "Manually excluded";
        exclusionType = caseDetail.modifiers?.includes("stats-exclude:all")
          ? "manual-all"
          : "manual-stage";
      }

      const processedCase = {
        ...caseDetail,
        exclusionType,
        exclusionReason,
        isExcluded: isManuallyExcluded,
      };

      // Handle outliers - keep active outliers in their respective lists but mark them
      if (isManuallyExcluded) {
        categorized.excluded.push(processedCase);
      } else if (caseDetail.isActive) {
        // Active cases stay in active list, even if outliers (they're still in the stage)
        if (caseDetail.isOutlier) {
          categorized.active.push({
            ...processedCase,
            isOutlier: true,
            outlierNote: `Statistical outlier (${formatDuration(
              caseDetail.timeInStage
            )})`,
          });
        } else {
          categorized.active.push(processedCase);
        }
      } else if (caseDetail.isOutlier) {
        // Only completed outliers go to excluded
        categorized.excluded.push({
          ...processedCase,
          exclusionType: "automatic-outlier",
          exclusionReason: `Statistical outlier (${formatDuration(
            caseDetail.timeInStage
          )})`,
          isExcluded: true,
        });
      } else {
        categorized.completed.push(processedCase);
      }
    });

    // Second, process all cases from stageStats.excludedCases (non-outlier exclusions)
    stageStats.excludedCases?.forEach((excludedCase) => {
      const caseId = excludedCase.caseId || excludedCase.id;

      // Skip if already processed
      if (processedCaseIds.has(caseId)) return;

      processedCaseIds.add(caseId);

      // Determine if it's manual or automatic exclusion
      const modifiers = excludedCase.modifiers || [];
      const isManuallyExcluded = isCaseExcluded({ modifiers }, stage);

      let exclusionType = "automatic";
      let exclusionReason = excludedCase.reason || "Data quality issue";

      if (isManuallyExcluded) {
        exclusionType = modifiers.includes("stats-exclude:all")
          ? "manual-all"
          : "manual-stage";
        exclusionReason =
          getExclusionReason(modifiers) ||
          excludedCase.reason ||
          "Manually excluded";
      }

      categorized.excluded.push({
        id: caseId,
        caseNumber: excludedCase.caseNumber,
        timeInStage: excludedCase.timeInStage || 0,
        visitCount: excludedCase.visitCount || 0,
        isActive: false,
        exclusionType,
        exclusionReason,
        isExcluded: true,
        modifiers: modifiers,
        priority: excludedCase.priority || false,
        rush: excludedCase.rush || false,
      });
    });

    // Third, add any manually excluded cases from database that weren't in stats
    manuallyExcludedCases.forEach((manualCase) => {
      if (!processedCaseIds.has(manualCase.id)) {
        processedCaseIds.add(manualCase.id);
        categorized.excluded.push(manualCase);
      }
    });

    // Sort cases
    categorized.active.sort((a, b) => b.timeInStage - a.timeInStage);
    categorized.completed.sort((a, b) => b.timeInStage - a.timeInStage);
    categorized.excluded.sort((a, b) => {
      // Statistical outliers at the bottom
      if (
        a.exclusionType === "automatic-outlier" &&
        b.exclusionType !== "automatic-outlier"
      )
        return 1;
      if (
        a.exclusionType !== "automatic-outlier" &&
        b.exclusionType === "automatic-outlier"
      )
        return -1;

      // Then sort by time
      return b.timeInStage - a.timeInStage;
    });

    return categorized;
  }, [stageStats, stage, manuallyExcludedCases]);

  // Search in database
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }

    const searchDatabase = async () => {
      setSearchLoading(true);
      try {
        const { data } = await db
          .from("cases")
          .select("*, case_history(*)")
          .eq("department", "General")
          .ilike("casenumber", `%${searchQuery}%`)
          .limit(10);

        if (data && data.length > 0) {
          // Process search results
          const processed = data.map((caseItem) => {
            const history = caseItem.case_history || [];
            const stageData = calculateStageTime(caseItem, stage, history);

            const isManuallyExcluded = isCaseExcluded(caseItem, stage);
            let exclusionReason = null;
            let exclusionType = null;

            if (isManuallyExcluded) {
              exclusionReason = getExclusionReason(caseItem.modifiers);
              if (caseItem.modifiers?.includes("stats-exclude:all")) {
                exclusionType = "manual-all";
              } else {
                exclusionType = "manual-stage";
              }
            }

            return {
              id: caseItem.id,
              caseNumber: caseItem.casenumber,
              timeInStage: stageData.adjustedWorkingTime,
              visitCount: stageData.visitCount,
              isActive: stageData.isActive,
              priority: caseItem.priority,
              rush: caseItem.modifiers?.includes("rush"),
              modifiers: caseItem.modifiers || [],
              exclusionType,
              exclusionReason,
              isExcluded: isManuallyExcluded,
              isFromSearch: true,
              completed: caseItem.completed,
              archived: caseItem.archived,
            };
          });

          setSearchResults(processed);
        } else {
          setSearchResults([]);
        }
      } catch (error) {
        console.error("Error searching database:", error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchDatabase, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery, stage]);

  // Get display cases
  const getDisplayCases = () => {
    // If we have search results, show those instead
    if (searchResults !== null && searchQuery) {
      return searchResults;
    }

    // Otherwise show the categorized cases
    const cases = processedCases[activeScreen] || [];
    if (!searchQuery) return cases;

    return cases.filter((c) =>
      c.caseNumber?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const displayCases = getDisplayCases();

  // Handle exclusion toggle - Updated to properly handle automatic outliers
  const handleToggleExclusion = async (caseId, scope = null, reason = null) => {
    setLoading(true);
    try {
      // For automatic outliers being re-included, we need to add an override modifier
      const caseData = displayCases.find((c) => c.id === caseId);
      if (
        caseData &&
        caseData.exclusionType === "automatic-outlier" &&
        scope === null
      ) {
        // Re-including an automatic outlier - add override modifier
        await toggleCaseExclusion(
          caseId,
          stage,
          "Manually included (override automatic exclusion)"
        );
      } else {
        // Normal exclusion/inclusion
        await toggleCaseExclusion(
          caseId,
          scope === "all" ? null : stage,
          reason
        );
      }

      // Update search results if this was a searched case
      if (searchResults) {
        setSearchResults((prev) =>
          prev.map((c) => {
            if (c.id === caseId) {
              const isNowExcluded = scope !== null;
              return {
                ...c,
                isExcluded: isNowExcluded,
                exclusionType: isNowExcluded
                  ? scope === "all"
                    ? "manual-all"
                    : "manual-stage"
                  : null,
                exclusionReason: reason,
              };
            }
            return c;
          })
        );
      }

      onClose(true); // Refresh parent
    } catch (error) {
      console.error("Error toggling exclusion:", error);
    } finally {
      setLoading(false);
      setShowExclusionDialog(null);
    }
  };

  // Handle batch actions
  const handleBatchAction = async (action) => {
    if (selectedCases.size === 0) return;

    setLoading(true);
    try {
      const caseIds = [...selectedCases];

      if (action === "exclude") {
        await batchToggleExclusions(caseIds, true, stage);
      } else if (action === "include") {
        await batchToggleExclusions(caseIds, false, stage);
      }

      setSelectedCases(new Set());
      onClose(true); // Refresh parent
    } catch (error) {
      console.error("Error in batch action:", error);
    } finally {
      setLoading(false);
    }
  };

  // Handle reset exclusions - Updated to handle legacy formats
  const handleResetExclusions = async (scope) => {
    setLoading(true);
    try {
      if (scope === "stage") {
        // Reset stage-specific exclusions
        const { data: allCases } = await db
          .from("cases")
          .select("id, modifiers")
          .eq("department", "General");

        if (allCases && allCases.length > 0) {
          for (const caseItem of allCases) {
            if (!caseItem.modifiers || caseItem.modifiers.length === 0)
              continue;

            const hasStageExclusion = caseItem.modifiers.some(
              (m) =>
                m === `stats-exclude:${stage}` ||
                m === `stats-exclude-${stage}` ||
                (m === "stats-exclude" &&
                  !caseItem.modifiers.includes("stats-exclude:all"))
            );

            if (hasStageExclusion) {
              const newModifiers = caseItem.modifiers.filter((m) => {
                if (m === `stats-exclude:${stage}`) return false;
                if (m === `stats-exclude-${stage}`) return false;
                if (
                  m === "stats-exclude" &&
                  !caseItem.modifiers.includes("stats-exclude:all")
                )
                  return false;

                if (m.startsWith("stats-exclude-reason:")) {
                  const hasOtherExclusions = caseItem.modifiers.some(
                    (mod) =>
                      mod !== `stats-exclude:${stage}` &&
                      mod !== `stats-exclude-${stage}` &&
                      mod !== "stats-exclude" &&
                      (mod.startsWith("stats-exclude:") ||
                        mod === "stats-exclude:all")
                  );
                  return hasOtherExclusions;
                }

                return true;
              });

              await db
                .from("cases")
                .update({ modifiers: newModifiers })
                .eq("id", caseItem.id);
            }
          }
        }
      } else {
        // Reset ALL exclusions
        const { data: allCases } = await db
          .from("cases")
          .select("id, modifiers");

        if (allCases && allCases.length > 0) {
          for (const caseItem of allCases) {
            if (!caseItem.modifiers || caseItem.modifiers.length === 0)
              continue;

            const hasExclusions = caseItem.modifiers.some(
              (m) => m.startsWith("stats-exclude") || m.includes("exclude")
            );

            if (hasExclusions) {
              const newModifiers = caseItem.modifiers.filter((m) => {
                if (m.startsWith("stats-exclude")) return false;
                if (m.startsWith("stats-exclude-reason:")) return false;
                if (m.includes("exclude") && m.includes("stats")) return false;

                return true;
              });

              await db
                .from("cases")
                .update({ modifiers: newModifiers })
                .eq("id", caseItem.id);
            }
          }
        }
      }

      setShowResetDialog(null);
      onClose(true); // Refresh parent
    } catch (error) {
      console.error("Error resetting exclusions:", error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate summary stats
  const totalCases =
    processedCases.active.length +
    processedCases.completed.length +
    processedCases.excluded.length;
  const includedInStats =
    processedCases.active.length + processedCases.completed.length;
  const manualExclusions = processedCases.excluded.filter((c) =>
    c.exclusionType?.includes("manual")
  ).length;
  const automaticExclusions = processedCases.excluded.filter(
    (c) =>
      c.exclusionType === "automatic" || c.exclusionType === "automatic-outlier"
  ).length;

  return createPortal(
    <AnimatePresence>
      {show && (
        <motion.div
          key="case-management-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
          onClick={() => onClose(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {stage.charAt(0).toUpperCase() + stage.slice(1)} Stage -
                    Case Management
                  </h2>
                  <p className="text-blue-100 text-sm mt-1">
                    Manage case exclusions and view stage statistics
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowResetDialog("stage")}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors group"
                    title={`Reset ${stage} stage exclusions`}
                  >
                    <IconReset className="group-hover:rotate-180 transition-transform duration-300" />
                  </button>
                  <button
                    onClick={() => setShowResetDialog("all")}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                    title="Reset all exclusions"
                  >
                    <IconDatabase />
                  </button>
                  <button
                    onClick={() => onClose(false)}
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
            </div>

            {/* Search Bar */}
            <div className="p-4 border-b bg-gray-50">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search entire database by case number..."
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {searchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                  </div>
                )}
              </div>
              {searchResults !== null && searchQuery && (
                <div className="mt-2 text-sm text-gray-600">
                  {searchResults.length === 0 ? (
                    "No cases found in database"
                  ) : (
                    <>
                      Found {searchResults.length} case
                      {searchResults.length !== 1 ? "s" : ""} in database
                      {searchResults.some((c) => c.archived) &&
                        " (including archived)"}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Screen Tabs - only show if not searching */}
            {!searchResults && (
              <div className="flex border-b">
                <button
                  onClick={() => {
                    setActiveScreen("active");
                    setSelectedCases(new Set());
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeScreen === "active"
                      ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Active Cases ({processedCases.active.length})
                </button>
                <button
                  onClick={() => {
                    setActiveScreen("completed");
                    setSelectedCases(new Set());
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeScreen === "completed"
                      ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Completed Cases ({processedCases.completed.length})
                </button>
                <button
                  onClick={() => {
                    setActiveScreen("excluded");
                    setSelectedCases(new Set());
                  }}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeScreen === "excluded"
                      ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Excluded ({processedCases.excluded.length})
                  <span className="text-xs ml-1">
                    [{manualExclusions}M/{automaticExclusions}A]
                  </span>
                </button>
              </div>
            )}

            {/* Batch Actions */}
            {selectedCases.size > 0 && (
              <div className="px-6 py-3 bg-blue-50 border-b flex items-center justify-between">
                <span className="text-sm text-blue-700">
                  {selectedCases.size} case{selectedCases.size > 1 ? "s" : ""}{" "}
                  selected
                </span>
                <div className="flex gap-2">
                  {activeScreen !== "excluded" || searchResults ? (
                    <button
                      onClick={() => handleBatchAction("exclude")}
                      disabled={loading}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Exclude Selected
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBatchAction("include")}
                      disabled={loading}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      Include Selected
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedCases(new Set())}
                    className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {!stageStats && !searchResults ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center text-gray-500">
                    <p>Loading stage statistics...</p>
                  </div>
                </div>
              ) : displayCases.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  {searchQuery && !searchResults
                    ? "No cases match your search"
                    : searchResults
                    ? "No cases found in database"
                    : `No ${activeScreen} cases in ${stage} stage`}
                </div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="w-12 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={
                            selectedCases.size === displayCases.length &&
                            displayCases.length > 0
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCases(
                                new Set(displayCases.map((c) => c.id))
                              );
                            } else {
                              setSelectedCases(new Set());
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                        Case #
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                        Time in Stage
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                        Visits
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {displayCases.map((caseData) => {
                      const isExcluded = caseData.isExcluded;

                      return (
                        <tr
                          key={caseData.id}
                          className={`hover:bg-gray-50 ${
                            isExcluded ? "bg-red-50" : ""
                          } ${
                            caseData.isActive && activeScreen === "active"
                              ? "bg-blue-50"
                              : ""
                          } ${caseData.isFromSearch ? "bg-yellow-50" : ""}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedCases.has(caseData.id)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedCases);
                                if (e.target.checked) {
                                  newSelected.add(caseData.id);
                                } else {
                                  newSelected.delete(caseData.id);
                                }
                                setSelectedCases(newSelected);
                              }}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">
                                {caseData.caseNumber}
                              </span>
                              {caseData.priority && (
                                <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">
                                  Priority
                                </span>
                              )}
                              {caseData.rush && (
                                <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded">
                                  Rush
                                </span>
                              )}
                              {caseData.isFromSearch && (
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                                  From DB
                                </span>
                              )}
                              {caseData.archived && (
                                <span className="text-xs bg-gray-100 text-gray-800 px-2 py-0.5 rounded">
                                  Archived
                                </span>
                              )}
                              {caseData.isOutlier && !caseData.isExcluded && (
                                <span
                                  className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded"
                                  title={caseData.outlierNote}
                                >
                                  Outlier
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <IconClock className="w-4 h-4 text-gray-400" />
                              <span
                                className={`font-mono text-sm ${
                                  caseData.isActive
                                    ? "text-blue-600 font-semibold"
                                    : ""
                                }`}
                              >
                                {caseData.visitCount > 0
                                  ? formatDuration(caseData.timeInStage)
                                  : "—"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {caseData.visitCount > 0 ? (
                              `${caseData.visitCount} ${
                                caseData.visitCount === 1 ? "visit" : "visits"
                              }`
                            ) : (
                              <span className="text-gray-400">
                                Never visited
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {caseData.exclusionType ? (
                              <div className="text-sm">
                                {caseData.exclusionType === "manual-all" && (
                                  <div className="flex items-center gap-1 text-red-600">
                                    <IconAlert className="w-4 h-4" />
                                    <span>Excluded (all stages)</span>
                                  </div>
                                )}
                                {caseData.exclusionType === "manual-stage" && (
                                  <div className="flex items-center gap-1 text-amber-600">
                                    <IconAlert className="w-4 h-4" />
                                    <span>Excluded (this stage)</span>
                                  </div>
                                )}
                                {caseData.exclusionType === "automatic" && (
                                  <div className="flex items-center gap-1 text-purple-600">
                                    <IconAlert className="w-4 h-4" />
                                    <span>Auto-excluded</span>
                                  </div>
                                )}
                                {caseData.exclusionType ===
                                  "automatic-outlier" && (
                                  <div className="flex items-center gap-1 text-yellow-600">
                                    <IconAlert className="w-4 h-4" />
                                    <span>Statistical outlier</span>
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {caseData.exclusionReason}
                                </div>
                              </div>
                            ) : (
                              <span
                                className={`text-sm ${
                                  caseData.isActive
                                    ? "text-blue-600 font-medium"
                                    : caseData.completed
                                    ? "text-gray-500"
                                    : caseData.archived
                                    ? "text-gray-400"
                                    : "text-gray-600"
                                }`}
                              >
                                {caseData.isActive
                                  ? "Active"
                                  : caseData.completed
                                  ? "Completed"
                                  : caseData.archived
                                  ? "Archived"
                                  : "Not in stage"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isExcluded ? (
                              <button
                                onClick={() =>
                                  handleToggleExclusion(caseData.id)
                                }
                                disabled={loading}
                                className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                                title={
                                  caseData.exclusionType === "automatic" ||
                                  caseData.exclusionType === "automatic-outlier"
                                    ? "Override automatic exclusion"
                                    : "Include in statistics"
                                }
                              >
                                <IconInclude />
                              </button>
                            ) : (
                              <button
                                onClick={() => setShowExclusionDialog(caseData)}
                                disabled={loading}
                                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                title="Exclude from statistics"
                              >
                                <IconExclude />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t bg-gray-50">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <div className="flex items-center gap-4">
                  <span>Total: {totalCases} cases</span>
                  <span className="text-gray-400">•</span>
                  <span>Included in stats: {includedInStats}</span>
                  <span className="text-gray-400">•</span>
                  <span>Manual: {manualExclusions}</span>
                  <span className="text-gray-400">•</span>
                  <span>Auto: {automaticExclusions}</span>
                </div>
                {stageStats && (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span>Average:</span>
                      <span className="font-medium">
                        {formatDuration(stageStats.averageTime)}
                      </span>
                    </div>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-2">
                      <span>Median:</span>
                      <span className="font-medium">
                        {formatDuration(stageStats.medianTime)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Exclusion Scope Dialog */}
          {showExclusionDialog && (
            <ExclusionScopeDialog
              caseNumber={showExclusionDialog.caseNumber}
              currentStage={stage}
              onConfirm={(scope, reason) => {
                handleToggleExclusion(showExclusionDialog.id, scope, reason);
              }}
              onCancel={() => setShowExclusionDialog(null)}
            />
          )}

          {/* Reset Confirmation Dialog */}
          {showResetDialog && (
            <ResetConfirmationDialog
              stage={stage}
              scope={showResetDialog}
              onConfirm={() => handleResetExclusions(showResetDialog)}
              onCancel={() => setShowResetDialog(null)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
