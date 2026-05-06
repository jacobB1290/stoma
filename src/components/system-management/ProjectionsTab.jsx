// ─────────────────────────────────────────────────────────────────────────────
// Projections Tab — forecasts, ETAs, capacity outlook
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from "react";
import clsx from "clsx";
import { TrendArrow } from "./Sparkline";
import {
  STAGES, COLORS, STAGE_COLORS, RISK_COLORS,
  dueDayKey, todayKey, dateFormatters,
  buildCompletionBuckets,
  stageOfCaseRollup,
  getEfficiencyColor,
} from "./constants";

// ── ThroughputForecast ────────────────────────────────────────────────────
// Shows N-day completion trend + simple linear forecast for next 7 days.
const ThroughputForecast = memo(function ThroughputForecast({ history }) {
  const data = useMemo(() => {
    const buckets = buildCompletionBuckets(history, 14);
    const last7 = buckets.slice(7);
    const prev7 = buckets.slice(0, 7);
    const sumLast7 = last7.reduce((a, b) => a + b, 0);
    const sumPrev7 = prev7.reduce((a, b) => a + b, 0);
    const dailyAvg = sumLast7 / 7;
    const wowDelta = sumPrev7 > 0 ? ((sumLast7 - sumPrev7) / sumPrev7) * 100 : null;

    const slope = (sumLast7 - sumPrev7) / 7;
    const forecast = Array.from({ length: 7 }).map((_, i) => Math.max(0, dailyAvg + slope * (i + 1)));
    const combined = [...buckets, ...forecast];

    const dayLabels = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = -13; i <= 7; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      dayLabels.push(dateFormatters.dayKey.format(d).slice(5));
    }
    return { buckets, last7, prev7, sumLast7, sumPrev7, dailyAvg, wowDelta, forecast, combined, dayLabels };
  }, [history]);

  const max = Math.max(1, ...data.combined);
  const todayIdx = 13;

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Throughput Forecast</h3>
          <p className="text-[11px] text-gray-500">14d history · 7d projected (linear trend)</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-500">Daily Avg</div>
            <div className="text-base font-bold text-gray-800">{data.dailyAvg.toFixed(1)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase text-gray-500">Last 7d</div>
            <div className="text-base font-bold text-gray-800 flex items-center gap-1 justify-end">
              {data.sumLast7}
              <TrendArrow delta={data.wowDelta} suffix="%" />
            </div>
          </div>
        </div>
      </div>

      {/* Combined bar chart: history + forecast */}
      <div className="relative">
        <div className="flex items-end gap-[2px] h-32">
          {data.combined.map((v, i) => {
            const isToday = i === todayIdx;
            const isFuture = i > todayIdx;
            const h = (v / max) * 100;
            const bg = isFuture ? "bg-gray-300" : isToday ? "bg-[#16525F]" : "bg-emerald-500";
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className={clsx("w-full rounded-t transition-all", bg, isFuture && "opacity-60")}
                  style={{ height: `${Math.max(2, h)}%` }}
                  title={`${data.dayLabels[i]}: ${v.toFixed(isFuture ? 1 : 0)}${isFuture ? " projected" : ""}`}
                />
                {(i === 0 || i === todayIdx || i === data.combined.length - 1) && (
                  <span className="absolute -bottom-4 text-[9px] text-gray-500 whitespace-nowrap">
                    {data.dayLabels[i]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute top-0 bottom-0" style={{ left: `${(todayIdx / (data.combined.length - 1)) * 100}%`, width: 1 }}>
          <div className="w-px h-full bg-gray-300 border-dashed border-l border-gray-400" />
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-6 text-[11px] text-gray-600">
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Past completions</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#16525F]" />Today</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 opacity-60" />Projected</div>
      </div>
    </div>
  );
});

// ── BacklogETA ────────────────────────────────────────────────────────────
// Estimates clearance time per stage based on inflow vs throughput.
const BacklogETA = memo(function BacklogETA({ cases, history, stageStats, stageReports }) {
  const eta = useMemo(() => {
    const open = (cases || []).filter((c) => !c.completed);
    const buckets14 = buildCompletionBuckets(history, 14);
    const dailyComp = buckets14.slice(7).reduce((a, b) => a + b, 0) / 7;

    const perStage = STAGES.map((stage) => {
      const count = open.filter((c) => stageOfCaseRollup(c) === stage).length;
      const stats = stageStats?.[stage];
      const avgHours = stats?.averageTime ? stats.averageTime / 3600000 : null;
      const totalHours = avgHours != null ? avgHours * count : null;
      const score = stageReports?.[stage]?.score ?? null;
      return { stage, count, avgHours, totalHours, score };
    });

    const overallEta = dailyComp > 0 ? Math.ceil(open.length / dailyComp) : null;

    return { perStage, overallEta, totalOpen: open.length, dailyComp };
  }, [cases, history, stageStats, stageReports]);

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Backlog Outlook</h3>
          <p className="text-[11px] text-gray-500">At current pace ({eta.dailyComp.toFixed(1)}/day)</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-gray-500">All Stages</div>
          <div className="text-2xl font-bold text-[#16525F] tabular-nums leading-none">
            {eta.overallEta != null ? `${eta.overallEta}d` : "—"}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {eta.perStage.map(({ stage, count, avgHours, totalHours, score }) => {
          const color = STAGE_COLORS[stage];
          return (
            <div key={stage} className="flex items-center gap-3">
              <div className="flex items-center gap-2 w-32 flex-shrink-0">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sm font-medium text-gray-700 capitalize">{stage}</span>
              </div>
              <div className="flex-1 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Open: </span>
                  <span className="font-bold text-gray-800">{count}</span>
                </div>
                <div>
                  <span className="text-gray-500">Time/case: </span>
                  <span className="font-bold text-gray-800">{avgHours ? `${avgHours.toFixed(1)}h` : "—"}</span>
                </div>
                <div>
                  <span className="text-gray-500">Total work: </span>
                  <span className="font-bold text-gray-800">{totalHours ? `${totalHours.toFixed(0)}h` : "—"}</span>
                </div>
              </div>
              {score != null && (
                <span className="text-xs font-bold tabular-nums w-12 text-right" style={{ color: getEfficiencyColor(score) }}>
                  {score.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
        <span className="text-gray-500">{eta.totalOpen} cases in pipeline</span>
        <span className="text-gray-500">Assumes 8h work day</span>
      </div>
    </div>
  );
});

// ── DueDateForecast ───────────────────────────────────────────────────────
// Shows distribution of due dates over the next 14 days.
const DueDateForecast = memo(function DueDateForecast({ cases }) {
  const data = useMemo(() => {
    const open = (cases || []).filter((c) => !c.completed);
    const tk = todayKey();
    const buckets = new Array(14).fill(0).map(() => ({ count: 0, rush: 0, hold: 0 }));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let overdue = 0;
    open.forEach((c) => {
      const k = dueDayKey(c);
      if (!k) return;
      if (k < tk) { overdue++; return; }
      const due = new Date(c.due);
      due.setHours(0, 0, 0, 0);
      const idx = Math.floor((due.getTime() - today.getTime()) / 86400000);
      if (idx >= 0 && idx < 14) {
        buckets[idx].count++;
        if (c.rush) buckets[idx].rush++;
        if (c.hold) buckets[idx].hold++;
      }
    });
    return { buckets, overdue };
  }, [cases]);

  const max = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Due Date Forecast</h3>
          <p className="text-[11px] text-gray-500">Next 14 days · open cases by due date</p>
        </div>
        {data.overdue > 0 && (
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
            {data.overdue} overdue
          </span>
        )}
      </div>

      <div className="flex items-end gap-1 h-28 mb-2">
        {data.buckets.map((bucket, i) => {
          const h = (bucket.count / max) * 100;
          const dayLabel = i === 0 ? "Today" : i === 1 ? "Tmrw" : `+${i}d`;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${dayLabel}: ${bucket.count} cases`}>
              <div className="w-full flex flex-col-reverse rounded-t overflow-hidden" style={{ height: `${Math.max(2, h)}%` }}>
                {bucket.count > 0 && bucket.hold > 0 && (
                  <div className="w-full bg-blue-300" style={{ height: `${(bucket.hold / bucket.count) * 100}%` }} />
                )}
                {bucket.count > 0 && bucket.rush > 0 && (
                  <div className="w-full bg-orange-400" style={{ height: `${(bucket.rush / bucket.count) * 100}%` }} />
                )}
                <div
                  className={clsx("w-full",
                    i === 0 ? "bg-amber-400" : i < 3 ? "bg-amber-300" : "bg-gray-300"
                  )}
                  style={{ height: `${Math.max(0, ((bucket.count - bucket.rush - bucket.hold) / bucket.count) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 text-[9px] text-gray-500">
        {data.buckets.map((_, i) => (
          <div key={i} className="flex-1 text-center">
            {i === 0 ? "Today" : i === 1 ? "Tmrw" : i % 2 === 0 ? `+${i}` : ""}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-600">
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />Standard</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400" />Rush</div>
        <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300" />On Hold</div>
      </div>
    </div>
  );
});

// ── CaseAgeDistribution ───────────────────────────────────────────────────
// Bucketed view of how long cases have been open.
const CaseAgeDistribution = memo(function CaseAgeDistribution({ cases }) {
  const data = useMemo(() => {
    const open = (cases || []).filter((c) => !c.completed);
    const now = Date.now();
    const buckets = [
      { label: "< 1d", min: 0, max: 86400000, count: 0, color: COLORS.success },
      { label: "1–3d", min: 86400000, max: 3 * 86400000, count: 0, color: "#84cc16" },
      { label: "3–7d", min: 3 * 86400000, max: 7 * 86400000, count: 0, color: COLORS.warning },
      { label: "7–14d", min: 7 * 86400000, max: 14 * 86400000, count: 0, color: "#fb923c" },
      { label: "14d+", min: 14 * 86400000, max: Infinity, count: 0, color: COLORS.danger },
    ];
    open.forEach((c) => {
      if (!c.created_at) return;
      const age = now - new Date(c.created_at).getTime();
      for (const b of buckets) {
        if (age >= b.min && age < b.max) { b.count++; break; }
      }
    });
    const total = open.length;
    const oldCount = buckets[3].count + buckets[4].count;
    return { buckets, total, oldCount };
  }, [cases]);

  const max = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Case Age</h3>
          <p className="text-[11px] text-gray-500">How long cases have been open</p>
        </div>
        {data.oldCount > 0 && (
          <span className={clsx("text-xs font-bold px-2 py-1 rounded-full border",
            data.oldCount > data.total * 0.2
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          )}>
            {data.oldCount} aging
          </span>
        )}
      </div>

      <div className="space-y-2">
        {data.buckets.map((b) => {
          const pct = data.total > 0 ? (b.count / data.total) * 100 : 0;
          return (
            <div key={b.label} className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-600 w-12 flex-shrink-0">{b.label}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(2, (b.count / max) * 100)}%`, backgroundColor: b.color }} />
              </div>
              <span className="text-xs font-bold tabular-nums w-16 text-right text-gray-700">
                {b.count} <span className="text-gray-400">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── RiskOutlook ───────────────────────────────────────────────────────────
const RiskOutlook = memo(function RiskOutlook({ stageReports }) {
  const data = useMemo(() => {
    let total = 0, critical = 0, high = 0, medium = 0, low = 0;
    STAGES.forEach((stage) => {
      const sum = stageReports?.[stage]?.predictions?.summary;
      if (!sum) return;
      total += sum.total || 0;
      critical += sum.critical || 0;
      high += sum.high || 0;
      medium += sum.medium || 0;
      low += sum.low || 0;
    });
    return { total, critical, high, medium, low };
  }, [stageReports]);

  const segs = [
    { key: "critical", count: data.critical, color: RISK_COLORS.critical.primary },
    { key: "high", count: data.high, color: RISK_COLORS.high.primary },
    { key: "medium", count: data.medium, color: RISK_COLORS.medium.primary },
    { key: "low", count: data.low, color: RISK_COLORS.low.primary },
  ];
  const total = Math.max(1, segs.reduce((a, s) => a + s.count, 0));

  return (
    <div className="glass-panel rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-800 mb-2">Risk Outlook</h3>
      <p className="text-[11px] text-gray-500 mb-4">Distribution across {data.total} predicted cases</p>

      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 mb-3">
        {segs.map((s) => s.count > 0 && (
          <div key={s.key} className="h-full" style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
            title={`${s.key}: ${s.count}`} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {segs.map((s) => (
          <div key={s.key} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-gray-700 capitalize">{s.key}</span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold text-gray-800">{s.count}</span>
              <span className="text-[10px] text-gray-400 ml-1">({((s.count / total) * 100).toFixed(0)}%)</span>
            </div>
          </div>
        ))}
      </div>

      {data.total === 0 && (
        <div className="mt-3 text-center text-[11px] text-gray-400 italic">No predictions yet — run refresh</div>
      )}
    </div>
  );
});

// ── Main Tab ──────────────────────────────────────────────────────────────
export const ProjectionsTab = memo(function ProjectionsTab({
  cases, history, stageReports, stageStats, running,
}) {
  return (
    <div className="space-y-5">
      <ThroughputForecast history={history} />
      <div className="grid gap-5 lg:grid-cols-2">
        <BacklogETA cases={cases} history={history} stageStats={stageStats} stageReports={stageReports} />
        <DueDateForecast cases={cases} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <CaseAgeDistribution cases={cases} />
        <RiskOutlook stageReports={stageReports} />
      </div>
    </div>
  );
});

export default ProjectionsTab;
