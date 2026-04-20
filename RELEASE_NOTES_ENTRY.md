# Release Notes: Case Risk Prediction System v9

## What's New ✨
- Upgraded ML model to XGBoost v9 — adds 23 cross-case context features so predictions now account for lab-wide load, per-stage queue depth, and recent throughput trends
- Case Risk modal redesigned to match the system's visual theme — glass effects, CSS theme variables, and consistent rounded corners across all three themes

## What Got Fixed 🐛
- Risk modal now shows the same cases as the board — brand-new cases with no stage history were previously missing from risk predictions
- Archived cases and internal broadcast rows no longer appear in risk predictions

## For Users 👤
- Predictions adapt to how busy the whole lab is, not just the individual case
- Risk modal case count matches what you see on the board for that stage
- Consistent look across white, pink, and dark themes
