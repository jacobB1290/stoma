import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPRING } from "../animationEngine";
import { db, archiveCases } from "../services/caseService";

// Action Selection Dialog for Duplicates
const DuplicateActionDialog = ({
  isOpen,
  onClose,
  onDelete,
  onArchive,
  count,
}) => {
  if (!isOpen) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Clean Up {count} Duplicate{count === 1 ? "" : "s"}
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          What would you like to do with the older completed duplicates?
        </p>

        <div className="space-y-3">
          <button
            onClick={onArchive}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
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
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            Archive Duplicates
          </button>

          <button
            onClick={onDelete}
            className="w-full rounded-lg bg-red-600 py-3 font-semibold text-white hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            Permanently Delete
          </button>

          <button
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Confirmation Dialog Component
const ConfirmDialog = ({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = "Delete",
  count,
}) => {
  if (!isOpen) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>

        {count !== undefined && (
          <div className="mb-6 p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm font-semibold text-red-800">
              This will permanently delete {count} case{count === 1 ? "" : "s"}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 py-2 font-semibold text-white hover:bg-red-700 transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// Helper to get default date range
const getDefaultDates = () => {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  return {
    min: oneYearAgo.toISOString().split("T")[0],
    max: today.toISOString().split("T")[0],
  };
};

export default function DeleteCompletedModal({
  dates,
  onDelete,
  onClose,
  onArchive,
}) {
  // Use provided dates or fall back to defaults
  const defaultDates = dates || getDefaultDates();

  const [from, setFrom] = useState(defaultDates.min);
  const [to, setTo] = useState(defaultDates.max);
  const [duplicateStats, setDuplicateStats] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [duplicateActionDialog, setDuplicateActionDialog] = useState({
    isOpen: false,
  });
  const [completedCount, setCompletedCount] = useState({ all: 0, range: 0 });

  // Fetch counts on mount and when dates change
  useEffect(() => {
    analyzeDuplicates();
    fetchCompletedCounts();
  }, []);

  useEffect(() => {
    fetchRangeCount();
  }, [from, to]);

  const fetchCompletedCounts = async () => {
    try {
      const { count: allCount } = await db
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("completed", true)
        .or("archived.is.null,archived.eq.false");

      setCompletedCount((prev) => ({ ...prev, all: allCount || 0 }));
    } catch (err) {
      console.error("Error fetching counts:", err);
    }
  };

  const fetchRangeCount = async () => {
    if (!from || !to || from > to) {
      setCompletedCount((prev) => ({ ...prev, range: 0 }));
      return;
    }

    try {
      const { count } = await db
        .from("cases")
        .select("*", { count: "exact", head: true })
        .eq("completed", true)
        .or("archived.is.null,archived.eq.false")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`);

      setCompletedCount((prev) => ({ ...prev, range: count || 0 }));
    } catch (err) {
      console.error("Error fetching range count:", err);
    }
  };

  const analyzeDuplicates = async () => {
    setIsAnalyzing(true);
    try {
      const { data: allCases, error } = await db
        .from("cases")
        .select("id, casenumber, created_at, completed")
        .or("archived.is.null,archived.eq.false")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const caseGroups = {};
      allCases.forEach((c) => {
        const num = c.casenumber.split(/\s+/)[0];
        if (!caseGroups[num]) {
          caseGroups[num] = [];
        }
        caseGroups[num].push(c);
      });

      let totalDuplicates = 0;
      let completedDuplicates = 0;
      let activeDuplicates = 0;
      const duplicatesToProcess = [];
      const affectedCaseNumbers = new Set();

      Object.entries(caseGroups).forEach(([caseNum, cases]) => {
        if (cases.length > 1) {
          affectedCaseNumbers.add(caseNum);
          cases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

          for (let i = 1; i < cases.length; i++) {
            totalDuplicates++;
            if (cases[i].completed) {
              completedDuplicates++;
              duplicatesToProcess.push(cases[i].id);
            } else {
              activeDuplicates++;
            }
          }
        }
      });

      setDuplicateStats({
        total: totalDuplicates,
        completed: completedDuplicates,
        active: activeDuplicates,
        toProcess: duplicatesToProcess,
        uniqueCaseNumbers: affectedCaseNumbers.size,
      });
    } catch (err) {
      console.error("Error analyzing duplicates:", err);
      setDuplicateStats({ error: true });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDeleteAll = () => {
    setConfirmDialog({
      isOpen: true,
      type: "all",
      title: "Delete All Completed Cases?",
      message:
        "This action cannot be undone. All completed cases will be permanently removed from the system.",
      count: completedCount.all,
      onConfirm: async () => {
        setConfirmDialog({ isOpen: false });
        await onDelete();
      },
    });
  };

  const handleDeleteRange = () => {
    setConfirmDialog({
      isOpen: true,
      type: "range",
      title: "Delete Cases in Date Range?",
      message: `Delete all completed cases created between ${new Date(
        from
      ).toLocaleDateString()} and ${new Date(to).toLocaleDateString()}?`,
      count: completedCount.range,
      onConfirm: async () => {
        setConfirmDialog({ isOpen: false });
        await onDelete(from, to);
      },
    });
  };

  const handleDuplicateCleanup = () => {
    if (!duplicateStats?.toProcess?.length) return;

    setDuplicateActionDialog({
      isOpen: true,
      count: duplicateStats.completed,
      onArchive: async () => {
        setDuplicateActionDialog({ isOpen: false });
        try {
          const { error } = await archiveCases(duplicateStats.toProcess);
          if (error) throw error;
          if (onArchive) {
            onArchive(duplicateStats.toProcess);
          }
        } catch (err) {
          console.error("Error archiving duplicates:", err);
          alert("Failed to archive duplicate cases");
        }
      },
      onDelete: async () => {
        setDuplicateActionDialog({ isOpen: false });
        setConfirmDialog({
          isOpen: true,
          title: "Permanently Delete Duplicates?",
          message:
            "This will permanently delete the selected duplicate cases. This action cannot be undone.",
          count: duplicateStats.completed,
          onConfirm: async () => {
            setConfirmDialog({ isOpen: false });
            try {
              const { error } = await db
                .from("cases")
                .delete()
                .in("id", duplicateStats.toProcess);

              if (error) throw error;
              onDelete("duplicates", null, duplicateStats.toProcess.length);
            } catch (err) {
              console.error("Error deleting duplicates:", err);
              alert("Failed to delete duplicate cases");
            }
          },
        });
      },
    });
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          layout
          transition={SPRING}
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0.9 }}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
        >
          {/* Delete ALL button */}
          <button
            onClick={handleDeleteAll}
            disabled={completedCount.all === 0}
            className="w-full rounded bg-red-600 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Delete ALL completed cases
            {completedCount.all > 0 && (
              <span className="ml-2 text-sm opacity-90">
                ({completedCount.all})
              </span>
            )}
          </button>

          {/* Clean up duplicates section */}
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-amber-900">
                  Clean up duplicate case numbers
                </h3>
                <p className="text-xs text-amber-700 mt-1">
                  Keep newest, process older completed duplicates
                </p>
              </div>
              {isAnalyzing && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full"
                />
              )}
            </div>

            {duplicateStats && !duplicateStats.error && (
              <div className="text-xs text-amber-800 space-y-1">
                <div>
                  Found{" "}
                  <span className="font-semibold">
                    {duplicateStats.uniqueCaseNumbers}
                  </span>{" "}
                  case numbers with duplicates
                </div>
                <div>
                  <span className="font-semibold">
                    {duplicateStats.completed}
                  </span>{" "}
                  completed duplicates can be processed
                </div>
                {duplicateStats.active > 0 && (
                  <div className="text-amber-600 font-medium">
                    {duplicateStats.active} active duplicate
                    {duplicateStats.active === 1 ? "" : "s"} will be preserved
                  </div>
                )}
              </div>
            )}

            <button
              disabled={
                isAnalyzing ||
                !duplicateStats?.completed ||
                duplicateStats.completed === 0
              }
              onClick={handleDuplicateCleanup}
              className="w-full rounded bg-amber-600 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isAnalyzing
                ? "Analyzing..."
                : duplicateStats?.completed
                ? `Clean up ${duplicateStats.completed} duplicate${
                    duplicateStats.completed === 1 ? "" : "s"
                  }`
                : "No duplicates to clean up"}
            </button>
          </div>

          {/* Date range section */}
          <div className="mt-4 rounded-xl border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Delete by date range
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                value={from}
                min={defaultDates.min}
                max={defaultDates.max}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border p-2 text-sm"
              />
              <input
                type="date"
                value={to}
                min={defaultDates.min}
                max={defaultDates.max}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border p-2 text-sm"
              />
            </div>

            {from && to && from <= to && completedCount.range > 0 && (
              <p className="text-xs text-gray-600">
                {completedCount.range} completed case
                {completedCount.range === 1 ? "" : "s"} in this range
              </p>
            )}

            <button
              disabled={from > to || completedCount.range === 0}
              onClick={handleDeleteRange}
              className="w-full rounded bg-red-500 py-2 font-semibold text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Delete selected range
            </button>
          </div>

          {/* Cancel button */}
          <button
            onClick={onClose}
            className="mt-4 w-full rounded border border-gray-300 bg-white py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </motion.div>
      </motion.div>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {confirmDialog.isOpen && (
          <ConfirmDialog
            isOpen={confirmDialog.isOpen}
            title={confirmDialog.title}
            message={confirmDialog.message}
            count={confirmDialog.count}
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => setConfirmDialog({ isOpen: false })}
          />
        )}
      </AnimatePresence>

      {/* Duplicate Action Dialog */}
      <AnimatePresence>
        {duplicateActionDialog.isOpen && (
          <DuplicateActionDialog
            isOpen={duplicateActionDialog.isOpen}
            count={duplicateActionDialog.count}
            onArchive={duplicateActionDialog.onArchive}
            onDelete={duplicateActionDialog.onDelete}
            onClose={() => setDuplicateActionDialog({ isOpen: false })}
          />
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
