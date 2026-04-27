# Release Notes: Front-Office Pill + Case Risk Modal Polish

## What's New ✨
- **Front-office pill** now expands itself inline to show today's missed case numbers whenever there are any. No click required, no separate panel — the pill is one continuous shape that grows and shrinks as the day progresses. Resets each morning.
- **Case risk modal** is now sized to the screen, like every other modal in the app. The header (case number, recommendation, tabs) and footer stay locked in place; the tab content scrolls inside.

## What Got Fixed 🐛
- Case risk analytics modal used to scroll the **entire** modal as one giant element, pushing the close button and tabs off-screen. It now caps at 90vh and the body scrolls independently.
- Front-office pill tooltip could re-pop after fading out if the cursor lingered near where it used to be. Hover model fixed: only the pill itself opens the tooltip; the tooltip card can keep an open tooltip alive but cannot resurrect a closing one.

## For Users 👤
- **Pill** grows wider when production/staff logged a case instead of front office today (e.g. `▏▎▍ 5% missed │ 1120 · 1140`). Hover for the full monthly detail tooltip; click is reserved for navigation.
- **Case risk modal** scroll behaves like the other modals — header and footer pinned, content scrolls in the middle.

## For Developers 👨‍💻
- `src/components/FrontOfficeBubble.jsx`: today's case numbers render as inline children of the pill's `<motion.div>`, gated by `todayMissed.length > 0`, with a Framer `layout` spring animating width on enter/exit. Hover handlers split into pill-only (opens) vs. tooltip-only (preserves open). Tooltip drops `pointerEvents` to `none` while `!isOpen`.
- `src/utils/caseRiskPredictions.js` (`CaseRiskAnalyticsModal`): outer wrapper switched from `items-start … overflow-y-auto p-6` to `items-center … p-4`; container now `max-h-[90vh] flex flex-col overflow-hidden`; header/footer `flex-shrink-0`; body is `flex-1 overflow-y-auto min-h-0`. Same pattern as `CaseManagementModal` and `EfficiencyModalUI`.
