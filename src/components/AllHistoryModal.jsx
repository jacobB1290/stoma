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
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { createPortal } from "react-dom";
import { db } from "../services/caseService";
import { formatHistoryAction } from "../utils/historyActionFormatter";


// Lazy load CaseHistory modal
const preloadCaseHistoryModal = () => import("./CaseHistory");
const CaseHistory = lazy(preloadCaseHistoryModal);

/* ───────── tweakable constants ───────── */
export const HEADER_SWITCH_OFFSET = 120;
const POPUP_GAP = 8;
const CLOSE_DELAY = 300;

/* ───────── global text size adjustment ───────── */
const TEXT_SIZE_DESKTOP = 10;
const TEXT_SIZE_MOBILE = 10;

const DESKTOP_SCALE = 1 + TEXT_SIZE_DESKTOP / 100;
const MOBILE_SCALE = 1 + TEXT_SIZE_MOBILE / 100;
const gentleSpring = { type: "spring", stiffness: 200, damping: 26 };

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
const processActionText = formatHistoryAction;

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
    if (preloadManager.promise) {
      return preloadManager.promise;
    }

    preloadManager.isPreloading = true;
    preloadManager.promise = (async () => {
      try {
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

  const baseFontSize = window.innerWidth < 640 ? 12 : 14;
  const scale = window.innerWidth < 640 ? MOBILE_SCALE : DESKTOP_SCALE;
  const fontSize = baseFontSize * scale;

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (row.case_id && onCaseClick) {
        onCaseClick(row.case_id, row.casenumber);
      }
    },
    [row.case_id, row.casenumber, onCaseClick]
  );

  return (
    <motion.div
      layout="position"
      className="relative px-6 py-3 cursor-pointer select-none"
      style={{ backgroundColor: rgba(TINT.ROW_WHITE) }}
      whileHover={{ backgroundColor: rgba(TINT.ROW_HOVER), x: 1 }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e);
        }
      }}
      initial={isNew ? { opacity: 0, y: -14, scale: 0.99 } : false}
      animate={isNew ? { opacity: 1, y: 0, scale: 1 } : false}
      transition={isNew ? { duration: 0.28, ease: [0.22, 1, 0.36, 1] } : false}
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

/* ───────── loading spinner (matches CaseHistory style) ───────── */
const LoadingSpinner = ({ label = "Loading history…" }) => (
  <div className="flex-1 flex flex-col items-center justify-center py-12 gap-3">
    <svg
      className="animate-spin h-8 w-8 text-gray-400"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
    <p className="text-sm text-gray-500">{label}</p>
  </div>
);

const normalizeAndGroupRows = (rows, processHistoryRow) => {
  const dueChangePattern =
    /Due date changed from (\d{1,2}-\d{1,2}) to (\d{1,2}-\d{1,2})/i;

  const processedRows = (rows ?? []).map(processHistoryRow);
  const filteredRows = processedRows.filter((row) => {
    const match = row.action.match(dueChangePattern);
    return !(match && match[1] === match[2]);
  });

  const groupedMap = new Map();
  filteredRows.forEach((row) => {
    const key = dayKey(row.created_at);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        label: fmtDate(row.created_at),
        key,
        rows: [],
        stats: {
          created: [],
          completed: [],
          rescheduled: [],
        },
      });
    }

    const group = groupedMap.get(key);
    group.rows.push(row);

    if (row.action === "Case created") group.stats.created.push(row.casenumber);
    else if (row.action === "Marked done")
      group.stats.completed.push(row.casenumber);
    else if (row.action.toLowerCase().includes("due date changed"))
      group.stats.rescheduled.push(row.casenumber);
  });

  return [...groupedMap.values()];
};

