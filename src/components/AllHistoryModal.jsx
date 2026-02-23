// AllHistoryModal.jsx - Add debugging version
import React, {
  useEffect,
  useState,
  useRef,
  memo,
  useCallback,
  useMemo,
  startTransition,
  lazy,
  Suspense,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { db } from "../services/caseService";

// Add debug logging
console.log("[AllHistoryModal] Module loading...");

// Lazy load CaseHistory modal
const CaseHistory = lazy(() => import("./CaseHistory"));

/* ───────── tweakable constants ───────── */
export const HEADER_SWITCH_OFFSET = 120;
const POPUP_GAP = 8;
const CLOSE_DELAY = 300;

/* ───────── global text size adjustment ───────── */
const TEXT_SIZE_DESKTOP = 10;
const TEXT_SIZE_MOBILE = 10;

const DESKTOP_SCALE = 1 + TEXT_SIZE_DESKTOP / 100;
const MOBILE_SCALE = 1 + TEXT_SIZE_MOBILE / 100;

/* ───────── bright glass tint helpers ───────── */
const TINT = {
  OVERLAY_BLACK: 0.4,
  SHELL_WHITE: 0.45,
  HEADER_WHITE: 0.7,
  ROW_WHITE: 0.35,
  ROW_HOVER: 0.45,
  STAT_BG: 0.6,
  STAT_HOVER: 0.7,
};
const rgba = (a) => {
  // Theme-aware tint helper: stays exactly as before in Blue/White,
  // switches to graphite tints in Dark mode only.
  if (
    typeof document !== "undefined" &&
    document.documentElement?.classList?.contains("theme-dark")
  ) {
    return `rgba(24,26,29,${a})`;
  }
  return `rgba(255,255,255,${a})`;
};

/* ───────── date helpers ───────── */
const TZ = "America/Boise";
const keyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const dayKey = (d) => keyFmt.format(new Date(d));
const fmtDate = (d) => dateFmt.format(new Date(d));
const fmtTime = (d) => timeFmt.format(new Date(d)).replace(" ", "\u202F");
const split = (s = "") => {
  const t = s
    .replace(/[()]/g, "")
    .replace(/\s*-\s*/, " ")
    .trim()
    .split(/\s+/);
  return [t.shift() || "", t.join(" ")];
};

/* ───────── action processing helpers (matching CaseHistory) ───────── */
const formatDateShort = (dateStr) => {
  const [year, month, day] = dateStr.split("T")[0].split("-");
  return `${parseInt(month)}-${parseInt(day)}`;
};

const processActionText = (action) => {
  const dueChangePattern =
    /Due changed from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/i;
  const match = action.match(dueChangePattern);

  if (match) {
    const fromDate = formatDateShort(match[1]);
    const toDate = formatDateShort(match[2]);
    return `Due date changed from ${fromDate} to ${toDate}`;
  }

  return action;
};

/* ───────── layout constants ───────── */
const gridBase =
  "grid grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1fr)] gap-3 items-start";
const grid = `min-w-0 w-full ${gridBase}`;

/* ───────── global active popup state ───────── */
let activePopupSetter = null;

/* ───────── Preload manager with debugging ───────── */
const preloadManager = {
  promise: null,
  data: null,
  error: null,
  isPreloading: false,
  hasPreloaded: false,

  preload: async () => {
    console.log("[AllHistoryModal] preloadManager.preload called", {
      hasPreloaded: preloadManager.hasPreloaded,
      isPreloading: preloadManager.isPreloading,
    });

    if (preloadManager.promise) {
      console.log("[AllHistoryModal] Returning existing promise");
      return preloadManager.promise;
    }

    preloadManager.isPreloading = true;
    preloadManager.promise = (async () => {
      const startTime = performance.now();
      try {
        console.log("[AllHistoryModal] Starting data fetch...");

        // Calculate date for 2 days ago
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const twoDaysAgoStr = twoDaysAgo.toISOString();

        // Fetch recent data
        const { data: recentData, error: recentError } = await db
          .from("case_history")
          .select(
            "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
          )
          .eq("cases.archived", false)
          .gte("created_at", twoDaysAgoStr)
          .order("created_at", { ascending: false });

        const fetchTime = performance.now() - startTime;
        console.log(`[AllHistoryModal] Data fetched in ${fetchTime}ms`, {
          recordCount: recentData?.length || 0,
        });

        if (recentError) throw recentError;

        preloadManager.data = { recentData, twoDaysAgoStr };
        preloadManager.hasPreloaded = true;
        preloadManager.isPreloading = false;
        return preloadManager.data;
      } catch (err) {
        console.error("[AllHistoryModal] Preload error:", err);
        preloadManager.error = err;
        preloadManager.isPreloading = false;
        throw err;
      }
    })();

    return preloadManager.promise;
  },

  reset: () => {
    console.log("[AllHistoryModal] Resetting preload manager");
    preloadManager.promise = null;
    preloadManager.data = null;
    preloadManager.error = null;
    preloadManager.isPreloading = false;
    preloadManager.hasPreloaded = false;
  },
};

// Export preload function to be called from parent component
export const preloadAllHistoryData = () => preloadManager.preload();

// Also export a function to check preload status
export const isHistoryPreloaded = () => preloadManager.hasPreloaded;

/* ───────── stat popup component ───────── */
const StatPopup = memo(
  ({ cases, onClose, targetRect, label, onMouseEnter, onMouseLeave }) => {
    const popRef = useRef(null);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const [isPositioned, setIsPositioned] = useState(false);

    useEffect(() => {
      if (!popRef.current || !targetRect) return;

      // Use RAF to ensure DOM is ready before calculating position
      requestAnimationFrame(() => {
        const pop = popRef.current;
        if (!pop) return;

        const { innerWidth: vw, innerHeight: vh } = window;
        const pr = pop.getBoundingClientRect();

        let left = targetRect.left + targetRect.width / 2 - pr.width / 2;
        let top = targetRect.bottom + POPUP_GAP;

        left = Math.max(16, Math.min(vw - pr.width - 16, left));
        if (top + pr.height + 16 > vh) {
          top = targetRect.top - pr.height - POPUP_GAP;
        }

        setPosition({ left, top: Math.max(8, top) });
        setIsPositioned(true);
      });
    }, [targetRect]);

    const CaseItem = useCallback(({ text, index }) => {
      const [num, desc] = split(text);
      return (
        <motion.li
          className="py-1 text-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.15,
            delay: Math.min(index * 0.01, 0.1),
            ease: "easeOut",
          }}
        >
          <div className="font-mono text-gray-800">{num}</div>
          {desc && (
            <div className="text-[10px] text-gray-600 mt-0.5">{desc}</div>
          )}
        </motion.li>
      );
    }, []);

    return createPortal(
      <motion.div
        ref={popRef}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{
          opacity: isPositioned ? 1 : 0,
          scale: isPositioned ? 1 : 0.95,
        }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{
          duration: 0.15,
          ease: "easeOut",
        }}
        style={{
          position: "fixed",
          left: position.left,
          top: position.top,
          zIndex: 9999,
          willChange: "opacity, transform",
          visibility: isPositioned ? "visible" : "hidden", // Hide until positioned
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="min-w-[200px] max-w-[280px] rounded-xl bg-white/90 backdrop-blur-2xl shadow-2xl border border-white/50"
      >
        <div className="px-4 py-2 border-b border-gray-200/50 bg-white/60 backdrop-blur-xl">
          <p className="text-xs font-semibold text-gray-800">{label} Cases</p>
        </div>
        <ul className="max-h-64 overflow-y-auto px-4 py-2 space-y-1">
          {cases.slice(0, 50).map((c, i) => (
            <CaseItem key={`${c}-${i}`} text={c} index={i} />
          ))}
          {cases.length > 50 && (
            <li className="text-[10px] text-gray-500 pt-2">
              ...and {cases.length - 50} more
            </li>
          )}
        </ul>
      </motion.div>,
      document.body
    );
  }
);

