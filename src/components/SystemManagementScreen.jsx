// Enhanced SystemManagementScreen.js - Complete Redesign
// Focus: Projections visualization, consolidated analytics, improved users tab

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  memo,
} from "react";
import clsx from "clsx";
import { db } from "../services/caseService";
import { fetchActiveUsers } from "../services/userService";
import { useMut } from "../context/DataContext";
import { APP_VERSION } from "../version";
import { calculateStageStatistics } from "../utils/stageTimeCalculations";
import { calculateDepartmentEfficiency } from "../utils/efficiencyCalculations";
import { formatHours } from "../utils/caseRiskPredictions";
import { getCanonicalName } from "../utils/nameNormalization";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TZ = "America/Boise";
const STAGES = ["design", "production", "finishing"];

const COLORS = {
  primary: "#16525F",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  purple: "#8b5cf6",
  indigo: "#6366f1",
};

const RISK_COLORS = {
  critical: {
    bg: "#fef2f2",
    border: "#fecaca",
    text: "#dc2626",
    primary: "#dc2626",
  },
  high: {
    bg: "#fff7ed",
    border: "#fed7aa",
    text: "#ea580c",
    primary: "#f97316",
  },
  medium: {
    bg: "#fefce8",
    border: "#fef08a",
    text: "#ca8a04",
    primary: "#eab308",
  },
  low: {
    bg: "#f0fdf4",
    border: "#bbf7d0",
    text: "#16a34a",
    primary: "#22c55e",
  },
};

const STAGE_COLORS = {
  design: "#6366f1",
  production: "#8b5cf6",
  finishing: "#a855f7",
};

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

const safeJsonParse = (str, fallback) => {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    return fallback;
  }
};

const fmtTimeAgo = (ts) => {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 25) return "Now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

const getStatus = (now, lastSeen) => {
  if (!lastSeen) return "offline";
  const diff = (now - new Date(lastSeen).getTime()) / 1000;
  if (diff < 45) return "active";
  if (diff < 330) return "idle";
  return "offline";
};

const stageOfCase = (row) => {
  const mods = row?.modifiers || [];
  const m = mods.find((x) => typeof x === "string" && x.startsWith("stage-"));
  return m ? m.replace("stage-", "") || "design" : "design";
};

const isDigitalGeneral = (row) => row?.department === "General";
const isOpenCase = (row) => !row?.completed && !row?.archived;

// Use centralized name normalization for consistent deduplication
// This maps name variations (dgital, Digital, digital) to canonical forms (Digital)
const normalizeForDedup = (name) => {
  if (!name) return "";
  // Use centralized normalization which handles typos, case, abbreviations
  return getCanonicalName(name).toLowerCase();
};

// Use canonical name for consistent display across the app
const formatDisplayName = (name) => {
  if (!name) return "Unknown";
  // getCanonicalName already returns properly formatted names
  return getCanonicalName(name);
};

const getEfficiencyColor = (score) => {
  if (score >= 80) return COLORS.success;
  if (score >= 60) return COLORS.warning;
  return COLORS.danger;
};

const extractUserSettings = (user) => {
  let deviceInfo = user.device_info;
  if (typeof deviceInfo === "string")
    deviceInfo = safeJsonParse(deviceInfo, null);
  if (!deviceInfo?.settings) return null;

  const booleanKeys = new Set([
    "showInfoBar",
    "showCaseTableDividers",
    "lockAddCaseCard",
    "showStageDividers",
    "autoUpdate",
    "liteUi",
  ]);
  const parsed = {};
  Object.entries(deviceInfo.settings).forEach(([key, val]) => {
    parsed[key] = booleanKeys.has(key)
      ? val === "true"
        ? true
        : val === "false"
        ? false
        : val
      : val;
  });
  return parsed;
};

const getDefaultSettings = () => ({
  boardTheme: "blue",
  showInfoBar: false,
  showCaseTableDividers: true,
  lockAddCaseCard: false,
  showStageDividers: false,
  autoUpdate: false,
  liteUi: false,
});

// Date formatters
const dateFormatters = {
  fullDateTime: new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }),
  dayKey: new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }),
  fullDate: new Intl.DateTimeFormat(undefined, {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  }),
  time: new Intl.DateTimeFormat(undefined, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }),
};

const dayKey = (d) => dateFormatters.dayKey.format(new Date(d));
const fmtDate = (d) => dateFormatters.fullDate.format(new Date(d));
const fmtTime = (d) =>
  dateFormatters.time.format(new Date(d)).replace(" ", "\u202F");

// ─────────────────────────────────────────────────────────────────────────────
// Animated Pipeline Flow Component
// ─────────────────────────────────────────────────────────────────────────────

