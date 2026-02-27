import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  lazy,
  Suspense,
} from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from "motion/react";
import { preloadAllHistoryData } from "./AllHistoryModal";
import { useMut } from "../context/DataContext";
import CaseTable from "./CaseTable";
import clsx from "clsx";
import "../styles.css";
import { checkForDuplicates } from "../services/caseService";
import { APP_VERSION } from "../constants";
const AllHistoryModal = lazy(() => import("./AllHistoryModal"));
const DeleteCompletedModal = lazy(() => import("./DeleteCompletedModal"));
const UpdateModal = lazy(() => import("./UpdateModal"));
const EXPAND_THRESHOLD = 0.5;
const COMPLETION_THRESHOLD = 0.8;
const INTERACTION_THRESHOLD = 0.8;
const BUBBLE_GAP = 20;
const MOBILE_BUBBLE_OFFSET = 10;

// Helper: count business days between 2 ISO dates (start exclusive, end inclusive)
const businessDaysBetweenISO = (startISO, endISO) => {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end < start) return null;

  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
};

// Helper function to calculate business days ahead
const calculateBusinessDaysAhead = (days) => {
  const date = new Date();
  let addedDays = 0;

  while (addedDays < days) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      addedDays++;
    }
  }

  return date.toISOString().slice(0, 10);
};

// Component for department glow layers
const DepartmentGlow = ({
  focusedInput,
  dept,
  getFocusGlowColor,
  getRow2Position,
}) => {
  const [isInitialRender, setIsInitialRender] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsInitialRender(false);
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  if (focusedInput !== "department") return null;

  return (
    <>
      {[60, 40, 20, 0].map((offset, index) => {
        const row2Pos = getRow2Position();
        const glowWidth =
          dept === "Digital"
            ? `calc(50% - 0.5rem - ${row2Pos.x}px + ${offset * 2}px)`
            : `calc(100% - ${row2Pos.x * 2}px + ${offset * 2}px)`;
        const glowLeft = row2Pos.x - offset;

        return (
          <motion.div
            key={`dept-${index}`}
            className="absolute"
            initial={{
              opacity: 0,
              scale: 0.9 + index * 0.025,
              left: glowLeft,
              width: glowWidth,
            }}
            animate={{
              opacity: 0.3 + index * 0.1,
              scale: 1,
              left: glowLeft,
              width: glowWidth,
            }}
            exit={{
              opacity: 0,
              scale: 0.95 + index * 0.01,
            }}
            transition={{
              opacity: { duration: 0.2 },
              scale: { duration: 0.2 },
              width: {
                duration: isInitialRender ? 0 : 0.4,
                ease: [0.4, 0, 0.2, 1],
              },
              left: {
                duration: isInitialRender ? 0 : 0.4,
                ease: [0.4, 0, 0.2, 1],
              },
            }}
            style={{
              top: `${row2Pos.y - offset * 0.5}px`,
              height: `${41 + offset}px`,
              borderRadius: `${2.5 - index * 0.4}rem`,
              background:
                offset > 0
                  ? `radial-gradient(ellipse 120% 100% at center, 
                rgba(${getFocusGlowColor().r}, ${getFocusGlowColor().g}, ${
                      getFocusGlowColor().b
                    }, ${0.05 + index * 0.01}) 0%, 
                rgba(${getFocusGlowColor().r}, ${getFocusGlowColor().g}, ${
                      getFocusGlowColor().b
                    }, ${0.03 + index * 0.005}) ${30 + index * 5}%, 
                transparent ${60 + index * 5}%)`
                  : undefined,
              boxShadow:
                offset === 0
                  ? `
                0 0 0 1px rgba(${getFocusGlowColor().r}, ${
                      getFocusGlowColor().g
                    }, ${getFocusGlowColor().b}, 0.08),
                0 0 15px rgba(${getFocusGlowColor().r}, ${
                      getFocusGlowColor().g
                    }, ${getFocusGlowColor().b}, 0.06),
                0 0 30px rgba(${getFocusGlowColor().r}, ${
                      getFocusGlowColor().g
                    }, ${getFocusGlowColor().b}, 0.03)
              `
                  : undefined,
            }}
          />
        );
      })}
    </>
  );
};

const InfoRow = React.memo(({ type, title, desc }) => {
  const base =
    "flex items-start space-x-3 p-4 rounded-xl text-white font-sans text-base h-full glass-card-dark";
  const typeStyles = {
    priority: "ring-2 ring-red-500/30 bg-red-500/15",
    rush: "ring-2 ring-orange-500/30 bg-orange-500/15",
    standard: "ring-2 ring-teal-600/30 bg-teal-600/15",
  };
  const iconColors = {
    priority: "bg-red-500",
    rush: "bg-orange-500",
    standard: "bg-teal-600",
  };
  return (
    <motion.div
      className={clsx(base, typeStyles[type] || typeStyles.standard)}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
    >
      {type !== "standard" && (
        <span className={clsx("h-12 w-1 rounded-full", iconColors[type])} />
      )}
      <div>
        <div className="font-medium text-gray-100">{title}</div>
        <div className="text-sm text-gray-300 mt-0.5">{desc}</div>
      </div>
    </motion.div>
  );
});
InfoRow.displayName = "InfoRow";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: "easeOut" },
  },
};

const ModalPlaceholder = () => null;

