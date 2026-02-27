import React, { useState, useLayoutEffect, useRef, useEffect } from "react";
import {
  ColumnShell,
  ColumnHeader,
  RowShell,
  RevealButton,
  SPRING,
} from "../animationEngine";
import { AnimatePresence, motion } from "motion/react";
import CaseHistory from "./CaseHistory";
import clsx from "clsx";
import { db, logCase } from "../services/caseService";
import { useMut } from "../context/DataContext";

const split = (s = "") => {
  const txt = s
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim();
  const [id, ...rest] = txt.split(/\s+/);
  return [id, rest.join(" ")];
};

const ChainLinkIcon = ({ className = "" }) => (
  <svg
    className={className}
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const StageDivider = ({ label, delay = 0 }) => (
  <motion.div
    layout
    initial={{ opacity: 0, scaleX: 0 }}
    animate={{
      opacity: 1,
      scaleX: 1,
      transition: {
        opacity: { duration: 0.2, delay },
        scaleX: { duration: 0.25, delay, ease: "easeOut" },
      },
    }}
    exit={{
      opacity: 0,
      scaleX: 0,
      transition: { opacity: { duration: 0.1 }, scaleX: { duration: 0.15 } },
    }}
    className="relative my-2 flex items-center"
  >
    <div className="flex-1 h-px bg-white/20" />
    <span className="px-2 text-[10px] font-medium text-white/50 uppercase tracking-wider">
      {label}
    </span>
    <div className="flex-1 h-px bg-white/20" />
  </motion.div>
);

const ReleasePopover = ({ caseItem, onConfirm, onCancel, anchorRect }) => {
  const [num, descFromSplit] = split(caseItem.caseNumber);
  const [caseNumber, setCaseNumber] = useState(num);
  const [handles, setHandles] = useState(descFromSplit);
  const [dueDate, setDueDate] = useState(
    caseItem.due ? new Date(caseItem.due).toISOString().split("T")[0] : ""
  );
  const todayISO = (() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const isPastDue = () => {
    if (!dueDate) return false;
    const [year, month, day] = dueDate.split("-").map(Number);
    const dueDateTime = new Date(year, month - 1, day);
    const today = new Date();
    const todayMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );
    return dueDateTime < todayMidnight;
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target))
        onCancel();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onCancel]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  useEffect(() => {
    if (anchorRect && popoverRef.current) {
      const pH = popoverRef.current.offsetHeight;
      const pW = popoverRef.current.offsetWidth;
      const vH = window.innerHeight;
      const vW = window.innerWidth;
      let top = anchorRect.bottom + 8;
      let left = anchorRect.right - pW;
      if (top + pH > vH - 20) top = anchorRect.top - pH - 8;
      if (left < 20) left = anchorRect.left;
      if (left + pW > vW - 20) left = vW - pW - 20;
      setPosition({ top, left });
    }
  }, [anchorRect]);

  const handleRelease = (e) => {
    e.stopPropagation();
    onConfirm({
      caseNumber: handles ? `${caseNumber} ${handles}` : caseNumber,
      due: dueDate,
    });
  };

  const arrowLeft = anchorRect
    ? anchorRect.left + anchorRect.width / 2 - position.left - 8
    : 0;

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: -5, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -5, scale: 0.95 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[9999] w-64 rounded-xl bg-white shadow-xl border border-gray-200"
      style={{
        top: position.top,
        left: position.left,
        boxShadow:
          "0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.08)",
      }}
    >
      <div
        className="absolute -top-2 w-4 h-4 bg-white border-l border-t border-gray-200 transform rotate-45"
        style={{ left: Math.max(12, Math.min(arrowLeft, 230)) }}
      />
      <div className="relative px-3 pt-3 pb-2 border-b border-gray-100 bg-white rounded-t-xl">
        <p className="text-xs font-medium text-gray-500">
          Edit before releasing?
        </p>
      </div>
      <div className="relative p-3 space-y-3 bg-white">
        <div className="flex gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">
              Case #
            </label>
            <input
              type="text"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="w-full px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 text-sm font-mono placeholder-gray-400 focus:outline-none focus:border-[rgba(22,82,95,0.4)] focus:ring-2 focus:ring-[rgba(22,82,95,0.08)] transition-all"
              placeholder="12345"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">
              Notes
            </label>
            <div className="relative">
              <input
                type="text"
                value={handles}
                onChange={(e) => setHandles(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-full px-2.5 py-1.5 pr-7 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:border-[rgba(22,82,95,0.4)] focus:ring-2 focus:ring-[rgba(22,82,95,0.08)] transition-all"
                placeholder="Optional"
              />
              {handles && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHandles("");
                  }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">
            Due Date
          </label>
          <input
            type="date"
            min={todayISO}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value && e.target.value < todayISO ? todayISO : e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className={clsx(
              "w-full px-2.5 py-1.5 rounded-lg border text-sm focus:outline-none transition-all",
              isPastDue()
                ? "bg-red-50 border-red-300 text-red-700 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                : "bg-gray-50 border-gray-200 text-gray-800 focus:border-[rgba(22,82,95,0.4)] focus:ring-2 focus:ring-[rgba(22,82,95,0.08)]"
            )}
          />
          {isPastDue() && (
            <p className="mt-1 text-[10px] font-medium text-red-500">
              This date is past due
            </p>
          )}
        </div>
      </div>
      <div className="relative px-3 pb-3 flex gap-2 bg-white rounded-b-xl">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="flex-1 px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-200 hover:border-gray-300 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleRelease}
          className="flex-1 px-3 py-1.5 rounded-lg bg-[#16525F] hover:bg-[#1F6F7C] text-white text-sm font-medium transition-all hover:translate-y-[-1px] shadow-[0_1px_3px_rgba(22,82,95,0.3)] hover:shadow-[0_4px_12px_rgba(22,82,95,0.25)]"
        >
          Release
        </button>
      </div>
    </motion.div>
  );
};

