// /src/components/BoardMobile.jsx
// Workload-at-a-glance mobile view - styled to match desktop board
// Week calendar grid with heatmap, minimal scrolling, optimized for 20-30 cases

import React, {
  useState,
  useMemo,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import CaseHistory from "./CaseHistory";
import { iso } from "../utils/date";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const HEADER_HEIGHT = 56;

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

const split = (s = "") => {
  const txt = s
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim();
  const [id, ...rest] = txt.split(/\s+/);
  return [id, rest.join(" ")];
};

const getWeekdayShort = (d) =>
  d instanceof Date
    ? d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)
    : "";

const getDayNum = (d) => (d instanceof Date ? d.getDate() : "");

const formatDateFull = (d) =>
  d instanceof Date
    ? d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : "";

// Heatmap intensity based on case count (0-4 scale)
const getHeatLevel = (count) => {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
};

/* ═══════════════════════════════════════════════════════════════════════════
   SUMMARY BAR - Shows total workload at a glance
   ═══════════════════════════════════════════════════════════════════════════ */

function SummaryBar({ totalCases, overdueCount, priorityCount, todayCount }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-[#16525F] border-b border-white/10">
      <div className="flex items-center gap-3">
        <div className="text-white">
          <span className="text-xl font-bold">{totalCases}</span>
          <span className="text-xs text-white/60 ml-1">cases</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {overdueCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/20">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs font-medium text-red-300">
              {overdueCount}
            </span>
          </div>
        )}
        {priorityCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/20">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <span className="text-xs font-medium text-orange-300">
              {priorityCount}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/20">
          <span className="text-xs font-medium text-yellow-300">
            Today: {todayCount}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   META CELLS - Overdue & On Hold buttons
   ═══════════════════════════════════════════════════════════════════════════ */

function MetaCells({ overdue, hold, onSelect, selectedKey }) {
  const overdueLevel = getHeatLevel(overdue.length);
  const holdLevel = getHeatLevel(hold.length);

  return (
    <div className="flex gap-2 px-3 py-2">
      {/* Overdue button - uses bg-red-700 for theme compatibility */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelect(selectedKey === "overdue" ? null : "overdue")}
        className={clsx(
          "flex-1 rounded-lg p-3 transition-all",
          "bg-red-700", // Theme CSS overrides this
          selectedKey === "overdue" && "ring-2 ring-white"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span className="text-white font-medium text-sm">Overdue</span>
          </div>
          <div
            className={clsx(
              "min-w-[28px] h-7 rounded-full flex items-center justify-center",
              "bg-white/20 text-white font-bold text-sm"
            )}
          >
            {overdue.length}
          </div>
        </div>
      </motion.button>

      {/* On Hold button - uses bg-amber-700 for theme compatibility */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelect(selectedKey === "hold" ? null : "hold")}
        className={clsx(
          "flex-1 rounded-lg p-3 transition-all",
          "bg-amber-700", // Theme CSS overrides this
          selectedKey === "hold" && "ring-2 ring-white"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⏸️</span>
            <span className="text-white font-medium text-sm">On Hold</span>
          </div>
          <div
            className={clsx(
              "min-w-[28px] h-7 rounded-full flex items-center justify-center",
              "bg-white/20 text-white font-bold text-sm"
            )}
          >
            {hold.length}
          </div>
        </div>
      </motion.button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEEK CALENDAR GRID - 7 days in a row with heatmap
   ═══════════════════════════════════════════════════════════════════════════ */

function WeekGrid({ horizon, map, today, selectedKey, onSelect }) {
  return (
    <div className="px-3 py-2">
      <div className="grid grid-cols-7 gap-1">
        {horizon.map((date) => {
          const dateKey = iso(date);
          const isToday = dateKey === iso(today);
          const rows = map[dateKey] || [];
          const count = rows.length;
          const heatLevel = getHeatLevel(count);
          const isSelected = selectedKey === dateKey;
          const hasPriority = rows.some((r) => r.priority);
          const hasRush = rows.some((r) => r.rush && !r.priority);

          return (
            <motion.button
              key={dateKey}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSelect(isSelected ? null : dateKey)}
              className={clsx(
                "relative flex flex-col items-center py-2 rounded-lg transition-all",
                // Use theme-compatible classes
                isToday ? "bg-yellow-100" : "bg-[#16525F]",
                isSelected && "ring-2 ring-white",
                // Heat intensity via opacity overlay
                !isToday && heatLevel >= 3 && "brightness-125",
                !isToday && heatLevel >= 4 && "brightness-150"
              )}
            >
              {/* Day abbreviation */}
              <span
                className={clsx(
                  "text-[10px] font-medium uppercase",
                  isToday ? "text-gray-600" : "text-white/60"
                )}
              >
                {getWeekdayShort(date)}
              </span>

              {/* Day number */}
              <span
                className={clsx(
                  "text-lg font-bold leading-tight",
                  isToday ? "text-gray-800" : "text-white"
                )}
              >
                {getDayNum(date)}
              </span>

              {/* Case count badge */}
              {count > 0 && (
                <div
                  className={clsx(
                    "mt-1 min-w-[20px] h-5 px-1 rounded-full flex items-center justify-center",
                    "text-[10px] font-bold",
                    isToday
                      ? "bg-gray-800/20 text-gray-700"
                      : "bg-white/20 text-white"
                  )}
                >
                  {count}
                </div>
              )}

              {/* Priority/Rush indicator dot */}
              {(hasPriority || hasRush) && (
                <div
                  className={clsx(
                    "absolute top-1 right-1 w-2 h-2 rounded-full",
                    hasPriority ? "bg-red-400" : "bg-orange-400"
                  )}
                />
              )}

              {/* Today indicator */}
              {isToday && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-yellow-500" />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DETAIL PANEL - Shows case list for selected day/category
   ═══════════════════════════════════════════════════════════════════════════ */

function DetailPanel({
  selectedKey,
  rows,
  title,
  icon,
  isOverdue,
  isHold,
  isToday,
  onClose,
  toggleComplete,
  toggleStage2,
  toggleHold,
  stage,
  updateCaseStage,
  onShowHistory,
}) {
  const [expandedRowId, setExpandedRowId] = useState(null);

  // Get background class based on type - theme compatible
  const bgClass = isOverdue
    ? "bg-red-700"
    : isHold
    ? "bg-amber-700"
    : isToday
    ? "bg-yellow-100"
    : "bg-[#16525F]";

  const textClass = isToday ? "text-gray-800" : "text-white";

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
      className={clsx(
        "absolute inset-x-0 bottom-0 rounded-t-2xl shadow-2xl overflow-hidden",
        bgClass
      )}
      style={{ maxHeight: "70vh" }}
    >
      {/* Header */}
      <div
        className={clsx(
          "flex items-center justify-between px-4 py-3 border-b",
          isToday ? "border-black/10" : "border-white/10"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className={clsx("font-semibold", textClass)}>{title}</span>
          <span
            className={clsx(
              "px-2 py-0.5 rounded-full text-xs font-bold",
              isToday
                ? "bg-gray-800/20 text-gray-700"
                : "bg-white/20 text-white"
            )}
          >
            {rows.length}
          </span>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center",
            isToday ? "bg-black/10 text-gray-600" : "bg-white/10 text-white"
          )}
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </motion.button>
      </div>

      {/* Case list */}
      <div
        className="overflow-y-auto p-3"
        style={{ maxHeight: "calc(70vh - 60px)" }}
      >
        {rows.length > 0 ? (
          rows.map((row, idx) => (
            <CaseRowMobile
              key={row.id}
              row={row}
              index={idx}
              isExpanded={expandedRowId === row.id}
              onToggle={(id) =>
                setExpandedRowId(expandedRowId === id ? null : id)
              }
              toggleComplete={toggleComplete}
              toggleStage2={toggleStage2}
              toggleHold={toggleHold}
              stage={stage}
              updateCaseStage={updateCaseStage}
              isOverdue={isOverdue}
              isHold={isHold}
              onShowHistory={onShowHistory}
            />
          ))
        ) : (
          <div
            className={clsx(
              "flex flex-col items-center justify-center py-8",
              textClass
            )}
          >
            <span className="text-3xl mb-2">
              {isOverdue ? "🎉" : isHold ? "📭" : "✨"}
            </span>
            <span className="text-sm opacity-60">
              {isOverdue
                ? "All caught up!"
                : isHold
                ? "Nothing held"
                : "No cases"}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CASE ROW - Uses same styling as desktop RowShell
   ═══════════════════════════════════════════════════════════════════════════ */

function CaseRowMobile({
  row,
  index,
  isExpanded,
  onToggle,
  toggleComplete,
  toggleStage2,
  toggleHold,
  stage,
  updateCaseStage,
  isOverdue,
  isHold,
  onShowHistory,
}) {
  const [num, desc] = split(row.caseNumber);
  const isPriority = row?.priority;
  const isRush = row?.rush;
  const isBBS = row?.modifiers?.includes("bbs");
  const isFlex = row?.modifiers?.includes("flex");
  const isStage2 = row?.modifiers?.includes("stage2");
  const isNewAccount = row?.modifiers?.includes("newaccount");
  const isInQC = row?.modifiers?.includes("stage-qc");

  const hasStageButtons = stage && row.department === "General" && !isInQC;
  const hasQCButtons = !stage && row.department === "General" && isInQC;
  const hasStage2Button = row.department === "Metal" && !isStage2;

  // Use same background classes as RowShell in animationEngine.js
  let rowBgClass = "bg-[#4D8490]";
  if (isStage2) rowBgClass = "bg-[#6F5BA8]";
  else if (isBBS) rowBgClass = "bg-[#55679B]";
  else if (isFlex) rowBgClass = "bg-[#C75A9E]";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className={clsx(
        "rounded-lg overflow-hidden mb-2",
        rowBgClass,
        // Same ring classes as RowShell
        isPriority && "ring-[3px] ring-red-500",
        isRush && !isPriority && "ring-[3px] ring-orange-400"
      )}
      onClick={() => onToggle(row.id)}
    >
      {/* Main row content */}
      <div className="flex items-center px-3 py-2.5">
        {/* Priority/Rush indicator */}
        {(isPriority || isRush) && (
          <div
            className={clsx(
              "w-1.5 h-4 rounded-full mr-2.5 flex-shrink-0",
              isPriority ? "bg-red-400" : "bg-orange-400"
            )}
          />
        )}

        {/* Case info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-white">
              {num}
            </span>
            {isBBS && <Tag label="BBS" color="blue" />}
            {isFlex && <Tag label="FX" color="pink" />}
            {isStage2 && <Tag label="S2" color="purple" />}
            {isNewAccount && <Tag label="NEW" gradient />}
          </div>
          {desc && (
            <span className="text-xs text-white/70 truncate block mt-0.5">
              {desc}
            </span>
          )}
        </div>

        {/* Expand indicator */}
        <motion.svg
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="w-4 h-4 text-white/40 ml-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </motion.svg>
      </div>

      {/* Expanded actions — layout prop drives height via GPU transform (FLIP),
          avoiding JS-driven height:0→auto which triggers layout every frame. */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            layout
          >
            <div className="flex flex-wrap gap-1.5 px-3 py-2.5 bg-black/15 border-t border-white/10">
              {/* Info button */}
              <ActionBtn
                label="Info"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowHistory(row);
                }}
              />

              {/* Stage buttons for Digital department */}
              {hasStageButtons && stage === "design" && (
                <>
                  <ActionBtn
                    label="Next →"
                    theme="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "production");
                    }}
                  />
                  <ActionBtn
                    label="Repair"
                    theme="amber"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "finishing", true);
                    }}
                  />
                </>
              )}
              {hasStageButtons && stage === "production" && (
                <>
                  <ActionBtn
                    label="← Prev"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "design");
                    }}
                  />
                  <ActionBtn
                    label="Next →"
                    theme="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "finishing");
                    }}
                  />
                </>
              )}
              {hasStageButtons && stage === "finishing" && (
                <>
                  <ActionBtn
                    label="← Prev"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "production");
                    }}
                  />
                  <ActionBtn
                    label="QC →"
                    theme="green"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "qc");
                    }}
                  />
                </>
              )}

              {/* QC buttons */}
              {hasQCButtons && (
                <>
                  <ActionBtn
                    label="← Prev"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateCaseStage(row, "finishing");
                    }}
                  />
                  <ActionBtn
                    label="Done"
                    theme="green"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleComplete(row.id, row.completed);
                    }}
                  />
                </>
              )}

              {/* Metal Stage 2 */}
              {hasStage2Button && (
                <ActionBtn
                  label="Stage 2"
                  theme="purple"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStage2(row);
                  }}
                />
              )}

              {/* Release button for hold */}
              {isHold && (
                <ActionBtn
                  label="Release"
                  theme="amber"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHold(row.id, true);
                  }}
                />
              )}

              {/* Done button */}
              {!hasStageButtons && !hasQCButtons && !isHold && (
                <ActionBtn
                  label="Done"
                  theme={isOverdue ? "red" : "green"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleComplete(row.id, row.completed);
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL UI COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

function Tag({ label, color, gradient }) {
  const colors = {
    blue: "bg-blue-500/80",
    pink: "bg-pink-500/80",
    purple: "bg-purple-500/80",
  };

  return (
    <span
      className={clsx(
        "text-[9px] text-white px-1.5 py-0.5 rounded font-semibold",
        gradient ? "bg-gradient-to-r from-pink-500 to-cyan-400" : colors[color]
      )}
    >
      {label}
    </span>
  );
}

function ActionBtn({ label, theme = "gray", onClick }) {
  // Use same frosted glass style as RevealButton in animationEngine.js
  const themes = {
    gray: "backdrop-blur-md bg-white/35 ring-1 ring-white/30 text-white hover:bg-white/40",
    blue: "bg-blue-500 text-white hover:bg-blue-600",
    green: "bg-emerald-500 text-white hover:bg-emerald-600",
    red: "bg-red-500 text-white hover:bg-red-600",
    amber: "bg-amber-500 text-white hover:bg-amber-600",
    purple: "bg-purple-500 text-white hover:bg-purple-600",
  };

  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 py-1.5 rounded text-xs font-semibold transition-colors",
        themes[theme]
      )}
    >
      {label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUICK OVERVIEW - Shows when no day is selected
   ═══════════════════════════════════════════════════════════════════════════ */

function QuickOverview({ horizon, map, today, overdue, hold, onSelect }) {
  const todayKey = iso(today);
  const todayRows = map[todayKey] || [];

  // Find busiest days
  const dayLoads = horizon
    .map((date) => ({
      date,
      key: iso(date),
      count: (map[iso(date)] || []).length,
      isToday: iso(date) === todayKey,
    }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
      {/* Today highlight */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="text-center mb-6"
      >
        <div className="text-white/60 text-xs uppercase tracking-wider mb-1">
          Today
        </div>
        <div className="text-5xl font-bold text-white mb-1">
          {todayRows.length}
        </div>
        <div className="text-white/60 text-sm">
          {todayRows.length === 1 ? "case" : "cases"}
        </div>
        {todayRows.length > 0 && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(todayKey)}
            className="mt-3 px-4 py-2 rounded-full bg-yellow-100 text-gray-800 text-sm font-medium"
          >
            View today's cases →
          </motion.button>
        )}
      </motion.div>

      {/* Busiest days */}
      {dayLoads.length > 0 && (
        <div className="w-full max-w-xs">
          <div className="text-white/40 text-xs uppercase tracking-wider mb-2 text-center">
            Busiest days
          </div>
          <div className="space-y-2">
            {dayLoads.map(({ date, key, count, isToday }) => (
              <motion.button
                key={key}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelect(key)}
                className={clsx(
                  "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                  isToday ? "bg-yellow-100" : "bg-white/10"
                )}
              >
                <span
                  className={clsx(
                    "text-sm font-medium",
                    isToday ? "text-gray-800" : "text-white"
                  )}
                >
                  {isToday ? "Today" : getWeekdayShort(date)}
                </span>
                <span
                  className={clsx(
                    "text-sm font-bold",
                    isToday ? "text-gray-600" : "text-white/70"
                  )}
                >
                  {count} {count === 1 ? "case" : "cases"}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Tap hint */}
      <div className="mt-6 text-white/30 text-xs text-center">
        Tap a day above to see cases
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */

export default function BoardMobile({
  today,
  horizon,
  overdue,
  hold,
  map,
  toggleComplete,
  toggleStage2,
  toggleHold,
  stage,
  stageConfig,
  updateCaseStage,
}) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [showHistory, setShowHistory] = useState(null);

  // Calculate totals
  const totalCases = useMemo(() => {
    let total = (overdue?.length || 0) + (hold?.length || 0);
    horizon.forEach((date) => {
      total += (map[iso(date)] || []).length;
    });
    return total;
  }, [overdue, hold, horizon, map]);

  const priorityCount = useMemo(() => {
    let count = 0;
    const countPriority = (rows) => rows?.filter((r) => r.priority).length || 0;
    count += countPriority(overdue);
    count += countPriority(hold);
    horizon.forEach((date) => {
      count += countPriority(map[iso(date)]);
    });
    return count;
  }, [overdue, hold, horizon, map]);

  const todayKey = iso(today);
  const todayCount = (map[todayKey] || []).length;

  // Get selected rows and metadata
  const selectedData = useMemo(() => {
    if (!selectedKey) return null;

    if (selectedKey === "overdue") {
      return {
        rows: overdue || [],
        title: "Overdue",
        icon: "⚠️",
        isOverdue: true,
        isHold: false,
        isToday: false,
      };
    }

    if (selectedKey === "hold") {
      return {
        rows: hold || [],
        title: "On Hold",
        icon: "⏸️",
        isOverdue: false,
        isHold: true,
        isToday: false,
      };
    }

    // It's a date key
    const date = horizon.find((d) => iso(d) === selectedKey);
    const isToday = selectedKey === todayKey;

    return {
      rows: map[selectedKey] || [],
      title: date ? formatDateFull(date) : selectedKey,
      icon: isToday ? "📅" : "📆",
      isOverdue: false,
      isHold: false,
      isToday,
    };
  }, [selectedKey, overdue, hold, map, horizon, todayKey]);

  return (
    <>
      {/* Main container - uses bg-[#16525F] for theme compatibility */}
      <div
        className="fixed inset-0 z-40 flex flex-col bg-[#16525F]"
        style={{ top: HEADER_HEIGHT }}
      >
        {/* Summary bar */}
        <SummaryBar
          totalCases={totalCases}
          overdueCount={overdue?.length || 0}
          priorityCount={priorityCount}
          todayCount={todayCount}
        />

        {/* Meta cells (Overdue & Hold) */}
        <MetaCells
          overdue={overdue || []}
          hold={hold || []}
          onSelect={setSelectedKey}
          selectedKey={selectedKey}
        />

        {/* Week calendar grid */}
        <WeekGrid
          horizon={horizon}
          map={map}
          today={today}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
        />

        {/* Quick overview or detail panel */}
        {!selectedKey ? (
          <QuickOverview
            horizon={horizon}
            map={map}
            today={today}
            overdue={overdue || []}
            hold={hold || []}
            onSelect={setSelectedKey}
          />
        ) : null}

        {/* Detail panel (slides up) */}
        <AnimatePresence>
          {selectedKey && selectedData && (
            <DetailPanel
              selectedKey={selectedKey}
              rows={selectedData.rows}
              title={selectedData.title}
              icon={selectedData.icon}
              isOverdue={selectedData.isOverdue}
              isHold={selectedData.isHold}
              isToday={selectedData.isToday}
              onClose={() => setSelectedKey(null)}
              toggleComplete={toggleComplete}
              toggleStage2={toggleStage2}
              toggleHold={toggleHold}
              stage={stage}
              updateCaseStage={updateCaseStage}
              onShowHistory={setShowHistory}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Case history modal */}
      {showHistory && (
        <CaseHistory
          id={showHistory.id}
          caseNumber={showHistory.caseNumber}
          onClose={() => setShowHistory(null)}
        />
      )}
    </>
  );
}
