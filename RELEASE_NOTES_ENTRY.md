# Release Notes: Morning Dropdown on Front-Office Pill

## What's New ✨
- The "% missed" pill in the header now morphs into a small daily dropdown when clicked, showing the case numbers entered today by non–front-office staff.
- The dropdown is visually unified with the pill — clicking flattens the pill's bottom corners and extrudes a connected panel below.
- Daily reset: each morning the list shows only what was added that day. If nothing's been missed today, you'll see "Nothing missed today."

## For Users 👤
- **Hover** the pill → full monthly detail tooltip (unchanged).
- **Click** the pill → quick "Today" list of cases that production/staff logged instead of front office.
- Click any case in the list to jump to its case history.
- Click outside or click the pill again to collapse it.

## For Developers 👨‍💻
- `src/components/FrontOfficeBubble.jsx`: replaced the click-to-pin-tooltip behavior with a `morphed` state that animates the pill's bottom corners square and renders a connected `<motion.div>` panel below. Today's misses are derived in a `useMemo` filtered against a local-time `00:00` boundary off `stats.missedCases`. The detailed hover tooltip is suppressed while morphed.
