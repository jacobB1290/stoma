// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Tab Components
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo, useState } from "react";
import clsx from "clsx";
import {
  STAGES, RISK_COLORS, STAGE_COLORS,
  stageOfCase, getEfficiencyColor, formatDisplayName, fmtTimeAgo, fmtTime,
  buildStageMoveBuckets, normalizeForDedup,
} from "./constants";
import { Sparkline } from "./Sparkline";

// ── StatusDot ──────────────────────────────────────────────────────────────
export const StatusDot = memo(function StatusDot({ status, size = "normal" }) {
  const sizeClass = size === "small" ? "h-2 w-2" : "h-2.5 w-2.5";
  if (status === "active") {
    return (
      <span className={`relative flex ${sizeClass}`}>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className={`relative inline-flex rounded-full ${sizeClass} bg-emerald-500`} />
      </span>
    );
  }
  return (
    <div className={clsx(sizeClass, "rounded-full flex-shrink-0", status === "idle" ? "bg-amber-400" : "bg-gray-400")} />
  );
});

// ── PipelineOverview ───────────────────────────────────────────────────────
export const PipelineOverview = memo(function PipelineOverview({ stageCounts, stageReports, stageStats, history, qcCount = 0 }) {
  const stageData = useMemo(() => {
    const scores = STAGES.map(s => stageReports[s]?.score ?? 0);
    const minScore = Math.min(...scores);
    return STAGES.map((stage) => {
      const report = stageReports[stage] || {};
      const stats = stageStats[stage] || {};
      const score = report.score ?? 0;
      const critical = report.predictions?.summary?.critical ?? 0;
      const high = report.predictions?.summary?.high ?? 0;
      const avgMs = stats.averageTime ?? 0;
      const avgHours = avgMs > 0 ? (avgMs / 3600000).toFixed(1) + "h" : "--";
      const isBottleneck = scores.length > 0 && score === minScore && score < 100;
      const moves7 = buildStageMoveBuckets(history, stage, 7);
      return { stage, count: stageCounts[stage] ?? 0, score, critical, high, avgHours, isBottleneck, sampleSize: stats.sampleSize ?? 0, moves7 };
    });
  }, [stageCounts, stageReports, stageStats, history]);

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">Pipeline Overview</h3>
        <span className="text-[10px] text-gray-400">7-day inflow trend</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {stageData.map((data, idx) => {
          const color = STAGE_COLORS[data.stage];
          const effColor = getEfficiencyColor(data.score);
          const circumference = 2 * Math.PI * 28;
          const dashOffset = circumference - (data.score / 100) * circumference;
          const riskCount = data.critical + data.high;
          const showQc = data.stage === "finishing" && qcCount > 0;

          return (
            <div key={data.stage} className="relative">
              <div className="rounded-xl p-4 bg-gray-50 border border-gray-100 transition-all hover:bg-white hover:shadow-sm"
                style={{ borderLeftWidth: 4, borderLeftColor: color }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-semibold text-gray-700 capitalize">{data.stage}</h4>
                    {showQc && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200"
                        title="Cases currently in QC review">
                        +{qcCount} QC
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {data.isBottleneck && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">Bottleneck</span>
                    )}
                    {riskCount > 0 && (
                      <span className={clsx("text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
                        data.critical > 0 ? "bg-red-50 text-red-600 border-red-200" : "bg-orange-50 text-orange-600 border-orange-200"
                      )}>{riskCount} at risk</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <svg width="60" height="60" className="-rotate-90">
                      <circle cx="30" cy="30" r="28" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                      <circle cx="30" cy="30" r="28" fill="none" stroke={effColor} strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={circumference} strokeDashoffset={dashOffset} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold" style={{ color: effColor }}>{data.score > 0 ? `${Math.round(data.score)}%` : "--"}</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-2xl font-bold text-gray-800 leading-none">{data.count}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{data.count === 1 ? "case" : "cases"}</div>
                    <div className="mt-1 text-[10px] text-gray-500">
                      Avg: <span className="text-gray-700 font-medium">{data.avgHours}</span>
                      {data.sampleSize > 0 && <span className="text-gray-400 ml-1">({data.sampleSize})</span>}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <Sparkline data={data.moves7} color={color} width={48} height={28} />
                  </div>
                </div>
              </div>
              {/* Arrow between cards */}
              {idx < stageData.length - 1 && (
                <>
                  <div className="hidden md:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-gray-300 text-lg">&rarr;</div>
                  <div className="md:hidden flex justify-center py-1 text-gray-300 text-lg">&darr;</div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── AtRiskPanel ────────────────────────────────────────────────────────────
export const AtRiskPanel = memo(function AtRiskPanel({ cases, stageReports, onTogglePriority, onToggleHold, onToggleRush }) {
  const [riskFilter, setRiskFilter] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const riskCases = useMemo(() => {
    const predMap = new Map();
    STAGES.forEach(stage => {
      const preds = stageReports[stage]?.predictions?.predictions || [];
      preds.forEach(p => {
        if (p.riskLevel !== "low" && !predMap.has(p.caseNumber)) predMap.set(p.caseNumber, p);
      });
    });
    const now = new Date();
    cases.filter(c => !c.completed && !c.archived).forEach(c => {
      if (new Date(c.due) < now && !predMap.has(c.caseNumber)) {
        predMap.set(c.caseNumber, { caseNumber: c.caseNumber, riskLevel: "critical", riskScore: 100, dueDate: c.due, stage: stageOfCase(c) });
      }
    });
    return [...predMap.values()].sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2 };
      return (order[a.riskLevel] ?? 3) - (order[b.riskLevel] ?? 3);
    });
  }, [stageReports, cases]);

  const filtered = useMemo(() => {
    if (riskFilter === "all") return riskCases;
    if (riskFilter === "overdue") {
      const now = new Date();
      return riskCases.filter(r => r.dueDate && new Date(r.dueDate) < now);
    }
    return riskCases.filter(r => r.riskLevel === riskFilter);
  }, [riskCases, riskFilter]);

  const displayed = showAll ? filtered : filtered.slice(0, 15);

  const caseMap = useMemo(() => {
    const map = new Map();
    cases.forEach(c => map.set(c.caseNumber, c));
    return map;
  }, [cases]);

  const getDueLabel = (dueDate) => {
    if (!dueDate) return null;
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due - now;
    const diffH = Math.round(Math.abs(diffMs) / 3600000);
    const diffD = Math.round(Math.abs(diffMs) / 86400000);
    if (diffMs < 0) return { text: diffD > 0 ? `Overdue ${diffD}d` : `Overdue ${diffH}h`, isOverdue: true };
    return { text: diffD > 0 ? `Due in ${diffD}d` : `Due in ${diffH}h`, isOverdue: false };
  };

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">At-Risk Cases</h3>
          {riskCases.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">{riskCases.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {[{ key: "all", label: "All" }, { key: "critical", label: "Critical" }, { key: "high", label: "High" }, { key: "overdue", label: "Overdue" }].map(fb => (
            <button key={fb.key} onClick={() => setRiskFilter(fb.key)}
              className={clsx("text-[10px] px-2 py-1 rounded-lg font-medium transition-colors",
                riskFilter === fb.key ? "bg-[#16525F] text-white" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              )}>{fb.label}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2">
            <span className="text-green-600 text-lg">&#10003;</span>
          </div>
          <p className="text-sm text-gray-500">All cases on track</p>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto space-y-1 pr-1">
          {displayed.map(risk => {
            const riskColors = RISK_COLORS[risk.riskLevel] || RISK_COLORS.medium;
            const dueInfo = getDueLabel(risk.dueDate);
            const row = caseMap.get(risk.caseNumber);

            return (
              <div key={risk.caseNumber} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors border border-transparent hover:border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-sm text-gray-800 flex-shrink-0">{risk.caseNumber}</span>
                  <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: riskColors.bg, color: riskColors.text, border: `1px solid ${riskColors.border}` }}>
                    {risk.riskLevel}
                  </span>
                  {risk.stage && <span className="text-[10px] text-gray-400 capitalize flex-shrink-0">{risk.stage}</span>}
                  {dueInfo && (
                    <span className={clsx("text-[10px] flex-shrink-0", dueInfo.isOverdue ? "text-red-500 font-medium" : "text-gray-400")}>{dueInfo.text}</span>
                  )}
                </div>
                {row && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => onTogglePriority(row)} title="Toggle priority"
                      className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors",
                        row.priority ? "bg-amber-100 text-amber-600" : "bg-gray-50 text-gray-300 hover:text-amber-500 hover:bg-amber-50"
                      )}>&#9733;</button>
                    <button onClick={() => onToggleHold(row)} title="Toggle hold"
                      className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-[10px] transition-colors",
                        row.hold ? "bg-blue-100 text-blue-600" : "bg-gray-50 text-gray-300 hover:text-blue-500 hover:bg-blue-50"
                      )}>&#10074;&#10074;</button>
                    <button onClick={() => onToggleRush(row)} title="Toggle rush"
                      className={clsx("w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors",
                        row.rush ? "bg-orange-100 text-orange-600" : "bg-gray-50 text-gray-300 hover:text-orange-500 hover:bg-orange-50"
                      )}>&#9889;</button>
                  </div>
                )}
              </div>
            );
          })}
          {!showAll && filtered.length > 15 && (
            <button onClick={() => setShowAll(true)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors">
              Show all {filtered.length} cases
            </button>
          )}
          {showAll && filtered.length > 15 && (
            <button onClick={() => setShowAll(false)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors">
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// ── TeamActivity ───────────────────────────────────────────────────────────
export const TeamActivity = memo(function TeamActivity({ users, recentHistory }) {
  const grouped = useMemo(() => {
    const buckets = { active: [], idle: [], offline: [] };
    (users || []).forEach(u => {
      const s = u.status || "offline";
      if (buckets[s]) buckets[s].push(u);
      else buckets.offline.push(u);
    });
    return [...buckets.active, ...buckets.idle, ...buckets.offline];
  }, [users]);

  const activeCount = useMemo(() => (users || []).filter(u => u.status === "active").length, [users]);

  const lastActionMap = useMemo(() => {
    // Key by normalized canonical name so we match users whose displayName
    // is canonicalized (e.g. "jane.doe" history → "Jane Doe" displayName).
    const map = new Map();
    (recentHistory || []).forEach(h => {
      const name = h.user_name;
      if (!name) return;
      const k = normalizeForDedup(name);
      if (k && !map.has(k)) map.set(k, h);
    });
    return map;
  }, [recentHistory]);

  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Team</h3>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">{activeCount} active</span>
      </div>
      {grouped.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No users online</p>
      ) : (
        <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
          {grouped.map(user => {
            const status = user.status || "offline";
            const initial = (user.displayName || "?").charAt(0).toUpperCase();
            const lastAction = lastActionMap.get(user.key) || lastActionMap.get(normalizeForDedup(user.displayName));
            const actionText = lastAction?.action;

            return (
              <div key={user.key} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                <StatusDot status={status} size="small" />
                <div className={clsx("w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0",
                  status === "active" ? "bg-gradient-to-br from-emerald-500 to-teal-600"
                    : status === "idle" ? "bg-gradient-to-br from-amber-500 to-orange-600"
                    : "bg-gradient-to-br from-gray-400 to-gray-500"
                )}>{initial}</div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800 truncate block">{user.displayName}</span>
                  {actionText && <span className="text-[10px] text-gray-400 truncate block">{actionText.length > 40 ? actionText.slice(0, 40) + "..." : actionText}</span>}
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTimeAgo(user.last_seen)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// ── ActivityFeed ───────────────────────────────────────────────────────────
export const ActivityFeed = memo(function ActivityFeed({ history }) {
  const entries = useMemo(() => (history || []).slice(0, 20), [history]);

  const getActionDot = (action) => {
    if (!action) return "bg-gray-300";
    const lower = action.toLowerCase();
    if (lower.includes("marked done") || lower.includes("completed")) return "bg-emerald-500";
    if (lower.includes("created")) return "bg-blue-500";
    if (lower.includes("moved") || lower.includes("stage")) return "bg-orange-400";
    return "bg-gray-300";
  };

  const getActionSummary = (action) => {
    if (!action) return "";
    const lower = action.toLowerCase();
    if (lower.includes("marked done")) return "completed";
    if (lower.includes("case created")) return "created";
    if (lower.includes("moved")) {
      // Match destination stage including multi-word names like "Quality Control".
      // Stops before " stage" suffix or " back" qualifier.
      const match = action.match(/moved\s+.*?(?:to|→)\s+([A-Za-z][\w\s]*?)(?:\s+(?:stage|back)\b|$)/i);
      return match ? `moved to ${match[1].trim()}` : "moved";
    }
    return action.length > 30 ? action.slice(0, 30) + "..." : action;
  };

  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Activity Feed</h3>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10px] text-emerald-600 font-medium">Live</span>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">No recent activity</p>
      ) : (
        <div className="max-h-[300px] overflow-y-auto space-y-0.5 pr-1">
          {entries.map((entry, idx) => {
            const caseNum = entry.cases?.casenumber;
            const summary = getActionSummary(entry.action);
            return (
              <div key={`${entry.created_at}-${idx}`} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-50 transition-colors">
                <span className="text-[10px] text-gray-400 w-12 flex-shrink-0 text-right">{entry.created_at ? fmtTime(entry.created_at) : ""}</span>
                <div className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", getActionDot(entry.action))} />
                <span className="text-xs text-gray-600 truncate">
                  <span className="text-gray-800 font-medium">{formatDisplayName(entry.user_name || "System")}</span>
                  {" "}{summary}
                  {caseNum && <span className="font-mono text-gray-400 ml-1">#{caseNum}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
