/**
 * FrontOfficePill
 *
 * Header pill (right side, Manage Cases view) showing the % of cases
 * entered by non-front-office staff for the current month (resets monthly).
 * Also shows a year-to-date percentage for reference.
 *
 * Context: The front office is responsible for entering 100% of cases.
 * When this number is above 0% it means a production/staff member noticed
 * a case wasn't logged yet and stepped in — that's a gap worth tracking.
 *
 * Color thresholds (muted — blends with the system):
 *   <5%   → ghost/neutral (normal variance, no action needed)
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
import CaseHistory from "./CaseHistory";

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
      // Current month start
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      // Current year start
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

      const { data, error } = await db
        .from("case_history")
        .select("user_name, case_id, action, created_at, cases(department, casenumber)")
        .gte("created_at", yearStart)
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

      // Split into monthly and yearly buckets
      const monthEntries = entries.filter(e => e.created_at >= monthStart);
      const yearEntries = entries;

      const tally = (list) => {
        let staff = 0;
        const byDept = {};    // { dept: { staff, total } }
        const missedCases = []; // cases not entered by front office
        for (const entry of list) {
          const canonical = getCanonicalName(entry.user_name || "");
          const isStaff = !isFrontOfficeStaff(canonical);
          if (isStaff) {
            staff++;
            missedCases.push({
              id: entry.case_id,
              caseNumber: entry.cases?.casenumber || entry.case_id,
              dept: entry.cases?.department || "Unknown",
              enteredBy: entry.user_name || "Unknown",
              createdAt: entry.created_at,
              isCompleted: false,
            });
          }
          const dept = entry.cases?.department || "Unknown";
          if (!byDept[dept]) byDept[dept] = { staff: 0, total: 0 };
          byDept[dept].total++;
          if (isStaff) byDept[dept].staff++;
        }
        const total = list.length;
        const rawPct = total > 0 ? (staff / total) * 100 : 0;
        // Department breakdown — worst first (only depts with misses)
        const deptBreakdown = Object.entries(byDept)
          .filter(([, v]) => v.staff > 0)
          .map(([dept, v]) => ({
            dept,
            staff: v.staff,
            total: v.total,
            pct: Math.round((v.staff / v.total) * 1000) / 10,
          }))
          .sort((a, b) => b.staff - a.staff);
        // Full department breakdown (all depts, for yearly baseline)
        const deptAll = Object.entries(byDept)
          .map(([dept, v]) => ({
            dept,
            staff: v.staff,
            total: v.total,
            pct: v.total > 0 ? Math.round((v.staff / v.total) * 1000) / 10 : 0,
          }));
        // Sort missed cases by date descending
        missedCases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return { pct: Math.round(rawPct * 10) / 10, staffCount: staff, totalCount: total, deptBreakdown, deptAll, missedCases };
      };

      // Build daily trend for the month — cumulative miss % over time
      const buildTrend = (entries) => {
        if (entries.length === 0) return [];
        // Group all entries by date string
        const byDate = {};
        for (const entry of entries) {
          const d = entry.created_at.slice(0, 10); // "YYYY-MM-DD"
          if (!byDate[d]) byDate[d] = { total: 0, staff: 0 };
          byDate[d].total++;
          const canonical = getCanonicalName(entry.user_name || "");
          if (!isFrontOfficeStaff(canonical)) byDate[d].staff++;
        }
        // Walk each day of the month so far, accumulating
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        const points = [];
        let cumTotal = 0, cumStaff = 0;
        for (let d = 1; d <= now.getDate(); d++) {
          const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (byDate[key]) {
            cumTotal += byDate[key].total;
            cumStaff += byDate[key].staff;
          }
          const pctVal = cumTotal > 0 ? (cumStaff / cumTotal) * 100 : 0;
          points.push({ day: d, pct: Math.round(pctVal * 10) / 10 });
        }
        return points;
      };

      const monthly = tally(monthEntries);
      const yearly = tally(yearEntries);
      const trend = buildTrend(monthEntries);

      // Enrich missed cases with completion status from the cases table
      const missedIds = monthly.missedCases.map(c => c.id).filter(Boolean);
      if (missedIds.length > 0) {
        const { data: caseRows } = await db
          .from("cases")
          .select("id, completed")
          .in("id", missedIds);
        if (caseRows) {
          const completionMap = {};
          for (const r of caseRows) completionMap[r.id] = !!r.completed;
          for (const mc of monthly.missedCases) {
            mc.isCompleted = completionMap[mc.id] || false;
          }
        }
      }

      if (monthly.totalCount === 0 && yearly.totalCount === 0) {
        if (mountedRef.current) { setStats(null); setLoading(false); }
        return;
      }

      if (mountedRef.current) {
        setStats({
          pct: monthly.pct,
          staffCount: monthly.staffCount,
          totalCount: monthly.totalCount,
          deptBreakdown: monthly.deptBreakdown,
          missedCases: monthly.missedCases,
          trend,
          yearPct: yearly.pct,
          yearStaffCount: yearly.staffCount,
          yearTotalCount: yearly.totalCount,
          monthLabel: now.toLocaleString("default", { month: "long" }),
          year: now.getFullYear(),
        });
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

    // Re-run when a new case_history row is inserted (case created)
    let debounceTimer;
    const ch = db
      .channel("fo-pill-history")
      .on(
        "postgres_changes",
        { schema: "public", table: "case_history", event: "INSERT" },
        () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(compute, 1500);
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fo-list-updated", compute);
      clearTimeout(debounceTimer);
      db.removeChannel(ch);
    };
  }, [compute]);

  return { stats, loading };
}

// ─────────────────────────────────────────────────────────────────────────────
// Color helper — deliberately muted, matching system tones
// ─────────────────────────────────────────────────────────────────────────────
function getPillAccent(pct) {
  if (pct > 10) return { dot: "rgba(220,38,38,0.95)", level: "red" };
  if (pct >= 5) return { dot: "rgba(245,158,11,0.90)", level: "amber" };
  return           { dot: "rgba(255,255,255,0.30)", level: "normal" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip — portaled so it escapes header overflow, theme-aware
// ─────────────────────────────────────────────────────────────────────────────
function PillTooltip({ stats, anchorRef, onMouseEnter, onMouseLeave, onOpenCase }) {
  const { pct, staffCount, totalCount, deptBreakdown, missedCases, trend, yearPct, yearStaffCount, yearTotalCount, monthLabel, year } = stats;
  const [showCompleted, setShowCompleted] = useState(false);

  // Split missed cases into active and completed
  const activeMissed = (missedCases || []).filter(c => !c.isCompleted);
  const completedMissed = (missedCases || []).filter(c => c.isCompleted);

  // Word fade-in counter
  const [wordsVisible, setWordsVisible] = useState(0);
  useEffect(() => { setWordsVisible(0); }, [pct, staffCount]);

  // Trend hover state
  const [trendHover, setTrendHover] = useState(null);
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

  const light = theme !== "dark";

  // Tooltip surface — theme-aware
  const surfaceBg = theme === "pink"  ? "#fdf8fa" :
                    theme === "dark"  ? "#1a2e33"  :
                    "#ffffff";
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
    pct > 10 ? "rgba(220,38,38,0.85)" :
    pct >= 5 ? "rgba(245,158,11,0.70)" :
               "rgba(34,197,94,0.65)";

  // Display name mapping
  const deptDisplayName = (name) => name === "General" ? "Digital" : name;

  // Count business days from start of month to today
  const businessDaysSoFar = (() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    let count = 0;
    for (let d = 1; d <= now.getDate(); d++) {
      const dow = new Date(y, m, d).getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  })();

  // Build summary as array of { text, bold } word tokens
  const buildSummary = () => {
    if (pct === 0) return null;
    // Each segment is either plain text or { bold: "text" }
    const segments = [];
    const push = (...items) => segments.push(...items);
    const B = (v) => ({ bold: String(v) });
    const perDay = staffCount / Math.max(businessDaysSoFar, 1);
    const s = staffCount !== 1;

    // Opening — what happened + pace
    push("So far this month,");
    push(B(staffCount));
    push(s ? "cases were" : "case was");
    push("not entered by front office at intake —");
    if (perDay >= 2) {
      push("about");
      push(B(Math.round(perDay) + " per business day."));
    } else if (perDay >= 1) {
      push(B("more than 1 per business day."));
    } else if (staffCount > 1 && businessDaysSoFar > 1) {
      push("roughly");
      push(B("1 every " + Math.round(businessDaysSoFar / staffCount) + " business days."));
    } else {
      // trim trailing " —" from opening
      segments[segments.length - 1] = segments[segments.length - 1].replace(/ —$/, ".");
    }

    // Department focus
    if (deptBreakdown && deptBreakdown.length > 0) {
      const worst = deptBreakdown[0];
      const wName = deptDisplayName(worst.dept);
      const ratio = Math.round(worst.total / worst.staff);
      if (deptBreakdown.length === 1) {
        push("All");
        push(B(staffCount));
        push("came from");
        push(B(wName));
        if (ratio <= 10) {
          push("— where");
          push(B("1 in every " + ratio));
          push("cases wasn't logged.");
        } else {
          // replace last segment to end with period
          segments[segments.length - 1] = typeof segments[segments.length - 1] === "object"
            ? { bold: segments[segments.length - 1].bold + "." }
            : segments[segments.length - 1] + ".";
        }
      } else {
        push("Most are in");
        push(B(wName));
        push("—");
        if (ratio <= 10) {
          push(B("1 in every " + ratio));
          push("cases there wasn't logged.");
        } else {
          push("at");
          push(B(worst.staff));
          push("missed.");
        }
      }
    }

    // Trend direction
    if (trend && trend.length >= 3) {
      const mid = Math.floor(trend.length / 2);
      const firstHalf = trend.slice(0, mid).reduce((a, p) => a + p.pct, 0) / mid;
      const secondHalf = trend.slice(mid).reduce((a, p) => a + p.pct, 0) / (trend.length - mid);
      if (secondHalf > firstHalf + 1.5) {
        push("The trend is going");
        push(B("up"));
        push("— it's getting worse as the month goes on.");
      } else if (secondHalf < firstHalf - 1.5) {
        push("The rate has been");
        push(B("coming down"));
        push("over the month.");
      }
    }

    push("The target is");
    push(B("0%."));

    // Flatten segments into individual words with bold flag
    const words = [];
    for (const seg of segments) {
      const isBold = typeof seg === "object";
      const text = isBold ? seg.bold : seg;
      for (const w of text.split(/\s+/).filter(Boolean)) {
        words.push({ text: w, bold: isBold });
      }
    }
    return words;
  };

  const summaryWords = buildSummary();

  // Tick words visible
  useEffect(() => {
    if (!summaryWords || !summaryWords.length || wordsVisible >= summaryWords.length) return;
    const timer = setTimeout(() => setWordsVisible(v => v + 1), 40);
    return () => clearTimeout(timer);
  }, [summaryWords, wordsVisible]);

  // Header gradient turns red when >10% — this is a serious problem
  const headerGradientFinal =
    pct > 10
      ? "linear-gradient(135deg, #7f1d1d 0%, #dc2626 100%)"
      : headerGradient;

  // Short status line for the header
  const statusMsg =
    pct > 10 ? { text: "Needs attention", color: "rgba(252,165,165,1)" } :
    pct >= 5 ? { text: "Trending up — review intake", color: "rgba(253,224,171,1)" } :
    pct > 0  ? { text: `${staffCount} case${staffCount !== 1 ? "s" : ""} not logged at intake`, color: "rgba(255,255,255,0.55)" } :
    null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="fo-pill-tooltip fixed z-[9999] w-[18.5rem] rounded-2xl overflow-hidden max-h-[85vh]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        top: pos.top,
        right: pos.right,
        boxShadow: light
          ? "0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)"
          : "0 12px 40px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.25)",
        background: surfaceBg,
        border: `1px solid ${surfaceBorder}`,
      }}
    >
      {/* Header band — turns red when >10% */}
      <div
        className="px-4 pt-3.5 pb-3"
        style={{ background: headerGradientFinal }}
      >
        <p
          className="text-[9px] font-semibold uppercase tracking-widest mb-2"
          style={{ color: "rgba(255,255,255,0.50)", letterSpacing: "0.12em" }}
        >
          {monthLabel} — Case Entry
        </p>
        {/* Number + label stacked cleanly */}
        <div className="flex items-end gap-2.5">
          <span
            className="text-[2.2rem] font-bold leading-none tabular-nums"
            style={{ color: "#ffffff" }}
          >
            {pct}%
          </span>
          <div className="mb-0.5 flex flex-col" style={{ color: "rgba(255,255,255,0.70)" }}>
            <span className="text-[11px] font-medium leading-tight">missed by</span>
            <span className="text-[11px] font-medium leading-tight">front office</span>
          </div>
        </div>
        {statusMsg && (
          <p
            className="text-[10px] font-semibold mt-2 leading-snug"
            style={{ color: statusMsg.color }}
          >
            {statusMsg.text}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3.5 space-y-2.5 overflow-y-auto" style={{ maxHeight: "calc(85vh - 5rem)" }}>

        {/* ── Summary — word-by-word fade in ── */}
        <div>
          {pct === 0 ? (
            <p className="text-[12px] leading-relaxed" style={{ color: "rgba(34,197,94,0.85)" }}>
              Every case this month was logged at intake. Keep it up.
            </p>
          ) : summaryWords && summaryWords.length > 0 ? (
            <p className="text-[12px] leading-[1.6]" style={{ color: textMuted }}>
              {summaryWords.map((w, i) => (
                <span
                  key={i}
                  style={{
                    opacity: i < wordsVisible ? 1 : 0,
                    transition: "opacity 0.3s ease",
                    fontWeight: w.bold ? 600 : 400,
                    color: w.bold ? textPrimary : undefined,
                  }}
                >{i > 0 ? " " : ""}{w.text}</span>
              ))}
            </p>
          ) : null}
        </div>

        {/* ── Where — department breakdown ── */}
        {deptBreakdown && deptBreakdown.length > 0 && (
          <div style={{ borderTop: `1px solid ${dividerColor}`, paddingTop: "0.5rem" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
               style={{ color: textMuted, letterSpacing: "0.06em" }}>
              Where
            </p>
            <div className="space-y-2">
              {deptBreakdown.map(d => {
                const deptBarColor =
                  d.pct > 10 ? "rgba(220,38,38,0.70)" :
                  d.pct > 5  ? "rgba(245,158,11,0.65)" :
                               "rgba(245,158,11,0.45)";
                return (
                  <div key={d.dept}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span style={{ color: textPrimary, fontWeight: 500 }}>{deptDisplayName(d.dept)}</span>
                      <span style={{ color: d.pct > 10 ? "rgba(220,38,38,0.80)" : textMuted }}>
                        {d.staff} of {d.total} ({d.pct}%)
                      </span>
                    </div>
                    {/* Mini bar */}
                    <div className="h-1 rounded-full overflow-hidden mt-0.5" style={{ background: trackBg }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(d.pct / 20 * 100, 100)}%`,
                          background: deptBarColor,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Missed cases — active by default, show all to reveal completed ── */}
        {missedCases && missedCases.length > 0 && (
          <div style={{ borderTop: `1px solid ${dividerColor}`, paddingTop: "0.5rem" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide"
               style={{ color: textMuted, letterSpacing: "0.06em" }}>
              Missed Cases ({activeMissed.length} active{completedMissed.length > 0 ? ` · ${completedMissed.length} completed` : ""})
            </p>

            {/* ── Active cases — always visible ── */}
            {activeMissed.length > 0 ? (
              <div className="mt-1.5 space-y-1 max-h-[140px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                {activeMissed.map((c) => {
                  const displayDept = c.dept === "General" ? "Digital" : c.dept;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onOpenCase(c)}
                      className="w-full flex items-center justify-between rounded-md px-2 py-1 cursor-pointer text-left"
                      style={{
                        background: light ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)",
                        border: "none",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = light ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.10)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = light ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)"}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium" style={{ color: textPrimary }}>{c.caseNumber}</span>
                        <span className="text-[9px] px-1 py-0.5 rounded" style={{
                          color: textMuted,
                          background: light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)",
                        }}>{displayDept}</span>
                      </div>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: textMuted, flexShrink: 0, opacity: 0.5 }}>
                        <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-1.5 text-[10px] italic" style={{ color: textMuted }}>All missed cases are completed</p>
            )}

            {/* ── Show completed toggle ── */}
            {completedMissed.length > 0 && (
              <>
                <button
                  onClick={() => setShowCompleted(v => !v)}
                  className="w-full text-center text-[10px] font-medium cursor-pointer mt-2"
                  style={{ color: textMuted, background: "none", border: "none", padding: "2px 0", opacity: 0.8 }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = "1"}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = "0.8"}
                >
                  {showCompleted ? "Hide completed" : `Show ${completedMissed.length} completed`}
                </button>
                <AnimatePresence>
                  {showCompleted && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      {/* ── Thick divider ── */}
                      <div style={{ margin: "0.4rem 0", borderTop: `3px solid ${dividerColor}` }} />

                      <div className="space-y-1 max-h-[120px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                        {completedMissed.map((c) => {
                          const displayDept = c.dept === "General" ? "Digital" : c.dept;
                          return (
                            <button
                              key={c.id}
                              onClick={() => onOpenCase(c)}
                              className="w-full flex items-center justify-between rounded-md px-2 py-1 cursor-pointer text-left"
                              style={{
                                background: light ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)",
                                border: "none",
                                transition: "background 0.15s",
                                opacity: 0.55,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = light ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.10)"; e.currentTarget.style.opacity = "0.85"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = light ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.05)"; e.currentTarget.style.opacity = "0.55"; }}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium" style={{ color: textPrimary }}>{c.caseNumber}</span>
                                <span className="text-[9px] px-1 py-0.5 rounded" style={{
                                  color: textMuted,
                                  background: light ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.08)",
                                }}>{displayDept}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: "rgba(34,197,94,0.7)", flexShrink: 0 }}>
                                  <path d="M2.5 5.5L4.5 7.5L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: textMuted, flexShrink: 0, opacity: 0.5 }}>
                                  <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        )}

        {/* ── Trend line — cumulative miss % through the month ── */}
        {trend && trend.length >= 2 && staffCount > 0 && (
          <div style={{ borderTop: `1px solid ${dividerColor}`, paddingTop: "0.5rem" }}>
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide"
                 style={{ color: textMuted, letterSpacing: "0.06em" }}>
                Trend
              </p>
              <span className="text-[10px]" style={{ color: textMuted }}>
                {monthLabel} 1–{trend[trend.length - 1].day}
              </span>
            </div>
            {(() => {
              const W = 220, H = 44, PAD = 2, TOP_PAD = 12;
              const maxPct = Math.max(...trend.map(p => p.pct), 1);
              const pts = trend.map((p, i) => {
                const x = PAD + (i / Math.max(trend.length - 1, 1)) * (W - PAD * 2);
                const y = TOP_PAD + (H - TOP_PAD - PAD) - ((p.pct / maxPct) * (H - TOP_PAD - PAD));
                return { x, y, pct: p.pct, day: p.day };
              });
              const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
              const fillPath = `${linePath} L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
              const lineColor = barColor;
              const last = pts[pts.length - 1];
              const hPt = trendHover != null ? pts[trendHover] : null;
              const sliceW = (W - PAD * 2) / Math.max(trend.length - 1, 1);
              return (
                <svg
                  width="100%"
                  viewBox={`0 0 ${W} ${H + 14}`}
                  style={{ display: "block", cursor: "crosshair" }}
                  onMouseLeave={() => setTrendHover(null)}
                >
                  {/* Fill under line */}
                  <path d={fillPath} fill={lineColor} opacity="0.10" />
                  {/* Line */}
                  <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  {/* End dot (dim when hovering elsewhere) */}
                  <circle cx={last.x} cy={last.y} r="2.5" fill={lineColor} opacity={hPt && trendHover !== pts.length - 1 ? 0.3 : 1} />
                  {/* End label (hide when hovering) */}
                  {!hPt && (
                    <text x={last.x} y={last.y - 6} textAnchor="end" fill={lineColor} fontSize="8" fontWeight="600">
                      {last.pct}%
                    </text>
                  )}
                  {/* Hover hit areas — invisible rects for each data point */}
                  {pts.map((p, i) => (
                    <rect
                      key={i}
                      x={p.x - sliceW / 2}
                      y={0}
                      width={sliceW}
                      height={H}
                      fill="transparent"
                      onMouseEnter={() => setTrendHover(i)}
                    />
                  ))}
                  {/* Hover indicator */}
                  {hPt && (
                    <>
                      {/* Vertical guide line */}
                      <line x1={hPt.x} y1={TOP_PAD} x2={hPt.x} y2={H} stroke={textMuted} strokeWidth="0.5" opacity="0.4" strokeDasharray="2,2" />
                      {/* Dot */}
                      <circle cx={hPt.x} cy={hPt.y} r="3" fill={lineColor} stroke={surfaceBg} strokeWidth="1.5" />
                      {/* Label — day + pct */}
                      <text
                        x={hPt.x}
                        y={Math.max(hPt.y - 7, 9)}
                        textAnchor={hPt.x < W / 2 ? "start" : "end"}
                        fill={textPrimary}
                        fontSize="8"
                        fontWeight="600"
                      >
                        Day {hPt.day}: {hPt.pct}%
                      </text>
                    </>
                  )}
                  {/* X-axis labels */}
                  <text x={PAD} y={H + 10} fill={textMuted} fontSize="7" opacity="0.6">1</text>
                  <text x={W - PAD} y={H + 10} textAnchor="end" fill={textMuted} fontSize="7" opacity="0.6">{trend[trend.length - 1].day}</text>
                </svg>
              );
            })()}
          </div>
        )}

        {/* ── Year-to-date ── */}
        <div style={{
          borderTop: `1px solid ${dividerColor}`,
          paddingTop: "0.5rem",
          background: light ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.03)",
          margin: "0 -1rem",
          padding: "0.5rem 1rem 0",
        }}>
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide"
               style={{ color: textMuted, letterSpacing: "0.06em" }}>
              {year} Year-to-date
            </p>
            <span className="text-[13px] font-bold tabular-nums" style={{
              color: yearPct > 10 ? "rgba(220,38,38,0.90)" :
                     yearPct >= 5 ? "rgba(245,158,11,0.85)" :
                                    "rgba(34,197,94,0.80)",
            }}>
              {yearPct}%
            </span>
          </div>
          <p className="text-[11px]" style={{ color: textMuted }}>
            {yearStaffCount} of {yearTotalCount} cases not entered by front office
          </p>
        </div>

        {/* ── Footer ── */}
        <div style={{ paddingTop: "0.375rem" }}>
          <p className="text-[10px]" style={{ color: textMuted, opacity: 0.6 }}>
            {monthLabel} · {totalCount} cases this month
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
  const [pinned, setPinned] = useState(false);
  const [historyCase, setHistoryCase] = useState(null); // { id, caseNumber }

  // Close on click outside when pinned
  useEffect(() => {
    if (!pinned) return;
    const handleOutside = (e) => {
      if (pillRef.current && !pillRef.current.contains(e.target) &&
          !e.target.closest(".fo-pill-tooltip")) {
        setPinned(false);
        setHovered(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [pinned]);

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
  const iconColor = accent.level !== "normal" ? accent.dot : textColor;

  // Amber-level pill overrides — warm tint so it's not ignorable
  const amberPillOverrides = accent.level === "amber" ? {
    background: theme === "white" ? "rgba(245,158,11,0.10)" :
                theme === "pink"  ? "rgba(245,158,11,0.12)" :
                                    "rgba(245,158,11,0.14)",
    border: `1px solid rgba(245,158,11,0.35)`,
    boxShadow: "0 0 8px rgba(245,158,11,0.15)",
  } : {};

  const redPillOverrides = accent.level === "red" ? {
    background: theme === "white" ? "rgba(220,38,38,0.12)" :
                theme === "pink"  ? "rgba(220,38,38,0.15)" :
                                    "rgba(220,38,38,0.18)",
    border: `1px solid rgba(220,38,38,0.50)`,
    boxShadow: "0 0 12px rgba(220,38,38,0.25), 0 0 4px rgba(220,38,38,0.15)",
  } : {};

  const handleMouseEnter = () => {
    clearTimeout(hoverTimerRef.current);
    setHovered(true);
  };
  const handleMouseLeave = () => {
    if (pinned) return;
    hoverTimerRef.current = setTimeout(() => setHovered(false), 120);
  };
  const handleClick = () => {
    setPinned(p => !p);
    setHovered(true);
  };

  return (
    <div
      ref={pillRef}
      className="relative flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={
          accent.level === "red"
            ? { opacity: 1, scale: 1, boxShadow: [
                "0 0 8px rgba(220,38,38,0.15)",
                "0 0 20px rgba(220,38,38,0.40)",
                "0 0 8px rgba(220,38,38,0.15)",
              ] }
            : accent.level === "amber"
            ? { opacity: 1, scale: 1, boxShadow: [
                "0 0 6px rgba(245,158,11,0.10)",
                "0 0 14px rgba(245,158,11,0.25)",
                "0 0 6px rgba(245,158,11,0.10)",
              ] }
            : { opacity: 1, scale: 1 }
        }
        transition={
          accent.level === "red"
            ? { opacity: { duration: 0.3 }, scale: { type: "spring", stiffness: 400, damping: 26, delay: 0.15 },
                boxShadow: { duration: 2, repeat: Infinity, ease: "easeInOut" } }
            : accent.level === "amber"
            ? { opacity: { duration: 0.3 }, scale: { type: "spring", stiffness: 400, damping: 26, delay: 0.15 },
                boxShadow: { duration: 3, repeat: Infinity, ease: "easeInOut" } }
            : { type: "spring", stiffness: 400, damping: 26, delay: 0.15 }
        }
        className="flex items-center gap-2 px-3 rounded-full backdrop-blur shadow-sm cursor-pointer select-none"
        style={{ ...pillSt, ...amberPillOverrides, ...redPillOverrides, height: PILL_H }}
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
          style={{ color: accent.level === "amber" ? accent.dot
                        : accent.level === "red"   ? accent.dot
                        : textColor }}
        >
          {Math.round(pct)}% missed
        </span>
      </motion.div>

      <AnimatePresence>
        {hovered && (
          <PillTooltip
            stats={stats}
            anchorRef={pillRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onOpenCase={(c) => setHistoryCase({ id: c.id, caseNumber: c.caseNumber })}
          />
        )}
      </AnimatePresence>

      {historyCase && (
        <CaseHistory
          id={historyCase.id}
          caseNumber={historyCase.caseNumber}
          onClose={() => setHistoryCase(null)}
        />
      )}
    </div>
  );
}
