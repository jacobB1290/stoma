import React, {
  useState,
  useCallback,
  useMemo,
  memo,
  useEffect,
  useRef,
} from "react";
import clsx from "clsx";
import RowMenu from "./RowMenu";
import ArchiveModal from "./ArchiveModal";
import DeleteCompletedModal from "./DeleteCompletedModal";
import { db, archiveCases } from "../services/caseService";
import { useMut } from "../context/DataContext";

// CaseTable.jsx - Optimized with progressive loading that doesn't block UI

// ============ PROGRESSIVE LOADING CONFIG ============
// Edit these values to tune loading performance vs animation smoothness
const INITIAL_BATCH = 20; // Rows shown instantly on page switch
const BATCH_SIZE = 100; // Rows added per batch
const BATCH_DELAY = 500; // Milliseconds between batches
// ====================================================

/* ---------------- Minimal Status Dots (no framer-motion) ---------------- */
const StatusDot = memo(({ type, pulse }) => {
  const [isHovered, setIsHovered] = useState(false);

  const config = {
    priority: { label: "Priority", bg: "bg-red-500" },
    rush: { label: "Rush", bg: "bg-orange-500" },
    hold: { label: "Hold", bg: "bg-amber-500" },
    stage2: { label: "Stage 2", bg: "bg-indigo-500" },
  };

  const { label, bg } = config[type];

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={clsx(
          "flex items-center justify-center overflow-hidden transition-all duration-150 ease-out",
          bg,
          pulse && "glow"
        )}
        style={{
          width: isHovered ? `${label.length * 7 + 16}px` : "8px",
          height: isHovered ? "20px" : "8px",
          borderRadius: isHovered ? "10px" : "9999px",
        }}
      >
        {isHovered && (
          <span className="text-white text-xs font-medium whitespace-nowrap px-2">
            {label}
          </span>
        )}
      </div>
    </div>
  );
});
StatusDot.displayName = "StatusDot";

const StatusDotsContainer = memo(({ statuses, pulse }) => {
  const dots = [];
  if (statuses.priority) dots.push("priority");
  if (statuses.rush) dots.push("rush");
  if (statuses.hold) dots.push("hold");
  if (statuses.stage2 && statuses.department === "Metal") dots.push("stage2");

  if (dots.length === 0) return null;

  return (
    <div className="flex items-center gap-1 ml-2">
      {dots.map((type) => (
        <StatusDot
          key={type}
          type={type}
          pulse={pulse}
        />
      ))}
    </div>
  );
});
StatusDotsContainer.displayName = "StatusDotsContainer";

/* ---------------- Helpers ---------------- */
const splitCase = (caseNumber = "") => {
  const text = caseNumber
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim()
    .split(/\s+/);
  return [text.shift() || "", text.join(" ")];
};

/* ---------------- Progressive Rows - Smooth progressive loading ---------------- */
// Simple row component
const TableRow = ({
  row,
  formatDate,
  completed,
  onEdit,
  toggleDone,
  toggleHold,
  toggleRush,
  togglePriority,
  toggleStage2,
  toggleNewAccount,
  removeCase,
  onArchive,
  workflowPending,
}) => (
  <tr
    className={clsx(
      "hover:bg-gray-50/50 transition-colors",
      workflowPending && "opacity-50"
    )}
  >
    <td className="px-2 sm:px-5 py-2 sm:py-4">
      <div className="flex items-center">
        <span className="font-mono text-xs sm:text-sm text-gray-900 flex-shrink-0">
          {row.caseNum}
        </span>
        <StatusDotsContainer
          statuses={row}
          pulse={row.pulse && !workflowPending}
        />
        {workflowPending && (
          <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gray-100 text-[10px] text-gray-500 font-medium">
            <svg
              className="w-3 h-3"
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
            waiting
          </span>
        )}
      </div>
      {row.caseDesc && (
        <div className="text-xs text-gray-600 mt-0.5">{row.caseDesc}</div>
      )}
    </td>
    <td className="px-2 sm:px-5 py-2 sm:py-4">
      <span className="text-xs sm:text-sm text-gray-700">
        {row.department === "General" ? "Digital" : row.department}
      </span>
    </td>
    <td className="px-2 sm:px-5 py-2 sm:py-4">
      <span
        className={clsx(
          "text-xs sm:text-sm font-mono",
          row.isOverdue && !row.completed && !row.hold && !workflowPending
            ? "text-red-600 font-medium"
            : "text-gray-700",
          row.hold && "line-through decoration-gray-400"
        )}
      >
        {formatDate(row.due)}
      </span>
    </td>
    <td className="px-2 sm:px-5 py-2 sm:py-4 text-right">
      <RowMenu
        row={row}
        completed={completed}
        onEdit={onEdit}
        toggleDone={toggleDone}
        toggleHold={toggleHold}
        toggleRush={toggleRush}
        togglePriority={togglePriority}
        toggleStage2={toggleStage2}
        toggleNewAccount={toggleNewAccount}
        removeCase={removeCase}
        onArchive={onArchive}
      />
    </td>
  </tr>
);

