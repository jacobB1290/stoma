# Release Notes: Today's Missed Cases Inline on Front-Office Pill

## What's New ✨
- The "% missed" pill in the header now **expands itself** to show today's missed case numbers inline whenever there are any. No click required, no separate panel — the pill is one continuous shape.
- Each morning the inline list resets. If nothing's been missed today, the pill stays in its compact form.

## For Users 👤
- The pill grows wider when production/staff logged a case instead of front office today, e.g. `▏▎▍ 5% missed │ 1120 · 1140`.
- **Hover** the pill → full monthly detail tooltip (unchanged).
- Click does not trigger any popover — it's reserved for navigation.

## For Developers 👨‍💻
- `src/components/FrontOfficeBubble.jsx`: removed the click-to-morph dropdown panel entirely. Today's case numbers now render as inline children of the pill's `<motion.div>`, gated by `todayMissed.length > 0`, with a Framer `layout` spring animating the pill's width as items enter/exit.
