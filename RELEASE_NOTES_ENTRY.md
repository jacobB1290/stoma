# Release Notes: System Management Screen — Manager Command Center

## What's New ✨
- **Today's Snapshot** hero card on the System Management dashboard. Six live KPIs with trend deltas at a glance: cases done today (with 7-day sparkline and week-over-week %), pipeline efficiency, backlog ETA, due today, overdue, and total workload hours.
- **Projections tab** (new). Forecasts and outlook in one place:
  - **Throughput Forecast** — 14 days of past completions plus a 7-day linear projection of expected daily output.
  - **Backlog Outlook** — per-stage open count, average time per case, total work hours, and overall ETA to clear the queue at current pace.
  - **Due Date Forecast** — 14-day stacked histogram of upcoming due dates with rush/hold breakdown and overdue badge.
  - **Case Age Distribution** — open cases bucketed by how long they've been in the pipeline (<1d, 1–3d, 3–7d, 7–14d, 14d+) with an "aging" badge when too many are old.
  - **Risk Outlook** — overall risk distribution with critical/high/medium/low percentages.
- **Needs Attention panel** on the dashboard. Auto-detected anomalies a manager should look at right now: stalled cases (>2× stage median), severely overdue (>3 days), overdue + on hold, throughput drops, stages with high risk concentration, and stages with low data quality. Expand each flag to see the specific case numbers.
- **Sparklines** on every Pipeline Overview card showing 7-day inflow trend per stage.
- **Tab badges** showing counts of items needing attention next to each tab name (critical risk + overdue on Dashboard, bottleneck stages on Performance, severely-overdue on Projections, outdated clients on Control).

## What Got Fixed 🐛
- **Cases due today no longer appear as "overdue"** during morning hours. The status counters now compare calendar days in the configured timezone (America/Boise) instead of UTC strings, eliminating an off-by-one window that would mis-categorise cases when local time and UTC date diverge.
- **Cases due tomorrow no longer appear as "due today"** during late-evening hours — same root cause, same fix.
- **QC cases are no longer invisible.** Cases in the Quality Control review state were silently dropped from the Pipeline Overview because the stages list excluded `qc`. They now show as a `+N QC` sub-badge on the Finishing card so managers can see the inspection backlog.
- **TeamActivity "last action" labels now show.** The dashboard's team panel was looking up history entries by display name but storing them by raw user name, so the "last action" caption almost never matched. Both sides now key by the canonical normalized name.
- **Activity Feed correctly names multi-word stages.** "Moved from Finishing to Quality Control" was being truncated to "moved to Quality"; it now reads "moved to Quality Control".

## For Users 👤
- Open the System Management Screen. The new **Today's Snapshot** card at the top gives you the day's headline metrics without scrolling. Anything urgent shows up as a red badge on the relevant tab.
- The new **Projections** tab is where to look for "what's coming" — upcoming due dates, expected throughput, and how long the current backlog will take.
- The **Needs Attention** card on the dashboard surfaces problems automatically — click any flag to see the affected case numbers.

## For Admins 👨‍💼
- All existing controls (push update, force restart, settings broadcast, front-office roster) remain on the **Control** tab — unchanged.
- The Refresh Stats button has been moved into a compact secondary bar above the tabs to free up vertical space for content.

## For Developers 👨‍💻
- New shared `Sparkline` and `TrendArrow` components in `src/components/system-management/Sparkline.jsx`.
- New panels: `TodaysSnapshot.jsx`, `AnomaliesPanel.jsx`, `ProjectionsTab.jsx`.
- New helpers in `system-management/constants.js`: `todayKey()`, `dueDayKey()`, `isOverdueRow()`, `isDueTodayRow()`, `stageOfCaseRollup()`, `buildCompletionBuckets()`, `buildStageMoveBuckets()`. The first four replace ad-hoc UTC-string date comparisons across the screen.
- All anomaly detection runs client-side over already-loaded `cases` and `case_history` data — no new database calls.
- Bundle size impact: +7.2 KB gzipped.
