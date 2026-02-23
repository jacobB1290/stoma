// /src/components/OverdueNotifier.jsx
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  motion,
  AnimatePresence,
  MotionConfig,
  useSpring,
  useTransform,
  useMotionValue,
} from "framer-motion";
import { parseLocalDate, DAY_MS } from "../utils/date";
import clsx from "clsx";
import { useMut } from "../context/DataContext";
import CaseHistory from "./CaseHistory";

/**
 * OverdueNotifier v29 — Mobile-responsive positioning
 * - DONE now calls toggleComplete(id, cur) + toggleCaseExclusion(id, null)
 * - Sits above editor/add-case, below CaseHistory
 * - Badge never clips when collapsed
 * - Displays "Digital" when department is "general"
 * - Mobile-responsive positioning with simple adjustments
 */

const Z_NOTIFIER = 260; // between editor (≤100/60) and CaseHistory (300)

// POSITIONING ADJUSTMENTS - Change these values to adjust position
const MOBILE_TOP = 140; // Adjust up/down for mobile
const MOBILE_RIGHT = 37; // Adjust left/right for mobile
const DESKTOP_TOP = 90; // Adjust up/down for desktop
const DESKTOP_RIGHT = 30; // Adjust left/right for desktop

export default function OverdueNotifier({
  data,
  onOpenCase,
  defaultHiddenDepts = ["C&B"],
  stageMap,
  stageKey = "stage",
  onEditCase,
  onInfoCase,
}) {
  // ===== Core utilities =====
  const normalizeString = useCallback((val) => {
    if (!val) return "";
    return String(val)
      .toUpperCase()
      .replace(/[&\s]/g, "")
      .replace(/\b(AND|THE)\b/g, "");
  }, []);

  const getDepartments = useCallback((row) => {
    const dept = row?.department ?? row?.dept;
    let depts = [];
    if (Array.isArray(dept)) {
      depts = dept.filter(Boolean).map(String);
    } else if (dept) {
      depts = [String(dept)];
    }
    // Transform "general" to "Digital"
    return depts.map((d) => (d.toLowerCase() === "general" ? "Digital" : d));
  }, []);

  const getId = useCallback((row) => {
    return (
      row?.id ?? row?.case_id ?? row?.caseId ?? row?.CaseID ?? row?.caseNumber
    );
  }, []);

  // ===== Stage logic (modifiers + fallbacks) =====
  const getStage = useCallback(
    (row) => {
      let dept = row?.department ?? row?.dept;
      if (Array.isArray(dept)) dept = dept[0];
      const deptNorm = String(dept ?? "").toLowerCase();

      const mods = Array.isArray(row?.modifiers)
        ? row.modifiers.map(String).map((s) => s.toLowerCase())
        : typeof row?.modifiers === "string"
        ? row.modifiers
            .split(/[,\s]+/)
            .map((s) => s.toLowerCase())
            .filter(Boolean)
        : [];

      const pickFromModifiers = () => {
        if (mods.includes("stage-qc")) return "Quality Control";
        if (mods.includes("stage-finishing")) return "Finishing";
        if (mods.includes("stage-production")) return "Production";
        if (mods.includes("stage-design")) return "Design";
        return null;
      };

      if (!deptNorm || deptNorm.includes("general")) {
        const m = pickFromModifiers();
        if (m) return m;
      }

      if (deptNorm.includes("metal")) {
        const s2 = row?.stage2;
        if (s2 === true || s2 === 1 || s2 === "1" || s2 === "true")
          return "Finishing";
        const m = pickFromModifiers();
        return m || "Development";
      }

      {
        const m = pickFromModifiers();
        if (m) return m;
      }

      const normalizeId = (v) =>
        v == null ? null : String(v).replace(/^0+/, "");
      const rawId = getId(row);
      const id = normalizeId(rawId);
      if (stageMap && id != null) {
        const fromMap = stageMap[id] ?? stageMap[String(rawId)];
        if (fromMap != null && String(fromMap).trim() !== "")
          return String(fromMap);
      }

      const candidates = [
        row?.[stageKey],
        row?.stage,
        row?.stageName,
        row?.status,
        row?.caseStage,
        row?.stage_name,
        row?.workflow?.stageName,
        row?.workflow?.stage,
      ];
      for (const c of candidates) {
        if (c != null && String(c).trim() !== "") return String(c);
      }

      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("Stage missing; showing Pending for case", rawId, {
          dept,
          mods,
          stage2: row?.stage2,
        });
      }
      return "Pending";
    },
    [stageMap, stageKey, getId]
  );

  // ===== Date logic =====
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const isOverdue = useCallback(
    (row) => {
      if (!row || row.completed || row.hold) return false;
      return parseLocalDate(row.due).getTime() < today.getTime();
    },
    [today]
  );

  const getDaysOverdue = useCallback(
    (row) => {
      const days = Math.floor(
        (today.getTime() - parseLocalDate(row.due).getTime()) / DAY_MS
      );
      return Math.max(0, days);
    },
    [today]
  );

  // ===== Natural language helpers =====
  const getCaseMessage = useCallback((caseItem, days) => {
    const caseNum = caseItem.caseNumber || caseItem.id;

    if (days === 0) {
      return {
        case: caseNum,
        text: "is due today. Please complete or reschedule.",
        urgency: "today",
      };
    }
    if (days === 1) {
      return {
        case: caseNum,
        text: "is 1 day overdue. Please reschedule or address.",
        urgency: "recent",
      };
    }
    if (days <= 3) {
      return {
        case: caseNum,
        text: `is ${days} days overdue. Please reschedule.`,
        urgency: "recent",
      };
    }
    if (days <= 7) {
      return {
        case: caseNum,
        text: `is ${days} days overdue. Needs attention.`,
        urgency: "moderate",
      };
    }
    if (days <= 14) {
      return {
        case: caseNum,
        text: "is over a week overdue. Urgent.",
        urgency: "urgent",
      };
    }
    return {
      case: caseNum,
      text: `is ${Math.floor(days / 7)} weeks overdue. Critical.`,
      urgency: "critical",
    };
  }, []);

  // ===== State =====
  const [hiddenDepts] = useState(() => new Set(defaultHiddenDepts));
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({
    top: DESKTOP_TOP,
    right: DESKTOP_RIGHT,
  });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [doneIds, setDoneIds] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [historyCase, setHistoryCase] = useState(null);

  const containerRef = useRef(null);

  const hiddenNormalized = useMemo(
    () => new Set(Array.from(hiddenDepts).map(normalizeString)),
    [hiddenDepts, normalizeString]
  );

  // ===== DataContext actions =====
  const { toggleCaseExclusion, toggleComplete } = useMut();

  // ===== Motion values =====
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(0, { stiffness: 150, damping: 20 });
  const springY = useSpring(0, { stiffness: 150, damping: 20 });
  const rotateX = useTransform(mouseY, [-100, 100], [5, -5]);
  const rotateY = useTransform(mouseX, [-100, 100], [-5, 5]);

  useEffect(() => {
    if (!isExpanded && isHovered) {
      const interval = setInterval(() => {
        springX.set((Math.random() - 0.5) * 4);
        springY.set((Math.random() - 0.5) * 4);
      }, 1200);
      return () => clearInterval(interval);
    } else {
      springX.set(0);
      springY.set(0);
    }
  }, [isHovered, isExpanded, springX, springY]);

  const handleMouseMove = useCallback(
    (e) => {
      if (!containerRef.current || isExpanded) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      mouseX.set(x);
      mouseY.set(y);
    },
    [isExpanded, mouseX, mouseY]
  );

  // ===== Click outside handler =====
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsExpanded(false);
        setShowAll(false);
        setOpenMenuId(null);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  // ===== Mobile-responsive Positioning =====
  useLayoutEffect(() => {
    const updatePosition = () => {
      const isMobile = window.innerWidth <= 768;

      if (isMobile) {
        setPosition({
          top: MOBILE_TOP,
          right: MOBILE_RIGHT,
        });
      } else {
        setPosition({
          top: DESKTOP_TOP,
          right: DESKTOP_RIGHT,
        });
      }
    };

    updatePosition();
    const handleUpdate = () => requestAnimationFrame(updatePosition);
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("orientationchange", handleUpdate);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("orientationchange", handleUpdate);
    };
  }, []);

  // ===== Data processing =====
  const allOverdueCases = useMemo(() => {
    return (data || [])
      .filter(isOverdue)
      .filter(
        (row) =>
          !getDepartments(row).some((d) =>
            hiddenNormalized.has(normalizeString(d))
          )
      )
      .sort((a, b) => getDaysOverdue(b) - getDaysOverdue(a));
  }, [
    data,
    isOverdue,
    getDepartments,
    hiddenNormalized,
    normalizeString,
    getDaysOverdue,
  ]);

  const visibleCases = useMemo(() => {
    return showAll ? allOverdueCases : allOverdueCases.slice(0, 3);
  }, [allOverdueCases, showAll]);

  const count = allOverdueCases.length;
  const hasMore = allOverdueCases.length > 3;

  // ===== Animation configs =====
  const bubbleSpring = {
    type: "spring",
    stiffness: 280,
    damping: 22,
    mass: 0.8,
  };

  const bubbleSize = 52;
  const baseCardWidth = 380;
  const maxCardWidth = 480;
  const maxCardHeight = 600;

  const cardDimensions = useMemo(() => {
    const isMobile = window.innerWidth <= 768;
    const headerHeight = 56;
    const footerHeight = hasMore ? 44 : 0;
    const caseItemHeight = 100;
    const containerPadding = 8;
    const itemSpacing = 8;

    const casesHeight =
      visibleCases.length * caseItemHeight +
      (visibleCases.length - 1) * itemSpacing;

    let height =
      headerHeight + casesHeight + footerHeight + containerPadding * 2;

    let width = isMobile
      ? Math.min(window.innerWidth - 32, 360)
      : baseCardWidth;

    if (!isMobile && visibleCases.length > 4) {
      width = Math.min(
        baseCardWidth + (visibleCases.length - 4) * 20,
        maxCardWidth
      );
    }

    const maxHeight = isMobile ? 500 : maxCardHeight;
    height = Math.min(height, maxHeight);

    return { width, height };
  }, [visibleCases.length, hasMore]);

  const getButtonDimensions = useCallback(() => {
    const availableHeight = 78;
    const buttonCount = 3;
    const gapSize = 4;
    const totalGaps = (buttonCount - 1) * gapSize;
    const buttonHeight = Math.floor(
      (availableHeight - totalGaps) / buttonCount
    );
    return Math.min(Math.max(buttonHeight, 22), 28);
  }, []);

  const WarningIcon = ({ className = "w-5 h-5", animate = false }) => (
    <motion.svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      animate={
        animate
          ? { strokeWidth: [2.5, 3, 2.5], rotate: [0, -2, 2, 0] }
          : undefined
      }
      transition={
        animate
          ? { duration: 3, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </motion.svg>
  );

  if (!count) return null;

  const buttonSize = getButtonDimensions();
  const iconSize = buttonSize <= 22 ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="fixed"
        style={{
          top: position.top,
          right: position.right,
          zIndex: Z_NOTIFIER,
          pointerEvents: historyCase ? "none" : "auto",
        }}
      >
        <motion.div
          ref={containerRef}
          layout
          className={clsx(
            "relative",
            isExpanded
              ? "bg-gradient-to-br from-rose-50 via-pink-50 to-rose-50 shadow-2xl"
              : "bg-gradient-to-br from-rose-500 via-pink-500 to-rose-600 shadow-2xl cursor-pointer",
            "will-change-transform"
          )}
          style={{
            width: isExpanded ? cardDimensions.width : bubbleSize,
            height: isExpanded ? cardDimensions.height : bubbleSize,
            borderRadius: isExpanded ? 16 : 24,
            transformOrigin: "right top",
            x: springX,
            y: springY,
            rotateX: isExpanded ? 0 : rotateX,
            rotateY: isExpanded ? 0 : rotateY,
            transformStyle: "preserve-3d",
            overflow: isExpanded ? "hidden" : "visible",
          }}
          initial={{ opacity: 0, scale: 0.3, rotate: -180 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={bubbleSpring}
          onClick={() => !isExpanded && setIsExpanded(true)}
          onMouseMove={handleMouseMove}
          onHoverStart={() => setIsHovered(true)}
          onHoverEnd={() => {
            setIsHovered(false);
            mouseX.set(0);
            mouseY.set(0);
          }}
          whileTap={!isExpanded ? { scale: 0.94 } : undefined}
        >
          <AnimatePresence mode="wait">
            {!isExpanded ? (
              // ===== BUBBLE =====
              <motion.div
                key="bubble"
                className="flex items-center justify-center w-full h-full text-white relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.8, rotate: 180 }}
                transition={{ duration: 0.15 }}
              >
                <motion.div
                  className="relative"
                  animate={{ y: [0, -3, 0, 2, 0], rotate: [0, -5, 5, -2, 0] }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <WarningIcon className="w-5 h-5 drop-shadow-lg" animate />
                </motion.div>

                {count > 1 && (
                  <motion.div
                    className="absolute -top-1 -right-1 bg-white text-rose-600 rounded-full min-w-[22px] h-[22px] flex items-center justify-center shadow-lg px-1 pointer-events-none"
                    style={{ zIndex: 10, transform: "translate(50%, -50%)" }}
                    initial={{ scale: 0, rotate: -360 }}
                    animate={{ scale: [1, 1.1, 1], rotate: 0 }}
                    transition={{
                      scale: {
                        delay: 0.2,
                        duration: 2.5,
                        repeat: Infinity,
                        ease: "easeInOut",
                      },
                      rotate: { type: "spring", stiffness: 200, damping: 15 },
                    }}
                  >
                    <span className="text-[11px] font-bold leading-none">
                      {count}
                    </span>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              // ===== CARD =====
              <motion.div
                key="card"
                className="flex flex-col h-full relative overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {/* Header */}
                <div className="px-4 py-3.5 border-b border-rose-200/40 bg-gradient-to-r from-rose-100/30 to-pink-100/30 flex-shrink-0">
                  <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <motion.div
                        className="text-rose-500"
                        animate={{ rotate: [0, -3, 3, 0] }}
                        transition={{
                          duration: 4,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                      >
                        <WarningIcon className="w-4 h-4" />
                      </motion.div>
                      <span className="text-sm font-semibold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                        {count === 1
                          ? "1 case needs attention"
                          : `${count} cases need attention`}
                      </span>
                    </div>

                    <motion.button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsExpanded(false);
                        setShowAll(false);
                        setOpenMenuId(null);
                      }}
                      className="relative p-1 rounded-lg hover:bg-rose-100/50 transition-colors"
                      whileHover={{ rotate: 90, scale: 1.1 }}
                      whileTap={{ scale: 0.85 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 15,
                      }}
                    >
                      <svg
                        className="w-3.5 h-3.5 text-rose-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </motion.button>
                  </div>
                </div>

                {/* Cases list */}
                <div className="flex-1 overflow-y-auto p-2">
                  <div className="space-y-2">
                    {visibleCases.map((caseItem, caseIndex) => {
                      const days = getDaysOverdue(caseItem);
                      const message = getCaseMessage(caseItem, days);
                      const departments = getDepartments(caseItem);
                      const stage = getStage(caseItem);
                      const id = String(getId(caseItem) ?? "");

                      const isBusy = busyId === id;
                      const isDoneLocal = doneIds.has(id);
                      const isMenuOpen = openMenuId === id;

                      return (
                        <motion.div
                          key={caseItem.id}
                          className={clsx(
                            "relative rounded-lg bg-white/60 backdrop-blur-sm",
                            "border border-rose-100/60",
                            "shadow-sm hover:shadow-md transition-all duration-200"
                          )}
                          whileHover={{
                            x: -2,
                            backgroundColor: "rgba(255,255,255,0.8)",
                          }}
                          transition={{ type: "spring", stiffness: 400 }}
                        >
                          <motion.div
                            className="absolute inset-0 rounded-lg bg-gradient-to-r from-rose-50/0 via-rose-50/50 to-rose-50/0"
                            initial={{ opacity: 0 }}
                            whileHover={{ opacity: 1 }}
                            transition={{ duration: 0.2 }}
                          />

                          <div className="relative px-4 py-3.5 flex items-start gap-3">
                            {/* Dot */}
                            <motion.div
                              className="relative mt-1.5 flex-shrink-0"
                              animate={
                                message.urgency === "critical"
                                  ? { scale: [1, 1.2, 1] }
                                  : undefined
                              }
                              transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }}
                            >
                              <div
                                className={clsx(
                                  "w-2 h-2 rounded-full",
                                  message.urgency === "critical"
                                    ? "bg-red-500"
                                    : message.urgency === "urgent"
                                    ? "bg-rose-500"
                                    : message.urgency === "moderate"
                                    ? "bg-rose-400"
                                    : "bg-pink-400"
                                )}
                              />
                              {message.urgency === "critical" && (
                                <motion.div
                                  className="absolute inset-0 w-2 h-2 rounded-full bg-red-500"
                                  animate={{
                                    scale: [1, 1.8],
                                    opacity: [0.5, 0],
                                  }}
                                  transition={{
                                    duration: 1.5,
                                    repeat: Infinity,
                                    ease: "easeOut",
                                  }}
                                />
                              )}
                            </motion.div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-700 leading-relaxed">
                                <span className="font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                                  Case {message.case}
                                </span>{" "}
                                <span className="text-gray-600">
                                  {message.text}
                                </span>
                              </p>
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                {departments.length > 0 && (
                                  <span className="text-xs text-gray-500 bg-gray-50/50 px-2 py-0.5 rounded">
                                    <span className="font-semibold text-gray-600">
                                      Dept:
                                    </span>{" "}
                                    {departments.join(", ")}
                                  </span>
                                )}
                                {stage && (
                                  <span className="text-xs text-gray-500 bg-gray-50/50 px-2 py-0.5 rounded">
                                    <span className="font-semibold text-gray-600">
                                      Stage:
                                    </span>{" "}
                                    {stage}
                                  </span>
                                )}
                                {isDoneLocal && (
                                  <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    Done (excluded)
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Action menu */}
                            <div
                              className="relative self-stretch flex items-center"
                              data-menu-for={id}
                              data-case-index={caseIndex}
                              style={{ minWidth: buttonSize }}
                            >
                              <AnimatePresence mode="wait">
                                {isMenuOpen ? (
                                  <div
                                    className="absolute right-0 top-0 bottom-0 flex flex-col justify-center gap-1"
                                    style={{ width: buttonSize }}
                                  >
                                    {[
                                      {
                                        label: "Edit",
                                        icon: (
                                          <svg
                                            className={iconSize}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                          >
                                            <path
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              strokeWidth={2}
                                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                            />
                                          </svg>
                                        ),
                                        action: () => {
                                          setOpenMenuId(null);
                                          onEditCase?.(caseItem);
                                          onOpenCase?.(caseItem);
                                        },
                                        color: "gray",
                                      },
                                      {
                                        label: "Info",
                                        icon: (
                                          <svg
                                            className={iconSize}
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
                                        ),
                                        action: () => {
                                          setOpenMenuId(null);
                                          setHistoryCase({
                                            id: getId(caseItem),
                                            caseNumber: caseItem.caseNumber,
                                          });
                                          onInfoCase?.(caseItem);
                                          window.dispatchEvent(
                                            new CustomEvent("case:info", {
                                              detail: { id, caseItem },
                                            })
                                          );
                                        },
                                        color: "blue",
                                      },
                                      {
                                        label: "Done",
                                        icon: (
                                          <svg
                                            className={iconSize}
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
                                        ),
                                        action: async () => {
                                          setOpenMenuId(null);
                                          setBusyId(id);
                                          setDoneIds((prev) => {
                                            const next = new Set(prev);
                                            next.add(id);
                                            return next;
                                          });

                                          // 1) Mark done in the system
                                          await toggleComplete(
                                            getId(caseItem),
                                            !!caseItem.completed
                                          );

                                          // 2) Exclude from ALL statistics
                                          const res = await toggleCaseExclusion(
                                            getId(caseItem),
                                            null,
                                            "Marked done from OverdueNotifier"
                                          );

                                          setBusyId(null);

                                          if (res?.error) {
                                            setDoneIds((prev) => {
                                              const next = new Set(prev);
                                              next.delete(id);
                                              return next;
                                            });
                                            console.error(
                                              "Exclude failed",
                                              res.error
                                            );
                                          } else {
                                            window.dispatchEvent(
                                              new CustomEvent(
                                                "case:exclude-stage-stats",
                                                {
                                                  detail: { id, caseItem },
                                                }
                                              )
                                            );
                                          }
                                        },
                                        color: "emerald",
                                        disabled: isBusy,
                                      },
                                    ].map((item, index) => (
                                      <motion.button
                                        key={item.label}
                                        role="menuitem"
                                        disabled={item.disabled}
                                        className={clsx(
                                          "flex items-center justify-center",
                                          "rounded-full shadow-md",
                                          "backdrop-blur-sm border",
                                          item.color === "emerald" &&
                                            "bg-emerald-50/90 border-emerald-300 text-emerald-600 hover:bg-emerald-100 hover:border-emerald-400",
                                          item.color === "blue" &&
                                            "bg-blue-50/90 border-blue-300 text-blue-600 hover:bg-blue-100 hover:border-blue-400",
                                          item.color === "gray" &&
                                            "bg-white/90 border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-gray-400",
                                          item.disabled &&
                                            "opacity-50 cursor-not-allowed",
                                          !item.disabled &&
                                            "hover:scale-110 active:scale-95 cursor-pointer",
                                          "transition-all duration-100"
                                        )}
                                        style={{
                                          width: buttonSize,
                                          height: buttonSize,
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!item.disabled) item.action();
                                        }}
                                        initial={{
                                          scale: 0,
                                          opacity: 0,
                                          rotate: -90,
                                        }}
                                        animate={{
                                          scale: 1,
                                          opacity: 1,
                                          rotate: 0,
                                        }}
                                        exit={{
                                          scale: 0,
                                          opacity: 0,
                                          rotate: 90,
                                        }}
                                        transition={{
                                          duration: 0.1,
                                          ease: [0.32, 0.72, 0, 1],
                                          delay: index * 0.02,
                                        }}
                                        title={item.label}
                                      >
                                        {item.disabled && isBusy ? (
                                          <motion.div
                                            className={clsx(
                                              "border-2 border-emerald-500 border-t-transparent rounded-full",
                                              buttonSize <= 22
                                                ? "w-3 h-3"
                                                : "w-3.5 h-3.5"
                                            )}
                                            animate={{ rotate: 360 }}
                                            transition={{
                                              duration: 1,
                                              repeat: Infinity,
                                              ease: "linear",
                                            }}
                                          />
                                        ) : (
                                          item.icon
                                        )}
                                      </motion.button>
                                    ))}
                                  </div>
                                ) : (
                                  <motion.button
                                    key="ellipsis"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenMenuId(id);
                                    }}
                                    aria-haspopup="menu"
                                    aria-expanded={false}
                                    className={clsx(
                                      "inline-flex items-center justify-center w-7 h-7 rounded-full",
                                      "text-gray-400 hover:text-gray-600",
                                      "hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200",
                                      "transition-all duration-200"
                                    )}
                                    title="Actions"
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.1 }}
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      viewBox="0 0 16 16"
                                      fill="currentColor"
                                    >
                                      <circle cx="8" cy="3" r="1.25" />
                                      <circle cx="8" cy="8" r="1.25" />
                                      <circle cx="8" cy="13" r="1.25" />
                                    </svg>
                                  </motion.button>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer */}
                {hasMore && (
                  <motion.button
                    onClick={() => setShowAll(!showAll)}
                    className="relative px-4 py-3 border-t border-rose-100/40 bg-gradient-to-r from-rose-50/30 to-pink-50/30 overflow-hidden group flex-shrink-0"
                    whileHover={{ backgroundColor: "rgba(254,242,242,0.5)" }}
                  >
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-rose-100/30 to-transparent"
                      initial={{ x: "-100%" }}
                      animate={{ x: "100%" }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                    <motion.p
                      className="relative text-xs text-rose-600 text-center font-semibold"
                      animate={{ opacity: [0.7, 1, 0.7] }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    >
                      {showAll
                        ? `Showing all ${count} cases • Click to collapse`
                        : `View all ${count} cases`}
                    </motion.p>
                  </motion.button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom shine */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 h-px pointer-events-none"
            style={{
              background: isExpanded
                ? "linear-gradient(90deg, transparent, rgba(244,114,182,0.3), transparent)"
                : "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
            }}
            animate={{ opacity: [0.3, 0.7, 0.3], scaleX: [0.8, 1, 0.8] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </div>

      {/* Case History modal (portal inside component, z-[300]) */}
      {historyCase && (
        <CaseHistory
          id={historyCase.id}
          caseNumber={historyCase.caseNumber}
          onClose={() => setHistoryCase(null)}
        />
      )}
    </MotionConfig>
  );
}
