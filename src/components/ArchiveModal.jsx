// src/components/ArchiveModal.jsx
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { db, restoreCase, logCase } from "../services/caseService";
import CaseHistory from "./CaseHistory";

export default function ArchiveModal({ isOpen, onClose, searchQuery = "" }) {
  const [archivedCases, setArchivedCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedCaseForHistory, setSelectedCaseForHistory] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [animationComplete, setAnimationComplete] = useState(false);

  // Clear state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // Reset all state when modal is closed
      setArchivedCases([]);
      setLoading(true);
      setLoadingMore(false);
      setAnimationComplete(false);
      setIsReady(false);
    }
  }, [isOpen]);

  // Start animation immediately when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      // Start animation right away
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    }
  }, [isOpen]);

  // Load data after animation starts
  useEffect(() => {
    if (isOpen && animationComplete) {
      fetchInitialCases();
    }
  }, [isOpen, animationComplete, searchQuery]);

  // Fetch first 15 cases quickly
  const fetchInitialCases = useCallback(async () => {
    setLoading(true);

    try {
      let query = db
        .from("cases")
        .select("*")
        .eq("archived", true)
        .order("archived_at", { ascending: false })
        .limit(15); // Only load first 15 cases

      if (searchQuery) {
        query = query.ilike("casenumber", `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      const initialCases = data || [];
      setArchivedCases(initialCases);
      setLoading(false);

      // If we got 15 cases, there might be more
      if (initialCases.length === 15) {
        setLoadingMore(true);
        // Load remaining cases in background
        setTimeout(() => {
          fetchRemainingCases();
        }, 100);
      }
    } catch (err) {
      console.error("Error fetching initial archived cases:", err);
      setLoading(false);
    }
  }, [searchQuery]);

  // Fetch remaining cases in background
  const fetchRemainingCases = useCallback(async () => {
    try {
      let query = db
        .from("cases")
        .select("*")
        .eq("archived", true)
        .order("archived_at", { ascending: false });

      if (searchQuery) {
        query = query.ilike("casenumber", `%${searchQuery}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      startTransition(() => {
        // Replace with all cases (not append, to avoid duplicates)
        setArchivedCases(data || []);
        setLoadingMore(false);
      });
    } catch (err) {
      console.error("Error fetching remaining archived cases:", err);
      setLoadingMore(false);
    }
  }, [searchQuery]);

  const handleRestore = async (caseId) => {
    try {
      const { error } = await restoreCase(caseId);
      if (error) throw error;

      // Remove from local state
      setArchivedCases((prev) => prev.filter((c) => c.id !== caseId));
    } catch (err) {
      console.error("Error restoring case:", err);
      alert("Failed to restore case");
    }
  };

  const handlePermanentDelete = async (caseId) => {
    if (
      !confirm(
        "Are you sure you want to permanently delete this case? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      // Log the deletion first
      await logCase(caseId, "Case permanently deleted from archive");

      const { error } = await db.from("cases").delete().eq("id", caseId);

      if (error) throw error;

      // Remove from local state
      setArchivedCases((prev) => prev.filter((c) => c.id !== caseId));
    } catch (err) {
      console.error("Error deleting case:", err);
      alert("Failed to delete case");
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const splitCase = (caseNumber = "") => {
    const text = caseNumber
      .replace(/[()]/g, "")
      .replace(/\s*-\s*/, " ")
      .trim()
      .split(/\s+/);
    return [text.shift() || "", text.join(" ")];
  };

  // Loading skeleton component
  const LoadingSkeleton = () => (
    <div className="p-6 space-y-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
            <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
            <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );

  if (!isOpen) return null;

  return createPortal(
    <>
      <AnimatePresence>
        {!isClosing && (
          <motion.div
            className="fixed inset-0 z-[300] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Animated blurred backdrop */}
            <motion.div
              className="absolute inset-0 pointer-events-auto"
              onClick={handleClose}
              initial={{
                backdropFilter: "blur(0px)",
                WebkitBackdropFilter: "blur(0px)",
                backgroundColor: "rgba(0, 0, 0, 0)",
              }}
              animate={{
                backdropFilter: "blur(2px)",
                WebkitBackdropFilter: "blur(2px)",
                backgroundColor: "rgba(0, 0, 0, 0.2)",
              }}
              exit={{
                backdropFilter: "blur(0px)",
                WebkitBackdropFilter: "blur(0px)",
                backgroundColor: "rgba(0, 0, 0, 0)",
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />

            {/* Modal */}
            <AnimatePresence>
              {isReady && (
                <motion.div className="fixed inset-0 flex items-center justify-center pointer-events-none p-4">
                  <motion.div
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-4xl h-[80vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col pointer-events-auto"
                    initial={{
                      scale: 0,
                      opacity: 0,
                      borderRadius: "100%",
                    }}
                    animate={{
                      scale: 1,
                      opacity: 1,
                      borderRadius: "1rem",
                    }}
                    exit={{
                      scale: 0,
                      opacity: 0,
                      borderRadius: "100%",
                    }}
                    transition={{
                      scale: {
                        type: "spring",
                        stiffness: 260,
                        damping: 20,
                        duration: 0.5,
                      },
                      opacity: {
                        duration: 0.3,
                        ease: "easeOut",
                      },
                      borderRadius: {
                        duration: 0.4,
                        ease: [0.16, 1, 0.3, 1],
                      },
                    }}
                    onAnimationComplete={() => setAnimationComplete(true)}
                  >
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                      className="flex flex-col h-full"
                    >
                      {/* Compact Header - Always visible */}
                      <div className="px-6 py-4 border-b bg-gray-50 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                          <h2 className="text-lg font-semibold text-gray-900">
                            Archived Cases
                          </h2>
                          {searchQuery && (
                            <span className="text-sm text-gray-600">
                              "{searchQuery}"
                            </span>
                          )}
                          {!loading && (
                            <span className="text-sm text-gray-500">
                              ({archivedCases.length})
                            </span>
                          )}
                        </div>
                        <button
                          onClick={handleClose}
                          className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
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

                      {/* Content Area - Fixed height for consistent animation */}
                      <div className="flex-1 overflow-hidden">
                        {loading ? (
                          <LoadingSkeleton />
                        ) : archivedCases.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <svg
                              className="w-10 h-10 mb-2"
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
                            <p className="text-sm">
                              {searchQuery
                                ? `No matches for "${searchQuery}"`
                                : "No archived cases"}
                            </p>
                          </div>
                        ) : (
                          <div className="h-full overflow-y-auto">
                            <table className="w-full">
                              <thead className="bg-gray-50 sticky top-0 z-10">
                                <tr>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    Case
                                  </th>
                                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    Department
                                  </th>
                                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {archivedCases.map((caseItem, index) => {
                                  const [caseNum] = splitCase(
                                    caseItem.casenumber
                                  );

                                  return (
                                    <motion.tr
                                      key={caseItem.id}
                                      className="hover:bg-gray-50 transition-colors"
                                      initial={{ opacity: 0, x: -20 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{
                                        delay: Math.min(index * 0.03, 0.3),
                                        duration: 0.2,
                                      }}
                                    >
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="font-mono text-sm font-medium text-gray-900">
                                          {caseNum}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-gray-600">
                                          {caseItem.department === "General"
                                            ? "Digital"
                                            : caseItem.department}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          <button
                                            onClick={() =>
                                              setSelectedCaseForHistory(
                                                caseItem
                                              )
                                            }
                                            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                                            title="View info"
                                          >
                                            <svg
                                              className="w-4 h-4"
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
                                          <button
                                            onClick={() =>
                                              handleRestore(caseItem.id)
                                            }
                                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Restore"
                                          >
                                            <svg
                                              className="w-4 h-4"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke="currentColor"
                                            >
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                                              />
                                            </svg>
                                          </button>
                                          <button
                                            onClick={() =>
                                              handlePermanentDelete(caseItem.id)
                                            }
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Delete permanently"
                                          >
                                            <svg
                                              className="w-4 h-4"
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
                                          </button>
                                        </div>
                                      </td>
                                    </motion.tr>
                                  );
                                })}
                              </tbody>
                            </table>

                            {/* Loading more indicator */}
                            {loadingMore && (
                              <div className="flex justify-center py-4 border-t">
                                <div className="flex items-center gap-2 text-gray-500">
                                  <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{
                                      duration: 1,
                                      repeat: Infinity,
                                      ease: "linear",
                                    }}
                                    className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full"
                                  />
                                  <span className="text-sm">
                                    Loading more cases...
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case History Modal */}
      {selectedCaseForHistory && (
        <CaseHistory
          id={selectedCaseForHistory.id}
          caseNumber={selectedCaseForHistory.casenumber}
          onClose={() => setSelectedCaseForHistory(null)}
        />
      )}
    </>,
    document.body
  );
}