/* ───────── stat chip with single popup behavior ───────── */
const Stat = memo(({ label, n, cases, statId }) => {
  const btnRef = useRef(null);
  const [showPopup, setShowPopup] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const timeoutRef = useRef(null);
  const isHoveringRef = useRef(false);
  const [isTouchDevice] = useState(() => "ontouchstart" in window);

  useEffect(() => {
    if (showPopup) {
      if (activePopupSetter && activePopupSetter !== setShowPopup) {
        activePopupSetter(false);
      }
      activePopupSetter = setShowPopup;
    }
  }, [showPopup]);

  const clearHideTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    timeoutRef.current = setTimeout(() => {
      if (!isHoveringRef.current) {
        setShowPopup(false);
        setTargetRect(null);
        if (activePopupSetter === setShowPopup) {
          activePopupSetter = null;
        }
      }
    }, CLOSE_DELAY);
  }, [clearHideTimeout]);

  const handleMouseEnter = useCallback(() => {
    if (cases.length === 0 || isTouchDevice) return;

    if (activePopupSetter && activePopupSetter !== setShowPopup) {
      activePopupSetter(false);
    }

    isHoveringRef.current = true;
    clearHideTimeout();

    if (btnRef.current) {
      setTargetRect(btnRef.current.getBoundingClientRect());
      setShowPopup(true);
    }
  }, [cases.length, isTouchDevice, clearHideTimeout]);

  const handleMouseLeave = useCallback(() => {
    if (isTouchDevice) return;
    isHoveringRef.current = false;
    scheduleHide();
  }, [isTouchDevice, scheduleHide]);

  const handlePopupMouseEnter = useCallback(() => {
    isHoveringRef.current = true;
    clearHideTimeout();
  }, [clearHideTimeout]);

  const handlePopupMouseLeave = useCallback(() => {
    isHoveringRef.current = false;
    scheduleHide();
  }, [scheduleHide]);

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (cases.length === 0) return;

      if (isTouchDevice) {
        if (showPopup) {
          setShowPopup(false);
          setTargetRect(null);
        } else {
          if (activePopupSetter && activePopupSetter !== setShowPopup) {
            activePopupSetter(false);
          }
          if (btnRef.current) {
            setTargetRect(btnRef.current.getBoundingClientRect());
            setShowPopup(true);
          }
        }
      }
    },
    [showPopup, cases.length, isTouchDevice]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (activePopupSetter === setShowPopup) {
        activePopupSetter = null;
      }
    };
  }, []);

  const statColor = "text-gray-700";
  const statBg = rgba(TINT.STAT_BG);

  return (
    <>
      <motion.button
        ref={btnRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        whileHover={{ scale: 1.05, y: -1 }}
        whileTap={{ scale: 0.98 }}
        transition={{
          type: "tween",
          duration: 0.1,
          ease: "easeOut",
        }}
        className={`inline-flex items-center gap-2 rounded-lg backdrop-blur-xl px-3 py-1.5 font-medium ${statColor} border border-white/50 shadow-sm hover:shadow-md transition-shadow cursor-pointer select-none`}
        style={{
          backgroundColor: statBg,
          willChange: "transform",
          fontSize: `${
            11 * (window.innerWidth < 640 ? MOBILE_SCALE : DESKTOP_SCALE)
          }px`,
        }}
      >
        <strong
          className="font-mono tabular-nums"
          style={{
            fontSize: `${
              14 * (window.innerWidth < 640 ? MOBILE_SCALE : DESKTOP_SCALE)
            }px`,
          }}
        >
          {n}
        </strong>
        <span>{label}</span>
      </motion.button>

      <AnimatePresence mode="wait">
        {showPopup && targetRect && (
          <StatPopup
            cases={cases}
            onClose={() => {
              setShowPopup(false);
              setTargetRect(null);
            }}
            targetRect={targetRect}
            label={label}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          />
        )}
      </AnimatePresence>
    </>
  );
});

