# Release Notes

## What Got Fixed 🐛
- Fixed a bug where the case modal showed a different forecast verdict than the Efficiency screen for the same case.
- Fixed a bug where opening the case history modal could briefly freeze the page.
- Fixed a bug where the "Details" button on the forecast strip opened two stacked modals that had to be closed one by one.

## What's New ✨
- Added a small **Risk Forecast** strip inside the case modal that shows the verdict at a glance and opens the full risk modal on click. Shows on Digital and General cases (the only departments the model was trained on).
- The strip pulls from the same prediction the Efficiency screen uses, so both surfaces always agree.

## For Users 👤
- Opening a case modal is instant; the forecast strip briefly says "Calculating…" while it loads in the background, then flips to the verdict.
- The **Performance / Lite Mode** toggle in Settings is now saved per device. Turning it on for one computer no longer carries over when you sign in elsewhere.
