# Release Notes: Model-Grounded Risk Signals in the Case Risk Modal

## What's New ✨
- The **Risk Signals → Why** panel in the Case Risk modal now explains *why* a case is at risk using the case's actual data, not generic phrases.
- Each signal shows three things: a clear **headline**, a **plain-English sentence** that quotes the real numbers behind it, and a **model-derived strength reading** showing how many percentage points (`+8 pp`, `−3 pp`) that signal shifted this case's late probability.
- The strength is now computed by attributing the live XGBoost classifier's prediction back to its input features (path-dependent attribution, the same family of techniques as TreeSHAP). Signals that *reduce* late risk (e.g. fast pickup, lots of recent activity) appear in green; signals that *raise* it appear in the case's risk color.
- Signals are ordered by absolute model impact — the factor the model itself weighed most heavily on this case is at the top.

## What Got Fixed 🐛
- The old "intensity" percentage was a hand-rolled normalization that looked like a model output but wasn't. It's been replaced with a number that genuinely comes from the model: the per-feature change in late probability for this exact case.
- Old "why" entries like `"inactive 18h+"` gave a label without a number. The new copy reads like `"Inactive for 26h — no activity recorded in the last 26h."` plus the model's verdict on how much that contributed.

## For Users 👤
- Open any case and click **Case Risk → Signals**. Each card in the "Why" column now ends with a `±N pp` figure showing how much that signal moved this case's late probability, with a bar sized to its relative weight among the signals shown.
- A short footnote under the cards explains where the numbers come from.
- Board chips and the front-office surface still use the same plain-text headlines — only the modal got the new attribution.

## For Developers 👨‍💻
- New `computeFeatureContributions()` in `src/utils/caseRiskPredictions.js` — path-dependent (Saabas-style) attribution against the loaded XGBoost late-classifier. Verified to satisfy the additivity invariant `Σ contributions == actual_logit − baseline_logit` exactly.
- The exported model JSON does not carry per-node `cover`, so leaf weighting in the conditional expectations is uniform. This is biased toward features near the root vs. exact TreeSHAP, but per-feature signs and relative ordering are correct. If/when the model is re-exported with cover, swap `precomputeTreeNodeStats()` to weight by cover and the rest is unchanged.
- Per-feature log-odds contributions are converted to probability deltas via leave-one-out ablation through the existing isotonic calibration curve, so `pp` numbers in the UI are in the same units as the case's headline late probability.
- Each entry in `RISK_SIGNAL_REGISTRY` now declares a `featureKeys: string[]` listing the model features whose attributions roll up into that signal. To add or tune a signal, edit only the registry.
- Predictions now expose `prediction.featureContributions = { shapLogOdds, probDeltas }` plus the existing `riskSignals` and `riskReasons`.