/* ───────── optimized row component ───────── */
const Row = memo(({ row, onCaseClick, isNew = false }) => {
  const [num, desc] = useMemo(() => split(row.casenumber), [row.casenumber]);
  const [isHovered, setIsHovered] = useState(false);

  const baseFontSize = window.innerWidth < 640 ? 12 : 14;
  const scale = window.innerWidth < 640 ? MOBILE_SCALE : DESKTOP_SCALE;
  const fontSize = baseFontSize * scale;

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      console.log("Row clicked:", row.case_id, row.casenumber); // Debug log
      if (row.case_id && onCaseClick) {
        onCaseClick(row.case_id, row.casenumber);
      }
    },
    [row.case_id, row.casenumber, onCaseClick]
  );

  return (
    <motion.div
      className="relative px-6 py-3 cursor-pointer select-none"
      style={{
        backgroundColor: isHovered
          ? rgba(TINT.ROW_HOVER)
          : rgba(TINT.ROW_WHITE),
        transition: "background-color 0.15s ease-out",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e);
        }
      }}
      initial={isNew ? { opacity: 0, y: -20 } : false}
      animate={isNew ? { opacity: 1, y: 0 } : false}
      transition={isNew ? { duration: 0.3, ease: "easeOut" } : false}
    >
      <div
        className={grid}
        style={{ fontSize: `${fontSize}px`, pointerEvents: "none" }}
      >
        <div className="min-w-0 break-words">
          <div className="font-mono text-gray-800 break-words hover:text-blue-600 transition-colors">
            {num}
          </div>
          {desc && (
            <div
              className="text-gray-600 mt-0.5 break-words"
              style={{ fontSize: `${10 * scale}px` }}
            >
              {desc}
            </div>
          )}
        </div>
        <div className="text-gray-700 tabular-nums whitespace-nowrap px-2">
          {fmtTime(row.created_at)}
        </div>
        <div className="text-gray-700 whitespace-nowrap px-2 max-w-[150px] overflow-hidden text-ellipsis">
          {row.user_name}
        </div>
        <div className="text-right text-gray-700 break-words">{row.action}</div>
      </div>
    </motion.div>
  );
});