const ProgressiveRows = memo(
  ({
    rows,
    formatDate,
    completed,
    onEdit,
    toggleDone,
    toggleHold,
    toggleRush,
    togglePriority,
    toggleStage2,
    toggleNewAccount,
    removeCase,
    onArchive,
    workflowMap,
  }) => {
    // Track visible count - start with all rows visible (no reset on re-renders)
    const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH);
    const initializedRef = useRef(false);

    // Only reset on true initial mount, never on re-renders or data changes
    // This completely prevents reload issues from search/filter
    useEffect(() => {
      if (!initializedRef.current) {
        initializedRef.current = true;
        setVisibleCount(INITIAL_BATCH);
      }
    }, []);

    // Progressive loading with setTimeout only (simpler, more predictable)
    useEffect(() => {
      if (visibleCount >= rows.length) return;

      const timeoutId = setTimeout(() => {
        setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, rows.length));
      }, BATCH_DELAY);

      return () => clearTimeout(timeoutId);
    }, [visibleCount, rows.length]);

    // Show all rows if we have fewer than visible count
    const actualVisible = Math.min(visibleCount, rows.length);
    const visibleRows = rows.slice(0, actualVisible);
    const remaining = rows.length - actualVisible;

    return (
      <>
        {visibleRows.map((row) => (
          <TableRow
            key={row.id}
            row={row}
            formatDate={formatDate}
            completed={completed}
            onEdit={onEdit}
            toggleDone={toggleDone}
            toggleHold={toggleHold}
            toggleRush={toggleRush}
            togglePriority={togglePriority}
            toggleStage2={toggleStage2}
            toggleNewAccount={toggleNewAccount}
            removeCase={removeCase}
            onArchive={onArchive}
            workflowPending={workflowMap?.get(row.id)?.isPending ?? false}
          />
        ))}
        {remaining > 0 && (
          <tr>
            <td colSpan={4} className="px-5 py-2 text-center">
              <span className="text-xs text-gray-400">
                Loading {remaining} more...
              </span>
            </td>
          </tr>
        )}
      </>
    );
  }
);
ProgressiveRows.displayName = "ProgressiveRows";

