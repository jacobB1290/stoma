# Release Notes: Smarter Risk Signals in the Case Risk Modal

## What's New ✨
- The **Risk Signals → Why** panel in the Case Risk modal now explains *why* a case is at risk using the case's actual data, not generic phrases.
- Each signal shows three things: a clear **headline**, a **plain-English sentence** that quotes the real numbers behind it (hours on hold, concurrent caseload, % of budget used, etc.), and an **intensity bar** so you can tell at a glance which signals are firing the hardest.
- Signals are now **ordered by strength** — the most consequential factor for *this* case is at the top, not just whichever rule appears first in the code.

## What Got Fixed 🐛
- Old "why" entries like `"inactive 18h+"` or `"tight batch intake"` gave you a label but no number to back it up. The new copy reads like `"Inactive for 26h — no activity recorded on the case in the last 26h."`
- Risk explanations sometimes felt arbitrary because the cutoffs lived inline next to the wording. They're now consolidated in a single signal registry, so what you see in the modal stays in lock-step with the underlying feature values that the model is actually scoring.

## For Users 👤
- Open any case and click **Case Risk → Signals**. The right-hand "Why" column will now show full sentences with the real numbers, plus a small bar showing how strongly each signal fired (longer bar = stronger contribution).
- The board chips that summarize a case's top risk reasons are unchanged — they still show the short headline.

## For Developers 👨‍💻
- New `RISK_SIGNAL_REGISTRY` and `buildRiskSignals()` helper in `src/utils/caseRiskPredictions.js`. Each entry binds a feature (or feature combination) to `{ activate, intensity, format }`.
- Predictions now expose a structured `prediction.riskSignals: { key, label, detail, intensity }[]` alongside the existing flat `prediction.riskReasons: string[]` (kept for backwards compatibility with the board view in `SystemManagementScreen.jsx`).
- The `RiskFactors` component prefers `riskSignals` when present and falls back to `riskReasons` otherwise.
- To add or tune a signal, edit only the registry — no changes needed in the prediction loop or the modal.
