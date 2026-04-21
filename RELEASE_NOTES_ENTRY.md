# Release Notes: Case Risk Prediction System v10

## What's New ✨
- Upgraded ML model to XGBoost v10 — same 131 features as v9 but with a critical training fix: 6 cross-case context features that were silently zero-valued during v9 training are now correctly backfilled, restoring the train/inference contract
- Late-risk classifier now uses whole-case overrun as the label (previously used a snapshot-dependent measure that caused mid-stage accuracy to collapse)
- Recency weighting tightened from 90-day to 45-day window to track workflow drift faster

## What Got Fixed 🐛
- Late classifier AUC for Design stage improved from 0.28 (worse than random) to 0.79
- Late classifier AUC for Production stage improved from 0.28 to 0.99
- Stage-exit time prediction accuracy improved ~20% (MAE 4.27h → 3.43h)
- Stage-exit close@1h|15% hit rate doubled: 31.9% → 57.7%

## For Users 👤
- Risk levels and timing estimates are meaningfully more accurate — especially for cases mid-way through Design or Production
- Late-risk flags are now reliable across all stages, not just at case start