const getStageFromModifiers = (mods = []) => {
  if (mods?.includes("stage-qc")) return "qc";
  if (mods?.includes("stage-finishing")) return "finishing";
  if (mods?.includes("stage-production")) return "production";
  if (mods?.includes("stage-design")) return "design";
  return "design";
};

const groupRowsByStage = (rows) => {
  const groups = {
    design: [],
    production: [],
    finishing: [],
    qc: [],
    other: [],
  };
  rows.forEach((row) => {
    if (row.department === "General" && !row.completed)
      groups[getStageFromModifiers(row.modifiers)].push(row);
    else if (row.department === "Metal" && !row.completed)
      groups.other.push(row);
    else groups.other.push(row);
  });
  return groups;
};

const groupMetalRowsByStage = (rows) => {
  const groups = { development: [], finishing: [], other: [] };
  rows.forEach((row) => {
    if (row.department === "Metal" && !row.completed) {
      if (!row.stage2) groups.development.push(row);
      else groups.finishing.push(row);
    } else groups.other.push(row);
  });
  return groups;
};

const chainHasPending = (workflowStatus) => {
  if (!workflowStatus || !workflowStatus.chain) return false;
  const { chain } = workflowStatus;
  for (let i = 1; i < chain.length; i++) {
    const upstreamComplete = chain.slice(0, i).every((c) => c.completed);
    if (!upstreamComplete) return true;
  }
  return false;
};

const linkedDeptLabel = (workflowStatus, currentId) => {
  if (!workflowStatus || !workflowStatus.chain) return "";
  const depts = [
    ...new Set(
      workflowStatus.chain
        .filter((c) => c.id !== currentId)
        .map((c) => (c.department === "General" ? "Digital" : c.department))
    ),
  ];
  return depts.join(", ");
};

