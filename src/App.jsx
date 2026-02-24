import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useContext,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { DataProvider, useMut } from "./context/DataContext";
import { UserProvider, UserCtx } from "./context/UserContext";
import { FlashProvider } from "./FlashContext";
import clsx from "clsx";
import UserSetupModal from "./components/UserSetupModal";
import Board from "./components/Board";
import "./theme-white.css";
import "./theme-dark.css";
import "./theme-pink.css";
import "./styles/glass.css";
import "./flash.css";
import { LiteModeProvider } from "./LiteModePerformancePatch";

// Lazy-load heavy panels – code-split into separate chunks so the initial
// JS bundle is smaller and the app shell loads faster.
const Editor               = lazy(() => import("./components/Editor"));
const SettingsModal        = lazy(() => import("./components/SettingsModal"));
const SystemManagementScreen = lazy(() => import("./components/SystemManagementScreen"));

// Lightweight spinner shown while a lazy chunk is being fetched
function PanelLoader() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px]">
      <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white/80 animate-spin" />
    </div>
  );
}

/* =============================
   Week Navigation Component
   ============================= */
function WeekNavigation({
  weekOffset,
  onPrev,
  onNext,
  isLightTheme,
  isMobile = false,
}) {
  if (isMobile) {
    // Mobile: Fixed position bottom right
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center bg-white/10 backdrop-blur-md rounded-full p-1 border border-white/20 shadow-lg">
        <button
          onClick={onPrev}
          disabled={weekOffset === 0}
          className={clsx(
            "p-2 rounded-full transition-all",
            weekOffset === 0
              ? "opacity-30 cursor-not-allowed"
              : "hover:bg-white/20 active:scale-95"
          )}
          aria-label="Previous week"
        >
          <svg
            className={clsx(
              "w-5 h-5",
              isLightTheme ? "text-gray-700" : "text-white"
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        {/* Fixed width container for offset indicator */}
        <div className="w-8 flex items-center justify-center">
          <span
            className={clsx(
              "text-xs font-medium transition-opacity duration-150",
              isLightTheme ? "text-gray-700" : "text-white/90",
              weekOffset > 0 ? "opacity-100" : "opacity-0"
            )}
          >
            +{weekOffset}
          </span>
        </div>

        <button
          onClick={onNext}
          className="p-2 rounded-full hover:bg-white/20 active:scale-95 transition-all"
          aria-label="Next week"
        >
          <svg
            className={clsx(
              "w-5 h-5",
              isLightTheme ? "text-gray-700" : "text-white"
            )}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    );
  }

  // Desktop: In header
  return (
    <div className="flex items-center">
      <button
        onClick={onPrev}
        disabled={weekOffset === 0}
        className={clsx(
          "p-1.5 rounded-lg transition-all",
          weekOffset === 0
            ? "opacity-30 cursor-not-allowed"
            : "hover:bg-white/20 active:scale-95"
        )}
        aria-label="Previous week"
      >
        <svg
          className={clsx(
            "w-4 h-4",
            isLightTheme ? "text-gray-700" : "text-white"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      {/* Fixed width container so arrows don't move */}
      <div className="w-8 flex items-center justify-center">
        <span
          className={clsx(
            "text-xs font-medium transition-opacity duration-150",
            isLightTheme ? "text-gray-600" : "text-white/80",
            weekOffset > 0 ? "opacity-100" : "opacity-0"
          )}
        >
          +{weekOffset}
        </span>
      </div>

      <button
        onClick={onNext}
        className="p-1.5 rounded-lg hover:bg-white/20 active:scale-95 transition-all"
        aria-label="Next week"
      >
        <svg
          className={clsx(
            "w-4 h-4",
            isLightTheme ? "text-gray-700" : "text-white"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>
    </div>
  );
}

/* =============================
   Settings Pill Component
   ============================= */
function SettingsPill({ onClick, className, isMobile = false }) {
  const { name } = useContext(UserCtx);
  const isLightTheme =
    document.documentElement.classList.contains("theme-white") ||
    document.documentElement.classList.contains("theme-pink");
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isMobile && !isMobileView) return null;
  if (!isMobile && isMobileView) return null;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all",
        "bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20",
        "shadow-sm hover:shadow-md",
        className
      )}
      aria-label="Settings"
    >
      <span className="text-lg">⚙️</span>
      {name && (
        <span
          className={clsx(
            "text-xs font-medium max-w-[100px] truncate",
            isLightTheme ? "text-gray-700" : "text-white/90"
          )}
        >
          {name}
        </span>
      )}
    </button>
  );
}

/* =============================
   Digital dropdown via portal
   ============================= */
function DigitalDropdown({
  open,
  anchorRef,
  digitalView,
  stageCounts,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  menuRefExternal,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const menuH = menuRef.current ? menuRef.current.offsetHeight : 220;
    const below = rect.bottom + 6;
    const above = rect.top - menuH - 6;
    const placeAbove = below + menuH > vh && above > 0;

    setPos({
      top: placeAbove ? above : below,
      left: rect.left,
      width: Math.max(rect.width, 220),
    });
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(el) => {
        menuRef.current = el;
        if (menuRefExternal) menuRefExternal.current = el;
      }}
      role="menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 99999,
      }}
      className="rounded-lg shadow-xl border border-gray-200 bg-white overflow-hidden text-gray-800"
    >
      <MenuItem
        active={digitalView === "overview"}
        label="Overview"
        meta="All"
        onClick={() => onSelect("overview")}
      />
      <Divider />
      <MenuItem
        active={digitalView === "design"}
        label="Design Stage"
        meta={stageCounts.design}
        onClick={() => onSelect("design")}
      />
      <MenuItem
        active={digitalView === "production"}
        label="Production Stage"
        meta={stageCounts.production}
        onClick={() => onSelect("production")}
      />
      <MenuItem
        active={digitalView === "finishing"}
        label="Finishing Stage"
        meta={stageCounts.finishing}
        onClick={() => onSelect("finishing")}
      />
    </div>,
    document.body
  );
}

