# Release Notes: QA Kernel v4.1 — Conversational Flow + Capability Expansion

## What's New ✨
- The in-app Q&A engine now sounds substantially more like a colleague and less like a bullet-point machine — replies use varied openers, natural connective tissue ("looking at this", "the thing I'd jump on first", "honestly"), and prose context around the numbers instead of stiff KV tables
- Five new capability areas the kernel previously couldn't answer:
  - **Case-type comparison** — "compare BBS vs Flex throughput", "which case type takes longest?"
  - **Buffer compliance** — "are we meeting our design and production buffers?", "buffer violations?"
  - **Rush analysis** — "how many rush cases are open and is it hurting our score?"
  - **Late-case detail** — "list every case that completed late", "is there a pattern in the late cases?"
  - **Data-quality / confidence** — "how reliable is the score given our sample size?"
- Per-component variation rotation so the same opener never repeats across responses, even when the same component handles multiple questions in a session
- Routing fix: "fix", "solve", "address", "tackle", "resolve" now route to the improvement advisor instead of being treated as out-of-scope

## What Got Fixed 🐛
- Out-of-scope deflections now offer varied pivots ("What I can offer:", "If you want, I can flip to something useful:") instead of repeating one canned line
- Bullet-heavy responses now close with a prose sentence so they read as complete thoughts rather than trailing lists
- Score breakdowns explain the math in sentences rather than dumping a labeled column

## For Users 👤
- Asking the same kind of question twice in a session produces freshly worded answers
- Domain-specific questions (BBS, Flex, buffers, rush, sample size) get domain-specific answers — not generic deflections
- Multi-turn conversations preserve context: ask "what's wrong?" then "how do I fix it?" and the second question is treated as a follow-up to the first

## For Developers 👨‍💻
- New `vary(ctx, options, bucket)` helper for deterministic per-component variation rotation
- New components: `case_type_comparator`, `buffer_compliance`, `rush_handler`, `late_case_detail`, `data_quality`
- New concepts in the routing map: `TYPE_COMPARE`, `CASE_TYPE`, `BUFFER`, `RUSH`, `QUALITY`, `BREAKDOWN`
- Test harness lives at `test-harness/` — run with `node --import ./test-harness/register.mjs ./test-harness/run-audit.mjs` (no installed deps required, uses local stubs for `@supabase/supabase-js` and `uuid`)
- Audit battery covers 77 prompts across NORMAL / HARD / GAP / OUT / FOLLOWUP categories, scored on word count, prose vs bullets, connective tissue, opener variation, sentence completeness, and domain relevance
- Final audit score: **1132/1132 (100%)** across all categories, up from 76.2% baseline