export default function Editor({ data, deptDefault }) {
  const shouldReduceMotion = useReducedMotion();
  const {
    addOrUpdate,
    toggleComplete,
    toggleHold,
    toggleNewAccount,
    toggleRush,
    togglePriority,
    toggleStage2,
    removeCase,
    removeAllCompleted,
    removeCompletedInRange,
    refreshCases,
  } = useMut();

  // form state
  const [id, setId] = useState(null);
  const [caseNo, setCaseNo] = useState("");
  const [caseNumberOnly, setCaseNumberOnly] = useState("");
  const [notes, setNotes] = useState("");
  const [showSplitInput, setShowSplitInput] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [dept, setDept] = useState(deptDefault || "Digital");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState(false);
  const [rush, setRush] = useState(false);
  const [hold, setHold] = useState(false);
  const [newAccount, setNewAccount] = useState(false);
  const [caseType, setCaseType] = useState("general");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [flexDetected, setFlexDetected] = useState(false);
  const [priorityDetected, setPriorityDetected] = useState(false);
  const [rushDetected, setRushDetected] = useState(false);
  const [bbsDetected, setBbsDetected] = useState(false);

  // Focus tracking state
  const [focusedInput, setFocusedInput] = useState(null);
  const [focusedFilter, setFocusedFilter] = useState(null);
  const [_previousFocusedInput, setPreviousFocusedInput] = useState(null);

  // Original values for edit mode
  const [originalValues, setOriginalValues] = useState(null);

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [_isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const duplicateCheckTimeoutRef = useRef(null);
  const [notificationPosition, setNotificationPosition] = useState({
    top: 0,
    left: 0,
  });

  // UI state
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("All");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showDel, setShowDel] = useState(false);
  // Info bar now defaults to false, reads from localStorage
  const [showBar, setShowBar] = useState(() =>
    JSON.parse(localStorage.getItem("showInfoBar") ?? "false")
  );
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  // Settings for locked form (no collapse animation)
  const [lockAddCaseCard, setLockAddCaseCard] = useState(() =>
    JSON.parse(localStorage.getItem("lockAddCaseCard") ?? "false")
  );

  // Settings for case table dividers
  const [showCaseTableDividers, setShowCaseTableDividers] = useState(() =>
    JSON.parse(localStorage.getItem("showCaseTableDividers") ?? "true")
  );

  // Settings for disabling automations (off by default)
  const [disableAutomations, setDisableAutomations] = useState(() =>
    JSON.parse(localStorage.getItem("disableAutomations") ?? "true")
  );

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [formBounds, setFormBounds] = useState({
    height: 0,
    top: 0,
    centerX: 0,
  });
  const [formDimensions, setFormDimensions] = useState({ width: 0, height: 0 });
  const [navbarHeight, setNavbarHeight] = useState(60);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [historyPreloaded, setHistoryPreloaded] = useState(false);
  const [formLayout, setFormLayout] = useState("desktop");
  const [_canFitOnRight, setCanFitOnRight] = useState(true);

  const forceOpen = search.trim().length > 0;

  // refs
  const formRef = useRef(null);
  const mainRef = useRef(null);
  const containerRef = useRef(null);
  const filtersRef = useRef(null);
  const scrollRAF = useRef(null);
  const measureRAF = useRef(null);
  const lastScrollY = useRef(0);
  const resizeObserverRef = useRef(null);
  const initialMountTimer = useRef(null);
  const lastSavedTimer = useRef(null);
  const errorTimer = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const notesInputRef = useRef(null);
  const caseInputRef = useRef(null);
  const singleInputRef = useRef(null);
  const dateInputRef = useRef(null);
  const preloadTimeoutRef = useRef(null);
  const notificationResizeObserverRef = useRef(null);
  const layoutObserverRef = useRef(null);
  const saveButtonRef = useRef(null);
  const caseTypeSelectorRef = useRef(null);
  const flexDetectedTimer = useRef(null);
  const priorityDetectedTimer = useRef(null);
  const rushDetectedTimer = useRef(null);
  const bbsDetectedTimer = useRef(null);

  // Track if the user manually chose a dept/due date so automations don't fight them
  const deptTouchedRef = useRef(false);
  const dueTouchedRef = useRef(false);

  // Track whether due was set by an automation (so we can safely update/revert it)
  const dueAutoReasonRef = useRef(null); // 'caseNumber' | 'notes' | 'deptSelect' | 'dateFocusDefault' | 'caseNumberRevert' | null
  const dueAutoDaysRef = useRef(null);
  const dueAutoValueRef = useRef(null);

  // Tracks which automation last set the department (so we can safely reverse it)
  const deptAutoReasonRef = useRef(null); // 'caseNumber' | 'notes' | 'dueDate' | null

  // Debounce case-number analysis so we wait for the full number before deciding
  const caseNumberAnalysisTimer = useRef(null);

  const { scrollY } = useScroll({ container: mainRef });
  const animationProgress = useMotionValue(0);
  const rawProgress = useMotionValue(0);

  // When locked, scale stays at 1
  const scale = useTransform(
    animationProgress,
    [0, 1],
    lockAddCaseCard ? [1, 1] : [1, 0.15]
  );

  const borderRadius = useTransform(animationProgress, (p) => {
    if (lockAddCaseCard) return "16px";
    const base = 16;
    let maxR;
    if (isMobile) {
      maxR = 9999;
    } else {
      maxR = Math.min(formDimensions.height / 2 || 250, 500);
    }
    const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return `${base + (maxR - base) * eased}px`;
  });

  const bubbleOffset =
    navbarHeight + BUBBLE_GAP + (isMobile ? MOBILE_BUBBLE_OFFSET : 0);

  const yPosition = useTransform(
    animationProgress,
    [0, 0.5, 1],
    lockAddCaseCard
      ? [0, 0, 0]
      : [
          0,
          isExpanding ? 0 : (-formBounds.top - bubbleOffset) * 0.5,
          isExpanding ? 0 : -formBounds.top - bubbleOffset,
        ]
  );

  const boxShadowTransform = useTransform(
    animationProgress,
    [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    lockAddCaseCard
      ? Array(11).fill(
          "0 10px 15px -3px rgba(0,0,0,0.08),0 4px 6px -2px rgba(0,0,0,0.04)"
        )
      : [
          "0 10px 15px -3px rgba(0,0,0,0.08),0 4px 6px -2px rgba(0,0,0,0.04)",
          "0 12px 20px -4px rgba(0,0,0,0.1),0 6px 10px -3px rgba(0,0,0,0.05)",
          "0 14px 25px -5px rgba(0,0,0,0.12),0 8px 15px -4px rgba(0,0,0,0.06)",
          "0 16px 30px -6px rgba(0,0,0,0.14),0 10px 20px -5px rgba(0,0,0,0.07)",
          "0 20px 40px -8px rgba(0,0,0,0.16),0 12px 25px -6px rgba(0,0,0,0.08)",
          "0 25px 50px -10px rgba(0,0,0,0.18),0 15px 30px -7px rgba(0,0,0,0.09)",
          "0 30px 60px -12px rgba(0,0,0,0.2),0 18px 35px -8px rgba(0,0,0,0.1)",
          "0 35px 70px -14px rgba(0,0,0,0.22),0 20px 40px -9px rgba(0,0,0,0.11)",
          "0 40px 80px -16px rgba(0,0,0,0.24),0 22px 45px -10px rgba(0,0,0,0.12)",
          "0 45px 90px -18px rgba(0,0,0,0.26),0 25px 50px -12px rgba(0,0,0,0.13)",
          "0 50px 100px -20px rgba(0,0,0,0.28),0 30px 60px -15px rgba(0,0,0,0.14)",
        ]
  );

  // When locked, content always visible
  const contentOpacity = useTransform(
    animationProgress,
    [0, 0.8, 1],
    lockAddCaseCard ? [1, 1, 1] : [1, 0.2, 0]
  );
  const contentScale = useTransform(
    animationProgress,
    [0, 1],
    lockAddCaseCard ? [1, 1] : [1, 0.8]
  );
  const collapsedOpacity = useTransform(
    animationProgress,
    [0, 0.2, 1],
    lockAddCaseCard ? [0, 0, 0] : [0, 0, 1]
  );
  const collapsedScale = useTransform(
    animationProgress,
    [0, 1],
    lockAddCaseCard ? [0.8, 0.8] : [0.8, 1]
  );

  const getBusinessDaysAhead = useCallback((days) => {
    return calculateBusinessDaysAhead(days);
  }, []);

  // Default due days by department (based on real usage patterns)
  const defaultDueDaysByDept = useMemo(() => {
    if (dept === "C&B") return 11;
    if (dept === "Metal") return 6;
    // Digital
    return 4;
  }, [dept]);

  const defaultDueDate = useMemo(
    () => getBusinessDaysAhead(defaultDueDaysByDept),
    [getBusinessDaysAhead, defaultDueDaysByDept]
  );

  const setDueAuto = useCallback(
    (days, reason) => {
      const iso = getBusinessDaysAhead(days);
      setDue(iso);
      dueAutoReasonRef.current = reason;
      dueAutoDaysRef.current = days;
      dueAutoValueRef.current = iso;
    },
    [getBusinessDaysAhead]
  );

  const maybeAutoSetDue = useCallback(
    (days, reason) => {
      if (dueTouchedRef.current) return;
      // If due is empty OR was set by an automation, keep it synced to the inferred dept
      if (!due || dueAutoReasonRef.current) {
        setDueAuto(days, reason);
      }
    },
    [due, setDueAuto]
  );

  const handleCaseNumberAnalysis = useCallback(
    (rawCaseNum, opts = {}) => {
      if (id) return; // don’t run automations while editing
      if (disableAutomations) return; // skip if automations are disabled

      const { immediate = false } = opts;
      const txt = String(rawCaseNum || "").trim();

      // Debounce: wait for the user to finish typing the case number
      if (caseNumberAnalysisTimer.current) {
        clearTimeout(caseNumberAnalysisTimer.current);
        caseNumberAnalysisTimer.current = null;
      }

      const revertCaseNumberCAndBToDigital = () => {
        if (
          !deptTouchedRef.current &&
          deptAutoReasonRef.current === "caseNumber" &&
          dept === "C&B"
        ) {
          setDept("Digital");
          deptAutoReasonRef.current = null;

          // If due was auto-set by this case-number rule, keep due aligned too
          if (
            !dueTouchedRef.current &&
            dueAutoReasonRef.current === "caseNumber"
          ) {
            setDueAuto(4, "caseNumberRevert");
          }
        }
      };

      // If user clears the field, undo a case-number-based auto dept (if we set it)
      if (!txt) {
        revertCaseNumberCAndBToDigital();
        return;
      }

      const delay = immediate ? 0 : 900;

      caseNumberAnalysisTimer.current = setTimeout(() => {
        // Only trust digit-count when the case number is strictly numeric
        if (!/^\d+$/.test(txt)) return;

        // If the user already picked a due date manually, let the due-date rules win
        if (dueTouchedRef.current) return;

        // 1–2 digits is a very strong C&B signal in your real data
        if (txt.length <= 2) {
          if (
            !deptTouchedRef.current &&
            deptAutoReasonRef.current !== "notes" &&
            dept !== "Metal"
          ) {
            setDept("C&B");
            deptAutoReasonRef.current = "caseNumber";

            // If user hasn't touched due, keep it synced to the inferred dept
            maybeAutoSetDue(11, "caseNumber");
          }
          return;
        }

        // 3+ digits is almost never C&B. If we auto-set C&B earlier, revert to Digital.
        revertCaseNumberCAndBToDigital();
      }, delay);
    },
    [id, dept, due, maybeAutoSetDue, setDueAuto, disableAutomations]
  );

  const hasChanges = useMemo(() => {
    if (!id || !originalValues) return false;
    const currentCaseNumber = showSplitInput
      ? caseNumberOnly + (notes ? " " + notes : "")
      : caseNo;
    return (
      currentCaseNumber !== originalValues.caseNumber ||
      dept !== originalValues.dept ||
      due !== originalValues.due ||
      priority !== originalValues.priority ||
      rush !== originalValues.rush ||
      hold !== originalValues.hold ||
      newAccount !== originalValues.newAccount ||
      caseType !== originalValues.caseType
    );
  }, [
    id,
    originalValues,
    caseNo,
    caseNumberOnly,
    notes,
    showSplitInput,
    dept,
    due,
    priority,
    rush,
    hold,
    newAccount,
    caseType,
  ]);

  const check3DFlexPattern = useCallback((text) => {
    const patterns = [
      /\b3d\s*flex\b/i,
      /\b3dflex\b/i,
      /\bthree\s*d\s*flex\b/i,
      /\bthreed\s*flex\b/i,
      /\bflex\s*3d\b/i,
      /\bflex3d\b/i,
      /\b3d\s*flx\b/i,
      /\b3dflx\b/i,
      /\bed\s*flex\b/i,
      /\bedflex\b/i,
      /\b3d\s*felx\b/i,
      /\b3d\s*flexx\b/i,
      /\b3d\s*flix\b/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return { found: true, matchedText: match[0] };
      }
    }
    return { found: false, matchedText: null };
  }, []);

  const checkBBSPattern = useCallback((text) => {
    const patterns = [
      /base\s*plate/i,
      /baseplate/i,
      /base\s*-?\s*plate/i,
      /basplate/i,
      /base\s*plat/i,
      /bas\s*plate/i,
      /b\s*plate/i,
      /bp/i,
      /bite\s*rim/i,
      /biterim/i,
      /bite\s*-?\s*rim/i,
      /bit\s*rim/i,
      /bite\s*rims/i,
      /b\s*rim/i,
      /br/i,
      /splint/i,
      /splnt/i,
      /splin/i,
      /splints/i,
      /night\s*guard/i,
      /nightguard/i,
      /ng/i,
      /mouth\s*guard/i,
      /mouthguard/i,
      /\bbbs\b/i,
      /b\.b\.s/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return { found: true, matchedText: match[0] };
      }
    }
    return { found: false, matchedText: null };
  }, []);

  const checkTimePattern = useCallback((text) => {
    const timePatterns = [
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM|a\.m\.|p\.m\.)\b/,
      /\b(\d{1,2}):(\d{2})\b/,
      /\b(\d{1,2})\s*o['']?clock\b/i,
      /\bat\s+(\d{1,2})\b/i,
      /\b(\d{1,2})\s*(hrs?|hours?)\b/i,
      /\bappt?\s*(?:at\s*)?(\d{1,2})/i,
      /\bappointment\s*(?:at\s*)?(\d{1,2})/i,
      /\b(\d{1,2})\s*(?:in\s*the\s*)?(morning|afternoon|evening)\b/i,
      /\bnoon\b/i,
      /\bmidday\b/i,
      /\bmidnight\b/i,
    ];

    for (const pattern of timePatterns) {
      if (pattern.test(text)) {
        return { found: true };
      }
    }

    return { found: false };
  }, []);

  const checkTomorrowPattern = useCallback(
    (text) => {
      const lowerText = text.toLowerCase();
      const tomorrowPatterns = [
        "tomorrow",
        "tmrw",
        "tmr",
        "tmw",
        "tomo",
        "tom",
        "2morrow",
        "2moro",
        "2mrw",
        "2mro",
        "2mor",
        "tomm",
        "tommorow",
        "tommorrow",
        "tomorow",
        "tomoro",
        "next day",
        "nxt day",
        "following day",
        "folowing day",
        "foll day",
        "nxt morning",
        "next morning",
        "tomorrow morning",
        "tmrw morning",
        "tomorrow afternoon",
        "tmrw afternoon",
      ];

      let hasTomorrow = false;
      for (const pattern of tomorrowPatterns) {
        if (lowerText.includes(pattern)) {
          hasTomorrow = true;
          break;
        }
      }

      if (!hasTomorrow) {
        return { found: false };
      }

      const hasTime = checkTimePattern(text).found;

      return { found: hasTime };
    },
    [checkTimePattern]
  );

  const checkTodayPattern = useCallback((text) => {
    const lowerText = text.toLowerCase();
    const todayPatterns = [
      "today",
      "tday",
      "tdy",
      "2day",
      "2dy",
      "same day",
      "sameday",
      "this morning",
      "this afternoon",
      "this evening",
      "later today",
      "ltr today",
      "ltr tdy",
    ];

    for (const pattern of todayPatterns) {
      if (lowerText.includes(pattern)) {
        return true;
      }
    }

    return false;
  }, []);

  const checkScanPattern = useCallback((text) => {
    const lowerText = text.toLowerCase();
    const scanPatterns = [
      "scan",
      "new scan",
      "scanbody",
      "scan body",
      "rescan",
      "re-scan",
    ];
    return scanPatterns.some((p) => lowerText.includes(p));
  }, []);

  const checkMetalKeywordPattern = useCallback((text) => {
    const lowerText = text.toLowerCase();
    const metalPatterns = [
      "acetal",
      "titanium",
      "clasp",
      "clasps",
      "uni",
      "unilateral",
      "clear",
    ];
    return metalPatterns.some((p) => lowerText.includes(p));
  }, []);

  const checkHoldPattern = useCallback((text) => {
    const lowerText = text.toLowerCase();
    const holdPatterns = [
      "front office",
      "frontoffice",
      "in the mail",
      "part in mail",
      "mail",
      "customs",
      "stuck",
      "waiting",
    ];
    return holdPatterns.some((p) => lowerText.includes(p));
  }, []);

  const handleNotesAnalysis = useCallback(
    (text) => {
      let processedText = text;

      // Skip automations if disabled
      if (disableAutomations) return processedText;

      // Product-type detection (Digital only)
      if (dept === "Digital") {
        const flexResult = check3DFlexPattern(text);
        if (flexResult.found && flexResult.matchedText) {
          setCaseType("flex");
          setFlexDetected(true);
          if (flexDetectedTimer.current)
            clearTimeout(flexDetectedTimer.current);
          flexDetectedTimer.current = setTimeout(() => {
            setFlexDetected(false);
          }, 1500);
          processedText = processedText
            .replace(flexResult.matchedText, "")
            .trim();
        }

        const bbsResult = checkBBSPattern(text);
        if (bbsResult.found && bbsResult.matchedText) {
          setCaseType("bbs");
          setBbsDetected(true);
          if (bbsDetectedTimer.current) clearTimeout(bbsDetectedTimer.current);
          bbsDetectedTimer.current = setTimeout(() => {
            setBbsDetected(false);
          }, 1500);
          processedText = processedText
            .replace(bbsResult.matchedText, "")
            .trim();
        }
      }

      // Dept inference from notes (Metal materials are extremely strong signals)
      if (!id && !deptTouchedRef.current && checkMetalKeywordPattern(text)) {
        setDept("Metal");
        deptAutoReasonRef.current = "notes";

        // If due was auto-set (or still empty), keep it synced to Metal's normal window
        maybeAutoSetDue(6, "notes");
      }

      // Hold inference from notes
      if (!id && checkHoldPattern(text) && !hold) {
        setHold(true);
      }

      // Scan language almost always means urgency
      if (!id && checkScanPattern(text) && !priority) {
        setPriority(true);
        setPriorityDetected(true);
        if (priorityDetectedTimer.current)
          clearTimeout(priorityDetectedTimer.current);
        priorityDetectedTimer.current = setTimeout(() => {
          setPriorityDetected(false);
        }, 1500);
      }

      const tomorrowResult = checkTomorrowPattern(text);
      if (tomorrowResult.found && !rush) {
        setRush(true);
        setRushDetected(true);
        if (rushDetectedTimer.current) clearTimeout(rushDetectedTimer.current);
        rushDetectedTimer.current = setTimeout(() => {
          setRushDetected(false);
        }, 1500);
      } else {
        const hasToday = checkTodayPattern(text);
        const timeResult = checkTimePattern(text);
        if ((hasToday || timeResult.found) && !priority) {
          setPriority(true);
          setPriorityDetected(true);
          if (priorityDetectedTimer.current)
            clearTimeout(priorityDetectedTimer.current);
          priorityDetectedTimer.current = setTimeout(() => {
            setPriorityDetected(false);
          }, 1500);
        }
      }

      return processedText;
    },
    [
      dept,
      check3DFlexPattern,
      checkBBSPattern,
      checkScanPattern,
      checkMetalKeywordPattern,
      checkHoldPattern,
      maybeAutoSetDue,
      checkTimePattern,
      checkTomorrowPattern,
      checkTodayPattern,
      priority,
      rush,
      hold,
      id,
      disableAutomations,
    ]
  );

  // Listen for settings changes
  useEffect(() => {
    const handleSettingsChange = () => {
      setShowBar(JSON.parse(localStorage.getItem("showInfoBar") ?? "false"));
      setLockAddCaseCard(
        JSON.parse(localStorage.getItem("lockAddCaseCard") ?? "false")
      );
      setShowCaseTableDividers(
        JSON.parse(localStorage.getItem("showCaseTableDividers") ?? "true")
      );
      setDisableAutomations(
        JSON.parse(localStorage.getItem("disableAutomations") ?? "true")
      );
    };
    window.addEventListener("settings-changed", handleSettingsChange);
    return () =>
      window.removeEventListener("settings-changed", handleSettingsChange);
  }, []);

  useEffect(() => {
    if (!formRef.current) return;
    const detectFormLayout = () => {
      const formEl = formRef.current;
      if (!formEl) return;
      const formRect = formEl.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const notificationWidth = 384;
      const rightSpace = viewportWidth - formRect.right;
      const minRightMargin = -150;
      const canFitRight = rightSpace >= notificationWidth + minRightMargin;
      setCanFitOnRight(canFitRight);
      const firstRow = formEl.querySelector(".grid.gap-4.sm\\:grid-cols-2");
      if (!firstRow) return;
      const inputs = firstRow.querySelectorAll("input");
      if (inputs.length < 2) return;
      const caseInput = inputs[0].getBoundingClientRect();
      const dateInput = inputs[1].getBoundingClientRect();
      if (Math.abs(caseInput.top - dateInput.top) < 10 && canFitRight) {
        setFormLayout("desktop");
      } else if (Math.abs(caseInput.top - dateInput.top) < 10 && !canFitRight) {
        setFormLayout("tablet");
      } else {
        setFormLayout("mobile");
      }
    };
    detectFormLayout();
    if (layoutObserverRef.current) {
      layoutObserverRef.current.disconnect();
    }
    layoutObserverRef.current = new ResizeObserver(detectFormLayout);
    layoutObserverRef.current.observe(formRef.current);
    window.addEventListener("resize", detectFormLayout);
    return () => {
      if (layoutObserverRef.current) {
        layoutObserverRef.current.disconnect();
      }
      window.removeEventListener("resize", detectFormLayout);
    };
  }, [isHydrated, showDuplicateWarning]);

  useEffect(() => {
    if (showDuplicateWarning && formRef.current && formLayout === "desktop") {
      const updateNotificationPosition = () => {
        const rect = formRef.current.getBoundingClientRect();
        const scrollTop =
          window.pageYOffset || document.documentElement.scrollTop;
        setNotificationPosition({
          top: rect.top + scrollTop,
          left: rect.right + 16,
        });
      };
      updateNotificationPosition();
      if (notificationResizeObserverRef.current) {
        notificationResizeObserverRef.current.disconnect();
      }
      notificationResizeObserverRef.current = new ResizeObserver(
        updateNotificationPosition
      );
      if (formRef.current) {
        notificationResizeObserverRef.current.observe(formRef.current);
      }
      window.addEventListener("resize", updateNotificationPosition);
      window.addEventListener("scroll", updateNotificationPosition);
      return () => {
        if (notificationResizeObserverRef.current) {
          notificationResizeObserverRef.current.disconnect();
        }
        window.removeEventListener("resize", updateNotificationPosition);
        window.removeEventListener("scroll", updateNotificationPosition);
      };
    }
  }, [showDuplicateWarning, formLayout]);

  useEffect(() => {
    if (duplicateCheckTimeoutRef.current) {
      clearTimeout(duplicateCheckTimeoutRef.current);
    }

    const caseToCheck = showSplitInput ? caseNumberOnly : caseNo.split(" ")[0];
    if (!caseToCheck.trim() || caseToCheck.trim().length < 1) {
      setDuplicates([]);
      setShowDuplicateWarning(false);
      return;
    }

    duplicateCheckTimeoutRef.current = setTimeout(async () => {
      setIsCheckingDuplicates(true);
      try {
        const foundDuplicates = await checkForDuplicates(caseToCheck, id);
        if (foundDuplicates.length > 0) {
          setDuplicates(foundDuplicates);
          setShowDuplicateWarning(true);
          playWarningSound();
        } else {
          setDuplicates([]);
          setShowDuplicateWarning(false);
        }
      } catch (error) {
        console.error("Error checking duplicates:", error);
      } finally {
        setIsCheckingDuplicates(false);
      }
    }, 500);

    return () => {
      if (duplicateCheckTimeoutRef.current) {
        clearTimeout(duplicateCheckTimeoutRef.current);
      }
    };
  }, [caseNo, caseNumberOnly, showSplitInput, id]);

  const playWarningSound = () => {
    try {
      const audio = new Audio(
        "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE"
      );
      audio.volume = 0.1;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    const defer = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    defer(() => setIsHydrated(true));
  }, []);

  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 2000));
    const id = idle(() => {
      preloadAllHistoryModal()
        .then(() => preloadAllHistoryData())
        .then(() => setHistoryPreloaded(true))
        .catch(() => {});
    });
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, []);

  const preloadAllHistoryModal = () => import("./AllHistoryModal");

  const handleHistoryHover = useCallback(() => {
    if (!historyPreloaded) {
      preloadAllHistoryModal();
      preloadAllHistoryData()
        .then(() => setHistoryPreloaded(true))
        .catch(() => {});
    }
  }, [historyPreloaded]);

  useEffect(() => {
    return () => {
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
      if (measureRAF.current) cancelAnimationFrame(measureRAF.current);
      if (initialMountTimer.current) clearTimeout(initialMountTimer.current);
      if (lastSavedTimer.current) clearTimeout(lastSavedTimer.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (preloadTimeoutRef.current) clearTimeout(preloadTimeoutRef.current);
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
      if (duplicateCheckTimeoutRef.current)
        clearTimeout(duplicateCheckTimeoutRef.current);
      if (notificationResizeObserverRef.current)
        notificationResizeObserverRef.current.disconnect();
      if (layoutObserverRef.current) layoutObserverRef.current.disconnect();
      if (flexDetectedTimer.current) clearTimeout(flexDetectedTimer.current);
      if (priorityDetectedTimer.current)
        clearTimeout(priorityDetectedTimer.current);
      if (rushDetectedTimer.current) clearTimeout(rushDetectedTimer.current);
      if (bbsDetectedTimer.current) clearTimeout(bbsDetectedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (isExpanding && mainRef.current) {
      const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      mainRef.current.addEventListener("scroll", prevent, { passive: false });
      mainRef.current.addEventListener("wheel", prevent, { passive: false });
      mainRef.current.addEventListener("touchmove", prevent, {
        passive: false,
      });
      return () => {
        if (mainRef.current) {
          mainRef.current.removeEventListener("scroll", prevent);
          mainRef.current.removeEventListener("wheel", prevent);
          mainRef.current.removeEventListener("touchmove", prevent);
        }
      };
    }
  }, [isExpanding]);

  const forceCompleteAnimation = useCallback(() => {
    if (shouldReduceMotion || lockAddCaseCard) {
      setIsCollapsed(false);
      rawProgress.set(0);
      animationProgress.set(0);
      return;
    }
    animate(animationProgress, 0, {
      type: "spring",
      stiffness: 300,
      damping: 25,
      onComplete: () => {
        setIsCollapsed(false);
        rawProgress.set(0);
      },
    });
  }, [animationProgress, rawProgress, shouldReduceMotion, lockAddCaseCard]);

  const _forceCollapseAnimation = useCallback(() => {
    if (shouldReduceMotion || lockAddCaseCard) {
      if (!lockAddCaseCard) {
        setIsCollapsed(true);
        rawProgress.set(1);
        animationProgress.set(1);
      }
      return;
    }
    animate(animationProgress, 1, {
      type: "spring",
      stiffness: 300,
      damping: 25,
      onComplete: () => {
        setIsCollapsed(true);
        rawProgress.set(1);
      },
    });
  }, [animationProgress, rawProgress, shouldReduceMotion, lockAddCaseCard]);

  useEffect(() => {
    if (!isHydrated) return;
    const detectDevice = () => {
      const ua = navigator.userAgent;
      const mobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          ua
        ) || window.innerWidth < 768;
      setIsMobile(mobile);
      // Measure actual rendered header height; fall back to device-type defaults
      const headerEl = document.querySelector("header");
      if (headerEl) {
        setNavbarHeight(headerEl.getBoundingClientRect().height);
      } else {
        setNavbarHeight(mobile ? 56 : 64);
      }
    };
    detectDevice();
    window.addEventListener("resize", detectDevice);
    return () => window.removeEventListener("resize", detectDevice);
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    const measureForm = () => {
      if (measureRAF.current) cancelAnimationFrame(measureRAF.current);
      measureRAF.current = requestAnimationFrame(() => {
        if (formRef.current && containerRef.current) {
          const rect = formRef.current.getBoundingClientRect();
          setFormBounds({
            height: rect.height,
            top: containerRef.current.offsetTop,
            centerX: rect.left + rect.width / 2,
          });
          setFormDimensions({ width: rect.width, height: rect.height });
        }
      });
    };
    measureForm();
    resizeObserverRef.current = new ResizeObserver(measureForm);
    if (formRef.current) resizeObserverRef.current.observe(formRef.current);
    return () => {
      if (measureRAF.current) cancelAnimationFrame(measureRAF.current);
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [isHydrated]);

  useEffect(() => {
    // Skip scroll-based collapse when locked
    if (!isHydrated || isExpanding || lockAddCaseCard) return;
    let lastUpdate = 0;
    const throttleMs = 16;
    const unsubscribe = scrollY.on("change", (latest) => {
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      lastUpdate = now;
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
      scrollRAF.current = requestAnimationFrame(() => {
        if (formBounds.height === 0) return;
        lastScrollY.current = latest;
        const formScrollPosition = latest - formBounds.top;
        const completionPoint = formBounds.height * COMPLETION_THRESHOLD;
        const expandPoint = -formBounds.height * EXPAND_THRESHOLD;
        let progress = 0;
        if (formScrollPosition > 0) {
          progress = Math.min(formScrollPosition / completionPoint, 1);
          rawProgress.set(progress);
          if (!shouldReduceMotion) {
            const eased =
              progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            animationProgress.set(eased);
          } else animationProgress.set(progress);
        } else {
          rawProgress.set(0);
          animationProgress.set(0);
        }
        if (progress >= 1 && !isCollapsed) {
          setIsCollapsed(true);
          animationProgress.set(1);
          rawProgress.set(1);
        } else if (formScrollPosition < expandPoint && isCollapsed) {
          forceCompleteAnimation();
        } else if (latest <= 10 && isCollapsed) {
          forceCompleteAnimation();
        } else if (!isCollapsed && progress < 1 && progress >= 0) {
          setIsCollapsed(false);
        }
      });
    });
    return () => {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }
      unsubscribe();
    };
  }, [
    scrollY,
    isCollapsed,
    formBounds,
    animationProgress,
    rawProgress,
    isExpanding,
    forceCompleteAnimation,
    shouldReduceMotion,
    isHydrated,
    lockAddCaseCard,
  ]);

  const handleFormClick = useCallback(() => {
    // When locked, no collapse/expand behavior
    if (lockAddCaseCard) return;

    if (isCollapsed) {
      setIsExpanding(true);
      setIsCollapsed(false);
      if (shouldReduceMotion) {
        animationProgress.set(0);
        rawProgress.set(0);
        setIsExpanding(false);
        return;
      }
      animate(animationProgress, 0, {
        type: "spring",
        stiffness: 300,
        damping: 25,
        onComplete: () => {
          rawProgress.set(0);
          setIsExpanding(false);
        },
      });
    }
  }, [
    isCollapsed,
    animationProgress,
    rawProgress,
    shouldReduceMotion,
    lockAddCaseCard,
  ]);

  useEffect(() => {
    const fn = () =>
      setShowBar(JSON.parse(localStorage.getItem("showInfoBar") ?? "false"));
    window.addEventListener("infobar-toggle", fn);
    return () => window.removeEventListener("infobar-toggle", fn);
  }, []);

  useEffect(() => {
    if (showSplitInput) {
      setCaseNo(caseNumberOnly + (notes ? " " + notes : ""));
    }
  }, [caseNumberOnly, notes, showSplitInput]);

  const reset = useCallback(() => {
    setId(null);
    setCaseNo("");
    setCaseNumberOnly("");
    setNotes("");
    setShowSplitInput(false);
    setIsReverting(false);
    setDept(deptDefault || "Digital");
    setDue(""); // Reset to empty for placeholder
    setPriority(false);
    setRush(false);
    setHold(false);
    setNewAccount(false);
    setCaseType("general");
    setDuplicates([]);
    setShowDuplicateWarning(false);
    setOriginalValues(null);
    setSaveError(null);
    setErrorMessage("");
    setFlexDetected(false);
    setPriorityDetected(false);
    setRushDetected(false);
    setBbsDetected(false);
    setFocusedInput(null);
    setPreviousFocusedInput(null);

    // Reset automation guards for next case creation
    deptTouchedRef.current = false;
    dueTouchedRef.current = false;
    deptAutoReasonRef.current = null;
    dueAutoReasonRef.current = null;
    dueAutoDaysRef.current = null;
    dueAutoValueRef.current = null;
    if (caseNumberAnalysisTimer.current) {
      clearTimeout(caseNumberAnalysisTimer.current);
      caseNumberAnalysisTimer.current = null;
    }
  }, [deptDefault]);

  const save = useCallback(async () => {
    if (isSubmitting) return;
    const finalCaseNo = showSplitInput
      ? caseNumberOnly + (notes ? " " + notes : "")
      : caseNo;
    if (!finalCaseNo.trim() || !due) return;
    setIsSubmitting(true);
    setSaveError(null);
    setErrorMessage("");
    try {
      const result = await addOrUpdate(
        {
          caseNumber: finalCaseNo,
          department: dept,
          due,
          priority,
          rush,
          hold,
          newAccount,
          caseType,
        },
        id
      );
      if (result && !result.error) {
        setLastSaved(finalCaseNo);
        reset();
        if (lastSavedTimer.current) clearTimeout(lastSavedTimer.current);
        lastSavedTimer.current = setTimeout(() => {
          setLastSaved(null);
          lastSavedTimer.current = null;
        }, 2000);
      } else {
        setSaveError(true);
        const errorMsg =
          result?.error?.message || result?.error || "Failed to save case";
        setErrorMessage(errorMsg);
        if (errorTimer.current) clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => {
          setSaveError(null);
          setErrorMessage("");
          errorTimer.current = null;
        }, 3000);
      }
    } catch (err) {
      console.error("Error saving case:", err);
      setSaveError(true);
      setErrorMessage(err.message || "An unexpected error occurred");
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => {
        setSaveError(null);
        setErrorMessage("");
        errorTimer.current = null;
      }, 3000);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    caseNo,
    caseNumberOnly,
    notes,
    showSplitInput,
    due,
    dept,
    priority,
    rush,
    hold,
    newAccount,
    caseType,
    id,
    addOrUpdate,
    reset,
    isSubmitting,
  ]);

  const handleEdit = useCallback(
    (r) => {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }
      setId(r.id);
      const spaceIndex = r.caseNumber.indexOf(" ");
      if (spaceIndex !== -1) {
        setCaseNumberOnly(r.caseNumber.substring(0, spaceIndex));
        setNotes(r.caseNumber.substring(spaceIndex + 1));
        setShowSplitInput(true);
      } else {
        setCaseNo(r.caseNumber);
        setCaseNumberOnly("");
        setNotes("");
        setShowSplitInput(false);
      }
      setDept(r.department === "General" ? "Digital" : r.department);
      setDue(r.due.slice(0, 10));
      setPriority(r.priority);
      setRush(r.rush);
      setHold(r.hold);
      setNewAccount(
        r.newAccount ?? r.modifiers?.includes("newaccount") ?? false
      );
      setCaseType(r.caseType || "general");
      setOriginalValues({
        caseNumber: r.caseNumber,
        dept: r.department === "General" ? "Digital" : r.department,
        due: r.due.slice(0, 10),
        priority: r.priority,
        rush: r.rush,
        hold: r.hold,
        newAccount:
          r.newAccount ?? r.modifiers?.includes("newaccount") ?? false,
        caseType: r.caseType || "general",
      });

      // Only do expand animation if not locked
      if (!lockAddCaseCard) {
        const expandCard = () => {
          setIsExpanding(true);
          setIsCollapsed(false);
          if (shouldReduceMotion) {
            animationProgress.set(0);
            rawProgress.set(0);
            setIsExpanding(false);
            return;
          }
          animate(animationProgress, 0, {
            type: "spring",
            stiffness: 300,
            damping: 25,
            onComplete: () => {
              rawProgress.set(0);
              setIsExpanding(false);
            },
          });
        };
        expandCard();
      }

      setTimeout(() => {
        const firstInput = formRef.current?.querySelector("input, select");
        firstInput?.focus();
      }, 400);
    },
    [animationProgress, rawProgress, shouldReduceMotion, lockAddCaseCard]
  );

  const handleEditDuplicate = useCallback(
    (duplicateCase) => {
      setShowDuplicateWarning(false);
      const fullCaseData = data.find((c) => c.id === duplicateCase.id);
      if (fullCaseData) {
        handleEdit(fullCaseData);
      }
    },
    [data, handleEdit]
  );

  const todayISO = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const handleDueChange = useCallback(
    (nextDue) => {
      setDue(nextDue);

      // Mark that the user explicitly touched the due date
      dueTouchedRef.current = true;

      // Only auto-trigger when adding a new case (not editing)
      if (id) return;

      // Skip automations if disabled
      if (disableAutomations) return;

      // If user sets due date to today, auto-trigger Priority + animation
      if (nextDue && nextDue === todayISO && !priority) {
        setPriority(true);
        setPriorityDetected(true);

        if (priorityDetectedTimer.current)
          clearTimeout(priorityDetectedTimer.current);
        priorityDetectedTimer.current = setTimeout(() => {
          setPriorityDetected(false);
        }, 1500);
      }

      // If due is within 2 business days (tomorrow/next business day), auto-trigger Rush + animation
      const bd = businessDaysBetweenISO(todayISO, nextDue);
      if (typeof bd === "number" && bd >= 1 && bd <= 2 && !rush) {
        setRush(true);
        setRushDetected(true);
        if (rushDetectedTimer.current) clearTimeout(rushDetectedTimer.current);
        rushDetectedTimer.current = setTimeout(() => {
          setRushDetected(false);
        }, 1500);
      }

      // Reverse mapping: due-date distance is a strong signal for department.
      // This runs before the dept select step (because due is entered first).
      if (
        typeof bd === "number" &&
        !deptTouchedRef.current &&
        deptAutoReasonRef.current !== "notes"
      ) {
        if (bd === 11 && dept !== "Metal") {
          setDept("C&B");
          deptAutoReasonRef.current = "dueDate";
        } else if (bd === 6) {
          setDept("Metal");
          deptAutoReasonRef.current = "dueDate";
        } else if (bd === 4) {
          setDept("Digital");
          deptAutoReasonRef.current = "dueDate";
        }
      }
    },
    [id, todayISO, priority, rush, dept, disableAutomations]
  );

  const compare = useCallback((a, b) => {
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    const da = new Date(a.due);
    const db = new Date(b.due);
    if (da < db) return -1;
    if (da > db) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  }, []);

  const matchesSearch = useCallback(
    (r) =>
      !search.trim() ||
      r.caseNumber.toLowerCase().includes(search.trim().toLowerCase()),
    [search]
  );

  const matchesDept = useCallback(
    (r) => {
      if (deptFilter === "All") return true;
      // "General" in DB means "Digital" in UI
      if (deptFilter === "General") return r.department === "General";
      return r.department === deptFilter;
    },
    [deptFilter]
  );

  const pending = useMemo(
    () =>
      data
        .filter((r) => !r.completed && matchesSearch(r) && matchesDept(r))
        .sort(compare),
    [data, matchesSearch, matchesDept, compare]
  );

  const completed = useMemo(
    () =>
      data
        .filter((r) => r.completed && matchesSearch(r) && matchesDept(r))
        .sort(compare)
        .reverse(),
    [data, matchesSearch, matchesDept, compare]
  );

  // When locked, always interactive
  const isInteractive =
    lockAddCaseCard ||
    rawProgress.get() < INTERACTION_THRESHOLD ||
    isExpanding ||
    !isCollapsed;

  const handleButtonClick = useCallback(
    (e) => {
      if (isSubmitting) {
        e.preventDefault();
        return;
      }
      if (id && !hasChanges) {
        reset();
      } else {
        save();
      }
    },
    [id, hasChanges, reset, save, isSubmitting]
  );

  const getAnimationOrigin = useCallback(() => {
    if (saveButtonRef.current) {
      const rect = saveButtonRef.current.getBoundingClientRect();
      const formRect = formRef.current?.getBoundingClientRect();
      if (formRect) {
        return {
          x: rect.left + rect.width / 2 - formRect.left,
          y: rect.top + rect.height / 2 - formRect.top,
        };
      }
    }
    return { x: 0, y: 0 };
  }, []);

  const getCaseTypeSelectorPosition = useCallback(() => {
    if (caseTypeSelectorRef.current) {
      const rect = caseTypeSelectorRef.current.getBoundingClientRect();
      const formRect = formRef.current?.getBoundingClientRect();
      if (formRect) {
        return {
          x: rect.left + rect.width / 2 - formRect.left,
          y: rect.top + rect.height / 2 - formRect.top,
        };
      }
    }
    return { x: 0, y: 0 };
  }, []);

  const getCaseNumberInputPosition = useCallback(() => {
    let inputEl = null;
    if (showSplitInput && caseInputRef.current) {
      inputEl = caseInputRef.current;
    } else if (!showSplitInput && singleInputRef.current) {
      inputEl = singleInputRef.current;
    }
    if (inputEl && formRef.current) {
      const rect = inputEl.getBoundingClientRect();
      const formRect = formRef.current.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - formRect.left,
        y: rect.top + rect.height / 2 - formRect.top,
      };
    }
    return { x: 100, y: 100 };
  }, [showSplitInput]);

  const getFocusedInputPosition = useCallback(() => {
    if (!focusedInput || !formRef.current)
      return { x: 0, y: 0, width: 0, height: 0 };

    const inputEl = formRef.current.querySelector(
      `[data-input-id="${focusedInput}"]`
    );
    if (!inputEl) return { x: 0, y: 0, width: 0, height: 0 };

    const rect = inputEl.getBoundingClientRect();
    const formRect = formRef.current.getBoundingClientRect();
    return {
      x: rect.left - formRect.left,
      y: rect.top - formRect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [focusedInput]);

  const getRow2Position = useCallback(() => {
    if (!formRef.current) return { x: 0, y: 0 };

    const row2 = formRef.current.querySelector(".form-row-flex");
    if (!row2) {
      return { x: 24, y: 88 };
    }

    const rect = row2.getBoundingClientRect();
    const formRect = formRef.current.getBoundingClientRect();
    return {
      x: rect.left - formRect.left,
      y: rect.top - formRect.top,
    };
  }, []);

  const getFocusedFilterPosition = useCallback(() => {
    if (!focusedFilter || !filtersRef.current)
      return { x: 0, y: 0, width: 0, height: 0 };
    const inputEl = filtersRef.current.querySelector(
      `[data-filter-id="${focusedFilter}"]`
    );
    if (!inputEl) return { x: 0, y: 0, width: 0, height: 0 };
    const rect = inputEl.getBoundingClientRect();
    const containerRect = filtersRef.current.getBoundingClientRect();
    return {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [focusedFilter]);

  const getFocusGlowColor = useCallback(() => {
    if (focusedInput === "case-type" && dept === "Digital") {
      if (caseType === "bbs") {
        return { r: 168, g: 85, b: 247 };
      } else if (caseType === "flex") {
        return { r: 236, g: 72, b: 153 };
      }
    }
    return { r: 22, g: 82, b: 95 };
  }, [focusedInput, dept, caseType]);

  const shouldSuppressFocusGlow = useCallback(() => {
    return (
      showDuplicateWarning &&
      (focusedInput === "case-single" || focusedInput === "case-split")
    );
  }, [showDuplicateWarning, focusedInput]);

  const handleFocusChange = useCallback(
    (newFocus) => {
      setPreviousFocusedInput(focusedInput);
      setFocusedInput(newFocus);
    },
    [focusedInput]
  );

  const handleDateClick = useCallback(() => {
    if (dateInputRef.current) {
      // Auto-populate with default date if empty
      if (!due) {
        setDue(defaultDueDate);
      }

      dateInputRef.current.focus();

      try {
        if (typeof dateInputRef.current.showPicker === "function") {
          dateInputRef.current.showPicker();
        }
      } catch (error) {
        // Safari/macOS can throw for showPicker; keep the native focused input behavior.
      }
    }
  }, [due, defaultDueDate]);

  const renderDuplicateNotification = () => {
    if (!showDuplicateWarning || duplicates.length === 0) return null;
    const notificationContent = (
      <>
        <div
          className={clsx(
            "flex items-center justify-between border-b border-amber-200/50",
            formLayout === "mobile"
              ? "px-3 py-2"
              : formLayout === "tablet"
              ? "px-3 py-2.5"
              : "px-4 py-3"
          )}
        >
          <div className="flex items-center gap-2">
            <svg
              className={clsx(
                "text-amber-600",
                formLayout === "mobile" ? "w-4 h-4" : "w-5 h-5"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p
              className={clsx(
                "font-semibold text-gray-900",
                formLayout === "mobile" ? "text-xs" : "text-sm"
              )}
            >
              Duplicate case detected
            </p>
          </div>
          <button
            onClick={() => setShowDuplicateWarning(false)}
            className="p-1 hover:bg-amber-100 rounded-lg transition-colors"
            title="Dismiss"
          >
            <svg
              className={clsx(
                "text-gray-600",
                formLayout === "mobile" ? "w-3 h-3" : "w-4 h-4"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div
          className={clsx(
            "overflow-y-auto",
            formLayout === "mobile"
              ? "max-h-[150px]"
              : formLayout === "tablet"
              ? "max-h-[200px]"
              : "max-h-[300px]"
          )}
        >
          <div
            className={clsx(
              formLayout === "mobile"
                ? "px-3 py-2 space-y-1.5"
                : formLayout === "tablet"
                ? "px-3 py-2.5 space-y-2"
                : "px-4 py-3 space-y-2"
            )}
          >
            {duplicates.map((dup) => {
              const [caseNum, ...caseDescParts] = dup.casenumber.split(" ");
              const caseDesc = caseDescParts.join(" ");
              const dueDate = new Date(dup.due);
              const month = dueDate.getUTCMonth() + 1;
              const day = dueDate.getUTCDate();
              const formattedDue = `${month}/${day}`;
              const todayUTC = new Date();
              const todayUTCString = new Date(
                Date.UTC(
                  todayUTC.getFullYear(),
                  todayUTC.getMonth(),
                  todayUTC.getDate()
                )
              )
                .toISOString()
                .slice(0, 10);
              const dueDateString = dup.due.slice(0, 10);
              const isPastDue = dueDateString < todayUTCString;
              return (
                <motion.div
                  key={dup.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 }}
                  className={clsx(
                    "bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-2 overflow-hidden",
                    formLayout === "mobile" || formLayout === "tablet"
                      ? "p-0"
                      : "p-2.5"
                  )}
                >
                  <div
                    className={clsx(
                      "flex-1 min-w-0",
                      formLayout === "mobile" || formLayout === "tablet"
                        ? "pl-2 py-1"
                        : ""
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          "font-mono font-semibold text-gray-800",
                          formLayout === "mobile" ? "text-xs" : "text-sm"
                        )}
                      >
                        {caseNum}
                      </span>
                      <span
                        className={clsx(
                          isPastDue
                            ? "text-red-600 font-medium"
                            : "text-gray-600",
                          formLayout === "mobile"
                            ? "text-[10px]"
                            : formLayout === "tablet"
                            ? "text-xs"
                            : "text-xs"
                        )}
                      >
                        {dup.department === "General"
                          ? "Digital"
                          : dup.department}{" "}
                        • {formattedDue}
                        {isPastDue && " (Overdue)"}
                      </span>
                    </div>
                    {caseDesc &&
                      formLayout !== "mobile" &&
                      formLayout !== "tablet" && (
                        <p className="text-xs text-gray-600 truncate mt-0.5">
                          {caseDesc}
                        </p>
                      )}
                  </div>
                  <button
                    onClick={() => handleEditDuplicate(dup)}
                    className={clsx(
                      "flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors relative",
                      formLayout === "mobile" || formLayout === "tablet"
                        ? "px-3 h-full min-h-[32px] text-xs rounded-r-lg border-l border-amber-700/20 shadow-[-2px_0_4px_rgba(217,119,6,0.1)]"
                        : "px-3 py-1.5 text-xs rounded-lg"
                    )}
                  >
                    Edit
                  </button>
                </motion.div>
              );
            })}
          </div>
        </div>
        <div
          className={clsx(
            "border-t border-amber-200/50",
            formLayout === "mobile"
              ? "px-3 pb-2 pt-1.5"
              : formLayout === "tablet"
              ? "px-3 pb-2.5 pt-2"
              : "px-4 pb-3 pt-2"
          )}
        >
          <button
            onClick={() => setShowDuplicateWarning(false)}
            className={clsx(
              "w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors",
              formLayout === "mobile" ? "py-1.5 text-xs" : "py-2 text-sm"
            )}
          >
            Dismiss & Continue Adding
          </button>
        </div>
      </>
    );
    if (formLayout === "desktop") {
      return (
        <motion.div
          className="glass-notification-warning rounded-xl shadow-lg fixed max-w-sm z-[9998]"
          style={{
            top: `${notificationPosition.top}px`,
            left: `${notificationPosition.left}px`,
          }}
          initial={{ opacity: 0, scale: 0.8, x: -20 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.8, x: -20 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 30,
            duration: 0.3,
          }}
        >
          {notificationContent}
        </motion.div>
      );
    }
    if (formLayout === "tablet") {
      return (
        <motion.div
          className="glass-notification-warning rounded-xl shadow-lg relative mx-auto mt-4 mb-6"
          style={{
            maxWidth: formDimensions.width
              ? `${formDimensions.width}px`
              : "100%",
            width: "100%",
          }}
          initial={{ opacity: 0, scale: 0.8, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -20 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 30,
            duration: 0.3,
          }}
        >
          {notificationContent}
        </motion.div>
      );
    }
    if (formLayout === "mobile" && formRef.current) {
      const caseInputEl = formRef.current.querySelector(".form-input");
      const saveButtonEl = formRef.current.querySelector(".primary-button");
      if (caseInputEl && saveButtonEl) {
        const caseRect = caseInputEl.getBoundingClientRect();
        const saveRect = saveButtonEl.getBoundingClientRect();
        const formRect = formRef.current.getBoundingClientRect();
        const topOffset = caseRect.bottom - formRect.top + 8;
        const availableHeight = saveRect.top - caseRect.bottom - -35;
        return (
          <motion.div
            className="glass-notification-warning-overlay rounded-xl shadow-lg absolute left-4 right-4 z-[100]"
            style={{
              top: `${topOffset}px`,
              height: `${availableHeight}px`,
            }}
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{
              type: "spring",
              stiffness: 500,
              damping: 30,
              duration: 0.3,
            }}
          >
            {notificationContent}
          </motion.div>
        );
      }
    }
    return null;
  };

  return (
    <main
      ref={mainRef}
      className="flex-1 overflow-auto bg-gradient-to-br from-gray-100 to-gray-200 p-4 sm:p-6 pb-44 text-gray-900 relative"
    >
      <motion.div
        className="my-2 text-center text-xs text-gray-600"
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        version {APP_VERSION}
      </motion.div>
      <div
        ref={containerRef}
        className="form-container-wrapper form-animated"
        style={{
          "--navbar-height": `${navbarHeight}px`,
          "--bubble-offset": `${bubbleOffset}px`,
          // Override sticky positioning when locked
          ...(lockAddCaseCard && {
            position: "relative",
            top: "auto",
          }),
        }}
      >
        <div className="form-morph-wrapper">
          <motion.section
            ref={formRef}
            className={clsx(
              "form-morph-container glass-panel relative",
              isCollapsed && !lockAddCaseCard && "form-collapsed"
            )}
            style={{
              // When locked, don't apply any transforms
              scale: lockAddCaseCard ? 1 : isHydrated ? scale : 1,
              borderRadius: lockAddCaseCard
                ? "1rem"
                : isHydrated
                ? borderRadius
                : "1rem",
              y: lockAddCaseCard ? 0 : isHydrated ? yPosition : 0,
              boxShadow: lockAddCaseCard
                ? "0 10px 15px -3px rgba(0,0,0,0.08),0 4px 6px -2px rgba(0,0,0,0.04)"
                : isHydrated
                ? boxShadowTransform
                : "0 10px 15px -3px rgba(0,0,0,0.08),0 4px 6px -2px rgba(0,0,0,0.04)",
              overflow: "hidden",
              isolation: "isolate",
            }}
            onClick={handleFormClick}
            initial={false}
            transition={
              !isHydrated || lockAddCaseCard
                ? {}
                : {
                    scale: { type: "spring", stiffness: 300, damping: 25 },
                    borderRadius: {
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                    },
                    y: { type: "spring", stiffness: 250, damping: 25 },
                  }
            }
          >
            {/* Focus glow animation */}
            <AnimatePresence>
              {focusedInput && !shouldSuppressFocusGlow() && (
                <motion.div
                  key={focusedInput}
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {focusedInput === "department" ||
                  focusedInput === "case-type" ? (
                    <>
                      <DepartmentGlow
                        focusedInput={focusedInput}
                        dept={dept}
                        getFocusGlowColor={getFocusGlowColor}
                        getRow2Position={getRow2Position}
                      />

                      <AnimatePresence>
                        {focusedInput === "case-type" && dept === "Digital" && (
                          <>
                            {[60, 40, 20, 0].map((offset, index) => {
                              const row2Pos = getRow2Position();
                              const glowX = `calc(50% + 0.5rem - ${offset}px)`;
                              const glowWidth = `calc(50% - 0.5rem - ${
                                row2Pos.x
                              }px + ${offset * 2}px)`;

                              return (
                                <motion.div
                                  key={`case-type-${index}`}
                                  className="absolute"
                                  initial={{
                                    opacity: 0,
                                    scale: 0.9 + index * 0.025,
                                  }}
                                  animate={{
                                    opacity: 0.3 + index * 0.1,
                                    scale: 1,
                                    transition: { duration: 0.2 },
                                  }}
                                  exit={{
                                    opacity: 0,
                                    scale: 0.95 + index * 0.01,
                                    transition: { duration: 0.1 },
                                  }}
                                  style={{
                                    left: glowX,
                                    top: `${row2Pos.y - offset * 0.5}px`,
                                    width: glowWidth,
                                    height: `${41 + offset}px`,
                                    borderRadius: `${2.5 - index * 0.4}rem`,
                                    background:
                                      offset > 0
                                        ? `radial-gradient(ellipse 120% 100% at center, 
                                      rgba(${getFocusGlowColor().r}, ${
                                            getFocusGlowColor().g
                                          }, ${getFocusGlowColor().b}, ${
                                            0.05 + index * 0.01
                                          }) 0%, 
                                      rgba(${getFocusGlowColor().r}, ${
                                            getFocusGlowColor().g
                                          }, ${getFocusGlowColor().b}, ${
                                            0.03 + index * 0.005
                                          }) ${30 + index * 5}%, 
                                      transparent ${60 + index * 5}%)`
                                        : undefined,
                                    boxShadow:
                                      offset === 0
                                        ? `
                                      0 0 0 1px rgba(${
                                        getFocusGlowColor().r
                                      }, ${getFocusGlowColor().g}, ${
                                            getFocusGlowColor().b
                                          }, 0.08),
                                      0 0 15px rgba(${getFocusGlowColor().r}, ${
                                            getFocusGlowColor().g
                                          }, ${getFocusGlowColor().b}, 0.06),
                                      0 0 30px rgba(${getFocusGlowColor().r}, ${
                                            getFocusGlowColor().g
                                          }, ${getFocusGlowColor().b}, 0.03)
                                    `
                                        : undefined,
                                  }}
                                />
                              );
                            })}
                          </>
                        )}
                      </AnimatePresence>
                    </>
                  ) : (
                    <>
                      {[60, 40, 20, 0].map((offset, index) => (
                        <motion.div
                          key={index}
                          className="absolute"
                          initial={{ opacity: 0, scale: 0.9 + index * 0.025 }}
                          animate={{
                            opacity: 0.3 + index * 0.1,
                            scale: 1,
                          }}
                          exit={{ opacity: 0, scale: 0.95 + index * 0.01 }}
                          transition={{ duration: 0.2 }}
                          style={{
                            left: `${getFocusedInputPosition().x - offset}px`,
                            top: `${
                              getFocusedInputPosition().y - offset * 0.5
                            }px`,
                            width: `${
                              getFocusedInputPosition().width + offset * 2
                            }px`,
                            height: `${
                              getFocusedInputPosition().height + offset
                            }px`,
                            borderRadius: `${2.5 - index * 0.4}rem`,
                            background:
                              offset > 0
                                ? `radial-gradient(ellipse 120% 100% at center, 
                              rgba(${getFocusGlowColor().r}, ${
                                    getFocusGlowColor().g
                                  }, ${getFocusGlowColor().b}, ${
                                    0.05 + index * 0.01
                                  }) 0%, 
                              rgba(${getFocusGlowColor().r}, ${
                                    getFocusGlowColor().g
                                  }, ${getFocusGlowColor().b}, ${
                                    0.03 + index * 0.005
                                  }) ${30 + index * 5}%, 
                              transparent ${60 + index * 5}%)`
                                : undefined,
                            boxShadow:
                              offset === 0
                                ? `
                              0 0 0 1px rgba(${getFocusGlowColor().r}, ${
                                    getFocusGlowColor().g
                                  }, ${getFocusGlowColor().b}, 0.08),
                              0 0 15px rgba(${getFocusGlowColor().r}, ${
                                    getFocusGlowColor().g
                                  }, ${getFocusGlowColor().b}, 0.06),
                              0 0 30px rgba(${getFocusGlowColor().r}, ${
                                    getFocusGlowColor().g
                                  }, ${getFocusGlowColor().b}, 0.03)
                            `
                                : undefined,
                          }}
                        />
                      ))}
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success animation glow */}
            <AnimatePresence>
              {lastSaved && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(ellipse 60% 180% at ${
                        getAnimationOrigin().x
                      }px ${
                        getAnimationOrigin().y + 100
                      }px, rgba(34, 197, 94, 0.3) 0%, rgba(34, 197, 94, 0.2) 10%, rgba(34, 197, 94, 0.1) 25%, rgba(34, 197, 94, 0.05) 40%, transparent 60%)`,
                      transformOrigin: `${getAnimationOrigin().x}px ${
                        getAnimationOrigin().y
                      }px`,
                    }}
                    initial={{
                      scale: 0,
                      opacity: 0,
                    }}
                    animate={{
                      scale: [0, 1.3, 1.8],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error animation glow */}
            <AnimatePresence>
              {saveError && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(circle at ${
                        getAnimationOrigin().x
                      }px ${
                        getAnimationOrigin().y
                      }px, rgba(239, 68, 68, 0.2) 0%, rgba(239, 68, 68, 0.08) 40%, transparent 70%)`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.5, 2],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 3D Flex detection animation */}
            <AnimatePresence>
              {flexDetected && dept === "Digital" && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(ellipse 250% 120% at ${
                        getCaseTypeSelectorPosition().x
                      }px ${
                        getCaseTypeSelectorPosition().y
                      }px, rgba(236, 72, 153, 0.15) 0%, rgba(236, 72, 153, 0.08) 20%, rgba(236, 72, 153, 0.03) 40%, transparent 55%)`,
                      transform: "rotate(-35deg)",
                      transformOrigin: `${getCaseTypeSelectorPosition().x}px ${
                        getCaseTypeSelectorPosition().y
                      }px`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.8, 2.5],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Priority detection animation */}
            <AnimatePresence>
              {priorityDetected && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(ellipse 250% 120% at 25% 65%, rgba(220, 38, 38, 0.15) 0%, rgba(220, 38, 38, 0.08) 20%, rgba(220, 38, 38, 0.03) 40%, transparent 55%)`,
                      transform: "rotate(-15deg)",
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.8, 2.5],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Rush detection animation */}
            <AnimatePresence>
              {rushDetected && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(ellipse 250% 120% at 50% 65%, rgba(234, 88, 12, 0.15) 0%, rgba(234, 88, 12, 0.08) 20%, rgba(234, 88, 12, 0.03) 40%, transparent 55%)`,
                      transform: "rotate(15deg)",
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.8, 2.5],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* BBS detection animation */}
            <AnimatePresence>
              {bbsDetected && dept === "Digital" && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(ellipse 250% 120% at ${
                        getCaseTypeSelectorPosition().x
                      }px ${
                        getCaseTypeSelectorPosition().y
                      }px, rgba(168, 85, 247, 0.15) 0%, rgba(168, 85, 247, 0.08) 20%, rgba(168, 85, 247, 0.03) 40%, transparent 55%)`,
                      transform: "rotate(25deg)",
                      transformOrigin: `${getCaseTypeSelectorPosition().x}px ${
                        getCaseTypeSelectorPosition().y
                      }px`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.8, 2.5],
                      opacity: [0, 1, 0],
                    }}
                    transition={{
                      duration: 1.2,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Duplicate detection animation */}
            <AnimatePresence>
              {showDuplicateWarning && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    borderRadius: lockAddCaseCard
                      ? "1rem"
                      : isHydrated
                      ? borderRadius
                      : "1rem",
                    overflow: "hidden",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <motion.div
                    className="absolute w-full h-full"
                    style={{
                      background: `radial-gradient(ellipse 100% 80% at ${
                        getCaseNumberInputPosition().x
                      }px ${
                        getCaseNumberInputPosition().y
                      }px, rgba(251, 191, 36, 0.2) 0%, rgba(251, 191, 36, 0.1) 25%, rgba(251, 191, 36, 0.05) 45%, transparent 60%)`,
                    }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{
                      scale: [0, 1.2, 1.5],
                      opacity: [0, 1, 0.7],
                    }}
                    transition={{
                      duration: 0.7,
                      ease: [0.25, 0.46, 0.45, 0.94],
                      times: [0, 0.6, 1],
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div
              className="form-content"
              style={{
                opacity: lockAddCaseCard ? 1 : isHydrated ? contentOpacity : 1,
                scale: lockAddCaseCard ? 1 : isHydrated ? contentScale : 1,
                pointerEvents: isInteractive ? "auto" : "none",
              }}
            >
              <AnimatePresence mode="wait">
                {lastSaved ? (
                  <motion.h2
                    key="saved"
                    className="mb-6 text-center text-xl font-semibold text-green-600 flex items-center justify-center gap-2"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.3 }}
                  >
                    <svg
                      className="w-6 h-6"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Case Added
                  </motion.h2>
                ) : saveError ? (
                  <motion.div
                    key="error"
                    className="mb-6 text-center"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h2 className="text-xl font-semibold text-red-600 flex items-center justify-center gap-2">
                      <svg
                        className="w-6 h-6"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Error
                    </h2>
                    {errorMessage && (
                      <p className="text-sm text-red-500 mt-1">
                        {errorMessage}
                      </p>
                    )}
                  </motion.div>
                ) : (
                  <motion.h2
                    key="title"
                    className="mb-6 text-center text-xl font-semibold text-gray-800"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                  >
                    {id ? "Edit Case" : "Add New Case"}
                  </motion.h2>
                )}
              </AnimatePresence>
              <div className="space-y-4">
                {/* Row 1 */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="relative">
                    {!showSplitInput ? (
                      <div
                        className={clsx(
                          showDuplicateWarning && "input-warning-border"
                        )}
                      >
                        <input
                          ref={singleInputRef}
                          data-input-id="case-single"
                          placeholder="Case Number"
                          value={caseNo}
                          onFocus={() => handleFocusChange("case-single")}
                          onBlur={(e) => {
                            handleFocusChange(null);
                            handleCaseNumberAnalysis(
                              e.target.value.split(" ")[0],
                              { immediate: true }
                            );
                          }}
                          onChange={(e) => {
                            let txt = e.target.value;
                            setCaseNo(txt);
                            if (
                              txt.trim().toLowerCase() === "update" &&
                              !showUpdateModal
                            ) {
                              setShowUpdateModal(true);
                              setCaseNo("");
                            }
                            const spaceIndex = txt.indexOf(" ");
                            if (
                              spaceIndex !== -1 &&
                              spaceIndex < txt.length - 1
                            ) {
                              const caseNum = txt.substring(0, spaceIndex);
                              const noteText = txt.substring(spaceIndex + 1);

                              // Case-number-only automations (runs before notes)
                              handleCaseNumberAnalysis(caseNum, {
                                immediate: true,
                              });
                              const cursorPos = e.target.selectionStart;
                              const isInNotes = cursorPos > spaceIndex;
                              setCaseNumberOnly(caseNum);
                              setNotes(noteText);
                              setShowSplitInput(true);
                              setTimeout(() => {
                                if (isInNotes && notesInputRef.current) {
                                  notesInputRef.current.focus();
                                  const notesPos = cursorPos - spaceIndex - 1;
                                  notesInputRef.current.setSelectionRange(
                                    notesPos,
                                    notesPos
                                  );
                                } else if (caseInputRef.current) {
                                  caseInputRef.current.focus();
                                  caseInputRef.current.setSelectionRange(
                                    cursorPos,
                                    cursorPos
                                  );
                                }
                              }, 50);
                            }
                          }}
                          className="form-input"
                        />
                        {showDuplicateWarning && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                            <svg
                              className="w-5 h-5 text-amber-500"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        className={clsx(
                          "flex gap-2 water-droplet-container",
                          isReverting && "reverting"
                        )}
                      >
                        <motion.div
                          initial={
                            isReverting ? { width: "auto" } : { width: "100%" }
                          }
                          animate={{ width: isReverting ? "100%" : "auto" }}
                          transition={{
                            type: "spring",
                            stiffness: 600,
                            damping: 30,
                          }}
                          className={clsx(
                            "water-droplet-case relative",
                            showDuplicateWarning && "input-warning-border"
                          )}
                        >
                          <input
                            ref={caseInputRef}
                            data-input-id="case-split"
                            placeholder="Case"
                            value={caseNumberOnly}
                            onFocus={() => handleFocusChange("case-split")}
                            onBlur={(e) => {
                              handleFocusChange(null);
                              handleCaseNumberAnalysis(
                                e.target.value.split(" ")[0],
                                { immediate: true }
                              );
                            }}
                            onChange={(e) => {
                              let txt = e.target.value;
                              if (!txt.includes(" ")) {
                                setCaseNumberOnly(txt);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Backspace" &&
                                caseNumberOnly === "" &&
                                notes === ""
                              ) {
                                setIsReverting(true);
                                setTimeout(() => {
                                  setShowSplitInput(false);
                                  setCaseNo("");
                                  setNotes("");
                                  setCaseNumberOnly("");
                                  setIsReverting(false);
                                  setTimeout(
                                    () => singleInputRef.current?.focus(),
                                    50
                                  );
                                }, 300);
                              } else if (e.key === " ") {
                                e.preventDefault();
                                handleCaseNumberAnalysis(caseNumberOnly, {
                                  immediate: true,
                                });
                                notesInputRef.current?.focus();
                              }
                            }}
                            className="form-input case-number-input"
                            style={{ minWidth: "80px", maxWidth: "120px" }}
                          />
                          {showDuplicateWarning && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                              <svg
                                className="w-4 h-4 text-amber-500"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </div>
                          )}
                        </motion.div>
                        <motion.div
                          initial={
                            isReverting
                              ? { opacity: 1, scale: 1, x: 0 }
                              : { opacity: 0, scale: 0.95, x: -10 }
                          }
                          animate={{
                            opacity: isReverting ? 0 : 1,
                            scale: isReverting ? 0.95 : 1,
                            x: isReverting ? 10 : 0,
                          }}
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 25,
                          }}
                          className="flex-1 water-droplet-notes"
                        >
                          <input
                            ref={notesInputRef}
                            data-input-id="notes"
                            placeholder="Notes"
                            value={notes}
                            onFocus={() => handleFocusChange("notes")}
                            onBlur={() => handleFocusChange(null)}
                            onChange={(e) => {
                              let txt = e.target.value;
                              txt = handleNotesAnalysis(txt);
                              setNotes(txt);
                            }}
                            onKeyDown={(e) => {
                              if (
                                e.key === "Backspace" &&
                                notes === "" &&
                                e.target.selectionStart === 0
                              ) {
                                e.preventDefault();
                                caseInputRef.current?.focus();
                                const len = caseNumberOnly.length;
                                caseInputRef.current?.setSelectionRange(
                                  len,
                                  len
                                );
                              }
                            }}
                            className="form-input"
                          />
                        </motion.div>
                      </div>
                    )}
                  </div>
                  <div className="relative cursor-pointer">
                    <input
                      ref={dateInputRef}
                      type="date"
                      data-input-id="date"
                      value={due}
                      min={todayISO}
                      onClick={handleDateClick}
                      onFocus={() => {
                        handleFocusChange("date");
                        // Auto-populate with default date if empty (only if automations enabled)
                        if (!due && !disableAutomations) {
                          setDueAuto(defaultDueDaysByDept, "dateFocusDefault");
                        }
                      }}
                      onBlur={() => handleFocusChange(null)}
                      onChange={(e) => handleDueChange(e.target.value)}
                      className={clsx(
                        "form-input date-input cursor-pointer",
                        !due && "date-empty"
                      )}
                    />
                    {!due && (
                      <div className="pointer-events-none absolute inset-0 flex items-center px-3 z-10">
                        <span className="text-gray-400 text-sm">Due Date</span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Row 2 */}
                <div className="space-y-4">
                  <motion.div
                    className="form-row-flex"
                    animate={{
                      gap: dept === "Digital" ? "1rem" : "0rem",
                    }}
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                    style={{
                      display: "flex",
                      alignItems: "start",
                      minHeight: "41px",
                      width: "100%",
                      maxWidth: "100%",
                      position: "relative",
                    }}
                  >
                    <motion.div
                      animate={{
                        width:
                          dept === "Digital" ? "calc(50% - 0.5rem)" : "100%",
                      }}
                      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                      style={{
                        flexShrink: 0,
                        position: "relative",
                      }}
                    >
                      <select
                        data-input-id="department"
                        value={dept}
                        onFocus={() => handleFocusChange("department")}
                        onBlur={() => handleFocusChange(null)}
                        onChange={(e) => {
                          deptTouchedRef.current = true;
                          deptAutoReasonRef.current = null;
                          const nextDept = e.target.value;
                          setDept(nextDept);
                          if (e.target.value !== "Digital")
                            setCaseType("general");

                          // Dept -> due default (only if user hasn't touched due yet and automations enabled)
                          if (
                            !disableAutomations &&
                            !dueTouchedRef.current &&
                            (!due || dueAutoReasonRef.current)
                          ) {
                            const days =
                              nextDept === "C&B"
                                ? 11
                                : nextDept === "Metal"
                                ? 6
                                : 4;
                            setDueAuto(days, "deptSelect");
                          }
                        }}
                        className="form-select"
                      >
                        <option value="Digital">Digital</option>
                        <option value="C&B">C&B</option>
                        <option value="Metal">Metal</option>
                      </select>
                    </motion.div>
                    <AnimatePresence>
                      {dept === "Digital" && (
                        <motion.div
                          ref={caseTypeSelectorRef}
                          className={clsx(
                            flexDetected &&
                              caseType === "flex" &&
                              "flex-pulse-animation",
                            bbsDetected &&
                              caseType === "bbs" &&
                              "bbs-pulse-animation"
                          )}
                          initial={{ width: "0%", opacity: 0, scale: 0.95 }}
                          animate={{
                            width: "calc(50% - 0.5rem)",
                            opacity: 1,
                            scale: 1,
                          }}
                          exit={{ width: "0%", opacity: 0, scale: 0.95 }}
                          transition={{
                            duration: 0.4,
                            ease: [0.4, 0, 0.2, 1],
                            opacity: { duration: 0.3 },
                          }}
                          style={{
                            flexShrink: 0,
                            position: "relative",
                          }}
                        >
                          <select
                            data-input-id="case-type"
                            value={caseType}
                            onFocus={() => handleFocusChange("case-type")}
                            onBlur={() => handleFocusChange(null)}
                            onChange={(e) => setCaseType(e.target.value)}
                            className={clsx(
                              "form-select",
                              caseType === "bbs" && "select-purple",
                              caseType === "flex" && "select-pink"
                            )}
                            style={{
                              backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2714%22%20height%3D%228%22%20viewBox%3D%220%200%2014%208%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M1%201l6%206%206-6%22%20stroke%3D%22%23${
                                caseType === "bbs"
                                  ? "a855f7"
                                  : caseType === "flex"
                                  ? "ec4899"
                                  : "9ca3af"
                              }%22%20stroke-width%3D%222%22%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E")`,
                            }}
                          >
                            <option value="general">General</option>
                            <option value="bbs">
                              Base Plates / Bite Rims / Splints
                            </option>
                            <option value="flex">3D Flex</option>
                          </select>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </div>
                {/* Row 3 */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setPriority(!priority)}
                    className={clsx(
                      "toggle-button modifier-toggle",
                      priority
                        ? priorityDetected
                          ? "toggle-active toggle-glow-red priority-pulse-animation"
                          : "toggle-active toggle-glow-red"
                        : "toggle-inactive text-red-600"
                    )}
                  >
                    Priority {priority ? "ON" : "OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRush(!rush)}
                    className={clsx(
                      "toggle-button modifier-toggle",
                      rush
                        ? rushDetected
                          ? "toggle-active toggle-glow-orange rush-pulse-animation"
                          : "toggle-active toggle-glow-orange"
                        : "toggle-inactive text-orange-600"
                    )}
                  >
                    Rush {rush ? "ON" : "OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHold(!hold)}
                    className={clsx(
                      "toggle-button modifier-toggle",
                      hold
                        ? "toggle-active toggle-glow-amber"
                        : "toggle-inactive text-amber-600"
                    )}
                  >
                    Hold {hold ? "ON" : "OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAccount(!newAccount)}
                    className={clsx(
                      "toggle-button modifier-toggle",
                      newAccount
                        ? "toggle-active toggle-glow-pink"
                        : "toggle-inactive text-pink-600"
                    )}
                  >
                    New Account {newAccount ? "ON" : "OFF"}
                  </button>
                </div>
                <button
                  ref={saveButtonRef}
                  disabled={
                    (!caseNo.trim() && !caseNumberOnly.trim()) ||
                    !due ||
                    isSubmitting
                  }
                  onClick={handleButtonClick}
                  className={clsx(
                    "primary-button w-full relative overflow-hidden",
                    isSubmitting &&
                      "animate-pulse cursor-not-allowed opacity-75",
                    id && !hasChanges && "cancel-button"
                  )}
                >
                  {isSubmitting
                    ? "Saving..."
                    : id
                    ? hasChanges
                      ? "Update Case"
                      : "Cancel"
                    : "Save Case"}
                </button>
              </div>
            </motion.div>
            {/* Only show collapsed button content when not locked */}
            {!lockAddCaseCard && (
              <motion.div
                className="collapsed-button-content"
                style={{
                  opacity: isHydrated ? collapsedOpacity : 0,
                  scale: isHydrated ? collapsedScale : 0.8,
                  pointerEvents: "none",
                }}
              >
                <svg
                  className="w-6 h-6 text-gray-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span className="text-gray-700 font-semibold text-base whitespace-nowrap ml-2">
                  {id ? "Edit Case" : "Add Case"}
                </span>
              </motion.div>
            )}
            {formLayout === "mobile" && (
              <AnimatePresence>{renderDuplicateNotification()}</AnimatePresence>
            )}
          </motion.section>
        </div>
      </div>
      {formLayout !== "mobile" && (
        <AnimatePresence>{renderDuplicateNotification()}</AnimatePresence>
      )}
      <AnimatePresence>
        {showBar && (
          <motion.div
            className="mx-auto mt-6 grid max-w-2xl grid-cols-1 sm:grid-cols-3 gap-3"
            variants={containerVariants}
            initial={false}
            animate="visible"
          >
            <InfoRow
              type="priority"
              title="Priority"
              desc="Patient appointment today"
            />
            <InfoRow
              type="rush"
              title="Rush"
              desc="Patient appointment tomorrow"
            />
            <InfoRow
              type="standard"
              title="Standard"
              desc="Flexible timeline"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        ref={filtersRef}
        className="mx-auto my-6 grid max-w-2xl grid-cols-2 gap-4 relative z-50"
        variants={containerVariants}
        initial={false}
        animate="visible"
      >
        <AnimatePresence>
          {focusedFilter && (
            <>
              {[60, 40, 20, 0].map((offset, index) => (
                <motion.div
                  key={index}
                  className="absolute pointer-events-none"
                  initial={{ opacity: 0, scale: 0.9 + index * 0.025 }}
                  animate={{
                    opacity: 0.3 + index * 0.1,
                    scale: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.95 + index * 0.01 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    left: `${getFocusedFilterPosition().x - offset}px`,
                    top: `${getFocusedFilterPosition().y - offset * 0.5}px`,
                    width: `${getFocusedFilterPosition().width + offset * 2}px`,
                    height: `${getFocusedFilterPosition().height + offset}px`,
                    borderRadius: `${2.5 - index * 0.4}rem`,
                    background:
                      offset > 0
                        ? `radial-gradient(ellipse 120% 100% at center, 
                        rgba(22, 82, 95, ${0.05 + index * 0.01}) 0%, 
                        rgba(22, 82, 95, ${0.03 + index * 0.005}) ${
                            30 + index * 5
                          }%, 
                        transparent ${60 + index * 5}%)`
                        : undefined,
                    boxShadow:
                      offset === 0
                        ? `
                            0 0 0 1px rgba(22, 82, 95, 0.08),
                            0 0 15px rgba(22, 82, 95, 0.06),
                            0 0 30px rgba(22, 82, 95, 0.03)
                          `
                        : undefined,
                    zIndex: -1,
                  }}
                />
              ))}
            </>
          )}
        </AnimatePresence>
        <div className="relative">
          <select
            data-filter-id="dept-filter"
            value={deptFilter}
            onFocus={() => setFocusedFilter("dept-filter")}
            onBlur={() => setFocusedFilter(null)}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="filter-input filter-shadow relative z-50"
            style={{ position: "relative" }}
          >
            <option value="All">All Departments</option>
            <option value="General">Digital</option>
            <option value="C&B">C&B</option>
            <option value="Metal">Metal</option>
          </select>
        </div>
        <div className="relative">
          <input
            data-filter-id="search"
            value={search}
            onFocus={() => setFocusedFilter("search")}
            onBlur={() => setFocusedFilter(null)}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cases..."
            className={clsx(
              "filter-input filter-shadow",
              search && "pr-8"
            )}
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
            >
              ×
            </button>
          )}
        </div>
      </motion.div>
      <motion.div
        variants={containerVariants}
        initial={false}
        animate="visible"
      >
        <CaseTable
          title="Active Cases"
          rows={pending}
          empty="No active cases"
          onEdit={handleEdit}
          toggleDone={toggleComplete}
          toggleHold={toggleHold}
          toggleNewAccount={toggleNewAccount}
          toggleRush={toggleRush}
          togglePriority={togglePriority}
          toggleStage2={toggleStage2}
          removeCase={removeCase}
          allHistory={() => setShowAllHistory(true)}
          allHistoryHover={handleHistoryHover}
          todayISO={todayISO}
          forceOpen={forceOpen}
          showDividers={showCaseTableDividers}
        />
      </motion.div>
      <motion.div
        variants={containerVariants}
        initial={false}
        animate="visible"
      >
        <CaseTable
          title="Completed Cases"
          rows={completed}
          empty="No completed cases"
          completed
          onEdit={handleEdit}
          toggleDone={toggleComplete}
          toggleHold={toggleHold}
          toggleNewAccount={toggleNewAccount}
          toggleRush={toggleRush}
          togglePriority={togglePriority}
          toggleStage2={toggleStage2}
          removeCase={removeCase}
          deleteAll={() => setShowDel(true)}
          todayISO={todayISO}
          searchQuery={search}
          fetchCases={refreshCases}
          dates={{
            min:
              completed.at(-1)?.due.slice(0, 10) ??
              new Date().toISOString().slice(0, 10),
            max:
              completed[0]?.due.slice(0, 10) ??
              new Date().toISOString().slice(0, 10),
          }}
          forceOpen={forceOpen}
          showDividers={showCaseTableDividers}
        />
      </motion.div>
      <Suspense fallback={<ModalPlaceholder />}>
        {showAllHistory && (
          <AllHistoryModal onClose={() => setShowAllHistory(false)} />
        )}
        {showDel && (
          <DeleteCompletedModal
            dates={{
              min: completed.at(-1)?.due.slice(0, 10) ?? "",
              max: completed[0]?.due.slice(0, 10) ?? "",
            }}
            onDelete={(from, to) => {
              if (!from) removeAllCompleted();
              else removeCompletedInRange(from, to);
              setShowDel(false);
            }}
            onClose={() => setShowDel(false)}
          />
        )}
        {showUpdateModal && (
          <UpdateModal open onClose={() => setShowUpdateModal(false)} />
        )}
      </Suspense>
      <style jsx>{`
        .water-droplet-container {
          position: relative;
        }
        .water-droplet-container.reverting .water-droplet-case::after,
        .water-droplet-container.reverting .water-droplet-notes::before {
          animation: water-merge 0.4s ease-out !important;
        }

        .input-warning-border.water-droplet-case::after,
        .input-warning-border ~ .water-droplet-notes::before {
          display: none !important;
        }

        .water-droplet-case::after,
        .water-droplet-notes::before {
          content: "";
          position: absolute;
          width: 2px;
          height: 60%;
          background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(22, 82, 95, 0.08) 20%,
            rgba(22, 82, 95, 0.15) 50%,
            rgba(22, 82, 95, 0.08) 80%,
            transparent 100%
          );
          top: 50%;
          transform: translateY(-50%);
          opacity: 0;
          animation: water-fade 0.6s ease-out;
        }
        .water-droplet-case::after {
          right: -5px;
        }
        .water-droplet-notes::before {
          left: -5px;
        }
        @keyframes water-fade {
          0% {
            opacity: 0;
            height: 0%;
          }
          50% {
            opacity: 0.6;
            height: 60%;
          }
          100% {
            opacity: 0;
            height: 60%;
          }
        }
        @keyframes water-merge {
          0% {
            opacity: 0;
            height: 60%;
          }
          50% {
            opacity: 0.6;
            height: 60%;
          }
          100% {
            opacity: 0;
            height: 0%;
          }
        }
        .case-number-input {
          text-align: center;
          font-weight: 500;
        }
        .filter-input option {
          background-color: white;
        }
        select.filter-input:focus {
          outline: none;
        }
        .filter-shadow {
          box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.06),
            0 1px 2px -1px rgba(0, 0, 0, 0.04);
        }
        .glass-notification {
          background: rgba(255, 255, 255, 0.98);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(0, 0, 0, 0.06);
          box-shadow: var(--shadow-lg);
          z-index: 9999;
          top: 80px !important;
        }
        .glass-notification-warning {
          background: linear-gradient(
            135deg,
            rgba(254, 243, 199, 0.98) 0%,
            rgba(255, 255, 255, 0.98) 100%
          );
          backdrop-filter: blur(12px);
          border: 1px solid rgba(251, 191, 36, 0.15);
          box-shadow: 0 8px 20px -4px rgba(217, 119, 6, 0.1),
            0 0 0 1px rgba(251, 191, 36, 0.08) inset;
        }
        .glass-notification-warning-overlay {
          background: linear-gradient(
            135deg,
            rgba(254, 243, 199, 0.99) 0%,
            rgba(255, 255, 255, 0.99) 100%
          );
          backdrop-filter: blur(16px);
          border: 1px solid rgba(251, 191, 36, 0.2);
          box-shadow: 0 8px 24px -4px rgba(217, 119, 6, 0.12),
            0 0 0 1px rgba(251, 191, 36, 0.1) inset,
            0 16px 32px -8px rgba(0, 0, 0, 0.08);
        }

        /* Fixed pulse animations - properly centered */
        .bbs-pulse-animation::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(100% + 8px);
          height: calc(100% + 8px);
          border-radius: calc(var(--radius-lg) + 4px);
          background: transparent;
          box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.3);
          animation: bbs-pulse 0.6s ease-out;
          pointer-events: none;
          z-index: -1;
        }
        @keyframes bbs-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.3);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(168, 85, 247, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(168, 85, 247, 0);
          }
        }

        .flex-pulse-animation::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(100% + 8px);
          height: calc(100% + 8px);
          border-radius: calc(var(--radius-lg) + 4px);
          background: transparent;
          box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.3);
          animation: flex-pulse 0.6s ease-out;
          pointer-events: none;
          z-index: -1;
        }
        @keyframes flex-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.3);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(236, 72, 153, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(236, 72, 153, 0);
          }
        }

        .priority-pulse-animation::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(100% + 6px);
          height: calc(100% + 6px);
          border-radius: calc(var(--radius) + 3px);
          background: transparent;
          box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.35);
          animation: priority-pulse 0.6s ease-out;
          pointer-events: none;
          z-index: -1;
        }
        @keyframes priority-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.35);
          }
          50% {
            box-shadow: 0 0 0 12px rgba(220, 38, 38, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0);
          }
        }

        .rush-pulse-animation::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: calc(100% + 6px);
          height: calc(100% + 6px);
          border-radius: calc(var(--radius) + 3px);
          background: transparent;
          box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.35);
          animation: rush-pulse 0.6s ease-out;
          pointer-events: none;
          z-index: -1;
        }
        @keyframes rush-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(234, 88, 12, 0.35);
          }
          50% {
            box-shadow: 0 0 0 12px rgba(234, 88, 12, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(234, 88, 12, 0);
          }
        }

        .input-warning-border {
          position: relative;
        }
        .input-warning-border::after {
          content: "";
          position: absolute;
          inset: -2px;
          border-radius: calc(var(--radius-lg) + 2px);
          background: linear-gradient(
            45deg,
            rgba(251, 191, 36, 0.2),
            rgba(245, 158, 11, 0.2)
          );
          z-index: -1;
          animation: warning-glow 2s ease-in-out infinite;
        }
        @keyframes warning-glow {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 0.8;
          }
        }
      `}</style>
    </main>
  );
}
