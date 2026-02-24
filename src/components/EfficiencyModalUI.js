// /src/components/EfficiencyModalUI.js
import React, { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";
import { formatDuration as formatDurationUtil } from "../utils/stageTimeCalculations";
import { CONFIG } from "../utils/efficiencyCalculations";
import SystemInsightsPanel from "./SystemInsightsPanel";
import CaseHistory from "./CaseHistory";
import { CaseRiskModal } from "../utils/caseRiskPredictions";

// ---------- utils ----------
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(n) || 0));
const pct = (x) => Math.max(0, Math.min(100, Number(x) || 0));
const cap = (s) =>
  typeof s === "string" ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const mean = (arr) =>
  arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

// ---------- icons ----------
const Icon = {
  Close: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  Expand: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
      />
    </svg>
  ),
  TrendUp: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
      />
    </svg>
  ),
  Clock: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  Activity: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
      />
    </svg>
  ),
  Flag: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5"
      />
    </svg>
  ),
  Warning: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  ),
};

// Overall Score Component
const ScoreDisplay = ({ score }) => {
  const getScoreColor = () => {
    if (score >= 90) return "from-teal-600 to-cyan-700";
    if (score >= 75) return "from-indigo-600 to-blue-700";
    if (score >= 60) return "from-amber-600 to-orange-700";
    return "from-rose-600 to-red-700";
  };
  const getScoreLabel = () => {
    if (score >= 90) return "Excellent Performance";
    if (score >= 75) return "Good Performance";
    if (score >= 60) return "Fair Performance";
    return "Needs Improvement";
  };
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, rgba(120, 119, 198, 0.3) 0%, transparent 50%)`,
          }}
        />
      </div>
      <div className="relative z-10">
        <div className="text-center">
          <p className="text-slate-400 text-sm font-medium mb-2">
            Overall Efficiency Score
          </p>
          <div className="flex items-center justify-center gap-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className={`text-7xl font-bold bg-gradient-to-r ${getScoreColor()} bg-clip-text text-transparent`}
            >
              {score.toFixed(0)}%
            </motion.div>
          </div>
          <p className="text-slate-300 text-lg mt-2">{getScoreLabel()}</p>
        </div>
      </div>
    </div>
  );
};

// Metric Bar Component
const MetricBar = ({ label, value, color, subMetrics, canExpand = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const getBarColor = () => {
    switch (color) {
      case "green":
        return "bg-gradient-to-r from-teal-500 to-cyan-600";
      case "blue":
        return "bg-gradient-to-r from-indigo-500 to-blue-600";
      case "amber":
        return "bg-gradient-to-r from-amber-500 to-orange-600";
      default:
        return "bg-gradient-to-r from-slate-500 to-slate-600";
    }
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div
        className={`p-4 ${canExpand ? "cursor-pointer hover:bg-slate-50" : ""}`}
        onClick={() => canExpand && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">
              {label}
            </span>
            {canExpand && (
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <Icon.Expand />
              </motion.div>
            )}
          </div>
          <span className="text-2xl font-bold text-slate-900">
            {value.toFixed(1)}%
          </span>
        </div>
        <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${value}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={`absolute inset-y-0 left-0 ${getBarColor()} rounded-full`}
          />
        </div>
      </div>
      <AnimatePresence>
        {isExpanded && subMetrics && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-slate-100 overflow-hidden"
          >
            <div className="p-4 bg-slate-50 space-y-3">
              {subMetrics.map((metric, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-xs text-slate-600">{metric.label}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${metric.value}%` }}
                        transition={{ duration: 0.5, delay: index * 0.1 }}
                        className="h-full bg-slate-400 rounded-full"
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-700 w-12 text-right">
                      {metric.value.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Statistics Card Component - Enhanced for risk display
const StatCard = ({
  icon,
  label,
  value,
  subtext,
  trend,
  onClick,
  highlight,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -2 }}
    transition={{ duration: 0.2 }}
    onClick={onClick}
    className={`bg-white rounded-xl border ${
      highlight ? "border-red-300 bg-red-50/50" : "border-slate-200"
    } p-4 hover:shadow-md transition-all ${
      onClick ? "cursor-pointer hover:border-slate-300" : ""
    }`}
  >
    <div className="flex items-start justify-between">
      <div
        className={`flex items-center gap-2 ${
          highlight ? "text-red-700" : "text-slate-600"
        } mb-2`}
      >
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {trend !== undefined && (
        <span
          className={`text-xs font-medium ${
            trend > 0 ? "text-teal-600" : "text-rose-600"
          }`}
        >
          {trend > 0 ? "+" : ""}
          {trend}%
        </span>
      )}
    </div>
    <p
      className={`text-xl font-bold ${
        highlight ? "text-red-900" : "text-slate-900"
      }`}
    >
      {value}
    </p>
    {subtext && (
      <p
        className={`text-xs ${
          highlight ? "text-red-600" : "text-slate-500"
        } mt-1`}
      >
        {subtext}
      </p>
    )}
  </motion.div>
);