const PipelineFlowVisualization = memo(function PipelineFlowVisualization({
  stageReports,
  stageCounts,
  selectedStage,
  onStageSelect,
}) {
  const [particles, setParticles] = useState([]);
  const animationRef = useRef(null);
  const particleIdRef = useRef(0);

  // Determine bottleneck stage
  const bottleneckStage = useMemo(() => {
    let worst = { stage: null, score: 100 };
    STAGES.forEach((stage) => {
      const report = stageReports[stage];
      const score = report?.score ?? 100;
      if (score < worst.score) worst = { stage, score };
    });
    return worst.stage;
  }, [stageReports]);

  // Stage data
  const stageData = useMemo(() => {
    return STAGES.map((stage) => {
      const report = stageReports[stage];
      const count = stageCounts[stage] || 0;
      const score = report?.score ?? null;
      const critical = report?.predictions?.summary?.critical || 0;
      const high = report?.predictions?.summary?.high || 0;

      return {
        id: stage,
        label: stage.charAt(0).toUpperCase() + stage.slice(1),
        count,
        score,
        critical,
        high,
        isBottleneck: stage === bottleneckStage,
        color: STAGE_COLORS[stage],
      };
    });
  }, [stageReports, stageCounts, bottleneckStage]);

  // Particle animation
  useEffect(() => {
    const createParticle = (fromIndex) => {
      if (fromIndex >= STAGES.length - 1) return;

      const id = particleIdRef.current++;
      const toStage = STAGES[fromIndex + 1];
      const toIsBottleneck = toStage === bottleneckStage;

      const particle = {
        id,
        fromIndex,
        progress: 0,
        speed: 0.008 + Math.random() * 0.004,
        color: toIsBottleneck ? COLORS.warning : COLORS.success,
      };

      setParticles((prev) => [...prev, particle]);
    };

    const animate = () => {
      setParticles((prev) => {
        const updated = prev
          .map((p) => ({ ...p, progress: p.progress + p.speed }))
          .filter((p) => p.progress < 1);
        return updated;
      });
      animationRef.current = requestAnimationFrame(animate);
    };

    // Spawn particles periodically
    const spawnInterval = setInterval(() => {
      const connectionIndex = Math.floor(Math.random() * (STAGES.length - 1));
      createParticle(connectionIndex);
    }, 400);

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      clearInterval(spawnInterval);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [bottleneckStage]);

  // Calculate positions for responsive layout
  const getStagePosition = (index, total, width) => {
    const padding = 80;
    const availableWidth = width - padding * 2;
    const spacing = availableWidth / (total - 1);
    return padding + index * spacing;
  };

  return (
    <div className="glass-panel p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Pipeline Flow
      </h3>

      {/* Desktop View */}
      <div className="hidden lg:block">
        <svg
          viewBox="0 0 800 180"
          className="w-full"
          style={{ minHeight: 180 }}
        >
          {/* Connection lines */}
          {STAGES.slice(0, -1).map((_, i) => {
            const x1 = getStagePosition(i, STAGES.length, 800) + 60;
            const x2 = getStagePosition(i + 1, STAGES.length, 800) - 60;
            const y = 90;
            const isToBottleneck = STAGES[i + 1] === bottleneckStage;

            return (
              <g key={`connection-${i}`}>
                {/* Base line */}
                <line
                  x1={x1}
                  y1={y}
                  x2={x2}
                  y2={y}
                  stroke={isToBottleneck ? "#fcd34d" : "#e5e7eb"}
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                {/* Arrow */}
                <polygon
                  points={`${x2 - 8},${y - 6} ${x2},${y} ${x2 - 8},${y + 6}`}
                  fill={isToBottleneck ? "#f59e0b" : "#9ca3af"}
                />
                {/* Particles */}
                {particles
                  .filter((p) => p.fromIndex === i)
                  .map((p) => {
                    const px = x1 + (x2 - x1) * p.progress;
                    return (
                      <circle
                        key={p.id}
                        cx={px}
                        cy={y}
                        r="6"
                        fill={p.color}
                        opacity={1 - p.progress * 0.5}
                      >
                        <animate
                          attributeName="r"
                          values="4;6;4"
                          dur="0.5s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    );
                  })}
              </g>
            );
          })}

          {/* Stage boxes */}
          {stageData.map((stage, i) => {
            const x = getStagePosition(i, STAGES.length, 800);
            const isSelected = selectedStage === stage.id;

            return (
              <g
                key={stage.id}
                onClick={() => onStageSelect(stage.id)}
                className="cursor-pointer"
                style={{ transition: "transform 0.2s" }}
              >
                {/* Bottleneck glow */}
                {stage.isBottleneck && (
                  <rect
                    x={x - 64}
                    y={26}
                    width={128}
                    height={128}
                    rx="20"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    opacity="0.5"
                  >
                    <animate
                      attributeName="opacity"
                      values="0.3;0.6;0.3"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </rect>
                )}

                {/* Main box */}
                <rect
                  x={x - 60}
                  y={30}
                  width={120}
                  height={120}
                  rx="16"
                  fill={isSelected ? stage.color : "white"}
                  stroke={isSelected ? stage.color : "#e5e7eb"}
                  strokeWidth={isSelected ? "3" : "2"}
                  className="transition-all"
                />

                {/* Stage label */}
                <text
                  x={x}
                  y={55}
                  textAnchor="middle"
                  className={`text-sm font-semibold ${
                    isSelected ? "fill-white" : "fill-gray-600"
                  }`}
                >
                  {stage.label}
                </text>

                {/* Case count */}
                <text
                  x={x}
                  y={95}
                  textAnchor="middle"
                  className={`text-3xl font-bold ${
                    isSelected ? "fill-white" : "fill-gray-800"
                  }`}
                >
                  {stage.count}
                </text>

                {/* Efficiency score */}
                <text
                  x={x}
                  y={130}
                  textAnchor="middle"
                  className={`text-sm font-medium ${
                    isSelected
                      ? "fill-white/80"
                      : stage.score >= 80
                      ? "fill-green-600"
                      : stage.score >= 60
                      ? "fill-amber-600"
                      : "fill-red-600"
                  }`}
                >
                  {stage.score != null ? `${Math.round(stage.score)}%` : "—"}
                </text>

                {/* Critical/High badge */}
                {(stage.critical > 0 || stage.high > 0) && (
                  <g>
                    <circle
                      cx={x + 50}
                      cy={40}
                      r="14"
                      fill={
                        stage.critical > 0
                          ? RISK_COLORS.critical.primary
                          : RISK_COLORS.high.primary
                      }
                    />
                    <text
                      x={x + 50}
                      y={45}
                      textAnchor="middle"
                      className="fill-white text-xs font-bold"
                    >
                      {stage.critical + stage.high}
                    </text>
                  </g>
                )}

                {/* Bottleneck indicator */}
                {stage.isBottleneck && (
                  <text
                    x={x}
                    y={170}
                    textAnchor="middle"
                    className="fill-amber-600 text-xs font-semibold"
                  >
                    ⚠️ BOTTLENECK
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Mobile View - Vertical */}
      <div className="lg:hidden space-y-4">
        {stageData.map((stage, i) => {
          const isSelected = selectedStage === stage.id;

          return (
            <div key={stage.id}>
              <button
                onClick={() => onStageSelect(stage.id)}
                className={clsx(
                  "w-full p-4 rounded-xl border-2 transition-all flex items-center justify-between",
                  isSelected
                    ? "border-[#16525F] bg-[#16525F]/5"
                    : "border-gray-200 bg-white hover:border-gray-300",
                  stage.isBottleneck && "ring-2 ring-amber-400 ring-offset-2"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="font-semibold text-gray-800">
                    {stage.label}
                  </span>
                  {stage.isBottleneck && (
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                      Bottleneck
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-800">
                      {stage.count}
                    </div>
                    <div className="text-xs text-gray-500">cases</div>
                  </div>
                  <div
                    className={clsx(
                      "text-lg font-bold",
                      stage.score >= 80
                        ? "text-green-600"
                        : stage.score >= 60
                        ? "text-amber-600"
                        : "text-red-600"
                    )}
                  >
                    {stage.score != null ? `${Math.round(stage.score)}%` : "—"}
                  </div>
                  {(stage.critical > 0 || stage.high > 0) && (
                    <span
                      className="px-2 py-1 text-white text-xs font-bold rounded-full"
                      style={{
                        backgroundColor:
                          stage.critical > 0
                            ? RISK_COLORS.critical.primary
                            : RISK_COLORS.high.primary,
                      }}
                    >
                      {stage.critical + stage.high}
                    </span>
                  )}
                </div>
              </button>

              {/* Connection arrow (not for last item) */}
              {i < stageData.length - 1 && (
                <div className="flex justify-center py-2">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 4v16m0 0l-6-6m6 6l6-6"
                      stroke={
                        STAGES[i + 1] === bottleneckStage
                          ? "#f59e0b"
                          : "#d1d5db"
                      }
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Risk Bubble Chart Component
// ─────────────────────────────────────────────────────────────────────────────

const RiskBubbleChart = memo(function RiskBubbleChart({
  predictions,
  onBubbleClick,
}) {
  const [hoveredCase, setHoveredCase] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const { bubbleData, riskCounts } = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const bubbles = [];

    (predictions || []).forEach((p, i) => {
      counts[p.riskLevel]++;

      // Only show bubbles for at-risk cases
      if (p.riskLevel !== "low") {
        const size = 16 + (p.riskScore / 100) * 24;
        bubbles.push({
          id: p.id || p.caseNumber,
          caseNumber: p.caseNumber,
          riskLevel: p.riskLevel,
          riskScore: p.riskScore,
          size,
          prediction: p,
        });
      }
    });

    return { bubbleData: bubbles, riskCounts: counts };
  }, [predictions]);

  // Group bubbles by risk level
  const groupedBubbles = useMemo(() => {
    const groups = { critical: [], high: [], medium: [] };
    bubbleData.forEach((b) => {
      if (groups[b.riskLevel]) groups[b.riskLevel].push(b);
    });
    return groups;
  }, [bubbleData]);

  const handleMouseEnter = (bubble, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setHoveredCase(bubble);
  };

  return (
    <div className="glass-panel p-6 h-full">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Risk Distribution
      </h3>

      {/* Summary counts */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {Object.entries(riskCounts).map(([level, count]) => (
          <div
            key={level}
            className="text-center p-2 rounded-lg"
            style={{ backgroundColor: RISK_COLORS[level].bg }}
          >
            <div
              className="text-xl font-bold"
              style={{ color: RISK_COLORS[level].primary }}
            >
              {count}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {level}
            </div>
          </div>
        ))}
      </div>

      {/* Bubble visualization */}
      <div className="relative min-h-[200px] flex flex-col gap-4">
        {["critical", "high", "medium"].map((level) => {
          const levelBubbles = groupedBubbles[level];
          if (levelBubbles.length === 0) return null;

          return (
            <div key={level} className="flex flex-wrap items-center gap-2">
              <span
                className="text-xs font-semibold uppercase w-16"
                style={{ color: RISK_COLORS[level].text }}
              >
                {level}
              </span>
              <div className="flex flex-wrap gap-1">
                {levelBubbles.map((bubble) => (
                  <button
                    key={bubble.id}
                    onClick={() => onBubbleClick?.(bubble.prediction)}
                    onMouseEnter={(e) => handleMouseEnter(bubble, e)}
                    onMouseLeave={() => setHoveredCase(null)}
                    className="relative rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2"
                    style={{
                      width: bubble.size,
                      height: bubble.size,
                      backgroundColor: RISK_COLORS[bubble.riskLevel].primary,
                      boxShadow: `0 0 ${bubble.size / 2}px ${
                        RISK_COLORS[bubble.riskLevel].primary
                      }40`,
                      focusRingColor: RISK_COLORS[bubble.riskLevel].primary,
                    }}
                    title={bubble.caseNumber}
                  >
                    <span className="sr-only">{bubble.caseNumber}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {riskCounts.critical === 0 &&
          riskCounts.high === 0 &&
          riskCounts.medium === 0 && (
            <div className="flex-1 flex items-center justify-center text-center py-8">
              <div>
                <div className="text-4xl mb-2">✅</div>
                <p className="text-gray-600 font-medium">All cases on track!</p>
                <p className="text-sm text-gray-400">
                  {riskCounts.low} cases with low risk
                </p>
              </div>
            </div>
          )}
      </div>

      {/* Tooltip */}
      {hoveredCase && (
        <div
          className="fixed z-50 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 8 }}
        >
          <div className="font-mono font-bold">{hoveredCase.caseNumber}</div>
          <div className="text-gray-300">Risk: {hoveredCase.riskScore}%</div>
          <div className="absolute left-1/2 -bottom-1 w-2 h-2 bg-gray-900 transform -translate-x-1/2 rotate-45" />
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Timeline Forecast Component
// ─────────────────────────────────────────────────────────────────────────────

const TimelineForecast = memo(function TimelineForecast({ predictions }) {
  const forecastData = useMemo(() => {
    const now = new Date();

    const addDays = (date, days) => {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    };

    const points = [
      { label: "Now", offset: 0 },
      { label: "+1d", offset: 1 },
      { label: "+3d", offset: 3 },
      { label: "+1wk", offset: 7 },
    ];

    return points.map(({ label, offset }) => {
      const targetDate = addDays(now, offset);

      // Count cases that will be at risk by this date
      const atRisk = (predictions || []).filter((p) => {
        if (!p.dueDate) return false;
        const dueDate = new Date(p.dueDate);

        // Case is at risk if: due before target AND (will be late OR currently critical/high)
        if (dueDate > targetDate) return false;
        return (
          p.willBeLate || p.riskLevel === "critical" || p.riskLevel === "high"
        );
      }).length;

      return { label, offset, atRisk, date: targetDate };
    });
  }, [predictions]);

  const maxRisk = Math.max(...forecastData.map((d) => d.atRisk), 1);
  const hasRisk = forecastData.some((d) => d.atRisk > 0);

  return (
    <div className="glass-panel p-6 h-full">
      <h3 className="text-lg font-semibold text-gray-800 mb-2">
        Timeline Forecast
      </h3>
      <p className="text-sm text-gray-500 mb-4">Projected at-risk cases</p>

      {/* Timeline chart */}
      <div className="relative h-32">
        <svg
          viewBox="0 0 300 100"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={pct}
              x1="40"
              y1={80 - (pct / 100) * 60}
              x2="280"
              y2={80 - (pct / 100) * 60}
              stroke="#f3f4f6"
              strokeWidth="1"
            />
          ))}

          {/* Area fill */}
          {hasRisk && (
            <path
              d={`
                M 40,80
                ${forecastData
                  .map((d, i) => {
                    const x = 40 + (i / (forecastData.length - 1)) * 240;
                    const y = 80 - (d.atRisk / maxRisk) * 60;
                    return `L ${x},${y}`;
                  })
                  .join(" ")}
                L 280,80
                Z
              `}
              fill="url(#riskGradient)"
            />
          )}

          {/* Line */}
          <path
            d={`
              M ${forecastData
                .map((d, i) => {
                  const x = 40 + (i / (forecastData.length - 1)) * 240;
                  const y = 80 - (d.atRisk / maxRisk) * 60;
                  return `${i === 0 ? "" : "L "}${x},${y}`;
                })
                .join(" ")}
            `}
            fill="none"
            stroke={COLORS.danger}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Points */}
          {forecastData.map((d, i) => {
            const x = 40 + (i / (forecastData.length - 1)) * 240;
            const y = 80 - (d.atRisk / maxRisk) * 60;

            return (
              <g key={d.label}>
                <circle
                  cx={x}
                  cy={y}
                  r="5"
                  fill="white"
                  stroke={COLORS.danger}
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={95}
                  textAnchor="middle"
                  className="fill-gray-500 text-[10px]"
                >
                  {d.label}
                </text>
                <text
                  x={x}
                  y={y - 10}
                  textAnchor="middle"
                  className="fill-gray-800 text-xs font-bold"
                >
                  {d.atRisk}
                </text>
              </g>
            );
          })}

          {/* Gradient definition */}
          <defs>
            <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.danger} stopOpacity="0.3" />
              <stop
                offset="100%"
                stopColor={COLORS.danger}
                stopOpacity="0.05"
              />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Summary insight */}
      {hasRisk ? (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">
              {forecastData[forecastData.length - 1].atRisk} cases
            </span>{" "}
            projected at-risk by end of week
          </p>
        </div>
      ) : (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800">
            No cases projected to be at risk this week
          </p>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Quick Stats Bar Component
// ─────────────────────────────────────────────────────────────────────────────

const QuickStatsBar = memo(function QuickStatsBar({
  predictions,
  stageReport,
}) {
  const stats = useMemo(() => {
    const summary = predictions?.summary || {};
    return {
      capacity: `${summary.stageCapacity || 1}`,
      avgRisk: `${((summary.averageLateProbability || 0) * 100).toFixed(0)}%`,
      throughput: stageReport?.throughput?.overall?.toFixed(0) || "—",
      avgWait: formatHours(summary.averageBacklog || 0),
    };
  }, [predictions, stageReport]);

  const statItems = [
    { label: "Capacity", value: stats.capacity, icon: "👥" },
    { label: "Avg Risk", value: stats.avgRisk, icon: "⚠️" },
    { label: "Velocity", value: `${stats.throughput}%`, icon: "⚡" },
    { label: "Avg Queue", value: stats.avgWait, icon: "📊" },
  ];

  return (
    <div className="glass-panel p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statItems.map((stat) => (
          <div key={stat.label} className="flex items-center gap-3">
            <span className="text-xl">{stat.icon}</span>
            <div>
              <div className="text-lg font-bold text-gray-800">
                {stat.value}
              </div>
              <div className="text-xs text-gray-500">{stat.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// At-Risk Case Card Component
// ─────────────────────────────────────────────────────────────────────────────

const AtRiskCaseCard = memo(function AtRiskCaseCard({ prediction, onClick }) {
  const colors = RISK_COLORS[prediction.riskLevel] || RISK_COLORS.low;
  const dueDate = prediction.dueDate ? new Date(prediction.dueDate) : null;
  const isOverdue = dueDate && dueDate < new Date();

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderLeftWidth: "4px",
        borderLeftColor: colors.primary,
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-bold text-gray-800">
              {prediction.caseNumber}
            </span>
            <span className="text-xs text-gray-500 capitalize">
              {prediction.caseType}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold" style={{ color: colors.text }}>
              {prediction.riskScore}% risk
            </span>
            <span className="text-gray-500">•</span>
            <span className="text-gray-600">
              {formatHours(prediction.stageWorkHours)} remaining
            </span>
          </div>

          {prediction.riskReasons?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {prediction.riskReasons.slice(0, 2).map((reason, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs bg-white/60 text-gray-600 rounded border border-gray-200"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <span
            className="px-2 py-1 text-xs font-bold uppercase rounded"
            style={{
              backgroundColor: colors.primary + "20",
              color: colors.text,
            }}
          >
            {prediction.riskLevel}
          </span>

          {isOverdue && (
            <div className="mt-2 text-xs font-semibold text-red-600">
              OVERDUE
            </div>
          )}

          {prediction.willBeLate && !isOverdue && (
            <div className="mt-2 text-xs text-amber-600">
              Late by {formatHours(prediction.daysLate * 24)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Redesigned Projections Panel
// ─────────────────────────────────────────────────────────────────────────────

const ProjectionsPanel = memo(function ProjectionsPanel({
  stageReports,
  stageCounts,
  selectedStage,
  onStageChange,
  isLoading,
}) {
  const currentReport = stageReports[selectedStage];
  const predictions = currentReport?.predictions;

  const sortedPredictions = useMemo(() => {
    if (!predictions?.predictions) return [];
    const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...predictions.predictions].sort(
      (a, b) => (riskOrder[a.riskLevel] || 3) - (riskOrder[b.riskLevel] || 3)
    );
  }, [predictions]);

  const atRiskPredictions = sortedPredictions.filter(
    (p) => p.riskLevel !== "low"
  );

  const handleBubbleClick = useCallback((prediction) => {
    // Scroll to the case in the list
    const element = document.getElementById(
      `case-${prediction.id || prediction.caseNumber}`
    );
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("ring-2", "ring-blue-400");
      setTimeout(
        () => element.classList.remove("ring-2", "ring-blue-400"),
        2000
      );
    }
  }, []);

  if (isLoading) {
    return (
      <div className="glass-panel p-12 text-center">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-[#16525F] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500">Loading projections...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pipeline Flow - Stage Selection */}
      <PipelineFlowVisualization
        stageReports={stageReports}
        stageCounts={stageCounts}
        selectedStage={selectedStage}
        onStageSelect={onStageChange}
      />

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Risk Bubbles */}
        <RiskBubbleChart
          predictions={sortedPredictions}
          onBubbleClick={handleBubbleClick}
        />

        {/* Timeline Forecast */}
        <TimelineForecast predictions={sortedPredictions} />
      </div>

      {/* Quick Stats */}
      <QuickStatsBar predictions={predictions} stageReport={currentReport} />

      {/* At-Risk Cases List (Always Visible) */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            At-Risk Cases
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({atRiskPredictions.length} requiring attention)
            </span>
          </h3>
          {sortedPredictions.length - atRiskPredictions.length > 0 && (
            <span className="text-sm text-gray-500">
              + {sortedPredictions.length - atRiskPredictions.length} on track
            </span>
          )}
        </div>

        {atRiskPredictions.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-600 font-medium">All cases on track!</p>
            <p className="text-gray-400 text-sm mt-1">
              No critical or high-risk cases
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {atRiskPredictions.map((prediction) => (
              <div
                key={prediction.id || prediction.caseNumber}
                id={`case-${prediction.id || prediction.caseNumber}`}
                className="transition-all"
              >
                <AtRiskCaseCard
                  prediction={prediction}
                  onClick={() =>
                    console.log("Case clicked:", prediction.caseNumber)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Consolidated Analytics Panel
// ─────────────────────────────────────────────────────────────────────────────

const AnalyticsPanel = memo(function AnalyticsPanel({
  stageReports,
  stageStatsMeta,
  historySummary,
}) {
  // Calculate overall efficiency
  const { overallEfficacy, stageData, insights } = useMemo(() => {
    const data = {};
    const insightsList = [];

    STAGES.forEach((stage) => {
      const report = stageReports[stage];
      if (!report) return;

      const score = report.score || 0;
      const onTime = (report.onTimeDelivery?.overall?.actualRate || 0) * 100;
      const velocity = report.throughput?.overall || 0;

      data[stage] = {
        score,
        onTime: Math.min(100, onTime),
        velocity: Math.min(100, velocity),
        sampleSize: stageStatsMeta[stage]?.valid || 0,
      };

      // Generate insights
      if (score >= 90) {
        insightsList.push({
          type: "success",
          message: `${
            stage.charAt(0).toUpperCase() + stage.slice(1)
          } is performing excellently at ${score.toFixed(0)}%`,
        });
      } else if (score < 60) {
        insightsList.push({
          type: "warning",
          message: `${
            stage.charAt(0).toUpperCase() + stage.slice(1)
          } efficiency (${score.toFixed(0)}%) needs attention`,
        });
      }
    });

    // Compare stages
    const scores = Object.values(data).map((d) => d.score);
    if (scores.length > 1) {
      const best = Object.entries(data).reduce((a, b) =>
        a[1].score > b[1].score ? a : b
      );
      const worst = Object.entries(data).reduce((a, b) =>
        a[1].score < b[1].score ? a : b
      );

      if (best[1].score - worst[1].score > 15) {
        insightsList.push({
          type: "info",
          message: `${
            best[0].charAt(0).toUpperCase() + best[0].slice(1)
          } outperforms ${worst[0]} by ${(
            best[1].score - worst[1].score
          ).toFixed(0)}%`,
        });
      }
    }

    const overall =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;

    return {
      overallEfficacy: overall,
      stageData: data,
      insights: insightsList,
    };
  }, [stageReports, stageStatsMeta]);

  return (
    <div className="space-y-6">
      {/* System Overview Card */}
      <div className="glass-panel p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-800">
              System Efficacy Overview
            </h3>
            <p className="text-sm text-gray-500">
              Combined efficiency across all stages
            </p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold text-gray-800">
              {overallEfficacy?.toFixed(0) || "—"}%
            </div>
            <div className="text-xs text-gray-500">Overall Score</div>
          </div>
        </div>

        {/* Stage Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STAGES.map((stage) => {
            const data = stageData[stage];
            if (!data) return null;

            const color = getEfficiencyColor(data.score);

            return (
              <div
                key={stage}
                className="p-4 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-100"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-700 capitalize">
                    {stage}
                  </span>
                  <span className="text-xl font-bold" style={{ color }}>
                    {data.score.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${data.score}%`, backgroundColor: color }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-gray-500">
                  <span>{data.sampleSize} cases</span>
                  <span>{data.onTime.toFixed(0)}% on-time</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key Insights */}
      {insights.length > 0 && (
        <div className="glass-panel p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Key Insights
          </h3>
          <div className="space-y-3">
            {insights.map((insight, i) => (
              <div
                key={i}
                className={clsx(
                  "p-3 rounded-lg border flex items-start gap-3",
                  insight.type === "success" && "bg-green-50 border-green-200",
                  insight.type === "warning" && "bg-amber-50 border-amber-200",
                  insight.type === "info" && "bg-blue-50 border-blue-200"
                )}
              >
                <span className="text-lg">
                  {insight.type === "success"
                    ? "🎯"
                    : insight.type === "warning"
                    ? "⚠️"
                    : "💡"}
                </span>
                <p
                  className={clsx(
                    "text-sm",
                    insight.type === "success" && "text-green-800",
                    insight.type === "warning" && "text-amber-800",
                    insight.type === "info" && "text-blue-800"
                  )}
                >
                  {insight.message}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage Comparison */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-6">
          Stage Performance Comparison
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* On-Time Rate */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-4">
              On-Time Rate
            </h4>
            <div className="space-y-3">
              {STAGES.map((stage) => {
                const value = stageData[stage]?.onTime || 0;
                return (
                  <div key={stage} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 capitalize">{stage}</span>
                      <span className="font-semibold text-gray-800">
                        {value.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Velocity Score */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-4">
              Velocity Score
            </h4>
            <div className="space-y-3">
              {STAGES.map((stage) => {
                const value = stageData[stage]?.velocity || 0;
                return (
                  <div key={stage} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 capitalize">{stage}</span>
                      <span className="font-semibold text-gray-800">
                        {value.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overall Score */}
          <div>
            <h4 className="text-sm font-medium text-gray-600 mb-4">
              Overall Efficiency
            </h4>
            <div className="space-y-3">
              {STAGES.map((stage) => {
                const value = stageData[stage]?.score || 0;
                return (
                  <div key={stage} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 capitalize">{stage}</span>
                      <span className="font-semibold text-gray-800">
                        {value.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${value}%`,
                          backgroundColor: getEfficiencyColor(value),
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Activity Charts (kept from original) */}
      {historySummary && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass-panel p-6">
            <h3 className="text-lg font-semibold text-gray-800">
              Top Contributors
            </h3>
            <p className="mt-1 text-sm text-gray-500 mb-4">Most active users</p>
            <div className="space-y-3">
              {historySummary.topUsers?.slice(0, 5).map((user) => {
                const maxValue = Math.max(
                  ...historySummary.topUsers.map((u) => u.value),
                  1
                );
                const width = (user.value / maxValue) * 100;
                return (
                  <div key={user.label} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700 truncate">
                        {user.label}
                      </span>
                      <span className="font-semibold text-gray-800">
                        {user.value}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-panel p-6">
            <h3 className="text-lg font-semibold text-gray-800">
              Action Breakdown
            </h3>
            <p className="mt-1 text-sm text-gray-500 mb-4">Types of actions</p>
            <div className="space-y-3">
              {historySummary.actionChartData?.map((item) => {
                const total = historySummary.actionChartData.reduce(
                  (sum, d) => sum + d.value,
                  0
                );
                const percentage = total > 0 ? (item.value / total) * 100 : 0;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm font-medium text-gray-700">
                          {item.label}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">
                        {item.value}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: item.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// UI Components (Status Dot, Toast, etc.)
// ─────────────────────────────────────────────────────────────────────────────

const StatusDot = memo(function StatusDot({ status, size = "normal" }) {
  const sizeClass = size === "small" ? "h-2 w-2" : "h-2.5 w-2.5";

  if (status === "active") {
    return (
      <span className={`relative flex ${sizeClass}`}>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span
          className={`relative inline-flex rounded-full ${sizeClass} bg-emerald-500`}
        />
      </span>
    );
  }

  return (
    <div
      className={clsx(
        sizeClass,
        "rounded-full flex-shrink-0",
        status === "idle" ? "bg-amber-400" : "bg-gray-400"
      )}
    />
  );
});

const Toast = memo(function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={clsx(
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-5 py-3 shadow-2xl transition-all",
        type === "success"
          ? "bg-emerald-600 text-white"
          : "bg-red-600 text-white"
      )}
    >
      <span>{type === "success" ? "✓" : "✗"}</span>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 text-white/70 hover:text-white">
        ×
      </button>
    </div>
  );
});

const LoadingSpinner = memo(function LoadingSpinner({ size = "md" }) {
  const sizes = {
    sm: "w-4 h-4 border-2",
    md: "w-6 h-6 border-2",
    lg: "w-8 h-8 border-3",
  };
  return (
    <div
      className={clsx(
        sizes[size],
        "border-gray-200 border-t-[#16525F] rounded-full animate-spin"
      )}
    />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Users & Commands Components (Improved Layout)
// ─────────────────────────────────────────────────────────────────────────────

const UserRow = memo(function UserRow({ user, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(user.key)}
      className={clsx(
        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all",
        isSelected
          ? "bg-[#16525F]/10 border-l-2 border-[#16525F]"
          : "hover:bg-gray-50 border-l-2 border-transparent",
        user.status === "offline" && !isSelected && "opacity-60"
      )}
    >
      <StatusDot status={user.status} size="small" />

      <div
        className={clsx(
          "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white flex-shrink-0",
          user.isOutdated
            ? "bg-gradient-to-br from-amber-500 to-orange-600"
            : "bg-gradient-to-br from-emerald-500 to-teal-600"
        )}
      >
        {user.displayName.charAt(0)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-800 truncate">
          {user.displayName}
        </div>
        <div className="text-xs text-gray-500">
          {fmtTimeAgo(user.last_seen)}
        </div>
      </div>

      <span
        className={clsx(
          "font-mono text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
          user.isOutdated
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"
        )}
      >
        v{user.app_version || "?"}
      </span>
    </button>
  );
});

const SETTING_DEFINITIONS = [
  {
    key: "boardTheme",
    label: "Theme",
    type: "select",
    options: ["blue", "white", "pink", "dark"],
  },
  { key: "showInfoBar", label: "Info Bar", type: "toggle" },
  { key: "showCaseTableDividers", label: "Table Dividers", type: "toggle" },
  { key: "lockAddCaseCard", label: "Lock Add Card", type: "toggle" },
  { key: "showStageDividers", label: "Stage Dividers", type: "toggle" },
  { key: "autoUpdate", label: "Auto Update", type: "toggle" },
  { key: "liteUi", label: "Lite UI", type: "toggle" },
];

const SettingsPanel = memo(function SettingsPanel({
  selectedUser,
  settingsToSend,
  settingsMode,
  onSettingsChange,
  onModeChange,
  onApplySettings,
  onForceRestart,
  sending,
}) {
  const displaySettings = useMemo(() => {
    const defaults = getDefaultSettings();
    return selectedUser.settings
      ? { ...defaults, ...selectedUser.settings }
      : defaults;
  }, [selectedUser.settings]);

  const hasChanges = useMemo(() => {
    if (settingsMode !== "edit") return false;
    return SETTING_DEFINITIONS.some(
      (s) => settingsToSend[s.key] !== displaySettings[s.key]
    );
  }, [settingsMode, settingsToSend, displaySettings]);

  const formatValue = (key, value) => {
    if (value === undefined || value === null) return "—";
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (key === "boardTheme")
      return value.charAt(0).toUpperCase() + value.slice(1);
    return String(value);
  };

  return (
    <div className="p-3 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-700">Settings</h4>
        <div className="flex rounded bg-gray-100 p-0.5">
          {["view", "edit"].map((mode) => (
            <button
              key={mode}
              onClick={() => onModeChange(mode)}
              className={clsx(
                "px-2 py-0.5 rounded text-xs transition-all capitalize",
                settingsMode === mode
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500"
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 flex-1 overflow-y-auto">
        {SETTING_DEFINITIONS.map((setting) => {
          const viewValue = displaySettings[setting.key];
          const editValue = settingsToSend[setting.key];
          const changed =
            settingsMode === "edit" &&
            editValue !== displaySettings[setting.key];

          return (
            <div
              key={setting.key}
              className={clsx(
                "rounded px-2 py-1.5 flex items-center justify-between",
                changed ? "bg-[#16525F]/10" : "bg-gray-50"
              )}
            >
              <span className="text-xs text-gray-600">{setting.label}</span>

              {settingsMode === "view" ? (
                <span
                  className={clsx(
                    "text-xs font-medium",
                    typeof viewValue === "boolean"
                      ? viewValue
                        ? "text-emerald-600"
                        : "text-gray-400"
                      : "text-gray-700"
                  )}
                >
                  {formatValue(setting.key, viewValue)}
                </span>
              ) : setting.type === "toggle" ? (
                <button
                  onClick={() => onSettingsChange(setting.key, !editValue)}
                  className={clsx(
                    "relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full transition-colors",
                    editValue ? "bg-[#16525F]" : "bg-gray-300"
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform mt-0.5",
                      editValue ? "translate-x-3.5 ml-0.5" : "translate-x-0.5"
                    )}
                  />
                </button>
              ) : (
                <select
                  value={editValue || ""}
                  onChange={(e) =>
                    onSettingsChange(setting.key, e.target.value)
                  }
                  className="rounded bg-white border border-gray-200 px-1.5 py-0.5 text-xs"
                >
                  {setting.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      {settingsMode === "edit" && (
        <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={onApplySettings}
            disabled={sending || !hasChanges}
            className={clsx(
              "flex-1 rounded py-1.5 text-xs font-semibold transition-all",
              hasChanges
                ? "bg-[#16525F] text-white"
                : "bg-gray-100 text-gray-400"
            )}
          >
            {sending ? "..." : "⚡ Apply"}
          </button>
          <button
            onClick={onForceRestart}
            disabled={sending}
            className="flex-1 rounded bg-amber-50 border border-amber-200 py-1.5 text-xs font-semibold text-amber-700"
          >
            🔄 Restart
          </button>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// History Components (kept from original but streamlined)
// ─────────────────────────────────────────────────────────────────────────────

const HistoryRow = memo(function HistoryRow({ row }) {
  const [num, desc] = useMemo(() => {
    const s = row.casenumber || "";
    const t = s
      .replace(/[()]/g, "")
      .replace(/\s*-\s*/, " ")
      .trim()
      .split(/\s+/);
    return [t.shift() || "", t.join(" ")];
  }, [row.casenumber]);

  return (
    <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-3 items-start px-4 py-2 hover:bg-gray-50 transition-colors">
      <div className="min-w-0">
        <div className="font-mono text-sm text-gray-800">{num}</div>
        {desc && <div className="text-[10px] text-gray-500">{desc}</div>}
      </div>
      <div className="text-sm text-gray-600 whitespace-nowrap">
        {fmtTime(row.created_at)}
      </div>
      <div className="text-sm text-gray-600 whitespace-nowrap max-w-[120px] truncate">
        {row.user_name}
      </div>
      <div className="text-sm text-right text-gray-600">{row.action}</div>
    </div>
  );
});

const DaySection = memo(function DaySection({ group }) {
  return (
    <section className="mb-4">
      <div className="rounded-xl overflow-hidden bg-white/60 border border-white/50 shadow-sm">
        <div className="px-4 py-2 font-bold text-gray-800 bg-white/80 border-b border-gray-200/30">
          {group.label}
        </div>
        <div className="grid grid-cols-[1fr_auto_auto_1fr] gap-3 px-4 py-1.5 text-[10px] font-semibold uppercase text-gray-500 bg-white/50 border-b border-gray-100">
          <span>Case #</span>
          <span>Time</span>
          <span>User</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y divide-gray-100/50">
          {group.rows.map((row, idx) => (
            <HistoryRow key={`${row.created_at}-${idx}`} row={row} />
          ))}
        </div>
      </div>
    </section>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function SystemManagementScreen() {
  const { rows } = useMut();

  // Core state
  const [tab, setTab] = useState("overview");
  const [now, setNow] = useState(Date.now());

  // User management
  const [activeUsers, setActiveUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserKey, setSelectedUserKey] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast, setToast] = useState(null);
  const [sending, setSending] = useState(false);
  const [updateNotes, setUpdateNotes] = useState("");
  const [settingsToSend, setSettingsToSend] = useState(getDefaultSettings());
  const [settingsMode, setSettingsMode] = useState("view");

  // History
  const [historyDays] = useState(7);
  const [history, setHistory] = useState([]);
  const [historyGroups, setHistoryGroups] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Projections
  const [running, setRunning] = useState(false);
  const [_progress, setProgress] = useState({
    design: 0,
    production: 0,
    finishing: 0,
  });
  const [stageReports, setStageReports] = useState({});
  const [stageStatsMeta, setStageStatsMeta] = useState({});
  const [calcError, setCalcError] = useState("");
  const [projectionsLoaded, setProjectionsLoaded] = useState(false);
  const [selectedProjectionStage, setSelectedProjectionStage] =
    useState("design");

  // Refs
  const hasAutoLoadedRef = useRef(false);
  const lastSelectedUserKeyRef = useRef(null);

  // Time ticker
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed Data
  // ─────────────────────────────────────────────────────────────────────────────

  const { openCases, digitalCases, stageCounts } = useMemo(() => {
    const arr = rows || [];
    const open = arr.filter(isOpenCase);
    const digital = open.filter(isDigitalGeneral);
    const counts = { design: 0, production: 0, finishing: 0, qc: 0 };
    digital.forEach((c) => {
      const s = stageOfCase(c);
      if (s in counts) counts[s]++;
    });
    return { openCases: open, digitalCases: digital, stageCounts: counts };
  }, [rows]);

  // User processing
  const { outdatedUsers, currentUsers, userStats, allProcessedUsers } =
    useMemo(() => {
      const users = activeUsers || [];
      if (users.length === 0) {
        return {
          outdatedUsers: [],
          currentUsers: [],
          allProcessedUsers: [],
          userStats: {
            total: 0,
            upToDate: 0,
            outdated: 0,
            active: 0,
            idle: 0,
            offline: 0,
          },
        };
      }

      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const filtered = users.filter((user) => {
        if (!user.last_seen || new Date(user.last_seen) < sevenDaysAgo)
          return false;
        const name = (user.user_name || "").trim();
        return (
          name.length >= 2 &&
          !/^(test|asdf|qwer|xxx|yyy|zzz|abc|aaa|bbb|\d+)$/i.test(name)
        );
      });

      // Deduplicate
      const grouped = {};
      filtered.forEach((user) => {
        const key = normalizeForDedup(user.user_name);
        const existing = grouped[key];
        if (
          !existing ||
          new Date(user.last_seen) > new Date(existing.last_seen)
        ) {
          grouped[key] = { ...user, _key: key };
        }
      });

      const allUsers = Object.values(grouped).map((user) => ({
        ...user,
        key: user._key,
        status: getStatus(now, user.last_seen),
        isOutdated: user.app_version !== APP_VERSION,
        displayName: formatDisplayName(user.user_name),
        settings: extractUserSettings(user),
      }));

      const sortFn = (a, b) => {
        const order = { active: 0, idle: 1, offline: 2 };
        return (
          order[a.status] - order[b.status] ||
          a.displayName.localeCompare(b.displayName)
        );
      };

      const outdated = allUsers.filter((u) => u.isOutdated).sort(sortFn);
      const current = allUsers.filter((u) => !u.isOutdated).sort(sortFn);

      return {
        outdatedUsers: outdated,
        currentUsers: current,
        allProcessedUsers: [...current, ...outdated],
        userStats: {
          total: allUsers.length,
          upToDate: current.length,
          outdated: outdated.length,
          active: allUsers.filter((u) => u.status === "active").length,
          idle: allUsers.filter((u) => u.status === "idle").length,
          offline: allUsers.filter((u) => u.status === "offline").length,
        },
      };
    }, [activeUsers, now]);

  const filteredOutdatedUsers = useMemo(
    () =>
      statusFilter === "all"
        ? outdatedUsers
        : outdatedUsers.filter((u) => u.status === statusFilter),
    [outdatedUsers, statusFilter]
  );
  const filteredCurrentUsers = useMemo(
    () =>
      statusFilter === "all"
        ? currentUsers
        : currentUsers.filter((u) => u.status === statusFilter),
    [currentUsers, statusFilter]
  );

  const selectedUser = useMemo(
    () =>
      selectedUserKey
        ? allProcessedUsers.find((u) => u.key === selectedUserKey) || null
        : null,
    [allProcessedUsers, selectedUserKey]
  );

  // Initialize settings when user changes
  useEffect(() => {
    if (selectedUser && lastSelectedUserKeyRef.current !== selectedUser.key) {
      lastSelectedUserKeyRef.current = selectedUser.key;
      setSettingsToSend(
        selectedUser.settings
          ? { ...getDefaultSettings(), ...selectedUser.settings }
          : getDefaultSettings()
      );
      setSettingsMode("view");
    } else if (!selectedUser) {
      lastSelectedUserKeyRef.current = null;
    }
  }, [selectedUser]);

  // History summary
  const historySummary = useMemo(() => {
    const hist = history || [];
    if (hist.length === 0)
      return { topUsers: [], actionChartData: [], total: 0 };

    const byUser = {};
    const byAction = { created: 0, done: 0, moved: 0, archived: 0 };

    hist.forEach((h) => {
      byUser[h.user_name || "Unknown"] =
        (byUser[h.user_name || "Unknown"] || 0) + 1;
      const a = (h.action || "").toLowerCase();
      if (a.includes("case created")) byAction.created++;
      else if (a.includes("marked done")) byAction.done++;
      else if (a.includes("archived")) byAction.archived++;
      else if (a.includes("moved")) byAction.moved++;
    });

    const topUsers = Object.entries(byUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value, color: COLORS.purple }));

    const actionChartData = [
      { label: "Created", value: byAction.created, color: COLORS.indigo },
      { label: "Done", value: byAction.done, color: COLORS.success },
      { label: "Moved", value: byAction.moved, color: COLORS.info },
      { label: "Archived", value: byAction.archived, color: "#94a3b8" },
    ];

    return { topUsers, actionChartData, total: hist.length };
  }, [history]);

  const avgEfficiency = useMemo(() => {
    const valid = Object.values(stageReports).filter((r) => r?.score != null);
    return valid.length > 0
      ? Math.round(
          valid.reduce((sum, r) => sum + (r.score || 0), 0) / valid.length
        )
      : null;
  }, [stageReports]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Data Loaders
  // ─────────────────────────────────────────────────────────────────────────────

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await fetchActiveUsers();
      setActiveUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load users", e);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    const t = setInterval(loadUsers, 15000);
    return () => clearInterval(t);
  }, [loadUsers]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - historyDays);

      const { data, error } = await db
        .from("case_history")
        .select(
          "case_id,action,created_at,user_name,cases!inner(casenumber,archived)"
        )
        .eq("cases.archived", false)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      setHistory(data || []);

      // Group by day
      const groups = new Map();
      (data || []).forEach((r) => {
        const k = dayKey(r.created_at);
        if (!groups.has(k))
          groups.set(k, { label: fmtDate(r.created_at), key: k, rows: [] });
        groups
          .get(k)
          .rows.push({ ...r, casenumber: r.cases?.casenumber || "—" });
      });

      setHistoryGroups(
        [...groups.values()].sort((a, b) => b.key.localeCompare(a.key))
      );
    } catch (e) {
      console.error("Failed to load history", e);
    } finally {
      setLoadingHistory(false);
    }
  }, [historyDays]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const runProjections = useCallback(async () => {
    setRunning(true);
    setCalcError("");
    setStageReports({});
    setStageStatsMeta({});
    setProgress({ design: 0, production: 0, finishing: 0 });

    try {
      const reports = {};
      const meta = {};

      for (const stage of STAGES) {
        const stats = await calculateStageStatistics(stage, (p) => {
          setProgress((cur) => ({
            ...cur,
            [stage]: Math.max(0, Math.min(100, p || 0)),
          }));
        });

        meta[stage] = {
          valid: stats?.validCases?.length || 0,
          calculatedAt: nowIso(),
        };

        const rep = await calculateDepartmentEfficiency(
          "Digital",
          stage,
          stats,
          stats?.validCases?.length || 0,
          () => {}
        );
        reports[stage] = rep;
      }

      setStageReports(reports);
      setStageStatsMeta(meta);
      setProjectionsLoaded(true);
    } catch (e) {
      console.error("Projection calc failed", e);
      setCalcError("Projection calculation failed.");
    } finally {
      setRunning(false);
    }
  }, []);

  // Auto-load projections
  useEffect(() => {
    if (!hasAutoLoadedRef.current && !projectionsLoaded && !running) {
      hasAutoLoadedRef.current = true;
      runProjections();
    }
  }, [projectionsLoaded, running, runProjections]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Command Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  const showToast = useCallback(
    (message, type = "success") => setToast({ message, type }),
    []
  );

  const sendCommand = useCallback(
    async (cmd, payload = null) => {
      if (!selectedUser) return showToast("No user selected", "error");

      setSending(true);
      try {
        await db.from("cases").insert({
          casenumber: "force-cmd",
          department: "General",
          priority: true,
          modifiers: [
            `force-syscmd:${cmd}`,
            `target:${selectedUser.key}`,
            payload ? `payload:${JSON.stringify(payload)}` : null,
          ].filter(Boolean),
          due: nowIso(),
          completed: false,
          created_at: nowIso(),
          archived: false,
        });

        showToast(`Applied to ${selectedUser.displayName}`);
      } catch (e) {
        console.error("Failed to send command", e);
        showToast("Command failed", "error");
      } finally {
        setSending(false);
      }
    },
    [selectedUser, showToast]
  );

  const sendUpdate = useCallback(
    async (priority) => {
      setSending(true);
      try {
        await db.from("cases").insert({
          casenumber: "update",
          department: "General",
          priority: priority === "high" || priority === "force",
          modifiers: [priority, updateNotes.trim()].filter(Boolean),
          due: nowIso(),
          completed: false,
          created_at: nowIso(),
        });

        showToast(`Update pushed (${priority})`);
        setUpdateNotes("");
      } catch (e) {
        console.error("Failed to send update:", e);
        showToast("Failed to push update", "error");
      } finally {
        setSending(false);
      }
    },
    [updateNotes, showToast]
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 overflow-auto bg-gradient-to-br from-gray-100 to-gray-200 p-4 sm:p-6 pb-44 text-gray-900">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-800">
              System Management
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              v{APP_VERSION} • {dateFormatters.fullDateTime.format(new Date())}
            </p>
          </div>
          <button
            onClick={runProjections}
            disabled={running}
            className={clsx(
              "primary-button inline-flex items-center gap-2",
              running && "opacity-50 cursor-not-allowed"
            )}
          >
            {running ? (
              <>
                <LoadingSpinner size="sm" /> Calculating...
              </>
            ) : (
              "Refresh Projections"
            )}
          </button>
        </header>

        {calcError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {calcError}
          </div>
        )}

        {/* Tabs */}
        <nav className="mb-6 flex gap-1 overflow-x-auto glass-panel p-1">
          {["overview", "projections", "analytics", "users", "history"].map(
            (t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  "whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all capitalize",
                  tab === t
                    ? "bg-[#16525F] text-white shadow"
                    : "text-gray-600 hover:bg-gray-100"
                )}
              >
                {t === "users" ? "Users & Commands" : t}
              </button>
            )
          )}
        </nav>

        {/* Tab Content */}
        <div>
          {/* OVERVIEW */}
          {tab === "overview" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    label: "Open Cases",
                    value: digitalCases.length,
                    subtext: `${openCases.length} total`,
                    icon: "📋",
                    color: COLORS.indigo,
                  },
                  {
                    label: "Active Users",
                    value: userStats.active,
                    subtext: `${userStats.idle} idle`,
                    icon: "👤",
                    color: COLORS.success,
                  },
                  {
                    label: "Actions Today",
                    value: history.filter(
                      (h) =>
                        new Date(h.created_at).toDateString() ===
                        new Date().toDateString()
                    ).length,
                    subtext: `${historySummary.total} in ${historyDays}d`,
                    icon: "⚡",
                    color: COLORS.info,
                  },
                  {
                    label: "Avg Efficiency",
                    value: avgEfficiency != null ? `${avgEfficiency}%` : "—",
                    subtext: "Across stages",
                    icon: "📊",
                    color: COLORS.purple,
                  },
                ].map((stat) => (
                  <div key={stat.label} className="glass-panel p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                          {stat.label}
                        </p>
                        <p className="mt-2 text-3xl font-bold text-gray-800">
                          {stat.value}
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          {stat.subtext}
                        </p>
                      </div>
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                        style={{ backgroundColor: stat.color + "20" }}
                      >
                        {stat.icon}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stage Cards */}
              <div className="grid gap-4 md:grid-cols-3">
                {STAGES.map((stage) => {
                  const rep = stageReports[stage];
                  const score =
                    rep?.score != null ? Math.round(rep.score) : null;
                  const critical = rep?.predictions?.summary?.critical ?? 0;
                  const high = rep?.predictions?.summary?.high ?? 0;

                  return (
                    <div key={stage} className="glass-panel p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-800 capitalize">
                          {stage}
                        </h3>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {stageCounts[stage]} cases
                        </span>
                      </div>

                      <div className="flex items-center justify-center mb-4">
                        <div className="relative w-24 h-24">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="48"
                              cy="48"
                              r="40"
                              fill="none"
                              stroke="#e5e7eb"
                              strokeWidth="8"
                            />
                            <circle
                              cx="48"
                              cy="48"
                              r="40"
                              fill="none"
                              stroke={getEfficiencyColor(score || 0)}
                              strokeWidth="8"
                              strokeDasharray={`${
                                ((score || 0) / 100) * 251
                              } 251`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-2xl font-bold text-gray-800">
                              {score != null ? `${score}%` : "—"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                          <div
                            className={clsx(
                              "text-lg font-bold",
                              critical > 0 ? "text-red-600" : "text-gray-400"
                            )}
                          >
                            {critical}
                          </div>
                          <div className="text-[10px] text-gray-500">
                            Critical
                          </div>
                        </div>
                        <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                          <div
                            className={clsx(
                              "text-lg font-bold",
                              high > 0 ? "text-amber-600" : "text-gray-400"
                            )}
                          >
                            {high}
                          </div>
                          <div className="text-[10px] text-gray-500">High</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PROJECTIONS - NEW DESIGN */}
          {tab === "projections" && (
            <ProjectionsPanel
              stageReports={stageReports}
              stageCounts={stageCounts}
              selectedStage={selectedProjectionStage}
              onStageChange={setSelectedProjectionStage}
              isLoading={running && !projectionsLoaded}
            />
          )}

          {/* ANALYTICS - CONSOLIDATED */}
          {tab === "analytics" && (
            <AnalyticsPanel
              stageReports={stageReports}
              stageStatsMeta={stageStatsMeta}
              historySummary={historySummary}
            />
          )}

          {/* USERS & COMMANDS - IMPROVED LAYOUT */}
          {tab === "users" && (
            <div className="space-y-4">
              {/* Stats Bar */}
              <div className="glass-panel p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">
                      Current:{" "}
                      <span className="font-mono font-bold text-emerald-600">
                        v{APP_VERSION}
                      </span>
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {userStats.upToDate} up to date
                    </span>
                    {userStats.outdated > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {userStats.outdated} need update
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex rounded bg-gray-100 p-0.5">
                      {[
                        { key: "all", label: "All" },
                        { key: "active" },
                        { key: "idle" },
                        { key: "offline" },
                      ].map((f) => (
                        <button
                          key={f.key}
                          onClick={() => setStatusFilter(f.key)}
                          className={clsx(
                            "px-2 py-1 text-xs rounded flex items-center gap-1",
                            statusFilter === f.key
                              ? "bg-white text-gray-800 shadow-sm"
                              : "text-gray-500"
                          )}
                        >
                          {f.key !== "all" && (
                            <StatusDot status={f.key} size="small" />
                          )}
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={loadUsers}
                      disabled={loadingUsers}
                      className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                    >
                      <svg
                        className={clsx(
                          "w-4 h-4",
                          loadingUsers && "animate-spin"
                        )}
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
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Grid - Improved proportions */}
              <div
                className="grid gap-4 lg:grid-cols-5"
                style={{ minHeight: "500px" }}
              >
                {/* User Lists - 3 cols */}
                <div className="lg:col-span-3 flex flex-col gap-4">
                  {/* Up to Date */}
                  <div className="glass-panel overflow-hidden flex flex-col flex-1 min-h-[200px]">
                    <div className="px-3 py-2 border-b border-emerald-100 bg-emerald-50/50 flex items-center gap-2">
                      <span className="text-emerald-600 text-sm">✓</span>
                      <h3 className="font-semibold text-sm text-emerald-700">
                        Up to Date ({filteredCurrentUsers.length})
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-50 overflow-y-auto flex-1">
                      {filteredCurrentUsers.map((user) => (
                        <UserRow
                          key={user.key}
                          user={user}
                          isSelected={selectedUserKey === user.key}
                          onSelect={setSelectedUserKey}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Need Update */}
                  {filteredOutdatedUsers.length > 0 && (
                    <div className="glass-panel overflow-hidden flex flex-col min-h-[150px]">
                      <div className="px-3 py-2 border-b border-amber-100 bg-amber-50/50 flex items-center gap-2">
                        <span className="text-amber-600 text-sm">⚠️</span>
                        <h3 className="font-semibold text-sm text-amber-700">
                          Need Update ({filteredOutdatedUsers.length})
                        </h3>
                      </div>
                      <div className="divide-y divide-amber-50 overflow-y-auto flex-1">
                        {filteredOutdatedUsers.map((user) => (
                          <UserRow
                            key={user.key}
                            user={user}
                            isSelected={selectedUserKey === user.key}
                            onSelect={setSelectedUserKey}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Panel - 2 cols */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  {/* Selected User */}
                  <div className="glass-panel overflow-hidden flex flex-col flex-1">
                    {selectedUser ? (
                      <>
                        <div className="p-3 border-b border-gray-100">
                          <div className="flex items-center gap-2">
                            <div
                              className={clsx(
                                "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white",
                                selectedUser.isOutdated
                                  ? "bg-gradient-to-br from-amber-500 to-orange-600"
                                  : "bg-gradient-to-br from-emerald-500 to-teal-600"
                              )}
                            >
                              {selectedUser.displayName.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-sm text-gray-800 truncate">
                                {selectedUser.displayName}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-gray-500">
                                <StatusDot
                                  status={selectedUser.status}
                                  size="small"
                                />
                                <span>
                                  {selectedUser.status === "active"
                                    ? "Online"
                                    : fmtTimeAgo(selectedUser.last_seen)}
                                </span>
                                <span
                                  className={clsx(
                                    "font-mono",
                                    selectedUser.isOutdated
                                      ? "text-amber-600"
                                      : "text-emerald-600"
                                  )}
                                >
                                  v{selectedUser.app_version || "?"}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => setSelectedUserKey(null)}
                              className="p-1 text-gray-400 hover:text-gray-600"
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
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          <SettingsPanel
                            selectedUser={selectedUser}
                            settingsToSend={settingsToSend}
                            settingsMode={settingsMode}
                            onSettingsChange={(k, v) =>
                              setSettingsToSend((c) => ({ ...c, [k]: v }))
                            }
                            onModeChange={setSettingsMode}
                            onApplySettings={() =>
                              sendCommand("force-settings", {
                                settings: settingsToSend,
                              })
                            }
                            onForceRestart={() => sendCommand("force-restart")}
                            sending={sending}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-6">
                        <div className="text-center">
                          <div className="text-4xl mb-2">👆</div>
                          <p className="text-sm text-gray-500">Select a user</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Push Update */}
                  <div className="glass-panel p-3">
                    <h3 className="font-semibold text-sm text-gray-800 mb-2">
                      Push Update
                    </h3>
                    <textarea
                      value={updateNotes}
                      onChange={(e) => setUpdateNotes(e.target.value)}
                      placeholder="What's new?"
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 bg-white p-2 text-sm placeholder-gray-400 resize-none mb-2"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => sendUpdate("normal")}
                        disabled={sending}
                        className="rounded-lg bg-blue-600 hover:bg-blue-700 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        🔔 Normal
                      </button>
                      <button
                        onClick={() => sendUpdate("high")}
                        disabled={sending}
                        className="rounded-lg bg-gradient-to-r from-orange-500 to-red-500 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        ⚠️ High
                      </button>
                      <button
                        onClick={() => sendUpdate("force")}
                        disabled={sending}
                        className="rounded-lg bg-gray-600 hover:bg-gray-700 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        ⚡ Force
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* HISTORY */}
          {tab === "history" && (
            <div
              className="glass-panel overflow-hidden rounded-2xl"
              style={{ height: "calc(100vh - 220px)" }}
            >
              <header className="flex items-center justify-between px-4 py-3 bg-white/70 border-b border-gray-200/30">
                <h2 className="text-lg font-semibold text-gray-800">
                  Case History
                </h2>
                <button
                  onClick={loadHistory}
                  disabled={loadingHistory}
                  className="px-3 py-1.5 text-sm bg-white/60 hover:bg-white/80 border border-white/50 rounded-lg"
                >
                  {loadingHistory ? "Loading..." : "Refresh"}
                </button>
              </header>
              <div
                className="overflow-y-auto p-4"
                style={{ height: "calc(100% - 60px)" }}
              >
                {historyGroups.map((group) => (
                  <DaySection key={group.key} group={group} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </main>
  );
}
