import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useUser } from "../context/UserContext";
import { useLiteMode } from "../LiteModePerformancePatch";

/* ─── fluid animation presets ─── */
const SHEET = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  shown: { opacity: 1, y: 0, scale: 1 },
};
const SHEET_T = {
  type: "spring",
  stiffness: 300,
  damping: 28,
  mass: 0.8,
};

const LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 200,
  damping: 28,
  mass: 0.8,
};

const cardVariants = {
  closed: {
    height: 0,
    transition: {
      height: {
        type: "spring",
        stiffness: 350,
        damping: 32,
        mass: 0.5,
      },
    },
  },
  open: {
    height: "auto",
    transition: {
      height: {
        type: "spring",
        stiffness: 280,
        damping: 28,
        mass: 0.6,
      },
    },
  },
};

/* ─── icons ─── */
const IconUser = React.memo(() => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
  </svg>
));
const IconEye = React.memo(() => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 stroke-current fill-none">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
));
const IconRefresh = React.memo(({ spin }) => (
  <motion.svg
    viewBox="0 0 24 24"
    className="h-5 w-5 stroke-current fill-none"
    animate={spin ? { rotate: 360 } : { rotate: 0 }}
    transition={spin ? { repeat: Infinity, duration: 0.6, ease: "linear" } : {}}
  >
    <path d="M4 4v6h6" strokeWidth="2" strokeLinecap="round" />
    <path d="M20 20v-6h-6" strokeWidth="2" strokeLinecap="round" />
    <path d="M5 17a8 8 0 0 0 13 2M19 7A8 8 0 0 0 6 5" strokeWidth="2" />
  </motion.svg>
));
const IconBolt = React.memo(() => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8Z" />
  </svg>
));

