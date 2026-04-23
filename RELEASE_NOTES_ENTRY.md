# Release Notes: Modal Z-Index Consistency Fix

## What Got Fixed 🐛
- **The Efficiency Analysis modal (Digital/Metal/C&B) now layers cleanly above page chrome.** It had been pinned at `z-50`, which is the same tier Tailwind uses for sticky nav elements, so dropdowns and page overlays could bleed over the modal edges. Bumped to `z-[100]`.
- **The case-history drill-in now sits above the Case Risk view.** Opening a case's history from inside the risk modal used to send the history modal *behind* the risk modal (risk was at `z-[10001]`, history at `z-[300]`), which made it effectively invisible. CaseHistory is now at `z-[10100]` so it floats above any risk/analytics modal stack.
- **AllHistoryModal's backdrop + suspense loader moved to the same top tier.** Previously `z-[150]` / `z-[301]`, now `z-[10050]` / `z-[10101]` so it always sits above the risk view when triggered from it.

## For Developers 👨‍💻
- New layering scheme (from bottom to top):
  - Page content / editor / add-case: ≤ 60
  - Base modals (efficiency, archive): 100–300
  - OverdueNotifier: 260 (above editor, below top-tier drill-ins)
  - AllHistoryModal: 10050
  - CaseRiskModal: 10001
  - CaseRiskAnalyticsModal: 10002
  - CaseHistory: 10100 (always the topmost drill-in)
  - AllHistoryModal suspense loader: 10101
- Comment and number in `src/components/OverdueNotifier.jsx` updated to reflect new layering.
- No changes to `ArchiveModal` (its `z-[300]` is correct — it's a standalone top-level modal, never opened from inside another).
- Both audits remain at 100%: 1132/1132 flow, 171/171 context.