/* =============================
   Metal dropdown via portal
   ============================= */
function MetalDropdown({
  open,
  anchorRef,
  metalView,
  stageCounts,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  menuRefExternal,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const menuH = menuRef.current ? menuRef.current.offsetHeight : 150;
    const below = rect.bottom + 6;
    const above = rect.top - menuH - 6;
    const placeAbove = below + menuH > vh && above > 0;

    setPos({
      top: placeAbove ? above : below,
      left: rect.left,
      width: Math.max(rect.width, 220),
    });
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(el) => {
        menuRef.current = el;
        if (menuRefExternal) menuRefExternal.current = el;
      }}
      role="menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 99999,
      }}
      className="rounded-lg shadow-xl border border-gray-200 bg-white overflow-hidden text-gray-800"
    >
      <MenuItem
        active={metalView === "overview"}
        label="Overview"
        meta="All"
        onClick={() => onSelect("overview")}
      />
      <Divider />
      <MenuItem
        active={metalView === "development"}
        label="Development Stage"
        meta={stageCounts.development}
        onClick={() => onSelect("development")}
      />
      <MenuItem
        active={metalView === "finishing"}
        label="Finishing Stage"
        meta={stageCounts.finishing}
        onClick={() => onSelect("finishing")}
      />
    </div>,
    document.body
  );
}

/* =============================
   Manage dropdown via portal
   ============================= */
function ManageDropdown({
  open,
  anchorRef,
  manageView,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  menuRefExternal,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const menuH = menuRef.current ? menuRef.current.offsetHeight : 160;
    const below = rect.bottom + 6;
    const above = rect.top - menuH - 6;
    const placeAbove = below + menuH > vh && above > 0;

    setPos({
      top: placeAbove ? above : below,
      left: rect.left,
      width: Math.max(rect.width, 240),
    });
  }, [open, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={(el) => {
        menuRef.current = el;
        if (menuRefExternal) menuRefExternal.current = el;
      }}
      role="menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 99999,
      }}
      className="rounded-lg shadow-xl border border-gray-200 bg-white overflow-hidden text-gray-800"
    >
      <MenuItem
        active={manageView === "cases"}
        label="Manage Cases"
        meta=""
        onClick={() => onSelect("cases")}
      />
      <Divider />
      <MenuItem
        active={manageView === "system"}
        label="System Management"
        meta="Faculty"
        onClick={() => onSelect("system")}
      />
    </div>,
    document.body
  );
}

