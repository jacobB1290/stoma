// ─────────────────────────────────────────────────────────────────────────────
// TodaysSnapshot — Manager hero card. Headline metrics + delta vs. baseline.
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from "react";
import { Sparkline, TrendArrow } from "./Sparkline";
import {
  STAGES, COLORS,
  isDueTodayRow, isOverdueRow,
  buildCompletionBuckets,
  todayKey, dateFormatters,
} from "./constants";

const KPI = memo(function KPI({ label, value, sub, accent, icon, sparkline, delta, deltaSuffix = "", deltaInvert = false }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-white/70 backdrop-blur-sm border border-white/60 p-3 shadow-sm transition-all hover:shadow-md hover:bg-white/85">
      {accent && <div className="absolute top-0 left-0 w-full h-0.5" style={{ backgroundColor: accent }} />}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-[14px] leading-none" aria-hidden>{icon}</span>}
          <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</span>
        </div>
        {delta != null && <TrendArrow delta={delta} suffix={deltaSuffix} invertColor={deltaInvert} />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold text-gray-800 tabular-nums leading-none">{value}</div>
          {sub && <div className="text-[11px] text-gray-500 mt-1 truncate">{sub}</div>}
        </div>
        {sparkline && <div className="flex-shrink-0 opacity-90">{sparkline}</div>}
      </div>
    </div>
  );
});

export const TodaysSnapshot = memo(function TodaysSnapshot({
  cases, history, stageReports, stageStats, stageCounts, userStats, running,
}) {
  const metrics = useMemo(() => {
    const open = (cases || []).filter((c) => !c.completed);
    const tk = todayKey();
    const completedToday = (history || []).filter((h) => {
      if (!h.action?.toLowerCase().includes("marked done")) return false;
      if (!h.created_at) return false;
      return dateFormatters.dayKey.format(new Date(h.created_at)) === tk;
    }).length;

    const buckets7 = buildCompletionBuckets(history, 7);
    const buckets14 = buildCompletionBuckets(history, 14);
    const last7Total = buckets7.reduce((a, b) => a + b, 0);
    const prev7Total = buckets14.slice(0, 7).reduce((a, b) => a + b, 0);
    const dailyAvg = last7Total / 7;
    const completedDelta = prev7Total > 0 ? ((last7Total - prev7Total) / prev7Total) * 100 : null;

    const overdue = open.filter(isOverdueRow).length;
    const dueToday = open.filter(isDueTodayRow).length;
    const onHold = open.filter((c) => c.hold).length;
    const rush = open.filter((c) => c.rush).length;

    const validReports = STAGES.map((s) => stageReports?.[s]).filter((r) => r && !r.noData);
    const avgEff = validReports.length
      ? validReports.reduce((a, r) => a + (r.score || 0), 0) / validReports.length
      : null;

    let critical = 0, high = 0;
    STAGES.forEach((s) => {
      const sum = stageReports?.[s]?.predictions?.summary;
      if (sum) { critical += sum.critical || 0; high += sum.high || 0; }
    });

    const totalActiveHours = STAGES.reduce((acc, stage) => {
      const stats = stageStats?.[stage];
      const count = stageCounts?.[stage] || 0;
      const avgMs = stats?.averageTime || 0;
      return acc + (avgMs / 3600000) * count;
    }, 0);

    const etaDays = dailyAvg > 0 ? Math.ceil(open.length / dailyAvg) : null;

    return {
      open: open.length,
      completedToday,
      buckets7,
      dailyAvg,
      completedDelta,
      overdue,
      dueToday,
      onHold,
      rush,
      avgEff,
      critical,
      high,
      totalActiveHours,
      etaDays,
    };
  }, [cases, history, stageReports, stageStats, stageCounts]);

  const headlineSpark = (
    <Sparkline data={metrics.buckets7} color={COLORS.success} width={70} height={24} />
  );

  const isLoading = running && metrics.avgEff == null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/60 shadow-md"
      style={{ background: "linear-gradient(135deg, rgba(22,82,95,0.08) 0%, rgba(99,102,241,0.06) 100%)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#16525F] to-[#0f3f4a] text-white text-sm font-bold shadow-sm">
            <span aria-hidden>◎</span>
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-800">Today's Snapshot</h2>
            <p className="text-[11px] text-gray-500">Live pipeline at a glance · {metrics.open} open cases · {userStats?.active || 0} active now</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {metrics.critical > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {metrics.critical} critical
            </span>
          )}
          {metrics.high > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
              {metrics.high} high
            </span>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 px-3 pb-3">
        <KPI
          label="Done Today"
          icon="✓"
          accent={COLORS.success}
          value={metrics.completedToday}
          sub={`Avg ${metrics.dailyAvg.toFixed(1)}/day · last 7d`}
          sparkline={headlineSpark}
          delta={metrics.completedDelta}
          deltaSuffix="%"
        />
        <KPI
          label="Pipeline Eff."
          icon="◐"
          accent={COLORS.primary}
          value={isLoading ? "—" : metrics.avgEff != null ? `${metrics.avgEff.toFixed(0)}%` : "—"}
          sub={isLoading ? "Calculating…" : "Avg across stages"}
        />
        <KPI
          label="Backlog ETA"
          icon="⌛"
          accent={COLORS.indigo}
          value={metrics.etaDays != null ? `${metrics.etaDays}d` : "—"}
          sub={metrics.etaDays != null ? `to clear ${metrics.open} cases` : "Need data"}
        />
        <KPI
          label="Due Today"
          icon="◆"
          accent={metrics.dueToday > 0 ? COLORS.warning : COLORS.success}
          value={metrics.dueToday}
          sub={metrics.dueToday > 0 ? "Watch closely" : "On schedule"}
        />
        <KPI
          label="Overdue"
          icon="!"
          accent={metrics.overdue > 0 ? COLORS.danger : COLORS.success}
          value={metrics.overdue}
          sub={metrics.overdue > 0 ? "Past due date" : "All on time"}
        />
        <KPI
          label="Workload"
          icon="∑"
          accent={COLORS.purple}
          value={`${metrics.totalActiveHours.toFixed(0)}h`}
          sub={`${metrics.rush} rush · ${metrics.onHold} on hold`}
        />
      </div>
    </section>
  );
});

export default TodaysSnapshot;
