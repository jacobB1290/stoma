// ─────────────────────────────────────────────────────────────────────────────
// AnomaliesPanel — Flags cases or trends that need manager attention.
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo, useState } from "react";
import clsx from "clsx";
import {
  STAGES,
  stageOfCaseRollup, isOverdueRow, dueDayKey, todayKey,
  buildCompletionBuckets,
} from "./constants";

const SEVERITY = {
  high: { dot: "bg-red-500", text: "text-red-700", chip: "bg-red-50 border-red-200 text-red-700" },
  medium: { dot: "bg-amber-500", text: "text-amber-700", chip: "bg-amber-50 border-amber-200 text-amber-700" },
  low: { dot: "bg-blue-500", text: "text-blue-700", chip: "bg-blue-50 border-blue-200 text-blue-700" },
};

const detect = ({ cases, history, stageStats, stageReports }) => {
  const flags = [];
  const open = (cases || []).filter((c) => !c.completed);
  const tk = todayKey();

  // 1. Last-action lookup: most recent history entry per case-number
  const lastActionByCase = new Map();
  (history || []).forEach((h) => {
    const cn = h.cases?.casenumber || h.casenumber;
    if (!cn || !h.created_at) return;
    const t = new Date(h.created_at).getTime();
    const prev = lastActionByCase.get(cn);
    if (!prev || t > prev.t) lastActionByCase.set(cn, { t, action: h.action });
  });

  // 2. Stuck cases — open + no movement > 2x stage median time
  const stuck = [];
  open.forEach((c) => {
    const stage = stageOfCaseRollup(c);
    const median = stageStats?.[stage]?.medianTime;
    if (!median) return;
    const last = lastActionByCase.get(c.caseNumber);
    const since = last ? Date.now() - last.t : Date.now() - new Date(c.created_at || Date.now()).getTime();
    if (since > median * 2) {
      stuck.push({ caseNumber: c.caseNumber, stage, since, factor: since / median });
    }
  });
  stuck.sort((a, b) => b.factor - a.factor);
  if (stuck.length > 0) {
    const top = stuck.slice(0, 5);
    flags.push({
      key: "stuck",
      severity: stuck.some((s) => s.factor > 4) ? "high" : "medium",
      title: `${stuck.length} case${stuck.length === 1 ? "" : "s"} stalled`,
      detail: `No movement in over 2× stage median time`,
      items: top.map((s) => `#${s.caseNumber} · ${s.stage} · ${s.factor.toFixed(1)}×`),
    });
  }

  // 3. Overdue with hold — likely forgotten
  const overdueOnHold = open.filter((c) => isOverdueRow(c) && c.hold);
  if (overdueOnHold.length > 0) {
    flags.push({
      key: "overdue-hold",
      severity: "high",
      title: `${overdueOnHold.length} overdue on hold`,
      detail: "Cases past due date that are also on hold",
      items: overdueOnHold.slice(0, 5).map((c) => `#${c.caseNumber}`),
    });
  }

  // 4. Long-overdue (>3 days past due)
  const longOverdue = open.filter((c) => {
    const k = dueDayKey(c);
    if (!k || k >= tk) return false;
    const dueDate = new Date(c.due);
    const daysLate = Math.floor((Date.now() - dueDate.getTime()) / 86400000);
    return daysLate >= 3;
  });
  if (longOverdue.length > 0) {
    flags.push({
      key: "long-overdue",
      severity: "high",
      title: `${longOverdue.length} severely overdue`,
      detail: "3+ days past due date",
      items: longOverdue.slice(0, 5).map((c) => `#${c.caseNumber}`),
    });
  }

  // 5. Velocity drop — last 7 vs prev 7 days
  const buckets14 = buildCompletionBuckets(history, 14);
  const last7 = buckets14.slice(7).reduce((a, b) => a + b, 0);
  const prev7 = buckets14.slice(0, 7).reduce((a, b) => a + b, 0);
  if (prev7 > 0 && last7 < prev7 * 0.7) {
    const drop = ((prev7 - last7) / prev7) * 100;
    flags.push({
      key: "velocity-drop",
      severity: drop > 50 ? "high" : "medium",
      title: `Throughput down ${drop.toFixed(0)}%`,
      detail: `${last7} done in last 7d vs ${prev7} the week before`,
      items: [],
    });
  }

  // 6. Stage with too many high-risk cases (>30%)
  STAGES.forEach((stage) => {
    const sum = stageReports?.[stage]?.predictions?.summary;
    if (!sum) return;
    const totalRisky = (sum.critical || 0) + (sum.high || 0);
    const totalAtStage = sum.total || 0;
    if (totalAtStage >= 5 && totalRisky / totalAtStage > 0.3) {
      flags.push({
        key: `stage-risk-${stage}`,
        severity: "medium",
        title: `${stage[0].toUpperCase()}${stage.slice(1)}: ${Math.round((totalRisky / totalAtStage) * 100)}% at risk`,
        detail: `${totalRisky} of ${totalAtStage} cases flagged critical/high`,
        items: [],
      });
    }
  });

  // 7. Stage data quality low — degrades reliability of predictions
  STAGES.forEach((stage) => {
    const q = stageStats?.[stage]?.dataQuality?.score;
    if (q != null && q < 50) {
      flags.push({
        key: `dq-${stage}`,
        severity: "low",
        title: `${stage[0].toUpperCase()}${stage.slice(1)}: low data quality`,
        detail: `Only ${q}% — predictions less reliable`,
        items: [],
      });
    }
  });

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
};

export const AnomaliesPanel = memo(function AnomaliesPanel(props) {
  const flags = useMemo(() => detect(props), [props]);
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-800">Needs Attention</h3>
          {flags.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {flags.length}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400">Auto-detected</span>
      </div>

      {flags.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-2">
            <span className="text-green-600 text-lg">✓</span>
          </div>
          <p className="text-sm text-gray-500">No anomalies detected</p>
          <p className="text-[11px] text-gray-400 mt-0.5">All systems healthy</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {flags.map((flag) => {
            const sev = SEVERITY[flag.severity];
            const isOpen = expanded === flag.key;
            const hasItems = flag.items && flag.items.length > 0;
            return (
              <div key={flag.key}
                className={clsx("rounded-lg border transition-all overflow-hidden",
                  sev.chip
                )}>
                <button
                  onClick={() => hasItems && setExpanded(isOpen ? null : flag.key)}
                  disabled={!hasItems}
                  className={clsx("w-full flex items-start gap-2 px-3 py-2 text-left",
                    hasItems && "hover:bg-white/30 cursor-pointer")}>
                  <span className={clsx("w-2 h-2 mt-1.5 rounded-full flex-shrink-0", sev.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className={clsx("text-sm font-semibold truncate", sev.text)}>{flag.title}</div>
                    <div className="text-[11px] text-gray-600 mt-0.5">{flag.detail}</div>
                  </div>
                  {hasItems && (
                    <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{isOpen ? "▾" : "▸"}</span>
                  )}
                </button>
                {isOpen && hasItems && (
                  <div className="px-3 pb-2 pt-0 border-t border-white/40">
                    <ul className="space-y-0.5 mt-1.5">
                      {flag.items.map((it, i) => (
                        <li key={i} className="text-[11px] font-mono text-gray-700">{it}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default AnomaliesPanel;