/* ───────── main modal component ───────── */
export default function AllHistoryModal({ onClose }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [current, setCurrent] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
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

  useEffect(() => {
    preloadCaseHistoryModal();
  }, []);

  /* Handle case click */
  const handleCaseClick = useCallback((caseId, caseNumber) => {
    setSelectedCase({ id: caseId, caseNumber });
  }, []);

  /* Process a single history row */
  const processHistoryRow = useCallback((row) => {
    return {
      rowId: `${row.created_at}-${row.case_id}-${row.action}`,
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
    requestAnimationFrame(() => {
      if (mountedRef.current) {
        setIsReady(true);
      }
    });
  }, []);

  /* Load first 2 days of data quickly */
  const loadInitialData = useCallback(async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgo.toISOString();

    const applyRecentRows = (recentRows) => {
      const groupedRows = normalizeAndGroupRows(recentRows, processHistoryRow);

      if (!mountedRef.current) return groupedRows;

      processedIdsRef.current.clear();
      (recentRows ?? []).forEach((row) => {
        processedIdsRef.current.add(`${row.created_at}-${row.case_id}-${row.action}`);
      });

      setCurrent(groupedRows[0]?.label || "");
      setGroups(groupedRows);
      setLoading(false);
      setLoadingMore(true);

      return groupedRows;
    };

    try {
      let provisionalGroups = null;

      if (preloadManager.data?.recentData?.length) {
        provisionalGroups = applyRecentRows(preloadManager.data.recentData);
      }

      const { data: freshRecentData, error } = await db
        .from("case_history")
        .select(
          "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
        )
        .eq("cases.archived", false)
        .gte("created_at", twoDaysAgoStr)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!mountedRef.current) return;

      const freshGroups = applyRecentRows(freshRecentData ?? []);
      preloadManager.reset();

      setTimeout(() => {
        if (mountedRef.current) {
          loadRemainingData(twoDaysAgoStr, freshGroups);
        }
      }, provisionalGroups ? 60 : 0);
    } catch (err) {
      console.error("Failed to load initial history:", err);
      if (mountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [processHistoryRow]);

  /* Load data after animation starts - prioritize first 2 days */
  useEffect(() => {
    if (animationComplete) {
      loadInitialData();
    }
  }, [animationComplete, loadInitialData]);

  /* Expand modal once initial data is ready */
  useEffect(() => {
    if (!loading) setIsExpanded(true);
  }, [loading]);

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
          const olderGroups = normalizeAndGroupRows(olderData ?? [], processHistoryRow);

          const mergedMap = new Map();
          existingGroups.forEach((group) => {
            mergedMap.set(group.key, {
              ...group,
              rows: [...group.rows],
              stats: {
                created: [...group.stats.created],
                completed: [...group.stats.completed],
                rescheduled: [...group.stats.rescheduled],
              },
            });
          });

          olderGroups.forEach((incomingGroup) => {
            const existingGroup = mergedMap.get(incomingGroup.key);
            if (!existingGroup) {
              mergedMap.set(incomingGroup.key, incomingGroup);
              return;
            }

            const seenRows = new Set(existingGroup.rows.map((row) => row.rowId));
            incomingGroup.rows.forEach((row) => {
              if (!seenRows.has(row.rowId)) {
                existingGroup.rows.push(row);
                seenRows.add(row.rowId);
              }
            });

            existingGroup.rows.sort(
              (a, b) => new Date(b.created_at) - new Date(a.created_at)
            );
            existingGroup.stats = {
              created: [...new Set(existingGroup.rows
                .filter((row) => row.action === "Case created")
                .map((row) => row.casenumber))],
              completed: [...new Set(existingGroup.rows
                .filter((row) => row.action === "Marked done")
                .map((row) => row.casenumber))],
              rescheduled: [...new Set(existingGroup.rows
                .filter((row) => row.action.toLowerCase().includes("due date changed"))
                .map((row) => row.casenumber))],
            };
          });

          const allGroups = [...mergedMap.values()].sort(
            (a, b) => new Date(b.key) - new Date(a.key)
          );

          (olderData ?? []).forEach((row) => {
            processedIdsRef.current.add(`${row.created_at}-${row.case_id}-${row.action}`);
          });

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
              className="absolute inset-0 pointer-events-auto backdrop-blur-sm"
              onClick={(e) => {
                if (!selectedCase) {
                  handleClose();
                }
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              style={{ backgroundColor: "rgba(0,0,0,0.2)" }}
            />

            {/* Main popup */}
            <AnimatePresence>
              {isReady && (
                <motion.div className="fixed inset-0 flex items-center justify-center pointer-events-none p-2 sm:p-4">
                  <motion.div
                    ref={modalRef}
                    className="w-full max-w-5xl pointer-events-auto overflow-hidden rounded-2xl border border-white/30 shadow-2xl flex flex-col"
                    layout
                    initial={{ scale: 0, opacity: 0, borderRadius: "100%" }}
                    animate={{ scale: 1, opacity: 1, borderRadius: "1rem" }}
                    exit={{ scale: 0, opacity: 0, borderRadius: "100%" }}
                    transition={{
                      scale: {
                        type: "spring",
                        stiffness: 400,
                        damping: 25,
                        duration: 0.3,
                      },
                      opacity: { duration: 0.2, ease: "easeOut" },
                      borderRadius: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
                      layout: { ...gentleSpring, duration: 0.4 },
                    }}
                    style={modalStyle}
                    onAnimationComplete={() => {
                      setAnimationComplete(true);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <LayoutGroup>
                    <motion.div
                      layout="position"
                      className="flex flex-col h-full max-h-[90vh] overflow-hidden"
                    >
                      {!isExpanded ? (
                        <motion.div
                          layout
                          className="flex flex-col items-center justify-center py-12"
                        >
                          <LoadingSpinner />
                        </motion.div>
                      ) : (
                        <>
                          {/* Header */}
                          <motion.header
                            layout="position"
                            className="flex-shrink-0 flex items-center justify-between px-6 py-4"
                            style={{ background: rgba(TINT.HEADER_WHITE) }}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              type: "spring",
                              stiffness: 280,
                              damping: 22,
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

                          {/* Sticky stats bar */}
                          <motion.div
                            layout="position"
                            className="flex-shrink-0 sticky top-0 z-20 flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3"
                            style={{ background: rgba(TINT.HEADER_WHITE) }}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              type: "spring",
                              stiffness: 280,
                              damping: 22,
                              delay: 0.04,
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
                            layout="position"
                            ref={listRef}
                            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              type: "spring",
                              stiffness: 280,
                              damping: 22,
                              delay: 0.08,
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
                                <LayoutGroup>
                                  {groups.map((g, groupIndex) => (
                                  <motion.section
                                    layout
                                    key={g.key}
                                    className="px-6 py-4 first:pt-6 last:pb-6"
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.22, delay: Math.min(groupIndex * 0.04, 0.2) }}
                                  >
                                    <motion.div
                                      layout
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
                                    </motion.div>
                                  </motion.section>
                                ))}
                                </LayoutGroup>
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
                    </LayoutGroup>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Case History Modal */}
      {selectedCase && (
        <Suspense fallback={<div className="fixed inset-0 z-[301] pointer-events-none flex items-center justify-center"><div className="pointer-events-auto rounded-xl bg-white/75 backdrop-blur-xl px-6 py-5 shadow-lg"><LoadingSpinner label="Opening case history…" /></div></div>}>
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
