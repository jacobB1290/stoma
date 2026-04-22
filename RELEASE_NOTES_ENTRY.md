# Release Notes: Case Risk Prediction System v10.4

## What's New ✨
- Case-state resolver reconciles the two risk signals (classifier and duration model) before showing a result — per-stage calibration cutoffs, median-centered ETAs, and asymmetric uncertainty bands all come from audit data
- Three-branch display logic:
  - **Agreement** (both models agree): single confident call, normal band
  - **False alarm** (duration model cries wolf, classifier says fine): green "On track" with inline explainer showing why it's not actually risky
  - **Weak alert** (classifier flags risk, duration model disagrees): amber "At risk · weak" tag with low-confidence label and asymmetric -6h to +15h band
- Low-confidence states are now labeled honestly as "weak alert" instead of being shown at full severity

## What Got Fixed 🐛
- Production stage classifier calibration fixed: cutoff raised from 0.25 to 0.40 based on audit data (Production predicted 28% late, actual 6.5% late in that range)
- Design stage keeps 0.25 cutoff where it's calibrated, Finishing uses global 0.30 knee
- ETA optimism correction changed from mean (11.4h, tail-dragged) to median (0h on alert branch, 1.7h elsewhere) — matches the audit data instead of overcorrecting the ~25% of cases where the quantile already runs pessimistic
- Uncertainty band is now asymmetric on the weak-alert branch (-6h / +15h) to reflect the skew of the actual error distribution

## For Users 👤
- Risk modal now shows *why* each case is flagged — not just whether
- Cases where only the quantile model is worried get a clear "false alarm" note so you know not to escalate them
- Cases with weak-alert status carry a visible "Low confidence" tag and historical late rate (11%) — treat as a signal, not a certainty
- Done-by time is now bias-corrected and should match actual completion more closely on agreement cases (where most cases live)

## For Developers 👨‍💻
- New export: `resolveCaseState(inputs)` returns branch, stateCall, stateConfidence, bias-corrected etaHours, asymmetric etaBand, and explainer strings
- Branch distribution is logged once per render as `[v10.4 resolver branches]` — expected ratios: ~90% agreement, ~8% false_alarm, ~2% classifier_alert; drift from this indicates upstream changes that warrant a re-audit
- All constants derived from audits on 1,955 snapshots; retune `ALERT_BAND_LOW_H` / `ALERT_BAND_HIGH_H` when the n=18 classifier-alert sample grows