export default function EfficiencyModal({
  showEfficiencyModal,
  setShowEfficiencyModal,
  departmentEfficiency,
  onShowCaseManagement,
  onShowTimeAnalysis,
  onAskSystem,
  stageStats, // provided by parent: calculateStageStatistics(stage)
}) {
  const stage = departmentEfficiency?.stage || null;

  // Risk modal
  const [showRiskModal, setShowRiskModal] = useState(false);

  // Case history modal
  const [showCaseHistory, setShowCaseHistory] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);

  const handleOpenCaseHistory = useCallback((caseId, caseNumber) => {
    setSelectedCase({ id: caseId, caseNumber });
    setShowCaseHistory(true);
  }, []);
  const handleCloseCaseHistory = useCallback(() => {
    setShowCaseHistory(false);
    setSelectedCase(null);
  }, []);

  // Ask with stage context
  const askWithStage = useCallback(
    async (question, additionalContext = {}) => {
      const fullContext = {
        efficiency: departmentEfficiency,
        stage,
        stageStats,
        throughput: departmentEfficiency?.throughput,
        onTimeDelivery: departmentEfficiency?.onTimeDelivery,
        predictions: departmentEfficiency?.predictions,
        score: departmentEfficiency?.score,
        activeCases: departmentEfficiency?.activeCases,
        completedCases: departmentEfficiency?.completedCases,
        sampleSize: departmentEfficiency?.sampleSize,
        ...additionalContext,
      };
      if (onAskSystem) return await onAskSystem(question, fullContext);
      return "System not connected";
    },
    [onAskSystem, stage, departmentEfficiency, stageStats]
  );

  // Main metric bars
  const metrics = {
    onTime: pct(departmentEfficiency?.onTimeDelivery?.overall?.actualRate ?? 0),
    velocity: pct(departmentEfficiency?.throughput?.overall ?? 0),
    buffer: pct(
      departmentEfficiency?.onTimeDelivery?.overall?.bufferCompliance
        ?.current ?? 100
    ),
    sampleSize: departmentEfficiency?.sampleSize ?? 0,
  };

  // Velocity sub-metrics
  const velocitySubMetrics = useMemo(() => {
    const throughput = departmentEfficiency?.throughput;
    if (!throughput?.byType) return [];
    const items = [];
    if (throughput.byType.general?.count)
      items.push({
        label: "General Cases",
        value: pct(throughput.byType.general.velocityScore ?? 0),
        count: throughput.byType.general.count,
      });
    if (throughput.byType.bbs?.count)
      items.push({
        label: "BBS Cases",
        value: pct(throughput.byType.bbs.velocityScore ?? 0),
        count: throughput.byType.bbs.count,
      });
    if (throughput.byType.flex?.count)
      items.push({
        label: "3D Flex Cases",
        value: pct(throughput.byType.flex.velocityScore ?? 0),
        count: throughput.byType.flex.count,
      });
    return items.filter((m) => m.count > 0);
  }, [departmentEfficiency]);

  // Weighted score with stage buffer penalty
  const weightsRaw = departmentEfficiency?.operationsSnapshot?.weights || {};
  const weights = {
    onTime: clamp(weightsRaw.onTime ?? 0.6, 0, 1),
    velocity: clamp(weightsRaw.velocity ?? 0.4, 0, 1),
  };
  const wsum = Math.max(0.0001, weights.onTime + weights.velocity);
  const w = {
    onTime: weights.onTime / wsum,
    velocity: weights.velocity / wsum,
  };

  const bufferPenaltyWeights = CONFIG?.BUFFER_PENALTY_WEIGHTS || {
    design: 0.2,
    production: 0.2,
    finishing: 0,
  };
  const bufferPenaltyW =
    stage && stage !== "finishing" ? bufferPenaltyWeights[stage] || 0 : 0;

  const base = w.onTime * metrics.onTime + w.velocity * metrics.velocity;
  const complianceGap = Math.max(0, 1 - metrics.buffer / 100);
  const afterBuffer = base * (1 - bufferPenaltyW * complianceGap);
  const finalScore =
    departmentEfficiency?.score ?? Math.max(0, Math.min(100, afterBuffer));

  // ---------- Stage-aware priority vs standard metric (EXACT logic restored) ----------
  const priorityMetric = useMemo(() => {
    // Prefer true stage time from stageStats.validCases (working hours, QC-aware)
    const valid = stageStats?.validCases || [];

    // Helper: collect times in ms
    const collectTimes = (predicate) =>
      valid
        .filter(predicate)
        .map((c) => Number(c.timeInStage) || Number(c.rawTimeInStage) || 0)
        .filter((t) => t > 0);

    // Primary cohorts
    let priorityTimes = collectTimes((c) => !!c.priority); // explicit priority
    let standardTimes = collectTimes((c) => !c.priority && !c.rush);

    // If too few priority samples, allow rush∨priority as "urgent" cohort
    if (priorityTimes.length < 3 && valid.length > 0) {
      const urgentTimes = collectTimes((c) => c.priority || c.rush);
      if (urgentTimes.length >= 3) priorityTimes = urgentTimes;
    }

    const minStandard = 5; // need a reasonable baseline
    const minPriority = 3;

    if (
      priorityTimes.length >= minPriority &&
      standardTimes.length >= minStandard
    ) {
      const avgP = mean(priorityTimes);
      const avgS = mean(standardTimes);

      // Percent improvement relative to standard time in THIS stage
      // positive = faster than standard, negative = slower
      const deltaPct = avgS > 0 ? ((avgS - avgP) / avgS) * 100 : 0;

      const display = `${Math.abs(Math.round(deltaPct))}% ${
        deltaPct >= 0 ? "faster" : "slower"
      }`;

      return {
        display,
        percent: deltaPct,
        trend: deltaPct > 0 ? Math.round(deltaPct) : undefined,
        samples: {
          priority: priorityTimes.length,
          standard: standardTimes.length,
        },
        avgMs: { priority: avgP, standard: avgS },
        source: "stageStats.validCases",
      };
    }

    // Fallback: try any per-type priorityStats produced upstream
    if (stageStats?.typeStats) {
      for (const type of ["general", "bbs", "flex"]) {
        const t = stageStats.typeStats[type];
        if (
          t?.priorityStats?.percentFaster !== undefined &&
          t.priorityStats.count >= 3
        ) {
          const pf = t.priorityStats.percentFaster; // positive = faster
          return {
            display: `${Math.abs(Math.round(pf))}% ${
              pf >= 0 ? "faster" : "slower"
            }`,
            percent: pf,
            trend: pf > 0 ? Math.round(pf) : undefined,
            samples: {
              priority: t.priorityStats.count,
              standard: t.priorityStats.standardComparison?.standardCount || 0,
            },
            avgMs: {
              priority: t.priorityStats.mean,
              standard: t.priorityStats.standardComparison?.standardMean || 0,
            },
            source: `typeStats.${type}.priorityStats`,
          };
        }
      }
    }

    // Last resort: try departmentEfficiency.throughput.byType case lists (less precise)
    const throughputByType = departmentEfficiency?.throughput?.byType;
    if (throughputByType) {
      const allCases = Object.values(throughputByType)
        .flatMap((t) => (t?.cases ? t.cases : []))
        .filter(Boolean);

      const pTimes = allCases
        .filter((c) => !!c.priority)
        .map((c) => c.timeInStage || c.rawTimeInStage || 0)
        .filter((t) => t > 0);
      const sTimes = allCases
        .filter((c) => !c.priority && !c.rush)
        .map((c) => c.timeInStage || c.rawTimeInStage || 0)
        .filter((t) => t > 0);

      if (pTimes.length >= minPriority && sTimes.length >= minStandard) {
        const avgP = mean(pTimes);
        const avgS = mean(sTimes);
        const deltaPct = avgS > 0 ? ((avgS - avgP) / avgS) * 100 : 0;
        return {
          display: `${Math.abs(Math.round(deltaPct))}% ${
            deltaPct >= 0 ? "faster" : "slower"
          }`,
          percent: deltaPct,
          trend: deltaPct > 0 ? Math.round(deltaPct) : undefined,
          samples: { priority: pTimes.length, standard: sTimes.length },
          avgMs: { priority: avgP, standard: avgS },
          source: "throughput.byType.cases",
        };
      }
    }

    return {
      display: "N/A",
      percent: 0,
      trend: undefined,
      samples: { priority: 0, standard: 0 },
      source: "none",
    };
  }, [stageStats, departmentEfficiency]);

  // ---------- Key statistics with updated risk counts ----------
  const stats = useMemo(() => {
    const throughput = departmentEfficiency?.throughput;
    const onTimeDelivery = departmentEfficiency?.onTimeDelivery;
    const predictions = departmentEfficiency?.predictions;

    const avgMs =
      stageStats?.averageTime ??
      (throughput?.averageTime || throughput?.overallStats?.mean || null);
    const medianMs =
      stageStats?.medianTime ??
      (throughput?.medianTime || throughput?.overallStats?.median || null);

    // Extract risk counts from predictions
    // Use nullish coalescing (??) instead of || to handle cases where count is 0
    const criticalCount =
      predictions?.summary?.critical ?? predictions?.urgent?.length ?? 0;
    const highCount =
      predictions?.summary?.high ?? predictions?.high?.length ?? 0;

    return {
      avgCompletion: avgMs ? formatDurationUtil(avgMs) : "N/A",
      medianTime: medianMs ? formatDurationUtil(medianMs) : "N/A",
      activeCases:
        departmentEfficiency?.activeCases ||
        predictions?.predictions?.length ||
        0,
      priorityCompletion: priorityMetric.display,
      priorityPercentFaster: priorityMetric.percent,
      rushCompletion: pct(onTimeDelivery?.byPriority?.actualRate ?? 0),
      criticalCases: criticalCount,
      highCases: highCount,
    };
  }, [departmentEfficiency, stageStats, priorityMetric]);

  if (!showEfficiencyModal || !departmentEfficiency) return null;

  return (
    <>
      {createPortal(
        <AnimatePresence>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowEfficiencyModal(false)}
          >
            <motion.div
              className="bg-slate-50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">
                      {departmentEfficiency?.department || "Department"}{" "}
                      Efficiency Analysis
                    </h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {stage && `${cap(stage)} Stage • `}
                      {metrics.sampleSize} cases analyzed
                      {departmentEfficiency?.calculatedAt &&
                        ` • ${new Date(
                          departmentEfficiency.calculatedAt
                        ).toLocaleTimeString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowEfficiencyModal(false)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <Icon.Close />
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="overflow-y-auto max-h-[calc(90vh-80px)] bg-slate-50">
                <div className="p-6 space-y-6">
                  {/* Overall Score */}
                  <ScoreDisplay score={finalScore} />

                  {/* Three Main Metrics */}
                  <div className="space-y-3">
                    <MetricBar
                      label="On-Time Delivery"
                      value={metrics.onTime}
                      color="green"
                    />
                    <MetricBar
                      label="Velocity Score"
                      value={metrics.velocity}
                      color="blue"
                      canExpand={velocitySubMetrics.length > 0}
                      subMetrics={velocitySubMetrics}
                    />
                    {stage !== "finishing" && (
                      <MetricBar
                        label="Buffer Compliance"
                        value={metrics.buffer}
                        color="amber"
                      />
                    )}
                  </div>

                  {/* Key Statistics Grid */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">
                      Key Statistics
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <StatCard
                        icon={<Icon.Clock />}
                        label="Avg Completion"
                        value={stats.avgCompletion}
                        onClick={onShowTimeAnalysis}
                      />
                      <StatCard
                        icon={<Icon.Activity />}
                        label="Median Time"
                        value={stats.medianTime}
                        onClick={onShowTimeAnalysis}
                      />
                      <StatCard
                        icon={<Icon.TrendUp />}
                        label="Active Cases"
                        value={stats.activeCases}
                        subtext="In progress"
                        onClick={onShowCaseManagement}
                      />
                      <StatCard
                        icon={<Icon.Flag />}
                        label="Priority"
                        value={stats.priorityCompletion}
                        subtext="vs standard cases"
                        trend={priorityMetric.trend}
                      />
                      <StatCard
                        icon={<Icon.Warning />}
                        label="Critical Risk"
                        value={stats.criticalCases}
                        subtext={
                          stats.highCases > 0
                            ? `${stats.highCases} high risk`
                            : "Click for details"
                        }
                        onClick={() => setShowRiskModal(true)}
                        highlight={stats.criticalCases > 0}
                      />
                    </div>
                  </div>

                  {/* Critical Risk Cases */}
                  {departmentEfficiency?.predictions?.urgent?.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-100 bg-red-50">
                        <h3 className="text-sm font-semibold text-red-900 flex items-center gap-2">
                          <Icon.Warning />
                          Critical Risk Cases
                        </h3>
                      </div>
                      <div className="p-4 space-y-2">
                        {departmentEfficiency.predictions.urgent
                          .slice(0, 5)
                          .map((prediction, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between p-2 bg-red-50 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-semibold text-slate-900">
                                  {prediction.caseNumber}
                                </span>
                                <span className="text-xs text-red-700">
                                  {prediction.daysUntilDue < 0
                                    ? `${Math.abs(
                                        prediction.daysUntilDue
                                      ).toFixed(1)} days overdue`
                                    : `${prediction.daysUntilDue.toFixed(
                                        1
                                      )} days until due`}
                                </span>
                              </div>
                              <span className="text-xs font-medium text-red-600">
                                {(prediction.lateProbability * 100).toFixed(0)}%
                                risk
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Case Insights & System Intelligence */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Case Insights & System Intelligence
                      </h3>
                    </div>
                    <div className="p-6">
                      <SystemInsightsPanel
                        departmentEfficiency={departmentEfficiency}
                        weights={w}
                        bufferPenaltyWeight={bufferPenaltyW}
                        bufferCompliance={metrics.buffer}
                        onAskSystem={askWithStage}
                        stage={stage}
                        stageStats={stageStats}
                        onOpenCaseHistory={handleOpenCaseHistory}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* Risk Modal */}
      <CaseRiskModal
        open={showRiskModal}
        onClose={() => setShowRiskModal(false)}
        predictions={departmentEfficiency?.predictions?.predictions || []}
        stage={stage}
        onOpenCaseHistory={handleOpenCaseHistory}
      />

      {/* Case History Modal */}
      {showCaseHistory && selectedCase && (
        <CaseHistory
          id={selectedCase.id}
          caseNumber={selectedCase.caseNumber}
          onClose={handleCloseCaseHistory}
        />
      )}
    </>
  );
}