/* ─── Toggle Switch Component ─── */
const ToggleSwitch = React.memo(({ enabled, onChange, label, description }) => (
  <div className="flex items-start justify-between gap-3 py-2">
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-gray-800">{label}</div>
      {description && (
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      )}
    </div>
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        enabled ? "bg-teal-600" : "bg-gray-300"
      }`}
      role="switch"
      aria-checked={enabled}
    >
      <motion.span
        className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0"
        initial={false}
        animate={{ x: enabled ? 20 : 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        style={{ willChange: "transform" }}
      />
    </button>
  </div>
));

/* ─── Theme Selector Component ─── */
const ThemeSelector = React.memo(({ theme, onChange }) => (
  <div className="py-2">
    <div className="text-sm font-medium text-gray-800 mb-2">Theme</div>
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => onChange("blue")}
        className={`py-2 px-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 ${
          theme === "blue"
            ? "border-teal-600 bg-teal-50 text-teal-700"
            : "border-gray-200 bg-white/50 text-gray-600 hover:border-gray-300"
        }`}
      >
        <div
          className="w-4 h-4 rounded-full theme-dot-blue"
          data-theme-dot="blue"
          style={{
            background: "linear-gradient(135deg, #103E48 0%, #16525F 100%)",
          }}
        />
        <span className="text-sm font-medium">Blue</span>
        {theme === "blue" && (
          <svg
            className="w-4 h-4 text-teal-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      <button
        onClick={() => onChange("white")}
        className={`py-2 px-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 ${
          theme === "white"
            ? "border-teal-600 bg-teal-50 text-teal-700"
            : "border-gray-200 bg-white/50 text-gray-600 hover:border-gray-300"
        }`}
      >
        <div
          className="w-4 h-4 rounded-full theme-dot-white border"
          data-theme-dot="white"
          style={{
            background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
            borderColor: "#cbd5e1",
          }}
        />
        <span className="text-sm font-medium">White</span>
        {theme === "white" && (
          <svg
            className="w-4 h-4 text-teal-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      <button
        onClick={() => onChange("pink")}
        className={`py-2 px-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 ${
          theme === "pink"
            ? "border-teal-600 bg-teal-50 text-teal-700"
            : "border-gray-200 bg-white/50 text-gray-600 hover:border-gray-300"
        }`}
      >
        <div
          className="w-4 h-4 rounded-full theme-dot-pink"
          data-theme-dot="pink"
          style={{
            background: "linear-gradient(135deg, #fbcfe8 0%, #f472b6 100%)",
          }}
        />
        <span className="text-sm font-medium">Pink</span>
        {theme === "pink" && (
          <svg
            className="w-4 h-4 text-teal-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      <button
        onClick={() => onChange("dark")}
        className={`py-2 px-3 rounded-lg border-2 transition-all duration-200 flex items-center justify-center gap-2 ${
          theme === "dark"
            ? "border-teal-600 bg-teal-50 text-teal-700"
            : "border-gray-200 bg-white/50 text-gray-600 hover:border-gray-300"
        }`}
      >
        <div
          className="w-4 h-4 rounded-full theme-dot-dark border"
          data-theme-dot="dark"
          style={{
            background: "linear-gradient(135deg, #64748b 0%, #1e293b 100%)",
            borderColor: "#475569",
          }}
        />
        <span className="text-sm font-medium">Dark</span>
        {theme === "dark" && (
          <svg
            className="w-4 h-4 text-teal-600"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
    </div>
  </div>
));

/* ─── Action Button ─── */
const ActionBtn = React.memo(
  ({ children, className = "", variant = "default", ...p }) => {
    const variants = {
      default: "bg-white/50 border-gray-200 text-gray-700 settings-action-btn",
      primary: "bg-teal-600 border-teal-600 text-white hover:bg-teal-700",
      success: "bg-green-500 border-green-500 text-white",
    };

    return (
      <motion.button
        {...p}
        whileTap={{ scale: 0.98 }}
        whileHover={{ scale: 1.01 }}
        transition={{ type: "tween", duration: 0.1, ease: "easeOut" }}
        className={`w-full rounded-lg py-2.5 px-4 backdrop-blur-lg border
        shadow-sm transition-colors duration-150 font-medium text-sm
        ${variants[variant]} ${className}`}
        style={{ willChange: "transform" }}
      >
        {children}
      </motion.button>
    );
  }
);

/* ─── Card Component ─── */
const Card = React.memo(({ open, toggle, icon, title, children }) => {
  return (
    <motion.div
      layout="position"
      layoutId={`card-${title}`}
      className="rounded-xl glass shadow-lg overflow-hidden"
      style={{
        boxShadow:
          "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
        willChange: "transform",
      }}
      transition={LAYOUT_TRANSITION}
      initial={false}
    >
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 h-14 select-none relative z-10 settings-card-header transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="text-gray-600">{icon}</div>
          <span className="font-medium text-gray-800">{title}</span>
        </div>
        <motion.svg
          viewBox="0 0 24 24"
          className="h-4 w-4 stroke-gray-400 fill-none"
          initial={false}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{
            type: "tween",
            duration: 0.15,
            ease: "easeOut",
          }}
        >
          <path d="M9 6l6 6-6 6" strokeWidth="2" strokeLinecap="round" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.div
            key="body"
            variants={cardVariants}
            initial="closed"
            animate="open"
            exit="closed"
            style={{ overflow: "hidden", willChange: "height" }}
          >
            <div className="px-4 pb-4 space-y-1 border-t border-gray-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

/* ─── Divider ─── */
const Divider = React.memo(() => (
  <div className="border-t border-gray-100 my-2" />
));

/* ─── Helper function to safely read autoUpdate from localStorage ─── */
const getAutoUpdateSetting = () => {
  try {
    const stored = localStorage.getItem("autoUpdate");
    return stored === "true";
  } catch (e) {
    return false;
  }
};

/* ─── modal ─── */
export default function SettingsModal({
  open,
  onClose,
  theme,
  setTheme,
  showInfoBar,
  setShowInfoBar,
}) {
  const { lite: liteUi, toggle: toggleLiteUi } = useLiteMode();
  const { name } = useUser();

  /* --- update flags ---------------------------------------------------- */
  const initUpdate =
    document.documentElement.classList.contains("update-pending");
  const initPriority = localStorage.getItem("updatePriority") || "normal";
  const [updatePending, setUpdatePending] = useState(initUpdate);
  const [updateNotes, setUpdateNotes] = useState(
    localStorage.getItem("updateNotes") ?? ""
  );
  const [updatePriority, setUpdatePriority] = useState(initPriority);
  const [autoUpdate, setAutoUpdate] = useState(() => getAutoUpdateSetting());
  const [showNotes, setShowNotes] = useState(initUpdate && updateNotes);

  /* --- which card is open --------------------------------------------- */
  const [card, setCard] = useState(initUpdate ? "sys" : "");

  /* --- Settings state --------------------------------------------- */
  const [showCaseTableDividers, setShowCaseTableDividers] = useState(() =>
    JSON.parse(localStorage.getItem("showCaseTableDividers") ?? "true")
  );

  const [lockAddCaseCard, setLockAddCaseCard] = useState(() =>
    JSON.parse(localStorage.getItem("lockAddCaseCard") ?? "false")
  );

  const [showStageDividers, setShowStageDividers] = useState(
    JSON.parse(localStorage.getItem("showStageDividers") || "false")
  );

  const [facultySystemManager, setFacultySystemManager] = useState(() =>
    JSON.parse(localStorage.getItem("facultySystemManager") ?? "false")
  );

  /* --- Mobile Board View State (off by default) --- */
  const [enableMobileBoardView, setEnableMobileBoardView] = useState(() =>
    JSON.parse(localStorage.getItem("enableMobileBoardView") ?? "false")
  );

  /* --- Disable Automations State (off by default) --- */
  const [disableAutomations, setDisableAutomations] = useState(() =>
    JSON.parse(localStorage.getItem("disableAutomations") ?? "true")
  );

  /* --- Dark Mode Boost State --- */
  const [boostDarkMode, setBoostDarkMode] = useState(() =>
    JSON.parse(localStorage.getItem("boostDarkMode") ?? "false")
  );

  /* --- Sanitize autoUpdate value on mount (one-time fix for corrupted values) --- */
  useEffect(() => {
    const stored = localStorage.getItem("autoUpdate");
    if (stored !== null && stored !== "true" && stored !== "false") {
      localStorage.setItem("autoUpdate", "false");
      setAutoUpdate(false);
    }
  }, []);

  /* --- Apply Boost Dark Mode Class --- */
  useEffect(() => {
    if (boostDarkMode) {
      document.documentElement.classList.add("theme-dark-boost");
    } else {
      document.documentElement.classList.remove("theme-dark-boost");
    }
  }, [boostDarkMode]);

  /* react to new update-available events */
  useEffect(() => {
    const fn = (e) => {
      const priority = e.detail?.priority ?? "normal";
      const notes = e.detail?.notes ?? "";

      localStorage.setItem("updateNotes", notes);
      localStorage.setItem("updatePriority", priority);
      setUpdateNotes(notes);
      setUpdatePriority(priority);

      if (
        priority === "force" ||
        localStorage.getItem("forceUpdate") === "true"
      ) {
        localStorage.removeItem("forceUpdate");
        window.location.reload();
        return;
      }

      const currentAutoUpdateValue = localStorage.getItem("autoUpdate");
      const isAutoUpdateEnabled = currentAutoUpdateValue === "true";

      if (isAutoUpdateEnabled) {
        document.documentElement.classList.remove(
          "update-pending",
          "update-critical"
        );
        window.location.reload();
      } else {
        setUpdatePending(true);
        setCard("sys");
        setShowNotes(!!notes);

        if (priority === "high") {
          document.documentElement.classList.add("update-critical");
        } else {
          document.documentElement.classList.remove("update-critical");
        }
        document.documentElement.classList.add("update-pending");
      }
    };
    window.addEventListener("update-available", fn);
    return () => window.removeEventListener("update-available", fn);
  }, []);

  const [spin, setSpin] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* --- Save autoUpdate to localStorage whenever it changes --- */
  useEffect(() => {
    localStorage.setItem("autoUpdate", autoUpdate ? "true" : "false");
  }, [autoUpdate]);

  const clearUpdateFlags = useCallback(() => {
    document.documentElement.classList.remove(
      "update-pending",
      "update-critical"
    );
    localStorage.removeItem("updateNotes");
    localStorage.removeItem("updatePriority");
    setUpdatePending(false);
    setUpdateNotes("");
    setUpdatePriority("normal");
    setShowNotes(false);
  }, []);

  const toggleCard = useCallback((cardName) => {
    setCard((prev) => (prev === cardName ? "" : cardName));
  }, []);

  const dispatchSettingsChanged = useCallback(() => {
    window.dispatchEvent(new Event("settings-changed"));
  }, []);

  const handleThemeChange = useCallback(
    (newTheme) => {
      setTheme(newTheme);
      localStorage.setItem("boardTheme", newTheme);
    },
    [setTheme]
  );

  const handleToggleInfoBar = useCallback(() => {
    const next = !showInfoBar;
    setShowInfoBar(next);
    localStorage.setItem("showInfoBar", JSON.stringify(next));
    window.dispatchEvent(new Event("infobar-toggle"));
    dispatchSettingsChanged();
  }, [showInfoBar, setShowInfoBar, dispatchSettingsChanged]);

  const handleToggleCaseTableDividers = useCallback(() => {
    const next = !showCaseTableDividers;
    setShowCaseTableDividers(next);
    localStorage.setItem("showCaseTableDividers", JSON.stringify(next));
    dispatchSettingsChanged();
  }, [showCaseTableDividers, dispatchSettingsChanged]);

  const handleToggleLockAddCaseCard = useCallback(() => {
    const next = !lockAddCaseCard;
    setLockAddCaseCard(next);
    localStorage.setItem("lockAddCaseCard", JSON.stringify(next));
    dispatchSettingsChanged();
  }, [lockAddCaseCard, dispatchSettingsChanged]);

  const handleToggleStageDividers = useCallback(() => {
    const next = !showStageDividers;
    setShowStageDividers(next);
    localStorage.setItem("showStageDividers", JSON.stringify(next));
    dispatchSettingsChanged();
  }, [showStageDividers, dispatchSettingsChanged]);

  const handleToggleMobileBoardView = useCallback(() => {
    const next = !enableMobileBoardView;
    setEnableMobileBoardView(next);
    localStorage.setItem("enableMobileBoardView", JSON.stringify(next));
    dispatchSettingsChanged();
  }, [enableMobileBoardView, dispatchSettingsChanged]);

  const handleToggleBoostDarkMode = useCallback(() => {
    const next = !boostDarkMode;
    setBoostDarkMode(next);
    localStorage.setItem("boostDarkMode", JSON.stringify(next));
  }, [boostDarkMode]);

  const handleToggleAutoUpdate = useCallback(() => {
    setAutoUpdate((prev) => !prev);
    dispatchSettingsChanged();
  }, [dispatchSettingsChanged]);

  const handleToggleFacultySystemManager = useCallback(() => {
    setFacultySystemManager((prev) => {
      const next = !prev;
      localStorage.setItem("facultySystemManager", JSON.stringify(next));
      dispatchSettingsChanged();
      return next;
    });
  }, [dispatchSettingsChanged]);

  const handleToggleDisableAutomations = useCallback(() => {
    const next = !disableAutomations;
    setDisableAutomations(next);
    localStorage.setItem("disableAutomations", JSON.stringify(next));
    dispatchSettingsChanged();
  }, [disableAutomations, dispatchSettingsChanged]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onClick={onClose}
      >
        <LayoutGroup>
          <motion.div
            variants={SHEET}
            initial="hidden"
            animate="shown"
            exit="hidden"
            transition={SHEET_T}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 p-3 glass-nb rounded-2xl max-h-[85vh] overflow-y-auto settings-modal-container"
            style={{
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              willChange: "transform, opacity",
              zIndex: 201,
            }}
            layout="position"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-2 pt-1 pb-2">
              <h2 className="text-lg font-semibold text-gray-100">Settings</h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg settings-close-btn transition-colors"
              >
                <svg
                  className="w-5 h-5 text-gray-200"
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

            {/* USER */}
            <Card
              open={card === "user"}
              toggle={() => toggleCard("user")}
              icon={<IconUser />}
              title="User"
            >
              <div className="pt-3 space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide">
                      Current User
                    </div>
                    <div className="font-medium text-gray-800 mt-0.5">
                      {name || "Not set"}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center">
                    <span className="text-teal-700 font-semibold text-lg">
                      {name ? name.charAt(0).toUpperCase() : "?"}
                    </span>
                  </div>
                </div>

                <ActionBtn
                  onClick={() => {
                    window.dispatchEvent(new Event("open-registration"));
                    onClose?.();
                  }}
                >
                  Change Name
                </ActionBtn>
              </div>
            </Card>

            {/* DISPLAY */}
            <Card
              open={card === "display"}
              toggle={() => toggleCard("display")}
              icon={<IconEye />}
              title="Display"
            >
              <div className="pt-3">
                <ThemeSelector theme={theme} onChange={handleThemeChange} />

                {/* Dark Mode Boost Toggle - Only visible when dark theme is active */}
                {theme === "dark" && (
                  <div className="mt-1 mb-2 p-2 bg-gray-100 rounded-lg border border-gray-200/50">
                    <ToggleSwitch
                      enabled={boostDarkMode}
                      onChange={handleToggleBoostDarkMode}
                      label="Boost Dark Mode"
                      description="Brighten background for low-contrast displays"
                    />
                  </div>
                )}

                <Divider />

                <ToggleSwitch
                  enabled={showInfoBar}
                  onChange={handleToggleInfoBar}
                  label="Info Cards"
                  description="Show Priority/Rush/Standard guide below the form"
                />

                <ToggleSwitch
                  enabled={showCaseTableDividers}
                  onChange={handleToggleCaseTableDividers}
                  label="Case Category Sections"
                  description="Group cases by Overdue, Priority, Rush, Hold"
                />

                <ToggleSwitch
                  enabled={lockAddCaseCard}
                  onChange={handleToggleLockAddCaseCard}
                  label="Lock Add Case Form"
                  description="Keep form expanded when scrolling (no bubble)"
                />

                <ToggleSwitch
                  enabled={showStageDividers}
                  onChange={handleToggleStageDividers}
                  label="Stage Dividers"
                  description="Show separators between stages in overview"
                />

                <ToggleSwitch
                  enabled={enableMobileBoardView}
                  onChange={handleToggleMobileBoardView}
                  label="Mobile Board View"
                  description="Show optimized board layout on small screens"
                />

                <Divider />

                <ToggleSwitch
                  enabled={!disableAutomations}
                  onChange={handleToggleDisableAutomations}
                  label="Smart Automations"
                  description="Auto-detect department, priority, rush from case notes"
                />
              </div>
            </Card>

            {/* PERFORMANCE – always visible */}
            <Card
              open={card === "performance"}
              toggle={() => toggleCard("performance")}
              icon={<IconBolt />}
              title="Performance"
            >
              <div className="pt-3 space-y-1">
                {/* Lite Mode master toggle */}
                <div
                  className={`p-3 rounded-lg border transition-colors ${
                    liteUi
                      ? "bg-amber-50 border-amber-200"
                      : "bg-gray-50 border-gray-200/50"
                  }`}
                >
                  <ToggleSwitch
                    enabled={liteUi}
                    onChange={toggleLiteUi}
                    label="⚡ Lite Mode"
                    description={
                      liteUi
                        ? "Active – blur & GPU compositor layers removed"
                        : "Removes blur & GPU layers so animations stay smooth on slow hardware"
                    }
                  />
                </div>

                {liteUi && (
                  <div className="mt-1 px-1 space-y-1 text-xs text-gray-500">
                    <p className="font-medium text-gray-600 pt-1">Active overrides:</p>
                    <ul className="space-y-0.5 list-none pl-0">
                      <li className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        Backdrop blur &amp; GPU filters removed
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        Glass panels → solid surfaces
                      </li>
                      <li className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        Translucent backgrounds made opaque
                      </li>
                    </ul>
                    <p className="text-gray-400 pt-0.5">Animations run at full speed · Shortcut: Alt + Shift + L</p>
                  </div>
                )}

                {!liteUi && (
                  <p className="text-xs text-gray-400 px-1 pt-1 pb-0.5">
                    Shortcut: Alt + Shift + L
                  </p>
                )}
              </div>
            </Card>

            {/* SYSTEM */}
            <Card
              open={card === "sys"}
              toggle={() => toggleCard("sys")}
              icon={<IconRefresh spin={spin} />}
              title="System"
            >
              <div className="pt-3 space-y-3">
                {/* Update Available Banner */}
                {updatePending && !autoUpdate && (
                  <div className="relative overflow-hidden rounded-lg">
                    <motion.div
                      className={`rounded-lg overflow-hidden ${
                        updatePriority === "high"
                          ? "bg-red-50 border border-red-200"
                          : "bg-blue-50 border border-blue-200"
                      }`}
                      layout="position"
                    >
                      <button
                        onClick={() => {
                          if (updateNotes) {
                            setShowNotes(!showNotes);
                          } else {
                            clearUpdateFlags();
                            window.location.reload();
                          }
                        }}
                        className="w-full p-3 flex items-center gap-3"
                      >
                        {/* Pulsing indicator */}
                        <div className="relative flex h-3 w-3">
                          <span
                            className={`absolute inline-flex h-full w-full rounded-full animate-ping ${
                              updatePriority === "high"
                                ? "bg-red-400"
                                : "bg-blue-400"
                            }`}
                            style={{ animationDuration: "1.5s" }}
                          />
                          <span
                            className={`relative inline-flex rounded-full h-3 w-3 ${
                              updatePriority === "high"
                                ? "bg-red-500"
                                : "bg-blue-500"
                            }`}
                          />
                        </div>

                        <div className="flex-1 text-left">
                          <div
                            className={`font-medium text-sm ${
                              updatePriority === "high"
                                ? "text-red-800"
                                : "text-blue-800"
                            }`}
                          >
                            {updatePriority === "high"
                              ? "Important Update Available"
                              : "Update Available"}
                          </div>
                          {!updateNotes && (
                            <div
                              className={`text-xs mt-0.5 ${
                                updatePriority === "high"
                                  ? "text-red-600"
                                  : "text-blue-600"
                              }`}
                            >
                              Tap to install
                            </div>
                          )}
                        </div>

                        {updateNotes && (
                          <motion.svg
                            className={`w-5 h-5 ${
                              updatePriority === "high"
                                ? "text-red-500"
                                : "text-blue-500"
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            initial={false}
                            animate={{ rotate: showNotes ? 180 : 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </motion.svg>
                        )}
                      </button>

                      {/* Release Notes */}
                      <AnimatePresence initial={false} mode="wait">
                        {showNotes && updateNotes && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div
                              className={`px-3 pb-3 pt-0 border-t ${
                                updatePriority === "high"
                                  ? "border-red-200"
                                  : "border-blue-200"
                              }`}
                            >
                              <div
                                className={`text-sm leading-relaxed mt-2 ${
                                  updatePriority === "high"
                                    ? "text-red-700"
                                    : "text-blue-700"
                                }`}
                              >
                                {updateNotes
                                  .split("\n")
                                  .map((line, index) => {
                                    const hasBullet = line
                                      .trim()
                                      .startsWith("•");
                                    const content = hasBullet
                                      ? line.trim().substring(1).trim()
                                      : line.trim();
                                    if (!content) return null;
                                    return (
                                      <div
                                        key={index}
                                        className={`${
                                          hasBullet ? "flex" : ""
                                        } ${index > 0 ? "mt-1" : ""}`}
                                      >
                                        {hasBullet && (
                                          <span className="mr-2 flex-shrink-0">
                                            •
                                          </span>
                                        )}
                                        <span
                                          className={hasBullet ? "flex-1" : ""}
                                        >
                                          {content}
                                        </span>
                                      </div>
                                    );
                                  })
                                  .filter(Boolean)}
                              </div>
                              <button
                                onClick={() => {
                                  clearUpdateFlags();
                                  window.location.reload();
                                }}
                                className={`w-full mt-3 py-2 rounded-lg font-medium text-sm text-white ${
                                  updatePriority === "high"
                                    ? "bg-red-500 hover:bg-red-600"
                                    : "bg-blue-500 hover:bg-blue-600"
                                } transition-colors`}
                              >
                                Install Update
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  </div>
                )}

                <ActionBtn
                  onClick={() => {
                    setSpin(true);
                    setTimeout(() => window.location.reload(), 100);
                  }}
                  className="flex items-center justify-center gap-2"
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Refresh Page
                </ActionBtn>

                <Divider />

                <ToggleSwitch
                  enabled={autoUpdate}
                  onChange={handleToggleAutoUpdate}
                  label="Auto-Update"
                  description="Automatically install updates when available"
                />

                <ToggleSwitch
                  enabled={facultySystemManager}
                  onChange={handleToggleFacultySystemManager}
                  label="Faculty: System Manager"
                  description="Show System Management under Manage Cases"
                />
              </div>
            </Card>

            {/* Version info */}
            <div className="text-center text-xs text-gray-400 pt-1 pb-2">
              Settings are saved automatically
            </div>
          </motion.div>
        </LayoutGroup>
      </motion.div>
    </AnimatePresence>
  );
}
