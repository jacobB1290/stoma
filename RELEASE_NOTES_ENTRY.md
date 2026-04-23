# Release Notes: QA Kernel v4.2.3 — Timezone-Safe Due Dates

## What Got Fixed 🐛
- **Due dates no longer display the wrong calendar day for users in negative-offset timezones.** When the `cases.due` column holds a plain date string like `"2026-04-23"`, JavaScript's `new Date("2026-04-23")` parses it as midnight UTC. A user in MST (UTC-7) or anywhere else west of UTC would then see `.toLocaleDateString()` render as "4/22/2026" — a full calendar day earlier than what was entered. The kernel now detects plain-date values, pulls the YYYY-MM-DD parts directly, and renders the calendar day without any timezone shift.
- **The false "overdue" flag is gone.** Because midnight-UTC was being treated as the deadline, a case due Apr 23 would look overdue to anyone in a western timezone for 7+ hours after the real end-of-day. The kernel now treats plain-date due values as end-of-day-local, so a case stays "due today" until local midnight and only flips to "overdue" after that.
- Full ISO timestamp due values (e.g. `"2026-05-10T16:00:00Z"`) continue to render in the viewer's local timezone — that's correct for timestamped deadlines, where the author actually intended a specific wall-clock moment.

## For Developers 👨‍💻
- New `U.parseDueDate(value)` returns `{ calendarDay, deadlineTs, isPlainDate }`. All due-date logic in the case lookup now goes through it — both the display line and the overdue/due-today math.
- New `U.formatDueDate(value)` convenience wrapper returns just the display string.
- Three new regression tests in the context audit under `db_lookup`:
  - Plain date `"2026-04-23"` renders as `4/23/2026`, never `4/22/2026`
  - A case due today-local is NOT marked overdue in the afternoon
  - Full ISO timestamps render a plausible local-TZ date (May 9–11 range acceptable, accounting for UTC-12 to UTC+14 extremes)
- Test harness now runs clean under America/Denver, America/Los_Angeles, America/New_York, UTC, Europe/London, Asia/Tokyo, and Pacific/Auckland. Run via `TZ=<zone> node --import ./test-harness/register.mjs ./test-harness/run-context-audit.mjs`.
- Audit totals: **1132/1132** flow audit, **171/171** context audit (across 7 timezones).
