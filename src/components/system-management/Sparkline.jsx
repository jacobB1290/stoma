// ─────────────────────────────────────────────────────────────────────────────
// Sparkline — small inline SVG line/area chart for trend visualization
// ─────────────────────────────────────────────────────────────────────────────

import React, { memo, useMemo } from "react";

export const Sparkline = memo(function Sparkline({
  data = [],
  color = "#16525F",
  width = 80,
  height = 24,
  fill = true,
  showDot = true,
  strokeWidth = 1.5,
  baseline = null,
}) {
  const { path, areaPath, dotX, dotY, ymin, ymax } = useMemo(() => {
    if (!data || data.length < 2) return { path: "", areaPath: "", dotX: 0, dotY: 0, ymin: 0, ymax: 0 };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = width / (data.length - 1);
    const pad = 2;
    const innerH = height - pad * 2;
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = pad + innerH - ((v - min) / range) * innerH;
      return [x, y];
    });
    const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `${path} L${(width).toFixed(1)},${height} L0,${height} Z`;
    const last = points[points.length - 1];
    return { path, areaPath, dotX: last[0], dotY: last[1], ymin: min, ymax: max };
  }, [data, width, height]);

  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="block">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2}
          stroke="#e5e7eb" strokeWidth="1" strokeDasharray="2 2" />
      </svg>
    );
  }

  const gradId = `spark-grad-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg width={width} height={height} className="block" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {baseline != null && ymax > 0 && (
        <line
          x1="0" x2={width}
          y1={2 + (height - 4) - ((baseline - ymin) / Math.max(1, ymax - ymin)) * (height - 4)}
          y2={2 + (height - 4) - ((baseline - ymin) / Math.max(1, ymax - ymin)) * (height - 4)}
          stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 2"
        />
      )}
      {fill && <path d={areaPath} fill={`url(#${gradId})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round" />
      {showDot && (
        <>
          <circle cx={dotX} cy={dotY} r="3" fill="white" stroke={color} strokeWidth={strokeWidth} />
        </>
      )}
    </svg>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TrendArrow — small directional arrow with delta label
// ─────────────────────────────────────────────────────────────────────────────

export const TrendArrow = memo(function TrendArrow({ delta, suffix = "", invertColor = false, neutralThreshold = 0 }) {
  if (delta == null || Number.isNaN(delta)) return null;
  const abs = Math.abs(delta);
  const isUp = delta > neutralThreshold;
  const isDown = delta < -neutralThreshold;
  const isFlat = !isUp && !isDown;
  const goodIsUp = !invertColor;
  const tone = isFlat ? "text-gray-400" : (isUp === goodIsUp ? "text-emerald-600" : "text-rose-600");
  const arrow = isFlat ? "→" : isUp ? "↑" : "↓";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${tone}`}>
      <span aria-hidden>{arrow}</span>
      <span>{sign}{abs % 1 === 0 ? abs : abs.toFixed(1)}{suffix}</span>
    </span>
  );
});
