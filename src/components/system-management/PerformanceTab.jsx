// ─────────────────────────────────────────────────────────────────────────────
// Performance Tab Components
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from "react";
import clsx from "clsx";
import { STAGES, COLORS, STAGE_COLORS, getEfficiencyColor } from "./constants";

// ── StagePerformanceCard ───────────────────────────────────────────────────
export const StagePerformanceCard = memo(function StagePerformanceCard({ stage, report, stats }) {
  const score = report?.score ?? 0;
  const color = getEfficiencyColor(score);
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  const pctBar = useMemo(() => {
    if (!stats) return null;
    const max = stats.p90Time || 1;
    return {
      p25Pct: Math.min(100, ((stats.p25Time || 0) / max) * 100),
      medianPct: Math.min(100, ((stats.medianTime || 0) / max) * 100),
      p75Pct: Math.min(100, ((stats.p75Time || 0) / max) * 100),
    };
  }, [stats]);

  const qualityBadge = useMemo(() => {
    const qScore = stats?.dataQuality?.score ?? 0;
    if (qScore >= 80) return { label: "Good", cls: "bg-green-50 text-green-700 border-green-200" };
    if (qScore >= 50) return { label: "Fair", cls: "bg-amber-50 text-amber-700 border-amber-200" };
    return { label: "Low", cls: "bg-red-50 text-red-700 border-red-200" };
  }, [stats]);

  if (!report) {
    return (
      <div className="glass-panel p-5 rounded-xl" style={{ borderTop: `4px solid ${STAGE_COLORS[stage]}` }}>
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-24 bg-gray-200 rounded" />
          <div className="flex justify-center"><div className="w-20 h-20 rounded-full bg-gray-200" /></div>
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (<div key={i} className="space-y-1"><div className="h-3 w-16 bg-gray-200 rounded" /><div className="h-4 w-10 bg-gray-200 rounded" /></div>))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel p-5 rounded-xl relative" style={{ borderTop: `4px solid ${STAGE_COLORS[stage]}` }}>
      <h4 className="text-lg font-semibold text-gray-800 capitalize mb-4">{stage}</h4>

      {/* Donut */}
      <div className="flex justify-center mb-4">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <circle cx="46" cy="46" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="7" />
          <circle cx="46" cy="46" r={radius} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference - progress}`} strokeDashoffset={circumference * 0.25}
            transform="rotate(-90 46 46)" className="transition-all duration-700" />
          <text x="46" y="43" textAnchor="middle" style={{ fontSize: 20, fontWeight: 700 }} fill={color}>{score.toFixed(0)}</text>
          <text x="46" y="57" textAnchor="middle" style={{ fontSize: 11 }} fill="#9ca3af">%</text>
        </svg>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase text-gray-500 tracking-wide">On-Time Rate</div>
          <div className="text-sm font-bold text-gray-800">{((report.onTimeDelivery?.overall?.actualRate ?? 0) * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500 tracking-wide">Velocity</div>
          <div className="text-sm font-bold text-gray-800">{(report.throughput?.overall || 0).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500 tracking-wide">Avg Time</div>
          <div className="text-sm font-bold text-gray-800">{stats ? ((stats.averageTime || 0) / 3600000).toFixed(1) + "h" : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-500 tracking-wide">Sample Size</div>
          <div className="text-sm font-bold text-gray-800">{stats ? `${stats.sampleSize} cases` : "—"}</div>
        </div>
      </div>

      {/* Percentile Bar */}
      {pctBar && (
        <div className="mb-3">
          <div className="text-[10px] uppercase text-gray-500 tracking-wide mb-1">Time Distribution (P25–P75)</div>
          <div className="relative h-2 bg-gray-200 rounded-full">
            <div className="absolute top-0 h-2 rounded-full opacity-60"
              style={{ left: `${pctBar.p25Pct}%`, width: `${Math.max(0, pctBar.p75Pct - pctBar.p25Pct)}%`, backgroundColor: STAGE_COLORS[stage] }} />
            <div className="absolute top-[-2px] w-1 h-3 rounded-sm bg-gray-500" style={{ left: `${pctBar.p25Pct}%` }}
              title={`P25: ${((stats.p25Time || 0) / 3600000).toFixed(1)}h`} />
            <div className="absolute top-[-3px] w-1.5 h-4 rounded-sm" style={{ left: `${pctBar.medianPct}%`, backgroundColor: STAGE_COLORS[stage] }}
              title={`Median: ${((stats.medianTime || 0) / 3600000).toFixed(1)}h`} />
            <div className="absolute top-[-2px] w-1 h-3 rounded-sm bg-gray-500" style={{ left: `${pctBar.p75Pct}%` }}
              title={`P75: ${((stats.p75Time || 0) / 3600000).toFixed(1)}h`} />
          </div>
        </div>
      )}

      {/* Data Quality Badge */}
      {stats?.dataQuality && (
        <div className="flex justify-end">
          <span className={clsx("text-[10px] font-medium px-2 py-0.5 rounded-full border", qualityBadge.cls)}>{qualityBadge.label} data</span>
        </div>
      )}
    </div>
  );
});

// ── BottleneckAnalysis ─────────────────────────────────────────────────────
export const BottleneckAnalysis = memo(function BottleneckAnalysis({ stageReports, stageStats }) {
  const analysis = useMemo(() => {
    const entries = STAGES.map(stage => ({
      stage,
      score: stageReports?.[stage]?.score ?? 0,
      avgTime: stageStats?.[stage]?.averageTime ? ((stageStats[stage].averageTime || 0) / 3600000).toFixed(1) : "?",
    }));
    const sorted = [...entries].sort((a, b) => a.score - b.score);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    let severity = worst.score < 60 ? "danger" : worst.score < 80 ? "warning" : "good";

    const insights = [];
    sorted.forEach(e => {
      if (e.score < 60) insights.push({ type: "warning", message: `${e.stage.charAt(0).toUpperCase() + e.stage.slice(1)} needs attention at ${e.score.toFixed(0)}% efficiency` });
    });
    if (best.score - worst.score > 20) insights.push({ type: "info", message: `Gap between ${best.stage} (${best.score.toFixed(0)}%) and ${worst.stage} (${worst.score.toFixed(0)}%)` });
    if (worst.score >= 80) insights.push({ type: "success", message: "All stages performing well — no bottlenecks detected" });

    return { sorted, worst, severity, insights };
  }, [stageReports, stageStats]);

  return (
    <div className="glass-panel p-6 rounded-xl">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Bottleneck Analysis</h3>

      <div className={clsx("p-4 rounded-lg border mb-5",
        analysis.severity === "danger" && "bg-red-50 border-red-200",
        analysis.severity === "warning" && "bg-amber-50 border-amber-200",
        analysis.severity === "good" && "bg-green-50 border-green-200"
      )}>
        <p className={clsx("text-sm font-medium",
          analysis.severity === "danger" && "text-red-800",
          analysis.severity === "warning" && "text-amber-800",
          analysis.severity === "good" && "text-green-800"
        )}>
          {analysis.severity !== "good" ? (
            <><span className="font-bold capitalize">{analysis.worst.stage}</span> is the bottleneck at <span className="font-bold">{analysis.worst.score.toFixed(0)}%</span> efficiency — avg {analysis.worst.avgTime}h per case</>
          ) : "All stages performing well — no significant bottlenecks"}
        </p>
      </div>

      <div className="space-y-3 mb-5">
        {analysis.sorted.map(({ stage, score }) => (
          <div key={stage} className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-600 capitalize w-20 shrink-0">{stage}</span>
            <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(score, 2)}%`, backgroundColor: getEfficiencyColor(score) }} />
            </div>
            <span className="text-xs font-bold w-10 text-right" style={{ color: getEfficiencyColor(score) }}>{score.toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {analysis.insights.length > 0 && (
        <div className="space-y-2">
          {analysis.insights.map((insight, i) => (
            <div key={i} className={clsx("p-3 rounded-lg border flex items-start gap-2 text-sm",
              insight.type === "warning" && "bg-amber-50 border-amber-200 text-amber-800",
              insight.type === "info" && "bg-blue-50 border-blue-200 text-blue-800",
              insight.type === "success" && "bg-green-50 border-green-200 text-green-800"
            )}>
              <span className="flex-shrink-0">{insight.type === "warning" ? "⚠" : insight.type === "info" ? "ℹ" : "✓"}</span>
              <p>{insight.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ── ThroughputSummary ──────────────────────────────────────────────────────
export const ThroughputSummary = memo(function ThroughputSummary({ cases, history }) {
  const metrics = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const completedToday = (history || []).filter(h => {
      if (!h.action?.toLowerCase().includes("marked done")) return false;
      return h.created_at && new Date(h.created_at).toISOString().slice(0, 10) === todayStr;
    }).length;

    const completedThisWeek = (history || []).filter(h => {
      if (!h.action?.toLowerCase().includes("marked done")) return false;
      return h.created_at && new Date(h.created_at) >= weekAgo;
    }).length;

    const activeCases = (cases || []).filter(c => !c.completed && !c.archived);
    const totalActive = activeCases.length;
    const rushCount = activeCases.filter(c => c.rush).length;
    const holdCount = activeCases.filter(c => c.hold).length;
    const newAccountCount = activeCases.filter(c => c.newAccount).length;

    const actionCounts = { created: 0, completed: 0, moved: 0, archived: 0 };
    (history || []).forEach(h => {
      const a = (h.action || "").toLowerCase();
      if (a.includes("created")) actionCounts.created++;
      else if (a.includes("marked done")) actionCounts.completed++;
      else if (a.includes("moved")) actionCounts.moved++;
      else if (a.includes("archived")) actionCounts.archived++;
    });

    return { completedToday, completedThisWeek, avgPerDay: completedThisWeek / 7, rushCount, holdCount, newAccountCount, totalActive, actionCounts };
  }, [cases, history]);

  const actionTotal = Object.values(metrics.actionCounts).reduce((a, b) => a + b, 0) || 1;
  const segments = [
    { key: "created", label: "Created", count: metrics.actionCounts.created, color: COLORS.indigo },
    { key: "completed", label: "Completed", count: metrics.actionCounts.completed, color: COLORS.success },
    { key: "moved", label: "Moved", count: metrics.actionCounts.moved, color: COLORS.info },
    { key: "archived", label: "Archived", count: metrics.actionCounts.archived, color: "#9ca3af" },
  ];

  const statCards = [
    { value: metrics.completedToday, label: "Completed Today" },
    { value: metrics.completedThisWeek, label: "Completed This Week" },
    { value: metrics.avgPerDay.toFixed(1), label: "Avg / Day", sub: "last 7 days" },
    { value: metrics.rushCount, label: "Rush Cases", sub: metrics.totalActive ? `${((metrics.rushCount / metrics.totalActive) * 100).toFixed(0)}% of active` : null },
    { value: metrics.holdCount, label: "On Hold", sub: metrics.totalActive ? `${((metrics.holdCount / metrics.totalActive) * 100).toFixed(0)}% of active` : null },
    { value: metrics.newAccountCount, label: "New Accounts" },
  ];

  return (
    <div className="glass-panel p-6 rounded-xl">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Throughput & Workload</h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {statCards.map((card, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-800">{card.value}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">{card.label}</div>
            {card.sub && <div className="text-[10px] text-gray-400 mt-0.5">{card.sub}</div>}
          </div>
        ))}
      </div>

      <div className="text-xs font-medium text-gray-600 mb-2">Action Breakdown (Last 7 Days)</div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-2">
        {segments.map(seg => seg.count > 0 && (
          <div key={seg.key} className="h-full" style={{ width: `${(seg.count / actionTotal) * 100}%`, backgroundColor: seg.color }} title={`${seg.label}: ${seg.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map(seg => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="text-[10px] text-gray-600">{seg.label} <span className="font-semibold text-gray-800">{seg.count}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
});
