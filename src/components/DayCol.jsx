import React, {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useCallback,
} from "react";
import {
  ColumnShell,
  ColumnHeader,
  RowShell,
  RevealButton,
  guard,
  SPRING,
  TWEEN,
} from "../animationEngine";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import CaseHistory from "./CaseHistory";
import { useMut } from "../context/DataContext";
import clsx from "clsx";

const fmt = (d) =>
  d instanceof Date
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";

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

const StageDivider = ({ label, isToday, delay = 0 }) => (
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
      transition: {
        opacity: { duration: 0.1 },
        scaleX: { duration: 0.15 },
      },
    }}
    className="relative my-2 flex items-center"
  >
    <div
      className={clsx("flex-1 h-px", isToday ? "bg-black/20" : "bg-white/20")}
    />
    <span
      className={clsx(
        "px-2 text-[10px] font-medium uppercase tracking-wider",
        isToday ? "text-black/50" : "text-white/50"
      )}
    >
      {label}
    </span>
    <div
      className={clsx("flex-1 h-px", isToday ? "bg-black/20" : "bg-white/20")}
    />
  </motion.div>
);

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
    if (row.department === "General" && !row.completed) {
      groups[getStageFromModifiers(row.modifiers)].push(row);
    } else if (row.department === "Metal" && !row.completed) {
      groups.other.push(row);
    } else {
      groups.other.push(row);
    }
  });
  return groups;
};

