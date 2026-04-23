# Release Notes: QA Engine Kernel v4.0

## What's New ✨
- Replaced the QA engine with the new `AppQAKernel` v4.0 — concept-based routing with lemmatization and synonym expansion instead of substring matching
- Hard `requires` gates per component eliminate noisy competing matches
- Softmax-normalized confidence scoring with ambiguity detection, so unclear questions trigger a clarification prompt instead of a wrong answer
- Conversation follow-ups ("why?", "and?", "tell me more") now route back to the last component and preserve entities across turns
- Response button rotation: the same CTA won't repeat two responses in a row

## What Got Fixed 🐛
- Entity extractor no longer mistakes timeframe numbers ("last 30 days") for case numbers
- `quickStats()` now reads the Supabase `count` field instead of `data.length`
- One centralized no-data fallback instead of eight copies scattered throughout
- Responses trimmed roughly 50% with glanceable numbers first

## For Developers 👨‍💻
- `src/qa/QAEngine.js` removed; new implementation lives at `src/qa/AppQAKernel.js`
- Board.jsx import updated to `../qa/AppQAKernel`; the default export `askSystem(question, context)` signature is unchanged
- Stage modifier strings moved to `CONFIG.STAGE_MODIFIERS`
- Dead multi-component orchestration code removed
