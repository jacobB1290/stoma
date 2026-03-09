/**
 * FrontOfficePill
 *
 * Header pill (right side, Manage Cases view) showing the % of cases
 * entered by non-front-office staff over the last 90 days.
 *
 * Context: The front office is responsible for entering 100% of cases.
 * When this number is above 0% it means a production/staff member noticed
 * a case wasn't logged yet and stepped in — that's a gap worth tracking.
 *
 * Color thresholds (muted — blends with the system):
 *   ≤5%   → ghost/neutral (normal variance, no action needed)
 *   5–10% → soft amber
 *   >10%  → soft red
 *
 * Pill styling exactly matches SettingsPill and WeekNavigation pill:
 *   px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20
 *   backdrop-blur border border-white/20 shadow-sm
 *
 * DB sync: the frontOfficeStaff list is persisted in the `active_devices`
 * table under user_name "__fo_config__". On startup we fetch that row to
 * hydrate localStorage, so new sessions always get the current list even if
 * they weren't online when an admin changed it.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";
import { db } from "../services/caseService";
import {
  getFrontOfficeList,
  isFrontOfficeStaff,
} from "../utils/frontOfficeStaff";
import { getCanonicalName } from "../utils/nameNormalization";

// ─────────────────────────────────────────────────────────────────────────────
// Storage key for the "disabled" preference
// ─────────────────────────────────────────────────────────────────────────────
export const FO_PILL_DISABLED_KEY = "frontOfficePillDisabled";

export function isFrontOfficePillDisabled() {
  try {
    return JSON.parse(localStorage.getItem(FO_PILL_DISABLED_KEY) ?? "false");
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme helpers — mirrors getHeaderPillStyle / getHeaderPillTextColor in App.jsx
// ─────────────────────────────────────────────────────────────────────────────
function getThemeKey() {
  const cl = document.documentElement.classList;
  if (cl.contains("theme-white")) return "white";
  if (cl.contains("theme-pink"))  return "pink";
  if (cl.contains("theme-dark"))  return "dark";
  return "blue";
}

function getHeaderPillStyle(theme) {
  if (theme === "white") return {
    background: "rgba(22,82,95,0.08)",
    border: "1px solid rgba(22,82,95,0.22)",
  };
  if (theme === "pink") return {
    background: "rgba(157,75,108,0.09)",
    border: "1px solid rgba(157,75,108,0.24)",
  };
  return {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.20)",
  };
}

function getHeaderPillTextColor(theme) {
  if (theme === "white") return "#16525f";
  if (theme === "pink")  return "#9d4b6c";
  return "rgba(255,255,255,0.90)";
}

const PILL_H = "36px"; // matches App.jsx locked height

// ─────────────────────────────────────────────────────────────────────────────
// Hook: compute the stat from case_history
// ─────────────────────────────────────────────────────────────────────────────
export function useFrontOfficeStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const compute = useCallback(async () => {
    const foList = getFrontOfficeList();
    if (foList.length === 0) {
      if (mountedRef.current) { setStats(null); setLoading(false); }
      return;
    }

    if (mountedRef.current) setLoading(true);
    try {
      const since = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await db
        .from("case_history")
        .select("user_name, case_id, action, created_at")
        .gte("created_at", since)
        .or("action.ilike.%case created%,action.ilike.%created%");

      if (error || !data) {
        if (mountedRef.current) setLoading(false);
        return;
      }

      // One row per case — keep the earliest creation entry
      const perCase = {};
      for (const row of data) {
        const cid = row.case_id;
        if (!cid) continue;
        const action = (row.action || "").toLowerCase();
        if (!action.includes("created")) continue;
        if (
          !perCase[cid] ||
          new Date(row.created_at) < new Date(perCase[cid].created_at)
        ) {
          perCase[cid] = row;
        }
      }

      const entries = Object.values(perCase);
      const total = entries.length;
      if (total === 0) {
        if (mountedRef.current) { setStats(null); setLoading(false); }
        return;
      }

      let staffCount = 0;
      for (const entry of entries) {
        const canonical = getCanonicalName(entry.user_name || "");
        if (!isFrontOfficeStaff(canonical)) staffCount++;
      }

      const pct = Math.round((staffCount / total) * 100);
      if (mountedRef.current) {
        setStats({ pct, staffCount, totalCount: total });
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    compute();
    // Re-run whenever the front office list changes (local or synced from DB)
    const onStorage = (e) => {
      if (e.key === "frontOfficeStaff") compute();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("fo-list-updated", compute);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fo-list-updated", compute);
    };
  }, [compute]);

  return { stats, loading };
}

// ─────────────────────────────────────────────────────────────────────────────
// Color helper — deliberately muted, matching system tones
// ─────────────────────────────────────────────────────────────────────────────
function getPillAccent(pct) {
  if (pct > 10) return { dot: "rgba(239,68,68,0.75)" };   // muted red
  if (pct > 5)  return { dot: "rgba(245,158,11,0.80)" };  // muted amber
  return           { dot: "rgba(255,255,255,0.30)" };      // ghost dot
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip — portaled so it escapes header overflow, theme-aware
// ─────────────────────────────────────────────────────────────────────────────
function PillTooltip({ stats, anchorRef }) {
  const { pct, staffCount, totalCount } = stats;
  const foCount = totalCount - staffCount;
  const [pos, setPos] = useState({ top: 0, right: 16 });
  const [theme, setTheme] = useState(getThemeKey);

  // Track theme changes while tooltip is open
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getThemeKey()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 10,
      right: window.innerWidth - rect.right,
    });
  }, [anchorRef]);

  const light = theme === "white" || theme === "pink";

  // Tooltip surface — theme-aware
  const surfaceBg = theme === "pink"  ? "#fdf8fa" :
                    theme === "white" ? "#ffffff"  :
                    "#1a2e33";
  const surfaceBorder = light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.10)";
  const textPrimary = light ? "#111827" : "#f1f5f9";
  const textMuted = light ? "#6b7280" : "#94a3b8";
  const trackBg = light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";
  const dividerColor = light ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";

  // Header band gradient — matches the theme accent
  const headerGradient =
    theme === "pink"  ? "linear-gradient(135deg, #6b2440 0%, #9d4b6c 100%)" :
    theme === "white" ? "linear-gradient(135deg, #103E48 0%, #16525F 100%)" :
    theme === "dark"  ? "linear-gradient(135deg, #0d2e35 0%, #1cc7b6 100%)" :
                        "linear-gradient(135deg, #103E48 0%, #16525F 100%)"; // blue default

  const barColor =
    pct > 10 ? "rgba(239,68,68,0.70)" :
    pct > 5  ? "rgba(245,158,11,0.70)" :
               "rgba(34,197,94,0.65)";

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="fixed z-[9999] w-[17rem] rounded-2xl overflow-hidden"
      style={{
        top: pos.top,
        right: pos.right,
        boxShadow: light
          ? "0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)"
          : "0 12px 40px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.25)",
        pointerEvents: "none",
        background: surfaceBg,
        border: `1px solid ${surfaceBorder}`,
      }}
    >
      {/* Header band — theme-matched gradient */}
      <div
        className="px-4 pt-4 pb-3"
        style={{ background: headerGradient }}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-widest mb-1.5"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          Case Entry Tracking
        </p>
        <div className="flex items-baseline gap-2">
          <span
            className="text-3xl font-bold leading-none"
            style={{ color: "#ffffff" }}
          >
            {pct}%
          </span>
          <span
            className="text-[13px] leading-snug"
            style={{ color: "rgba(255,255,255,0.75)" }}
          >
            added by<br />non-front-office
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3.5 space-y-3">
        {/* Bar */}
        <div>
          <div className="flex justify-between text-[11px] mb-1.5" style={{ color: textMuted }}>
            <span>Front Office — {foCount} cases</span>
            <span>Staff — {staffCount}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: trackBg }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: barColor, transition: "width 0.4s ease" }}
            />
          </div>
        </div>

        {/* Explanation */}
        <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>
          Front office is responsible for entering{" "}
          <strong style={{ color: textPrimary }}>all cases</strong>. When staff
          add cases, it means they noticed one wasn't logged — a sign that a
          front office intake was missed.
        </p>

        {pct === 0 ? (
          <p className="text-[11px] font-medium" style={{ color: "rgba(34,197,94,0.85)" }}>
            ✓ All cases in the last 90 days were entered by front office.
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed" style={{ color: textMuted }}>
            {staffCount} of {totalCount} cases over the past 90 days were
            entered by staff rather than front office.
          </p>
        )}

        <div style={{ borderTop: `1px solid ${dividerColor}`, paddingTop: "0.625rem" }}>
          <p className="text-[11px]" style={{ color: textMuted }}>
            Last 90 days · {totalCount} total cases
          </p>
        </div>
      </div>
    </motion.div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function FrontOfficePill() {
  const { stats, loading } = useFrontOfficeStats();
  const [hovered, setHovered] = useState(false);
  const [disabled, setDisabled] = useState(() => isFrontOfficePillDisabled());
  const [theme, setTheme] = useState(getThemeKey);
  const pillRef = useRef(null);
  const hoverTimerRef = useRef(null);

  // React to theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getThemeKey()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // React to settings-applied (DB sync) and local toggle events
  useEffect(() => {
    const onDisabledChange = () => setDisabled(isFrontOfficePillDisabled());
    window.addEventListener("storage", onDisabledChange);
    window.addEventListener("fo-pill-toggle", onDisabledChange);
    window.addEventListener("settings-applied", onDisabledChange);
    return () => {
      window.removeEventListener("storage", onDisabledChange);
      window.removeEventListener("fo-pill-toggle", onDisabledChange);
      window.removeEventListener("settings-applied", onDisabledChange);
    };
  }, []);

  const foList = getFrontOfficeList();
  if (foList.length === 0) return null;
  if (disabled) return null;
  if (loading) return null;
  if (!stats) return null;

  const { pct } = stats;
  const accent   = getPillAccent(pct);
  const pillSt   = getHeaderPillStyle(theme);
  const textColor = getHeaderPillTextColor(theme);

  // Icon color: use accent dot color when it's visible; otherwise use text color
  const iconColor = accent.dot !== "rgba(255,255,255,0.30)" ? accent.dot : textColor;

  const handleMouseEnter = () => {
    clearTimeout(hoverTimerRef.current);
    setHovered(true);
  };
  const handleMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => setHovered(false), 120);
  };

  return (
    <div
      ref={pillRef}
      className="relative flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 26, delay: 0.15 }}
        className="flex items-center gap-2 px-3 rounded-full backdrop-blur shadow-sm cursor-default select-none"
        style={{ ...pillSt, height: PILL_H }}
      >
        {/* Bar-chart icon — same 18px as ⚙️ in SettingsPill */}
        <svg
          className="flex-shrink-0"
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="currentColor"
          style={{ color: iconColor, opacity: 0.85 }}
        >
          <rect x="1" y="9" width="3" height="6" rx="0.75" />
          <rect x="6" y="5" width="3" height="10" rx="0.75" />
          <rect x="11" y="2" width="3" height="13" rx="0.75" />
        </svg>
        {/* Label */}
        <span
          className="text-xs font-medium"
          style={{ color: textColor }}
        >
          {pct}% staff-entered
        </span>
      </motion.div>

      <AnimatePresence>
        {hovered && <PillTooltip stats={stats} anchorRef={pillRef} />}
      </AnimatePresence>
    </div>
  );
}