const fmtCompleteDate = (r) => {
  const raw = r.completed_at || r.updated_at;
  if (!raw) return "Complete";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "Complete";
  return `Done ${d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
};

const ButtonPanel = ({
  color,
  needsStackedButtons,
  hasStageButtons,
  hasQCButtons,
  hasStage2Button,
  stage,
  row,
  onHold,
  onInfoClick,
  onStageAction,
  onComplete,
  onRelease,
  onStage2,
  onUnlink,
  showingPopover,
  isWorkflowPending,
  isInWorkflow,
  workflowStatus,
}) => {
  const showChainIcon = isInWorkflow && chainHasPending(workflowStatus);

  return (
    <div className="ml-auto flex gap-2 pr-1 items-center flex-shrink-0">
      <RevealButton
        open
        label={
          <span className="font-serif italic font-bold text-xs px-1">i</span>
        }
        theme="gray"
        small
        onClick={onInfoClick}
      />

      {isWorkflowPending ? (
        <div className="flex flex-col gap-1.5 items-center">
          {showChainIcon && (
            <RevealButton
              open
              label={
                <span className="flex items-center gap-1">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    <path d="M4 20L20 4" />
                  </svg>
                  Unlink
                </span>
              }
              theme="gray"
              onClick={(e) => {
                e.stopPropagation();
                onUnlink();
              }}
            />
          )}
        </div>
      ) : (
        <div
          className={clsx(
            "flex",
            needsStackedButtons ? "flex-col gap-1.5" : "flex-row gap-2"
          )}
        >
          {hasStageButtons && (
            <>
              {stage === "design" && (
                <>
                  <RevealButton
                    open
                    label="Next →"
                    theme="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("production");
                    }}
                  />
                  <RevealButton
                    open
                    label="Repair"
                    theme="amber"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("finishing", true);
                    }}
                  />
                </>
              )}
              {stage === "production" && (
                <>
                  <RevealButton
                    open
                    label="Next →"
                    theme="blue"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("finishing");
                    }}
                  />
                  <RevealButton
                    open
                    label="← Prev"
                    theme="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("design");
                    }}
                  />
                </>
              )}
              {stage === "finishing" && (
                <>
                  <RevealButton
                    open
                    label="QC →"
                    theme="green"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("qc");
                    }}
                  />
                  <RevealButton
                    open
                    label="← Prev"
                    theme="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStageAction("production");
                    }}
                  />
                </>
              )}
            </>
          )}
          {hasQCButtons && (
            <>
              <RevealButton
                open
                label="Done"
                theme="green"
                onClick={(e) => {
                  e.stopPropagation();
                  onComplete();
                }}
              />
              <RevealButton
                open
                label="← Prev"
                theme="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  onStageAction("finishing");
                }}
              />
            </>
          )}
          {(row.department !== "General" ||
            onHold ||
            (!stage && !row.modifiers?.includes("stage-qc"))) && (
            <RevealButton
              open
              label={onHold ? "Release" : "Done"}
              theme={onHold ? "amber" : color === "red" ? "red" : "green"}
              onClick={(e) => {
                e.stopPropagation();
                if (onHold) onRelease(e);
                else onComplete();
              }}
            />
          )}
          {hasStage2Button && (
            <RevealButton
              open
              label="Stage 2"
              theme="purple"
              onClick={(e) => {
                e.stopPropagation();
                onStage2();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default function MetaCol({
  title,
  color,
  rows = [],
  today,
  onHold = false,
  hideHeader = false,
  toggleComplete,
  toggleHold,
  toggleStage2,
  stage,
  stageConfig,
  updateCaseStage,
  showStageDividers = false,
}) {
  const [active, setActive] = useState(null);
  const [closing, setClosing] = useState(null);
  const [showHistory, setShowHistory] = useState(null);
  const [releasePopover, setReleasePopover] = useState(null);
  const [releaseButtonRect, setReleaseButtonRect] = useState(null);
  const [dividersReady, setDividersReady] = useState(false);
  const contentKeyRef = useRef(0);

  const { workflowMap, unlinkFromWorkflow } = useMut();

  useLayoutEffect(() => {
    contentKeyRef.current++;
  }, [rows.length]);

  useLayoutEffect(() => {
    if (showStageDividers) {
      setDividersReady(false);
      const timer = setTimeout(() => setDividersReady(true), 450);
      return () => clearTimeout(timer);
    } else {
      setDividersReady(false);
    }
  }, [showStageDividers, contentKeyRef.current]);

  const handleRowClick = (rowId, isCurrentlyOpen) => {
    if (releasePopover?.id === rowId) return;
    if (isCurrentlyOpen) {
      setClosing(rowId);
      setTimeout(() => {
        setActive(null);
        setClosing(null);
      }, 150);
    } else {
      if (active) {
        setClosing(active);
        setTimeout(() => {
          setActive(rowId);
          setClosing(null);
        }, 150);
      } else setActive(rowId);
    }
    setReleasePopover(null);
    setReleaseButtonRect(null);
  };

  const handleCancel = () => {
    setReleasePopover(null);
    setReleaseButtonRect(null);
    if (active) {
      setClosing(active);
      setTimeout(() => {
        setActive(null);
        setClosing(null);
      }, 150);
    }
  };

  const handleReleaseConfirm = async (updates) => {
    if (!releasePopover) return;
    const { id, modifiers = [] } = releasePopover;
    const originalCaseNumber = releasePopover.caseNumber;
    const originalDue = releasePopover.due
      ? new Date(releasePopover.due).toISOString().split("T")[0]
      : "";
    const hasChanges =
      updates.caseNumber !== originalCaseNumber || updates.due !== originalDue;
    if (hasChanges) {
      const updatePayload = {
        casenumber: updates.caseNumber.trim(),
        due: `${updates.due}T00:00:00Z`,
      };
      const { error } = await db
        .from("cases")
        .update(updatePayload)
        .eq("id", id);
      if (error) console.error("Error updating case:", error);
      else {
        if (updates.caseNumber !== originalCaseNumber)
          await logCase(
            id,
            `Case # changed from ${originalCaseNumber} to ${updates.caseNumber}`
          );
        if (updates.due !== originalDue)
          await logCase(
            id,
            `Due date changed from ${originalDue} to ${updates.due}`
          );
      }
    }
    const newModifiers = modifiers.filter((m) => m !== "hold");
    const { error: holdError } = await db
      .from("cases")
      .update({ modifiers: newModifiers })
      .eq("id", id);
    if (!holdError) await logCase(id, "hold removed");
    setReleasePopover(null);
    setReleaseButtonRect(null);
    setActive(null);
    setClosing(null);
  };

  const renderContent = () => {
    if (!showStageDividers || rows.length === 0) return renderRows(rows);
    const hasDigital = rows.some(
      (r) => r.department === "General" && !r.completed
    );
    const hasMetal = rows.some((r) => r.department === "Metal" && !r.completed);
    if (hasDigital) {
      const groups = groupRowsByStage(rows);
      let di = 0;
      return (
        <>
          {groups.design.length > 0 && (
            <>
              {dividersReady && (
                <StageDivider label="Design" delay={di++ * 0.03} />
              )}
              {renderRows(groups.design)}
            </>
          )}
          {groups.production.length > 0 && (
            <>
              {dividersReady && (
                <StageDivider label="Production" delay={di++ * 0.03} />
              )}
              {renderRows(groups.production)}
            </>
          )}
          {groups.finishing.length > 0 && (
            <>
              {dividersReady && (
                <StageDivider label="Finishing" delay={di++ * 0.03} />
              )}
              {renderRows(groups.finishing)}
            </>
          )}
          {groups.qc.length > 0 && (
            <>
              {dividersReady && <StageDivider label="QC" delay={di++ * 0.03} />}
              {renderRows(groups.qc)}
            </>
          )}
          {groups.other.length > 0 && renderRows(groups.other)}
        </>
      );
    } else if (hasMetal) {
      const groups = groupMetalRowsByStage(rows);
      let di = 0;
      return (
        <>
          {groups.development.length > 0 && (
            <>
              {dividersReady && (
                <StageDivider label="Development" delay={di++ * 0.03} />
              )}
              {renderRows(groups.development)}
            </>
          )}
          {groups.finishing.length > 0 && (
            <>
              {dividersReady && (
                <StageDivider label="Finishing" delay={di++ * 0.03} />
              )}
              {renderRows(groups.finishing)}
            </>
          )}
          {groups.other.length > 0 && renderRows(groups.other)}
        </>
      );
    }
    return renderRows(rows);
  };

  const renderRows = (rowsToRender) => {
    return rowsToRender.map((r) => {
      const isOpen = r.id === active;
      const isClosing_ = r.id === closing;
      const showExpanded = isOpen || isClosing_;
      const showButtons = isOpen && !isClosing_;

      const [num, desc] = split(r.caseNumber);
      const isStage2 = r.modifiers?.includes("stage2");
      const isInQC = r.modifiers?.includes("stage-qc");
      const showingPopover = releasePopover?.id === r.id;

      const workflowStatus = workflowMap?.get(r.id);
      const isWorkflowPending = workflowStatus?.isPending ?? false;
      const isInWorkflow = !!workflowStatus;
      const showChainIcon = isInWorkflow && chainHasPending(workflowStatus);

      const days = countDays(r, onHold, today);
      const isOverTwoWeeks = onHold && days >= 14;

      const hasStage2Button =
        r.department === "Metal" && !onHold && !isStage2 && !isWorkflowPending;
      const hasStageButtons =
        stage &&
        r.department === "General" &&
        !onHold &&
        !isInQC &&
        !isWorkflowPending;
      const hasQCButtons =
        !stage &&
        r.department === "General" &&
        isInQC &&
        !onHold &&
        !isWorkflowPending;
      const needsStackedButtons =
        hasStage2Button || hasStageButtons || hasQCButtons || isWorkflowPending;

      const pendingTextCls = isWorkflowPending ? "opacity-50" : "";

      const workflowLabel = showChainIcon
        ? isWorkflowPending
          ? `waiting on ${workflowStatus.upstreamCases
              .map((c) =>
                c.department === "General" ? "Digital" : c.department
              )
              .join(", ")}`
          : linkedDeptLabel(workflowStatus, r.id)
        : "";

      return (
        <RowShell
          key={r.id}
          row={r}
          open={showExpanded}
          metaColor={color}
          onClick={() => handleRowClick(r.id, isOpen)}
          workflowPending={isWorkflowPending}
        >
          {/* ── Collapsed ── */}
          {!showExpanded && (
            <>
              <div className="flex flex-col justify-center min-w-0 flex-1">
                <div
                  className={clsx("flex items-center gap-1.5", pendingTextCls)}
                >
                  <span className="font-mono leading-tight">{num}</span>
                  {showChainIcon && (
                    <span className="inline-flex items-center gap-1 text-[9px] leading-none text-white/45">
                      <ChainLinkIcon className="w-2.5 h-2.5" />
                      <span>
                        {isWorkflowPending
                          ? workflowStatus.upstreamCases
                              .map((c) =>
                                c.department === "General"
                                  ? "Digital"
                                  : c.department
                              )
                              .join(", ")
                          : linkedDeptLabel(workflowStatus, r.id)}
                      </span>
                    </span>
                  )}
                </div>
                {desc && (
                  <span
                    className={clsx(
                      "mt-0.5 text-xs leading-tight text-white/80",
                      pendingTextCls
                    )}
                  >
                    {desc}
                  </span>
                )}
              </div>

              <div className="flex-shrink-0 flex items-center pr-2 pl-2">
                {r.completed ? (
                  <span className="whitespace-nowrap text-[11px] leading-none text-white/70 italic">
                    {fmtCompleteDate(r)}
                  </span>
                ) : (
                  <span
                    className={clsx(
                      "whitespace-nowrap text-sm leading-none",
                      isOverTwoWeeks
                        ? "text-red-400 flash-hold-days font-semibold"
                        : "text-white/70"
                    )}
                  >
                    {days}d
                  </span>
                )}
              </div>
            </>
          )}

          {/* ── Expanded ── */}
          {showExpanded && (
            <div className="flex flex-col flex-1 min-w-0">
              {/* Top row: case info left, buttons right */}
              <div className="flex items-center">
                <div
                  className={clsx(
                    "flex flex-col justify-center flex-1 min-w-0",
                    pendingTextCls
                  )}
                >
                  <span className="font-mono leading-tight">{num}</span>
                  {desc && (
                    <span className="mt-0.5 text-xs leading-tight text-white/80">
                      {desc}
                    </span>
                  )}
                </div>

                {showButtons && (
                  <ButtonPanel
                    color={color}
                    needsStackedButtons={needsStackedButtons}
                    hasStageButtons={hasStageButtons}
                    hasQCButtons={hasQCButtons}
                    hasStage2Button={hasStage2Button}
                    stage={stage}
                    row={r}
                    onHold={onHold && !isWorkflowPending}
                    showingPopover={showingPopover}
                    isWorkflowPending={isWorkflowPending}
                    isInWorkflow={isInWorkflow}
                    workflowStatus={workflowStatus}
                    onInfoClick={(e) => {
                      e.stopPropagation();
                      setShowHistory(r);
                    }}
                    onStageAction={(ts, ir) => {
                      if (isWorkflowPending) return;
                      updateCaseStage(r, ts, ir);
                      setActive(null);
                      setClosing(null);
                    }}
                    onComplete={() => {
                      if (isWorkflowPending) return;
                      toggleComplete?.(r.id, r.completed);
                      setActive(null);
                      setClosing(null);
                    }}
                    onRelease={(e) => {
                      if (isWorkflowPending) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      if (showingPopover) handleCancel();
                      else {
                        setReleaseButtonRect(rect);
                        setReleasePopover(r);
                      }
                    }}
                    onStage2={() => {
                      if (isWorkflowPending) return;
                      toggleStage2?.(r);
                      setActive(null);
                      setClosing(null);
                    }}
                    onUnlink={() => {
                      unlinkFromWorkflow(r.id);
                      setActive(null);
                      setClosing(null);
                    }}
                  />
                )}
              </div>

              {/* Bottom: full-width workflow status bar */}
              {showChainIcon && workflowLabel && (
                <div className="mt-1 -mx-2 -mb-[5px] px-2.5 py-1.5 bg-black/[0.12] border-t border-white/[0.06] rounded-b-[7px]">
                  <span className="flex items-center gap-1.5 text-[10px] leading-none text-white/55">
                    <ChainLinkIcon className="w-3 h-3 flex-shrink-0 opacity-70" />
                    <span>{workflowLabel}</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </RowShell>
      );
    });
  };

  return (
    <>
      <ColumnShell metaColor={color}>
        {!hideHeader && <ColumnHeader meta text={title} />}
        <AnimatePresence mode="popLayout">
          {rows.length ? (
            renderContent()
          ) : (
            <motion.p
              layout
              transition={SPRING}
              className="m-2 text-center text-sm italic text-white/60"
            >
              none
            </motion.p>
          )}
        </AnimatePresence>
      </ColumnShell>

      {showHistory && (
        <CaseHistory
          id={showHistory.id}
          caseNumber={showHistory.caseNumber}
          onClose={() => setShowHistory(null)}
        />
      )}

      <AnimatePresence>
        {releasePopover && releaseButtonRect && (
          <ReleasePopover
            caseItem={releasePopover}
            onConfirm={handleReleaseConfirm}
            onCancel={handleCancel}
            anchorRect={releaseButtonRect}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function countDays(r, onHold, today) {
  if (!today) return 0;
  if (onHold) {
    const holdStart = r.hold_started
      ? new Date(r.hold_started).setHours(0, 0, 0, 0)
      : new Date(r.created_at).setHours(0, 0, 0, 0);
    return Math.floor((today - holdStart) / 86_400_000) + 1;
  }
  return Math.floor((today - new Date(r.due).getTime()) / 86_400_000);
}
