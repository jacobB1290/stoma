# Release Notes: QA Kernel v4.2.1 — Case Lookup Fix

## What Got Fixed 🐛
- **Case status no longer reads "completed 12/31/1969"** for completed cases. The `cases.completed` column is a boolean flag, but the kernel was passing it to `new Date()` as if it were a timestamp — `new Date(true)` produces 12/31/1969. The kernel now uses `completed_at` for the actual completion timestamp and falls back gracefully when it's missing ("marked completed (no completion timestamp on record)").
- **Active cases no longer mistakenly show as completed**. A short-lived earlier fix used `updated_at` as a fallback, which was wrong — `updated_at` is just last-edit time. Active cases now correctly show their due-date status (overdue, due today, in production, etc.).
- **The History button no longer renders as an empty `[ACTION:History|]` glyph** when the case row is missing an `id`. The button is now skipped entirely in that situation rather than emitting an invalid `[MODAL:HISTORY|undefined|undefined]` that the UI parser strips, leaving an empty action.

## For Developers 👨‍💻
- Three new regression tests in `test-harness/run-context-audit.mjs` under the `db_lookup` tag covering: completed case with boolean flag, missing-id History button, and active case status rendering. The harness monkey-patches `DBKnowledge.caseByNumber` with realistic Supabase row shapes so these tests run without hitting the network.
- Final audit scores: **1132/1132** conversational flow, **156/156** context (now including DB lookup regressions).