function MenuItem({ active, label, meta, onClick }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        "flex w-full items-center justify-between px-4 py-2 text-sm select-none",
        active ? "bg-gray-50 font-semibold" : "hover:bg-gray-100"
      )}
    >
      <span className="truncate">{label}</span>
      <span className="ml-3 text-xs text-gray-500">{meta}</span>
    </button>
  );
}

const Divider = () => <div className="border-t border-gray-200 my-1" />;

export default function App() {
  return (
    <UserProvider>
      <AuthGate />
    </UserProvider>
  );
}

// Renders the login screen until the user has identified themselves.
// Nothing in the app tree (DataProvider, Supabase subscriptions, etc.)
// mounts until AuthGate passes — deleting the DOM node in DevTools has
// no effect because the app simply doesn't exist in the tree yet.
function AuthGate() {
  const { needsName } = useContext(UserCtx);
  if (needsName) return <LoginScreen />;
  return <AppShell />;
}

function LoginScreen() {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[#103E48] to-[#16525F]">
      <UserSetupModal />
    </div>
  );
}

function AppShell() {
  const [view, setView] = useState(
    localStorage.getItem("lastView") || "digital"
  );
  const [theme, setTheme] = useState(
    localStorage.getItem("boardTheme") || "blue"
  );
  const [showInfoBar, setShowInfoBar] = useState(
    JSON.parse(localStorage.getItem("showInfoBar") || "true")
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [digitalView, setDigitalView] = useState(
    localStorage.getItem("lastDigitalView") || "overview"
  );

  const [metalView, setMetalView] = useState(
    localStorage.getItem("lastMetalView") || "overview"
  );

  const [manageView, setManageView] = useState(
    localStorage.getItem("lastManageView") || "cases"
  );

  const [showDigitalDropdown, setShowDigitalDropdown] = useState(false);
  const [showMetalDropdown, setShowMetalDropdown] = useState(false);
  const [showManageDropdown, setShowManageDropdown] = useState(false);

  // Week offset state
  const [weekOffset, setWeekOffset] = useState(0);

  const [facultySystemManagerEnabled, setFacultySystemManagerEnabled] =
    useState(() =>
      JSON.parse(localStorage.getItem("facultySystemManager") ?? "false")
    );

  useEffect(() => {
    document.documentElement.classList.toggle("theme-white", theme === "white");
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    document.documentElement.classList.toggle("theme-pink", theme === "pink");
  }, [theme]);

  useEffect(() => {
    // Theme colour map – applied to <html> so the gradient fills the entire
    // screen including iOS safe-area gutters (status bar + home indicator).
    // Using inline style instead of Tailwind classes because Tailwind's
    // bg-gradient-to-br is relative to element size and would leave bare
    // background visible behind safe-area padding on body.
    const gradients = {
      blue: "linear-gradient(to bottom right, #103E48 0%, #16525F 100%)",
      white: "linear-gradient(to bottom right, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0.9) 100%)",
      dark: "linear-gradient(to bottom right, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
      pink: "linear-gradient(to bottom right, rgba(255,240,245,0.4) 0%, rgba(252,231,243,0.6) 50%, rgba(255,240,245,0.9) 100%)",
    };
    const gradient = gradients[theme] || gradients.blue;
    // Set on html so it bleeds behind the safe-area insets on body
    document.documentElement.style.background = `${gradient} no-repeat fixed`;
    document.documentElement.style.backgroundSize = "100% 100%";
    // Keep body transparent so html background shows through safe zones
    document.body.style.background = "transparent";

    // Legacy Tailwind classes removed – no longer needed for background
    const allBgClasses = ["bg-gradient-to-br", "from-[#103E48]", "to-[#16525F]",
      "from-white/40", "via-white/60", "to-white/90",
      "from-slate-900", "via-slate-800",
      "from-pink-50/40", "via-pink-100/60", "to-pink-50/90"];
    document.body.classList.remove(...allBgClasses);
  }, [theme]);

  useEffect(() => {
    const timerId = scheduleMidnightRefresh();
    return () => clearTimeout(timerId);
  }, []);

  useEffect(() => localStorage.setItem("lastView", view), [view]);

  useEffect(
    () => localStorage.setItem("lastDigitalView", digitalView),
    [digitalView]
  );

  useEffect(
    () => localStorage.setItem("lastMetalView", metalView),
    [metalView]
  );

  useEffect(
    () => localStorage.setItem("lastManageView", manageView),
    [manageView]
  );

  // When faculty system manager is disabled, force back to cases view
  useEffect(() => {
    if (!facultySystemManagerEnabled && manageView === "system") {
      setManageView("cases");
    }
  }, [facultySystemManagerEnabled, manageView]);

  useEffect(() => {
    const onSettingsChanged = () => {
      setFacultySystemManagerEnabled(
        JSON.parse(localStorage.getItem("facultySystemManager") ?? "false")
      );
    };
    window.addEventListener("settings-changed", onSettingsChanged);
    return () =>
      window.removeEventListener("settings-changed", onSettingsChanged);
  }, []);

  // Listen for settings-applied event (from UserSetupModal when applying saved settings)
  // This updates the App state immediately without requiring a page refresh
  useEffect(() => {
    const onSettingsApplied = (e) => {
      const appliedSettings = e.detail || {};
      console.log("[App] Settings applied event received:", appliedSettings);

      // Update theme if it was changed
      if (appliedSettings.boardTheme !== undefined) {
        setTheme(appliedSettings.boardTheme);
      }

      // Update showInfoBar if it was changed
      if (appliedSettings.showInfoBar !== undefined) {
        // Handle both string and boolean values
        const value =
          typeof appliedSettings.showInfoBar === "string"
            ? appliedSettings.showInfoBar === "true"
            : appliedSettings.showInfoBar;
        setShowInfoBar(value);
      }

      // Update facultySystemManager if it was changed
      if (appliedSettings.facultySystemManager !== undefined) {
        const value =
          typeof appliedSettings.facultySystemManager === "string"
            ? appliedSettings.facultySystemManager === "true"
            : appliedSettings.facultySystemManager;
        setFacultySystemManagerEnabled(value);
      }
    };

    window.addEventListener("settings-applied", onSettingsApplied);
    return () =>
      window.removeEventListener("settings-applied", onSettingsApplied);
  }, []);

  // Reset week offset when changing views or stages
  useEffect(() => {
    setWeekOffset(0);
  }, [view, digitalView, metalView]);

  function scheduleMidnightRefresh() {
    const now = new Date();
    const ms =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    return setTimeout(() => window.location.reload(), ms);
  }

  // Week navigation handlers
  const handleNextWeek = useCallback(() => {
    setWeekOffset((prev) => prev + 1);
  }, []);

  const handlePrevWeek = useCallback(() => {
    setWeekOffset((prev) => Math.max(0, prev - 1));
  }, []);

  let activeDept = null;
  if (view === "digital") activeDept = "General";
  else if (view === "cb") activeDept = "C&B";
  else if (view === "metal") activeDept = "Metal";

  return (
    <LiteModeProvider>
      <FlashProvider>
        <DataProvider activeDept={activeDept}>
          <Inner
            view={view}
            setView={setView}
            digitalView={digitalView}
            setDigitalView={setDigitalView}
            metalView={metalView}
            setMetalView={setMetalView}
            showDigitalDropdown={showDigitalDropdown}
            setShowDigitalDropdown={setShowDigitalDropdown}
            showMetalDropdown={showMetalDropdown}
            setShowMetalDropdown={setShowMetalDropdown}
            manageView={manageView}
            setManageView={setManageView}
            showManageDropdown={showManageDropdown}
            setShowManageDropdown={setShowManageDropdown}
            facultySystemManagerEnabled={facultySystemManagerEnabled}
            showInfoBar={showInfoBar}
            setSettingsOpen={setSettingsOpen}
            weekOffset={weekOffset}
            onNextWeek={handleNextWeek}
            onPrevWeek={handlePrevWeek}
          />

          <Suspense fallback={null}>
            <SettingsModal
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              theme={theme}
              setTheme={setTheme}
              showInfoBar={showInfoBar}
              setShowInfoBar={setShowInfoBar}
            />
          </Suspense>

        </DataProvider>
      </FlashProvider>
    </LiteModeProvider>
  );
}

function Inner({
  view,
  setView,
  digitalView,
  setDigitalView,
  metalView,
  setMetalView,
  manageView,
  setManageView,
  showDigitalDropdown,
  setShowDigitalDropdown,
  showMetalDropdown,
  setShowMetalDropdown,
  showManageDropdown,
  setShowManageDropdown,
  facultySystemManagerEnabled,
  showInfoBar,
  setSettingsOpen,
  weekOffset,
  onNextWeek,
  onPrevWeek,
}) {
  const { rows } = useMut();
  const isLightTheme =
    document.documentElement.classList.contains("theme-white") ||
    document.documentElement.classList.contains("theme-pink");
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const metalButtonRef = useRef(null);
  const metalDropdownRef = useRef(null);
  const manageButtonRef = useRef(null);
  const manageDropdownRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const hasBeenOnDigital = useRef(view === "digital");
  const hasBeenOnMetal = useRef(view === "metal");
  const hasBeenOnManage = useRef(view === "manage");
  const isDropdownPinned = useRef(false);
  const isMetalDropdownPinned = useRef(false);
  const isManageDropdownPinned = useRef(false);
  const [isCalculatingStats, setIsCalculatingStats] = useState(false);
  const statsCalculationTimeout = useRef(null);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);

  let activeDept = null;
  if (view === "digital") activeDept = "General";
  else if (view === "cb") activeDept = "C&B";
  else if (view === "metal") activeDept = "Metal";

  // Determine if week navigation should be shown (only for board views, not manage)
  const showWeekNav = view !== "manage";

  useEffect(() => {
    const handleResize = () => {
      setIsMobileView(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (view === "digital") hasBeenOnDigital.current = true;
    if (view === "metal") hasBeenOnMetal.current = true;
    if (view === "manage") hasBeenOnManage.current = true;
  }, [view]);

  useEffect(
    () => () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (statsCalculationTimeout.current)
        clearTimeout(statsCalculationTimeout.current);
    },
    []
  );

  const handleClickOutside = useCallback(
    (e) => {
      if (!isDropdownPinned.current && showDigitalDropdown) {
        const btn = buttonRef.current;
        const menu = dropdownRef.current;
        if (
          btn &&
          !btn.contains(e.target) &&
          menu &&
          !menu.contains(e.target)
        ) {
          setShowDigitalDropdown(false);
        }
      }
      if (!isMetalDropdownPinned.current && showMetalDropdown) {
        const btn = metalButtonRef.current;
        const menu = metalDropdownRef.current;
        if (
          btn &&
          !btn.contains(e.target) &&
          menu &&
          !menu.contains(e.target)
        ) {
          setShowMetalDropdown(false);
        }
      }

      if (!isManageDropdownPinned.current && showManageDropdown) {
        const btn = manageButtonRef.current;
        const menu = manageDropdownRef.current;
        if (
          btn &&
          !btn.contains(e.target) &&
          menu &&
          !menu.contains(e.target)
        ) {
          setShowManageDropdown(false);
        }
      }
    },
    [
      showDigitalDropdown,
      showMetalDropdown,
      showManageDropdown,
      setShowDigitalDropdown,
      setShowMetalDropdown,
      setShowManageDropdown,
    ]
  );

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  const handleDigitalClick = () => {
    if (view === "digital") {
      if (!showDigitalDropdown) {
        setShowDigitalDropdown(true);
        isDropdownPinned.current = true;
      }
    } else {
      setView("digital");
      setDigitalView("overview");
      setShowDigitalDropdown(false);
      setShowMetalDropdown(false);
      setShowManageDropdown(false);
      hasBeenOnDigital.current = true;
      isDropdownPinned.current = false;
      isMetalDropdownPinned.current = false;
      isManageDropdownPinned.current = false;
    }
  };

  const handleMetalClick = () => {
    if (view === "metal") {
      if (!showMetalDropdown) {
        setShowMetalDropdown(true);
        isMetalDropdownPinned.current = true;
      }
    } else {
      setView("metal");
      setMetalView("overview");
      setShowMetalDropdown(false);
      setShowDigitalDropdown(false);
      setShowManageDropdown(false);
      hasBeenOnMetal.current = true;
      isMetalDropdownPinned.current = false;
      isDropdownPinned.current = false;
      isManageDropdownPinned.current = false;
    }
  };

  const handleManageClick = () => {
    if (view === "manage") {
      // Only show dropdown if faculty system manager is enabled
      if (facultySystemManagerEnabled && !showManageDropdown) {
        setShowManageDropdown(true);
        isManageDropdownPinned.current = true;
      }
    } else {
      setView("manage");
      // When switching to manage view, always go to cases (unless faculty is enabled and was on system)
      if (!facultySystemManagerEnabled) {
        setManageView("cases");
      }
      setShowManageDropdown(false);
      setShowDigitalDropdown(false);
      setShowMetalDropdown(false);
      hasBeenOnManage.current = true;
      isManageDropdownPinned.current = false;
      isDropdownPinned.current = false;
      isMetalDropdownPinned.current = false;
    }
  };

  const handleManageMouseEnter = () => {
    // Only show dropdown on hover if faculty system manager is enabled
    if (!facultySystemManagerEnabled) return;

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (showDigitalDropdown && !isDropdownPinned.current) {
      setShowDigitalDropdown(false);
    }
    if (showMetalDropdown && !isMetalDropdownPinned.current) {
      setShowMetalDropdown(false);
    }
    if (
      !isManageDropdownPinned.current &&
      (view === "manage" || hasBeenOnManage.current)
    ) {
      setShowManageDropdown(true);
    }
  };

  const handleManageMouseLeave = () => {
    if (!facultySystemManagerEnabled) return;
    if (isManageDropdownPinned.current) return;
    closeTimeoutRef.current = setTimeout(() => {
      if (!isManageDropdownPinned.current) setShowManageDropdown(false);
    }, 200);
  };

  const selectManageView = (next) => {
    setView("manage");
    setManageView(next);
    setShowManageDropdown(false);
    isManageDropdownPinned.current = false;
  };

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (showMetalDropdown && !isMetalDropdownPinned.current) {
      setShowMetalDropdown(false);
    }
    if (showManageDropdown && !isManageDropdownPinned.current) {
      setShowManageDropdown(false);
    }
    if (
      !isDropdownPinned.current &&
      (view === "digital" || hasBeenOnDigital.current)
    ) {
      setShowDigitalDropdown(true);
    }
  };

  const handleMouseLeave = () => {
    if (isDropdownPinned.current) return;
    closeTimeoutRef.current = setTimeout(() => {
      if (!isDropdownPinned.current) setShowDigitalDropdown(false);
    }, 200);
  };

  const handleMetalMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    if (showDigitalDropdown && !isDropdownPinned.current) {
      setShowDigitalDropdown(false);
    }
    if (showManageDropdown && !isManageDropdownPinned.current) {
      setShowManageDropdown(false);
    }
    if (
      !isMetalDropdownPinned.current &&
      (view === "metal" || hasBeenOnMetal.current)
    ) {
      setShowMetalDropdown(true);
    }
  };

  const handleMetalMouseLeave = () => {
    if (isMetalDropdownPinned.current) return;
    closeTimeoutRef.current = setTimeout(() => {
      if (!isMetalDropdownPinned.current) setShowMetalDropdown(false);
    }, 200);
  };

  const selectDigitalView = useCallback(
    (subView) => {
      setView("digital");
      if (subView !== "overview" && subView !== digitalView) {
        setIsCalculatingStats(true);
      }
      setDigitalView(subView);
      setShowDigitalDropdown(false);
      setShowManageDropdown(false);
      isDropdownPinned.current = false;
      isManageDropdownPinned.current = false;

      if (statsCalculationTimeout.current)
        clearTimeout(statsCalculationTimeout.current);
      if (subView !== "overview") {
        statsCalculationTimeout.current = setTimeout(
          () => setIsCalculatingStats(false),
          3000
        );
      } else {
        setIsCalculatingStats(false);
      }
    },
    [digitalView, setView, setDigitalView, setShowDigitalDropdown]
  );

  const selectMetalView = useCallback(
    (subView) => {
      setView("metal");
      if (subView !== "overview" && subView !== metalView) {
        setIsCalculatingStats(true);
      }
      setMetalView(subView);
      setShowMetalDropdown(false);
      setShowManageDropdown(false);
      isMetalDropdownPinned.current = false;
      isManageDropdownPinned.current = false;

      if (statsCalculationTimeout.current)
        clearTimeout(statsCalculationTimeout.current);
      if (subView !== "overview") {
        statsCalculationTimeout.current = setTimeout(
          () => setIsCalculatingStats(false),
          3000
        );
      } else {
        setIsCalculatingStats(false);
      }
    },
    [metalView, setView, setMetalView, setShowMetalDropdown]
  );

  const getStageFromModifiers = (mods = []) => {
    if (mods.includes("stage-qc")) return "qc";
    if (mods.includes("stage-finishing")) return "finishing";
    if (mods.includes("stage-production")) return "production";
    if (mods.includes("stage-design")) return "design";
    return "design";
  };

  const stageCounts = React.useMemo(() => {
    const c = { design: 0, production: 0, finishing: 0 };
    rows.forEach((r) => {
      if (r.department === "General" && !r.completed && !r.archived) {
        const stage = getStageFromModifiers(r.modifiers);
        if (stage !== "qc") {
          c[stage]++;
        }
      }
    });
    return c;
  }, [rows]);

  const metalStageCounts = React.useMemo(() => {
    const c = { development: 0, finishing: 0 };
    rows.forEach((r) => {
      if (r.department === "Metal" && !r.completed && !r.archived) {
        if (!r.stage2) {
          c.development++;
        } else {
          c.finishing++;
        }
      }
    });
    return c;
  }, [rows]);

  // Determine button label for Manage
  const getManageButtonLabel = () => {
    if (isMobileView) {
      return "Manage";
    }
    if (facultySystemManagerEnabled && manageView === "system") {
      return "System Management";
    }
    return "Manage Cases";
  };

  // Show dropdown arrow only if faculty system manager is enabled
  const showManageDropdownArrow = facultySystemManagerEnabled;

  const tabs = [["cb", "C&B"]];

  return (
    <div
      className={clsx(
        "flex flex-col min-h-screen w-screen flex-1 transition-colors",
        isLightTheme ? "text-gray-900" : "text-white"
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-center gap-4 p-4 bg-[#103E48]/30 shadow backdrop-blur-md rounded-b-xl relative z-40">
        <SettingsPill
          onClick={() => setSettingsOpen(true)}
          className="absolute left-4 top-1/2 -translate-y-1/2"
          isMobile={false}
        />

        {/* Week Navigation - Desktop (right side of header) */}
        {showWeekNav && !isMobileView && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <WeekNavigation
              weekOffset={weekOffset}
              onPrev={onPrevWeek}
              onNext={onNextWeek}
              isLightTheme={isLightTheme}
              isMobile={false}
            />
          </div>
        )}

        {/* Digital button */}
        <div className="relative" style={{ zIndex: 60 }}>
          <button
            ref={buttonRef}
            onClick={handleDigitalClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={clsx(
              "px-4 py-2 rounded-xl font-semibold transition text-center flex items-center gap-1",
              "flex-1 md:flex-none",
              view === "digital"
                ? isLightTheme
                  ? "bg-white/70 backdrop-blur-md text-gray-900 shadow"
                  : "bg-white text-[#103E48] shadow"
                : "bg-white/10 hover:bg-white/20 backdrop-blur"
            )}
          >
            Digital
            {(view === "digital" || hasBeenOnDigital.current) && (
              <svg
                className={clsx(
                  "w-4 h-4 transition-transform duration-200",
                  showDigitalDropdown ? "rotate-180" : ""
                )}
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
              </svg>
            )}
          </button>

          <DigitalDropdown
            open={showDigitalDropdown}
            anchorRef={buttonRef}
            digitalView={digitalView}
            stageCounts={stageCounts}
            onSelect={selectDigitalView}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            menuRefExternal={dropdownRef}
          />
        </div>

        {/* Metal button */}
        <div className="relative" style={{ zIndex: 60 }}>
          <button
            ref={metalButtonRef}
            onClick={handleMetalClick}
            onMouseEnter={handleMetalMouseEnter}
            onMouseLeave={handleMetalMouseLeave}
            className={clsx(
              "px-4 py-2 rounded-xl font-semibold transition text-center flex items-center gap-1",
              "flex-1 md:flex-none",
              view === "metal"
                ? isLightTheme
                  ? "bg-white/70 backdrop-blur-md text-gray-900 shadow"
                  : "bg-white text-[#103E48] shadow"
                : "bg-white/10 hover:bg-white/20 backdrop-blur"
            )}
          >
            Metal
            {(view === "metal" || hasBeenOnMetal.current) && (
              <svg
                className={clsx(
                  "w-4 h-4 transition-transform duration-200",
                  showMetalDropdown ? "rotate-180" : ""
                )}
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
              </svg>
            )}
          </button>

          <MetalDropdown
            open={showMetalDropdown}
            anchorRef={metalButtonRef}
            metalView={metalView}
            stageCounts={metalStageCounts}
            onSelect={selectMetalView}
            onMouseEnter={handleMetalMouseEnter}
            onMouseLeave={handleMetalMouseLeave}
            menuRefExternal={metalDropdownRef}
          />
        </div>

        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setView(key);
              setShowDigitalDropdown(false);
              setShowMetalDropdown(false);
              setShowManageDropdown(false);
              isDropdownPinned.current = false;
              isMetalDropdownPinned.current = false;
              isManageDropdownPinned.current = false;
            }}
            className={clsx(
              "px-4 py-2 rounded-xl font-semibold transition text-center",
              "flex-1 md:flex-none",
              key === "manage" && "whitespace-nowrap",
              view === key
                ? isLightTheme
                  ? "bg-white/70 backdrop-blur-md text-gray-900 shadow"
                  : "bg-white text-[#103E48] shadow"
                : "bg-white/10 hover:bg-white/20 backdrop-blur"
            )}
          >
            {label}
          </button>
        ))}

        {/* Manage button */}
        <div className="relative" style={{ zIndex: 60 }}>
          <button
            ref={manageButtonRef}
            onClick={handleManageClick}
            onMouseEnter={handleManageMouseEnter}
            onMouseLeave={handleManageMouseLeave}
            className={clsx(
              "px-4 py-2 rounded-xl font-semibold transition text-center flex items-center gap-1",
              "flex-1 md:flex-none whitespace-nowrap",
              view === "manage"
                ? isLightTheme
                  ? "bg-white/70 backdrop-blur-md text-gray-900 shadow"
                  : "bg-white text-[#103E48] shadow"
                : "bg-white/10 hover:bg-white/20 backdrop-blur"
            )}
          >
            {getManageButtonLabel()}
            {showManageDropdownArrow &&
              (view === "manage" || hasBeenOnManage.current) && (
                <svg
                  className={clsx(
                    "w-4 h-4 transition-transform duration-200",
                    showManageDropdown ? "rotate-180" : ""
                  )}
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
                </svg>
              )}
          </button>

          {facultySystemManagerEnabled && (
            <ManageDropdown
              open={showManageDropdown}
              anchorRef={manageButtonRef}
              manageView={manageView}
              onSelect={selectManageView}
              onMouseEnter={handleManageMouseEnter}
              onMouseLeave={handleManageMouseLeave}
              menuRefExternal={manageDropdownRef}
            />
          )}
        </div>
      </header>

      {/* Mobile settings fab */}
      <SettingsPill
        onClick={() => setSettingsOpen(true)}
        className="fixed bottom-4 left-4 z-40 shadow-lg"
        isMobile={true}
      />

      {/* Week Navigation - Mobile (bottom right) */}
      {showWeekNav && isMobileView && (
        <WeekNavigation
          weekOffset={weekOffset}
          onPrev={onPrevWeek}
          onNext={onNextWeek}
          isLightTheme={isLightTheme}
          isMobile={true}
        />
      )}

      {/* Main content */}
      {view === "manage" ? (
        <Suspense fallback={<PanelLoader />}>
          {facultySystemManagerEnabled && manageView === "system" ? (
            <SystemManagementScreen />
          ) : (
            <Editor data={rows} deptDefault="Digital" showInfoBar={showInfoBar} />
          )}
        </Suspense>
      ) : (
        <Board
          data={rows}
          stage={
            view === "digital" && digitalView !== "overview"
              ? digitalView
              : view === "metal" && metalView !== "overview"
              ? metalView
              : null
          }
          activeDept={activeDept}
          isCalculatingStats={isCalculatingStats}
          onStatsCalculated={() => setIsCalculatingStats(false)}
          weekOffset={weekOffset}
        />
      )}
    </div>
  );
}