/* ---------------- CollapsibleSection ---------------- */
const CollapsibleSection = memo(
  ({
    title,
    count,
    bgColor,
    textColor,
    shadowColor,
    rows,
    formatDate,
    completed,
    onEdit,
    toggleDone,
    toggleHold,
    toggleRush,
    togglePriority,
    toggleStage2,
    toggleNewAccount,
    removeCase,
    onArchive,
    defaultExpanded = true,
    forceOpen = false,
    isOverdueSection = false,
    workflowMap,
  }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const prevForceOpen = useRef(forceOpen);

    useEffect(() => {
      if (forceOpen) {
        setIsExpanded(true);
      } else if (prevForceOpen.current && !forceOpen && !defaultExpanded) {
        setIsExpanded(false);
      }
      prevForceOpen.current = forceOpen;
    }, [forceOpen, defaultExpanded]);

    const toggleExpanded = useCallback(() => {
      if (!forceOpen) {
        setIsExpanded((v) => !v);
      }
    }, [forceOpen]);

    return (
      <div className="relative">
        {/* Shadow */}
        <div
          className={clsx(
            "absolute inset-0 rounded-xl blur-xl opacity-25 pointer-events-none",
            isOverdueSection ? "bg-red-900/40" : shadowColor
          )}
          style={{ transform: "translateY(8px)" }}
        />

        <div
          className={clsx(
            "relative rounded-xl overflow-hidden backdrop-blur-md shadow-lg border",
            isOverdueSection ? "border-red-900/40" : "border-white/30"
          )}
        >
          {/* Header */}
          <button
            onClick={toggleExpanded}
            className={clsx(
              "w-full px-4 py-3.5 flex items-center justify-between",
              isOverdueSection
                ? "flash-overdue text-red-100"
                : [bgColor, textColor],
              "hover:brightness-110 transition-[filter] duration-150"
            )}
            style={
              isOverdueSection
                ? { "--overdue-bg": "#7f1d1d" }
                : undefined
            }
          >
            <div className="flex items-center gap-3">
              <svg
                className="w-4 h-4 transition-transform duration-300 ease-out"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="font-semibold text-sm uppercase tracking-wide">
                {title}
              </span>
            </div>
            <span
              className={clsx(
                "px-2.5 py-0.5 rounded-full text-xs font-medium",
                isOverdueSection ? "bg-red-950/60 text-red-100" : "bg-white/20"
              )}
            >
              {count}
            </span>
          </button>

          {/* Content - CSS grid for smooth animation */}
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{
              gridTemplateRows: isExpanded ? "1fr" : "0fr",
            }}
          >
            <div className="min-h-0 overflow-hidden">
              <div
                className="bg-white/90 backdrop-blur-sm transition-opacity duration-200"
                style={{ opacity: isExpanded ? 1 : 0 }}
              >
                <table className="w-full">
                  <tbody className="divide-y divide-gray-200/50">
                    <ProgressiveRows
                      rows={rows}
                      formatDate={formatDate}
                      completed={completed}
                      onEdit={onEdit}
                      toggleDone={toggleDone}
                      toggleHold={toggleHold}
                      toggleRush={toggleRush}
                      togglePriority={togglePriority}
                      toggleStage2={toggleStage2}
                      toggleNewAccount={toggleNewAccount}
                      removeCase={removeCase}
                      onArchive={onArchive}
                      workflowMap={workflowMap}
                    />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
CollapsibleSection.displayName = "CollapsibleSection";

/* ---------------- CaseTable ---------------- */
export default memo(function CaseTable({
  title,
  rows,
  empty,
  onEdit,
  toggleDone,
  toggleHold,
  toggleRush,
  togglePriority,
  toggleStage2,
  toggleNewAccount,
  removeCase,
  completed = false,
  deleteAll,
  allHistory,
  allHistoryHover,
  todayISO,
  searchQuery = "",
  fetchCases,
  dates,
  forceOpen = false,
  showDividers = true,
}) {
  const [showArchive, setShowArchive] = useState(false);
  const [archiveCount, setArchiveCount] = useState(0);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const { workflowMap } = useMut();

  const formatDate = useCallback((dateStr) => {
    const [, month, day] = dateStr.split("T")[0].split("-");
    return `${parseInt(month)}-${parseInt(day)}`;
  }, []);

  const processedRows = useMemo(
    () =>
      rows.map((row) => {
        const isOverdue = !row.completed && row.due.slice(0, 10) < todayISO;
        const pulse = !row.completed;
        const [caseNum, caseDesc] = splitCase(row.caseNumber);
        return { ...row, isOverdue, pulse, caseNum, caseDesc };
      }),
    [rows, todayISO]
  );

  const categorizedRows = useMemo(() => {
    const c = { overdue: [], priority: [], rush: [], hold: [], regular: [] };
    processedRows.forEach((row) => {
      if (row.hold) c.hold.push(row);
      else if (row.isOverdue) c.overdue.push(row);
      else if (row.priority && !row.completed) c.priority.push(row);
      else if (row.rush && !row.completed) c.rush.push(row);
      else c.regular.push(row);
    });
    return c;
  }, [processedRows]);

  const allRowsFlat = useMemo(() => {
    if (showDividers) return null;
    return [...processedRows].sort((a, b) => {
      if (a.priority && !b.priority) return -1;
      if (!a.priority && b.priority) return 1;
      const da = new Date(a.due);
      const db = new Date(b.due);
      if (da < db) return -1;
      if (da > db) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  }, [processedRows, showDividers]);

  useEffect(() => {
    let mounted = true;
    const fetchCount = async () => {
      if (!completed) return;
      try {
        let query = db
          .from("cases")
          .select("*", { count: "exact", head: true })
          .eq("archived", true);
        if (searchQuery) query = query.ilike("casenumber", `%${searchQuery}%`);
        const { count } = await query;
        mounted && setArchiveCount(count || 0);
      } catch (err) {
        console.error("Error fetching archive count:", err);
      }
    };
    fetchCount();
    return () => {
      mounted = false;
    };
  }, [searchQuery, completed]);

  const handleArchive = useCallback(
    async (caseIds) => {
      try {
        const { error } = await archiveCases(caseIds);
        if (error) throw error;
        if (fetchCases) await fetchCases();
        if (completed) {
          let query = db
            .from("cases")
            .select("*", { count: "exact", head: true })
            .eq("archived", true);
          if (searchQuery)
            query = query.ilike("casenumber", `%${searchQuery}%`);
          const { count } = await query;
          setArchiveCount(count || 0);
        }
      } catch (err) {
        console.error("Error archiving cases:", err);
        alert(`Failed to archive cases: ${err.message || err}`);
      }
    },
    [fetchCases, completed, searchQuery]
  );

  const handleArchiveFromMenu = useCallback(
    async (caseId) => handleArchive([caseId]),
    [handleArchive]
  );

  return (
    <>
      <section
        className={clsx(
          "mx-auto mt-6 max-w-3xl glass-panel rounded-2xl overflow-hidden",
          completed && "opacity-95"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-200">
          <h3 className="text-base sm:text-lg font-semibold text-gray-800">
            {title}
          </h3>
          <div className="flex items-center space-x-2">
            {allHistory && (
              <button
                onClick={allHistory}
                onMouseEnter={allHistoryHover}
                className="secondary-button text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2"
              >
                <span className="hidden sm:inline">View History</span>
                <span className="sm:hidden">History</span>
              </button>
            )}
            {deleteAll && (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="danger-button text-xs sm:text-sm px-3 py-1.5 sm:px-4 sm:py-2"
              >
                <span className="hidden sm:inline">Clean Up</span>
                <span className="sm:hidden">Clean</span>
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {processedRows.length > 0 ? (
            <>
              {!showDividers ? (
                <div className="bg-white/70 backdrop-blur-sm rounded-xl shadow-sm border border-white/50 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200/30">
                        <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Case
                        </th>
                        <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          <span className="hidden sm:inline">Department</span>
                          <span className="sm:hidden">Dept</span>
                        </th>
                        <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                          Due
                        </th>
                        <th className="px-2 sm:px-5 py-2 sm:py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider w-10">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/30">
                      <ProgressiveRows
                        rows={allRowsFlat}
                        formatDate={formatDate}
                        completed={completed}
                        onEdit={onEdit}
                        toggleDone={toggleDone}
                        toggleHold={toggleHold}
                        toggleRush={toggleRush}
                        togglePriority={togglePriority}
                        toggleStage2={toggleStage2}
                        toggleNewAccount={toggleNewAccount}
                        removeCase={removeCase}
                        onArchive={handleArchiveFromMenu}
                        workflowMap={workflowMap}
                      />
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  {categorizedRows.overdue.length > 0 && (
                    <CollapsibleSection
                      title="Overdue Cases"
                      count={categorizedRows.overdue.length}
                      bgColor="bg-gray-300/70"
                      textColor="text-gray-800"
                      shadowColor="bg-gray-400/40"
                      rows={categorizedRows.overdue}
                      formatDate={formatDate}
                      completed={completed}
                      onEdit={onEdit}
                      toggleDone={toggleDone}
                      toggleHold={toggleHold}
                      toggleRush={toggleRush}
                      togglePriority={togglePriority}
                      toggleStage2={toggleStage2}
                      toggleNewAccount={toggleNewAccount}
                      removeCase={removeCase}
                      onArchive={handleArchiveFromMenu}
                      defaultExpanded={categorizedRows.overdue.length < 10}
                      forceOpen={forceOpen}
                      isOverdueSection={true}
                      workflowMap={workflowMap}
                    />
                  )}

                  {categorizedRows.priority.length > 0 && (
                    <CollapsibleSection
                      title="Priority Cases"
                      count={categorizedRows.priority.length}
                      bgColor="bg-red-200/70"
                      textColor="text-red-900"
                      shadowColor="bg-red-400/40"
                      rows={categorizedRows.priority}
                      formatDate={formatDate}
                      completed={completed}
                      onEdit={onEdit}
                      toggleDone={toggleDone}
                      toggleHold={toggleHold}
                      toggleRush={toggleRush}
                      togglePriority={togglePriority}
                      toggleStage2={toggleStage2}
                      toggleNewAccount={toggleNewAccount}
                      removeCase={removeCase}
                      onArchive={handleArchiveFromMenu}
                      defaultExpanded={true}
                      forceOpen={forceOpen}
                      workflowMap={workflowMap}
                    />
                  )}

                  {categorizedRows.rush.length > 0 && (
                    <CollapsibleSection
                      title="Rush Cases"
                      count={categorizedRows.rush.length}
                      bgColor="bg-orange-200/70"
                      textColor="text-orange-900"
                      shadowColor="bg-orange-400/40"
                      rows={categorizedRows.rush}
                      formatDate={formatDate}
                      completed={completed}
                      onEdit={onEdit}
                      toggleDone={toggleDone}
                      toggleHold={toggleHold}
                      toggleRush={toggleRush}
                      togglePriority={togglePriority}
                      toggleStage2={toggleStage2}
                      toggleNewAccount={toggleNewAccount}
                      removeCase={removeCase}
                      onArchive={handleArchiveFromMenu}
                      defaultExpanded={true}
                      forceOpen={forceOpen}
                      workflowMap={workflowMap}
                    />
                  )}

                  {categorizedRows.hold.length > 0 && (
                    <CollapsibleSection
                      title="On Hold"
                      count={categorizedRows.hold.length}
                      bgColor="bg-amber-200/70"
                      textColor="text-amber-900"
                      shadowColor="bg-amber-400/40"
                      rows={categorizedRows.hold}
                      formatDate={formatDate}
                      completed={completed}
                      onEdit={onEdit}
                      toggleDone={toggleDone}
                      toggleHold={toggleHold}
                      toggleRush={toggleRush}
                      togglePriority={togglePriority}
                      toggleStage2={toggleStage2}
                      toggleNewAccount={toggleNewAccount}
                      removeCase={removeCase}
                      onArchive={handleArchiveFromMenu}
                      defaultExpanded={true}
                      forceOpen={forceOpen}
                      workflowMap={workflowMap}
                    />
                  )}

                  {categorizedRows.regular.length > 0 && (
                    <div className="bg-white/70 backdrop-blur-sm rounded-xl shadow-sm border border-white/50 overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200/30">
                            <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Case
                            </th>
                            <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              <span className="hidden sm:inline">
                                Department
                              </span>
                              <span className="sm:hidden">Dept</span>
                            </th>
                            <th className="px-2 sm:px-5 py-2 sm:py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Due
                            </th>
                            <th className="px-2 sm:px-5 py-2 sm:py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider w-10">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200/30">
                          <ProgressiveRows
                            rows={categorizedRows.regular}
                            formatDate={formatDate}
                            completed={completed}
                            onEdit={onEdit}
                            toggleDone={toggleDone}
                            toggleHold={toggleHold}
                            toggleRush={toggleRush}
                            togglePriority={togglePriority}
                            toggleStage2={toggleStage2}
                            toggleNewAccount={toggleNewAccount}
                            removeCase={removeCase}
                            onArchive={handleArchiveFromMenu}
                            workflowMap={workflowMap}
                          />
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="bg-white/70 backdrop-blur-sm rounded-xl p-8 text-center border border-white/50">
              <p className="text-sm text-gray-500">{empty}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {completed && rows.length > 0 && (
          <div className="px-4 sm:px-5 py-3 border-t border-gray-200 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <div className="text-xs sm:text-sm text-gray-600">
                Showing {rows.length} completed case
                {rows.length !== 1 ? "s" : ""}
              </div>
              <button
                onClick={() => setShowArchive(true)}
                className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors group text-xs sm:text-sm"
              >
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600 group-hover:text-gray-700"
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
                <span className="font-medium">View Archive</span>
                {archiveCount > 0 && (
                  <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-gray-300 text-gray-700 rounded-full">
                    {searchQuery && archiveCount > 0
                      ? `${archiveCount} match`
                      : archiveCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </section>

      <ArchiveModal
        isOpen={showArchive}
        onClose={() => setShowArchive(false)}
        searchQuery={searchQuery}
      />
      {showDeleteModal && (
        <DeleteCompletedModal
          dates={dates}
          onDelete={deleteAll}
          onArchive={handleArchive}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </>
  );
});