/* ───────── loading skeleton with smooth animation ───────── */
const LoadingSkeleton = () => (
  <motion.div
    className="flex-1 flex flex-col"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3, ease: "easeOut" }}
  >
    {/* Fake stats bar */}
    <div
      className="flex-shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3 border-b border-gray-200/20"
      style={{ background: rgba(TINT.HEADER_WHITE) }}
    >
      <div className="h-6 w-32 bg-white/30 rounded animate-pulse" />
      <div className="flex gap-2">
        <div className="h-8 w-24 bg-white/30 rounded animate-pulse" />
        <div className="h-8 w-24 bg-white/30 rounded animate-pulse" />
        <div className="h-8 w-24 bg-white/30 rounded animate-pulse" />
      </div>
    </div>

    {/* Scrollable skeleton content */}
    <div className="flex-1 overflow-y-auto px-6 py-4">
      {[1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="space-y-3 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            delay: i * 0.08,
            ease: "easeOut",
          }}
        >
          <div className="h-8 w-32 bg-white/30 rounded animate-pulse backdrop-blur-sm" />
          <div className="space-y-2">
            {[1, 2, 3].map((j) => (
              <div
                key={j}
                className="h-12 bg-white/20 rounded animate-pulse backdrop-blur-sm"
                style={{ animationDelay: `${j * 150}ms` }}
              />
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  </motion.div>
);

/* ───────── main modal component ───────── */
export default function AllHistoryModal({ onClose }) {
  console.log("[AllHistoryModal] Component rendering");
  const renderStartTime = performance.now();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [current, setCurrent] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [animationComplete, setAnimationComplete] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [newRowIds, setNewRowIds] = useState(new Set());
  const listRef = useRef(null);
  const scrollRAF = useRef(null);
  const modalRef = useRef(null);
  const mountedRef = useRef(true);
  const closeTimerRef = useRef(null);
  const subscriptionRef = useRef(null);
  const processedIdsRef = useRef(new Set());

  /* Handle case click */
  const handleCaseClick = useCallback((caseId, caseNumber) => {
    console.log("handleCaseClick called:", caseId, caseNumber); // Debug log
    setSelectedCase({ id: caseId, caseNumber });
  }, []);

  /* Process a single history row */
  const processHistoryRow = useCallback((row) => {
    return {
      case_id: row.case_id,
      casenumber: row.cases?.casenumber ?? "—",
      created_at: row.created_at,
      action: processActionText(row.action),
      user_name: row.user_name?.trim() || "—",
    };
  }, []);

  /* Add new row to groups */
  const addNewRowToGroups = useCallback(
    (newRow) => {
      setGroups((prevGroups) => {
        const processedRow = processHistoryRow(newRow);

        // Check for same-day due changes
        const dueChangePattern =
          /Due date changed from (\d{1,2}-\d{1,2}) to (\d{1,2}-\d{1,2})/i;
        const match = processedRow.action.match(dueChangePattern);
        if (match && match[1] === match[2]) {
          return prevGroups; // Skip same-day due changes
        }

        const k = dayKey(processedRow.created_at);
        const groupsCopy = [...prevGroups];

        let groupIndex = groupsCopy.findIndex((g) => g.key === k);

        if (groupIndex === -1) {
          // Create new group
          const newGroup = {
            label: fmtDate(processedRow.created_at),
            key: k,
            rows: [processedRow],
            stats: {
              created: [],
              completed: [],
              rescheduled: [],
            },
          };

          // Update stats
          if (processedRow.action === "Case created") {
            newGroup.stats.created.push(processedRow.casenumber);
          } else if (processedRow.action === "Marked done") {
            newGroup.stats.completed.push(processedRow.casenumber);
          } else if (
            processedRow.action.toLowerCase().includes("due date changed")
          ) {
            newGroup.stats.rescheduled.push(processedRow.casenumber);
          }

          // Insert in correct position (newest first)
          let insertIndex = 0;
          for (let i = 0; i < groupsCopy.length; i++) {
            if (new Date(newGroup.key) > new Date(groupsCopy[i].key)) {
              break;
            }
            insertIndex = i + 1;
          }
          groupsCopy.splice(insertIndex, 0, newGroup);
        } else {
          // Add to existing group
          const group = { ...groupsCopy[groupIndex] };

          // Insert row in correct position (newest first)
          const rowsCopy = [...group.rows];
          let insertIndex = 0;
          for (let i = 0; i < rowsCopy.length; i++) {
            if (
              new Date(processedRow.created_at) >
              new Date(rowsCopy[i].created_at)
            ) {
              break;
            }
            insertIndex = i + 1;
          }
          rowsCopy.splice(insertIndex, 0, processedRow);

          // Update stats
          const statsCopy = { ...group.stats };
          if (processedRow.action === "Case created") {
            statsCopy.created = [...statsCopy.created, processedRow.casenumber];
          } else if (processedRow.action === "Marked done") {
            statsCopy.completed = [
              ...statsCopy.completed,
              processedRow.casenumber,
            ];
          } else if (
            processedRow.action.toLowerCase().includes("due date changed")
          ) {
            statsCopy.rescheduled = [
              ...statsCopy.rescheduled,
              processedRow.casenumber,
            ];
          }

          groupsCopy[groupIndex] = {
            ...group,
            rows: rowsCopy,
            stats: statsCopy,
          };
        }

        return groupsCopy;
      });

      // Mark as new for animation
      setNewRowIds((prev) =>
        new Set(prev).add(
          `${newRow.created_at}-${newRow.case_id}-${newRow.action}`
        )
      );

      // Remove from new after animation
      setTimeout(() => {
        setNewRowIds((prev) => {
          const next = new Set(prev);
          next.delete(
            `${newRow.created_at}-${newRow.case_id}-${newRow.action}`
          );
          return next;
        });
      }, 500);
    },
    [processHistoryRow]
  );

  /* Setup real-time subscription */
  useEffect(() => {
    if (!animationComplete || loading) return;

    // Subscribe to new case_history inserts
    const channel = db
      .channel("case_history_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "case_history",
        },
        async (payload) => {
          console.log("New case history:", payload.new);

          // Check if we've already processed this row
          const rowId = `${payload.new.created_at}-${payload.new.case_id}-${payload.new.action}`;
          if (processedIdsRef.current.has(rowId)) {
            return;
          }
          processedIdsRef.current.add(rowId);

          // Fetch the full row with case data
          const { data, error } = await db
            .from("case_history")
            .select(
              "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
            )
            .eq("id", payload.new.id)
            .eq("cases.archived", false)
            .single();

          if (!error && data && mountedRef.current) {
            addNewRowToGroups(data);
          }
        }
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        db.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [animationComplete, loading, addNewRowToGroups]);

  /* cleanup on unmount */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
      if (subscriptionRef.current) {
        db.removeChannel(subscriptionRef.current);
      }
      processedIdsRef.current.clear();
    };
  }, []);

  /* Start animation immediately */
  useEffect(() => {
    console.log("[AllHistoryModal] Setting isReady to true");
    requestAnimationFrame(() => {
      if (mountedRef.current) {
        setIsReady(true);
      }
    });
  }, []);

  /* Load data after animation starts - prioritize first 2 days */
  useEffect(() => {
    if (animationComplete) {
      console.log("[AllHistoryModal] Animation complete, loading data...");
      loadInitialData();
    }
  }, [animationComplete]);

  /* Load first 2 days of data quickly */
  const loadInitialData = useCallback(async () => {
    const loadStartTime = performance.now();
    console.log("[AllHistoryModal] loadInitialData called");

    try {
      let recentData, twoDaysAgoStr;

      // Check if we have preloaded data
      if (preloadManager.data) {
        console.log("[AllHistoryModal] Using preloaded data");
        ({ recentData, twoDaysAgoStr } = preloadManager.data);
        // Reset preload data after using it
        preloadManager.reset();
      } else {
        console.log("[AllHistoryModal] No preloaded data, fetching now...");
        // Fallback to fetching data if not preloaded
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        twoDaysAgoStr = twoDaysAgo.toISOString();

        const { data, error } = await db
          .from("case_history")
          .select(
            "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
          )
          .eq("cases.archived", false)
          .gte("created_at", twoDaysAgoStr)
          .order("created_at", { ascending: false });

        if (error) throw error;
        recentData = data;
      }

      if (!mountedRef.current) return;

      // Process recent data immediately
      const recentRows = (recentData ?? []).map((r) => {
        const rowId = `${r.created_at}-${r.case_id}-${r.action}`;
        processedIdsRef.current.add(rowId);
        return processHistoryRow(r);
      });

      // Filter out same-day due changes (matching CaseHistory logic)
      const dueChangePattern =
        /Due date changed from (\d{1,2}-\d{1,2}) to (\d{1,2}-\d{1,2})/i;
      const filteredRows = recentRows.filter((r) => {
        const match = r.action.match(dueChangePattern);
        return !(match && match[1] === match[2]);
      });

      // Group recent rows
      const recentMap = new Map();
      filteredRows.forEach((r) => {
        const k = dayKey(r.created_at);
        if (!recentMap.has(k)) {
          recentMap.set(k, {
            label: fmtDate(r.created_at),
            key: k,
            rows: [],
            stats: {
              created: [],
              completed: [],
              rescheduled: [],
            },
          });
        }
        const g = recentMap.get(k);
        g.rows.push(r);

        if (r.action === "Case created") g.stats.created.push(r.casenumber);
        else if (r.action === "Marked done")
          g.stats.completed.push(r.casenumber);
        else if (r.action.toLowerCase().includes("due date changed"))
          g.stats.rescheduled.push(r.casenumber);
      });

      const recentGroups = [...recentMap.values()];

      const processTime = performance.now() - loadStartTime;
      console.log(
        `[AllHistoryModal] Initial data processed in ${processTime}ms`
      );

      // Show recent data immediately
      if (mountedRef.current) {
        setCurrent(recentGroups[0]?.label || "");
        setGroups(recentGroups);
        setLoading(false);
        setLoadingMore(true);
      }

      // Load the rest in the background
      setTimeout(() => {
        if (mountedRef.current) {
          loadRemainingData(twoDaysAgoStr, recentGroups);
        }
      }, 100);
    } catch (err) {
      console.error("Failed to load initial history:", err);
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [processHistoryRow]);

  /* Load remaining data in background */
  const loadRemainingData = useCallback(
    async (afterDate, existingGroups) => {
      try {
        // Second query: everything older than 2 days
        const { data: olderData, error: olderError } = await db
          .from("case_history")
          .select(
            "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
          )
          .eq("cases.archived", false)
          .lt("created_at", afterDate)
          .order("created_at", { ascending: false })
          .limit(1000);

        if (olderError) throw olderError;
        if (!mountedRef.current) return;

        startTransition(() => {
          const olderRows = (olderData ?? []).map((r) => {
            const rowId = `${r.created_at}-${r.case_id}-${r.action}`;
            processedIdsRef.current.add(rowId);
            return processHistoryRow(r);
          });

          // Filter out same-day due changes (matching CaseHistory logic)
          const dueChangePattern =
            /Due date changed from (\d{1,2}-\d{1,2}) to (\d{1,2}-\d{1,2})/i;
          const filteredRows = olderRows.filter((r) => {
            const match = r.action.match(dueChangePattern);
            return !(match && match[1] === match[2]);
          });

          // Create a map starting with existing groups
          const fullMap = new Map();
          existingGroups.forEach((g) => fullMap.set(g.key, g));

          // Add older rows
          filteredRows.forEach((r) => {
            const k = dayKey(r.created_at);
            if (!fullMap.has(k)) {
              fullMap.set(k, {
                label: fmtDate(r.created_at),
                key: k,
                rows: [],
                stats: {
                  created: [],
                  completed: [],
                  rescheduled: [],
                },
              });
            }
            const g = fullMap.get(k);
            g.rows.push(r);

            if (r.action === "Case created") g.stats.created.push(r.casenumber);
            else if (r.action === "Marked done")
              g.stats.completed.push(r.casenumber);
            else if (r.action.toLowerCase().includes("due date changed"))
              g.stats.rescheduled.push(r.casenumber);
          });

          const allGroups = [...fullMap.values()];

          if (mountedRef.current) {
            setGroups(allGroups);
            setLoadingMore(false);
          }
        });
      } catch (err) {
        console.error("Failed to load remaining history:", err);
        if (mountedRef.current) {
          setLoadingMore(false);
        }
      }
    },
    [processHistoryRow]
  );

  /* scroll lock */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* optimized scroll-spy */
  useEffect(() => {
    if (!groups.length || loading) return;

    const list = listRef.current;
    if (!list) return;

    const onScroll = () => {
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);

      scrollRAF.current = requestAnimationFrame(() => {
        const headings = list.querySelectorAll("[data-day-heading]");
        const listRect = list.getBoundingClientRect();
        let active = "";

        for (const heading of headings) {
          const rect = heading.getBoundingClientRect();
          const relativeTop = rect.top - listRect.top;

          if (relativeTop <= HEADER_SWITCH_OFFSET) {
            active = heading.dataset.day || "";
          } else {
            break;
          }
        }

        if (active && active !== current) {
          setCurrent(active);
        }
      });
    };

    list.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      list.removeEventListener("scroll", onScroll);
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    };
  }, [groups, current, loading]);

  const curStats = useMemo(
    () =>
      groups.find((g) => g.label === current)?.stats || {
        created: [],
        completed: [],
        rescheduled: [],
      },
    [groups, current]
  );

  const handleClose = useCallback(() => {
    if (!mountedRef.current || selectedCase) return; // Don't close if case history is open

    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        onClose();
      }
    }, 300);
  }, [onClose, selectedCase]);

  /* keyboard handler */
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && !selectedCase) {
        // Only close if no case history open
        handleClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleClose, selectedCase]);

  /* click outside handler */
  useEffect(() => {
    const handleClickOutside = (e) => {
      // Don't close if case history is open or if clicking inside modal
      if (
        selectedCase ||
        (modalRef.current && modalRef.current.contains(e.target))
      ) {
        return;
      }
      handleClose();
    };

    const timer = setTimeout(() => {
      if (!selectedCase) {
        // Only add listener if no case history
        window.addEventListener("click", handleClickOutside);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClickOutside);
    };
  }, [handleClose, selectedCase]);

  const headerScale = window.innerWidth < 640 ? MOBILE_SCALE : DESKTOP_SCALE;
  const headerFontSize = window.innerWidth < 640 ? 11 : 12;

  /* memoized modal style */
  const modalStyle = useMemo(
    () => ({
      height: "85vh",
      background: rgba(TINT.SHELL_WHITE),
      backdropFilter: "blur(40px) saturate(180%)",
      WebkitBackdropFilter: "blur(40px) saturate(180%)",
      willChange: "transform, opacity",
      boxShadow: `
        0 0 0 1px rgba(0, 0, 0, 0.05),
        0 0 40px rgba(0, 0, 0, 0.15),
        0 0 80px rgba(0, 0, 0, 0.1),
        inset 0 0 0 1px rgba(255, 255, 255, 0.1)
      `,
    }),
    []
  );

  // Log render time
  useEffect(() => {
    const renderTime = performance.now() - renderStartTime;
    console.log(`[AllHistoryModal] Render completed in ${renderTime}ms`);
  });

  return createPortal(
    <>
      <AnimatePresence>
        {!isClosing && (
          <motion.div
            className="fixed inset-0 z-[150] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Animated blurred backdrop */}
            <motion.div
              className="absolute inset-0 pointer-events-auto"
              onClick={(e) => {
                if (!selectedCase) {
                  // Only close on backdrop click if no case history
                  handleClose();
                }
              }}
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

            {/* Main popup */}
            <AnimatePresence>
              {isReady && (
                <motion.div className="fixed inset-0 flex items-center justify-center pointer-events-none p-4">
                  <motion.div
                    ref={modalRef}
                    className="w-full max-w-5xl pointer-events-auto overflow-hidden rounded-2xl border border-white/30 shadow-2xl flex flex-col"
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
                    style={modalStyle}
                    onAnimationComplete={() => {
                      console.log("[AllHistoryModal] Animation complete");
                      setAnimationComplete(true);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.4 }}
                      className="flex flex-col h-full"
                    >
                      {/* Header */}
                      <motion.header
                        className="flex-shrink-0 flex items-center justify-between px-6 py-4"
                        style={{ background: rgba(TINT.HEADER_WHITE) }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{
                          delay: 0.3,
                          duration: 0.3,
                          ease: "easeOut",
                        }}
                      >
                        <h2
                          className="font-semibold text-gray-800"
                          style={{ fontSize: `${20 * headerScale}px` }}
                        >
                          All Case History
                        </h2>
                        <motion.button
                          onClick={handleClose}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          transition={{
                            type: "tween",
                            duration: 0.1,
                            ease: "easeOut",
                          }}
                          className="rounded-lg px-4 py-2 bg-white/50 hover:bg-white/70 backdrop-blur-xl border border-white/50 shadow-sm transition-colors text-gray-700"
                          style={{
                            willChange: "transform",
                            fontSize: `${14 * headerScale}px`,
                          }}
                        >
                          Close
                        </motion.button>
                      </motion.header>

                      {loading ? (
                        <LoadingSkeleton />
                      ) : (
                        <>
                          {/* Sticky stats bar */}
                          <motion.div
                            className="flex-shrink-0 sticky top-0 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3"
                            style={{ background: rgba(TINT.HEADER_WHITE) }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{
                              delay: 0.35,
                              duration: 0.3,
                              ease: "easeOut",
                            }}
                          >
                            <motion.span
                              key={current}
                              className="font-bold text-gray-800"
                              initial={{ opacity: 0.7 }}
                              animate={{ opacity: 1 }}
                              transition={{ duration: 0.15, ease: "easeOut" }}
                              style={{ fontSize: `${18 * headerScale}px` }}
                            >
                              {current || "Loading..."}
                            </motion.span>
                            <div className="flex flex-wrap justify-center sm:justify-end gap-2 w-full sm:w-auto">
                              <Stat
                                statId="created"
                                label="Created"
                                n={curStats.created.length}
                                cases={curStats.created}
                              />
                              <Stat
                                statId="completed"
                                label="Completed"
                                n={curStats.completed.length}
                                cases={curStats.completed}
                              />
                              <Stat
                                statId="rescheduled"
                                label="Rescheduled"
                                n={curStats.rescheduled.length}
                                cases={curStats.rescheduled}
                              />
                            </div>
                          </motion.div>

                          {/* Content area */}
                          <motion.div
                            ref={listRef}
                            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{
                              duration: 0.25,
                              delay: 0.4,
                              ease: "easeOut",
                            }}
                            style={{
                              WebkitOverflowScrolling: "touch",
                              willChange: "scroll-position",
                            }}
                          >
                            {groups.length === 0 ? (
                              <motion.div
                                className="flex items-center justify-center h-64"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.3 }}
                              >
                                <p className="text-gray-500">
                                  No active case history available
                                </p>
                              </motion.div>
                            ) : (
                              <div>
                                {groups.map((g) => (
                                  <section
                                    key={g.key}
                                    className="px-6 py-4 first:pt-6 last:pb-6"
                                  >
                                    <div
                                      className="rounded-xl overflow-hidden backdrop-blur-sm"
                                      style={{
                                        background: rgba(TINT.ROW_WHITE),
                                      }}
                                    >
                                      <div
                                        className="px-6 py-3 font-bold text-gray-800 backdrop-blur-md"
                                        style={{
                                          background: rgba(
                                            TINT.HEADER_WHITE * 0.8
                                          ),
                                          fontSize: `${18 * headerScale}px`,
                                        }}
                                        data-day-heading={g.label}
                                        data-day={g.label}
                                      >
                                        {g.label}
                                      </div>
                                      <div>
                                        <div
                                          className={`${grid} px-6 py-2 font-semibold uppercase text-gray-600 backdrop-blur-sm`}
                                          style={{
                                            background: rgba(
                                              TINT.ROW_WHITE + 0.1
                                            ),
                                            fontSize: `${
                                              headerFontSize * headerScale
                                            }px`,
                                          }}
                                        >
                                          <span>Case #</span>
                                          <span className="whitespace-nowrap px-2">
                                            Time
                                          </span>
                                          <span className="whitespace-nowrap px-2">
                                            User
                                          </span>
                                          <span className="text-right">
                                            Action
                                          </span>
                                        </div>
                                        <div>
                                          {g.rows.map((r) => {
                                            const rowKey = `${r.created_at}-${r.case_id}-${r.action}`;
                                            return (
                                              <Row
                                                key={rowKey}
                                                row={r}
                                                onCaseClick={handleCaseClick}
                                                isNew={newRowIds.has(rowKey)}
                                              />
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  </section>
                                ))}
                                {loadingMore && (
                                  <div className="flex justify-center py-8">
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
                                        Loading older history...
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </motion.div>
                        </>
                      )}
                    </motion.div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case History Modal */}
      {selectedCase && (
        <Suspense fallback={null}>
          <CaseHistory
            id={selectedCase.id}
            caseNumber={selectedCase.caseNumber}
            onClose={() => setSelectedCase(null)}
          />
        </Suspense>
      )}
    </>,
    document.body
  );
}

console.log("[AllHistoryModal] Module loaded");
