# Release Notes: QA Kernel v4.2.2 — Case Lookup Pipeline Fix

## What Got Fixed 🐛
- **Case lookup now returns the correct row when a casenumber has been reused.** The `cases` table can have multiple rows with the same `casenumber` (e.g. an archived historical case from 2025 and a currently-active one from 2026). The old query used `.single()` with no tie-breaker, so it returned a stale archived row for questions about the active case. The lookup now pulls up to ten candidates and ranks them — active rows before completed, non-archived before archived, most-recent activity wins ties — so "look up case 1202" finds the live one.
- **The broken `[ACTION:History|]` literal no longer leaks into the chat bubble.** The History modal was being emitted as `[ACTION:History|[MODAL:HISTORY|...|...]]`. The UI's modal regex strips the inner `[MODAL:...]` first, which left an empty-command `[ACTION:History|]` that got rendered as raw text. The kernel now emits the history modal as a flat `[MODAL:HISTORY|id|casenumber]` tag appended after the response body, with the regular buttons kept separate.
- **Completed cases with no `completed_at` timestamp no longer punt with "no timestamp on record."** If the case is marked complete but has no completion timestamp, the response now infers lateness from the due date where possible and surfaces archive state ("marked completed and archived, was due 2 months ago") instead of dead-ending.
- **Active cases with a missing `data.id` don't emit the History modal tag at all**, which prevented the `undefined`-in-MODAL edge case from surfacing in the chat.

## For Developers 👨‍💻
- `DBKnowledge.caseByNumber` now returns up to 10 candidate rows and calls a new `DBKnowledge._rankCandidates(rows)` static to pick the best one. `_rankCandidates` is exported-on-the-class (not a module-level export) so tests can monkey-patch `caseByNumber` and delegate ranking to the real implementation.
- Three new regression conversations under `db_lookup` in the context audit:
  - Active-vs-archived duplicate dedup
  - No nested `[ACTION:[MODAL:]]` leakage
  - Flat `[MODAL:HISTORY|…]` emission only when we actually have an id
- New `matchesRaw(re, label)` audit helper that checks against the raw response text (including `[MODAL:…]`/`[ACTION:…]` tags) instead of the stripped body.
- Audit totals: **1132/1132** flow audit, **163/163** context audit.