const groupMetalRowsByStage = (rows) => {
  const groups = { development: [], finishing: [], other: [] };
  rows.forEach((row) => {
    if (row.department === "Metal" && !row.completed) {
      if (!row.stage2) groups.development.push(row);
      else groups.finishing.push(row);
    } else {
      groups.other.push(row);
    }
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

const StagePriorityBar = ({ columnRef, rowRefs, prioIds, stageKey }) => {
  const barY = useMotionValue(0);
  const barHeight = useMotionValue(0);
  const animationFrame = useRef(null);

  const track = useCallback(() => {
    if (prioIds.length === 0 || !columnRef.current) {
      barHeight.set(0);
      return;
    }
    const firstEl = rowRefs.current[prioIds[0]];
    if (!firstEl) {
      barHeight.set(0);
      return;
    }
    const colRect = columnRef.current.getBoundingClientRect();
    const firstRect = firstEl.getBoundingClientRect();
    barY.set(firstRect.top - colRect.top);
    let total = 0;
    prioIds.forEach((id) => {
      const el = rowRefs.current[id];
      if (el) total = el.getBoundingClientRect().bottom - firstRect.top;
    });
    barHeight.set(total);
  }, [prioIds, columnRef, rowRefs, barY, barHeight]);

  useLayoutEffect(() => {
    track();
    const frame = () => {
      track();
      animationFrame.current = requestAnimationFrame(frame);
    };
    animationFrame.current = requestAnimationFrame(frame);
    return () => {
      if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    };
  }, [track]);

  useLayoutEffect(() => {
    track();
  }, [prioIds, track]);

  if (prioIds.length === 0) return null;
  return (
    <motion.div
      className="absolute w-2 rounded bg-red-600 z-10"
      style={{ left: -13, y: barY, height: barHeight }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ opacity: { duration: 0.2 } }}
    />
  );
};

export default function DayCol({
  date,
  rows = [],
  isToday,
  hideHeader = false,
  toggleComplete,
  toggleStage2,
  stage,
  stageConfig,
  updateCaseStage,
  showStageDividers = false,
}) {
  toggleComplete = guard("toggleComplete", toggleComplete);
  toggleStage2 = guard("toggleStage2", toggleStage2);

  const [active, setActive] = useState(null);
  const [showHistory, setShowHistory] = useState(null);
  const rowRefs = useRef({});
  const columnRef = useRef(null);
  const [dividersReady, setDividersReady] = useState(false);
  const contentKeyRef = useRef(0);

  const { workflowMap, unlinkFromWorkflow } = useMut();

  const prioIdsByStage = useMemo(() => {
    if (!showStageDividers) {
      const arr = [];
      for (const r of rows) {
        if (r.priority && !r.completed) arr.push(r.id);
        else break;
      }
      return { all: arr };
    }
    const hasDigital = rows.some(
      (r) => r.department === "General" && !r.completed
    );
    const hasMetal = rows.some((r) => r.department === "Metal" && !r.completed);
    const prioMap = {};
    if (hasDigital) {
      const groups = groupRowsByStage(rows);
      ["design", "production", "finishing", "qc"].forEach((sk) => {
        const sp = [];
        for (const r of groups[sk]) {
          if (r.priority && !r.completed) sp.push(r.id);
          else break;
        }
        if (sp.length > 0) prioMap[sk] = sp;
      });
    } else if (hasMetal) {
      const groups = groupMetalRowsByStage(rows);
      ["development", "finishing"].forEach((sk) => {
        const sp = [];
        for (const r of groups[sk]) {
          if (r.priority && !r.completed) sp.push(r.id);
          else break;
        }
        if (sp.length > 0) prioMap[sk] = sp;
      });
    }
    const otherPrios = [];
    const otherRows = rows.filter((r) => {
      if (hasDigital && r.department === "General" && !r.completed)
        return false;
      if (hasMetal && r.department === "Metal" && !r.completed) return false;
      return true;
    });
    for (const r of otherRows) {
      if (r.priority && !r.completed) otherPrios.push(r.id);
      else break;
    }
    if (otherPrios.length > 0) prioMap.other = otherPrios;
    return prioMap;
  }, [rows, showStageDividers]);

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

  const renderContent = () => {
    if (!showStageDividers || rows.length === 0) return renderRows(rows, "all");
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
            <React.Fragment key="design-group">
              {dividersReady && (
                <StageDivider
                  label="Design"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.design, "design")}
            </React.Fragment>
          )}
          {groups.production.length > 0 && (
            <React.Fragment key="production-group">
              {dividersReady && (
                <StageDivider
                  label="Production"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.production, "production")}
            </React.Fragment>
          )}
          {groups.finishing.length > 0 && (
            <React.Fragment key="finishing-group">
              {dividersReady && (
                <StageDivider
                  label="Finishing"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.finishing, "finishing")}
            </React.Fragment>
          )}
          {groups.qc.length > 0 && (
            <React.Fragment key="qc-group">
              {dividersReady && (
                <StageDivider
                  label="QC"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.qc, "qc")}
            </React.Fragment>
          )}
          {groups.other.length > 0 && renderRows(groups.other, "other")}
        </>
      );
    } else if (hasMetal) {
      const groups = groupMetalRowsByStage(rows);
      let di = 0;
      return (
        <>
          {groups.development.length > 0 && (
            <React.Fragment key="development-group">
              {dividersReady && (
                <StageDivider
                  label="Development"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.development, "development")}
            </React.Fragment>
          )}
          {groups.finishing.length > 0 && (
            <React.Fragment key="metal-finishing-group">
              {dividersReady && (
                <StageDivider
                  label="Finishing"
                  isToday={isToday}
                  delay={di++ * 0.03}
                />
              )}
              {renderRows(groups.finishing, "finishing")}
            </React.Fragment>
          )}
          {groups.other.length > 0 && renderRows(groups.other, "other")}
        </>
      );
    }
    return renderRows(rows, "all");
  };

  const renderRows = (rowsToRender, stageKey) => {
    return rowsToRender.map((r) => {
      const open = r.id === active;
      const [num, desc] = split(r.caseNumber);
      const isInQC = r.modifiers?.includes("stage-qc");

      const workflowStatus = workflowMap?.get(r.id);
      const isWorkflowPending = workflowStatus?.isPending ?? false;
      const isInWorkflow = !!workflowStatus;
      const showChainIcon = isInWorkflow && chainHasPending(workflowStatus);
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
          open={open}
          dayRow
          innerRef={(el) => {
            if (el) rowRefs.current[r.id] = el;
          }}
          onClick={() => setActive(open ? null : r.id)}
          workflowPending={isWorkflowPending}
        >
          {/* ── Collapsed ── */}
          {!open && (
            <>
              {showChainIcon && (
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-40 z-10">
                  <ChainLinkIcon className="w-3.5 h-3.5" />
                </span>
              )}
              <motion.div
                layout
                transition={SPRING}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: TWEEN }}
                className={clsx(
                  "mx-auto text-center flex flex-col justify-center",
                  pendingTextCls
                )}
              >
                <span className="leading-none">{num}</span>
                {desc && (
                  <span className="mt-0.5 text-xs leading-none text-white/80">
                    {desc}
                  </span>
                )}
              </motion.div>
            </>
          )}

          {/* ── Expanded ── */}
          {open && (
            <motion.div
              layout
              transition={SPRING}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: TWEEN }}
              className="flex-auto flex flex-col"
            >
              {/* Top section: case info + buttons side by side */}
              <div className="flex items-center min-h-[48px]">
                {/* Left: case info */}
                <div
                  className={clsx(
                    "flex flex-col justify-center flex-1 min-w-0",
                    pendingTextCls
                  )}
                >
                  <span className="leading-none">{num}</span>
                  {desc && (
                    <span className="mt-0.5 text-xs leading-none text-white/80">
                      {desc}
                    </span>
                  )}
                </div>

                {/* Right: buttons */}
                <div className="ml-auto flex gap-2 pr-1 items-center flex-shrink-0">
                  <RevealButton
                    open
                    label={
                      <span className="font-serif italic font-bold text-xs px-1">
                        i
                      </span>
                    }
                    theme="gray"
                    small
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowHistory(r);
                    }}
                  />

                  <div className="flex flex-col gap-2">
                    {isWorkflowPending && showChainIcon && (
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
                          unlinkFromWorkflow(r.id);
                          setActive(null);
                        }}
                      />
                    )}

                    {!isWorkflowPending && (
                      <>
                        {stage && r.department === "General" && !isInQC && (
                          <>
                            {stage === "design" && (
                              <>
                                <RevealButton
                                  open
                                  label="Next →"
                                  theme="blue"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "production");
                                    setActive(null);
                                  }}
                                />
                                <RevealButton
                                  open
                                  label="Repair"
                                  theme="amber"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "finishing", true);
                                    setActive(null);
                                  }}
                                />
                              </>
                            )}
                            {stage === "production" && (
                              <>
                                <RevealButton
                                  open
                                  label="← Prev"
                                  theme="gray"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "design");
                                    setActive(null);
                                  }}
                                />
                                <RevealButton
                                  open
                                  label="Next →"
                                  theme="blue"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "finishing");
                                    setActive(null);
                                  }}
                                />
                              </>
                            )}
                            {stage === "finishing" && (
                              <>
                                <RevealButton
                                  open
                                  label="← Prev"
                                  theme="gray"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "production");
                                    setActive(null);
                                  }}
                                />
                                <RevealButton
                                  open
                                  label="QC →"
                                  theme="green"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCaseStage(r, "qc");
                                    setActive(null);
                                  }}
                                />
                              </>
                            )}
                          </>
                        )}
                        {!stage &&
                          r.department === "General" &&
                          isInQC &&
                          !r.completed && (
                            <>
                              <RevealButton
                                open
                                label="← Prev"
                                theme="gray"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCaseStage(r, "finishing");
                                  setActive(null);
                                }}
                              />
                              <RevealButton
                                open
                                label="Done"
                                theme="green"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleComplete(r.id, r.completed);
                                  setActive(null);
                                }}
                              />
                            </>
                          )}
                        {r.department === "Metal" && !r.stage2 && (
                          <RevealButton
                            open
                            label={"Stage\u00A02"}
                            theme="purple"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleStage2(r);
                              setActive(null);
                            }}
                          />
                        )}
                        {(r.department !== "General" ||
                          (!stage && !isInQC)) && (
                          <RevealButton
                            open
                            label="Done"
                            theme="green"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleComplete(r.id, r.completed);
                              setActive(null);
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
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
            </motion.div>
          )}
        </RowShell>
      );
    });
  };

  return (
    <>
      <ColumnShell isToday={isToday}>
        <div className="relative" ref={columnRef}>
          <AnimatePresence>
            {showStageDividers
              ? Object.entries(prioIdsByStage).map(
                  ([sk, pIds]) =>
                    pIds.length > 0 && (
                      <StagePriorityBar
                        key={`pb-${sk}`}
                        columnRef={columnRef}
                        rowRefs={rowRefs}
                        prioIds={pIds}
                        stageKey={sk}
                      />
                    )
                )
              : prioIdsByStage.all?.length > 0 && (
                  <StagePriorityBar
                    key="pb-all"
                    columnRef={columnRef}
                    rowRefs={rowRefs}
                    prioIds={prioIdsByStage.all}
                    stageKey="all"
                  />
                )}
          </AnimatePresence>

          {!hideHeader && <ColumnHeader text={fmt(date)} isToday={isToday} />}

          <AnimatePresence mode="popLayout">
            {rows.length ? (
              renderContent()
            ) : (
              <motion.p
                layout
                transition={SPRING}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: TWEEN }}
                className="m-2 text-center text-sm italic text-white/60"
              >
                no cases
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </ColumnShell>

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
