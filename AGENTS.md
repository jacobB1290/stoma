# AGENTS.md — Automation Rules for AI Contributors

This file is the operational contract for Codex/Claude in this repository.

## Goal
Keep the **version number, changelog, and in-app update notifier fully automated**.

## Release Automation (source of truth)
1. `package.json` `version` is the only source of app version.
2. `src/version.js` exports `APP_VERSION` from `package.json`.
3. Build must generate release metadata via:
   - `scripts/generate-changelog.mjs`
   - outputs: `public/version.json` and `public/changelog.json`
4. Runtime update checks must use `src/services/versionCheckService.js` polling `/version.json`.
5. Existing UI notification system remains event-driven via `update-available` event.

## Standard vs Urgent updates
- `standard` release priority => notifier priority `normal`
- `urgent` release priority => notifier priority `high`
- `force` should be reserved for exceptional break/fix scenarios only

Mapping implementation lives in `src/services/versionCheckService.js` (`mapPriority`).

## Version bump rules (semantic versioning)
- `BREAKING` in commit subject => `major`
- `feat` / `feature` / `new` subject => `minor`
- all other commits => `patch`

Implemented by `.github/workflows/version-bump.yml`.

## AI workflow requirements (Codex/Claude)
When making any release-affecting change:
1. Keep version reads through `src/version.js` (do not hardcode versions in components).
2. If metadata schema changes, update both generator and polling consumer.
3. Regenerate metadata locally when needed:
   - `node scripts/generate-changelog.mjs`
4. Validate app still builds:
   - `npm run build`
5. If changing release policy, update both `AGENTS.md` and `CLAUDE.md` in same PR.

## Do not do
- Do not reintroduce hardcoded `APP_VERSION` constants in feature files.
- Do not bypass generated metadata by manually editing runtime-only values.
- Do not disable update polling without replacing it with an equivalent automated mechanism.

## Quick checklist before PR
- [ ] Version source still `package.json`
- [ ] `src/version.js` still canonical app version export
- [ ] `scripts/generate-changelog.mjs` still writes both metadata files
- [ ] `src/services/versionCheckService.js` still dispatches `update-available`
- [ ] `.github/workflows/version-bump.yml` still enforces semver bump logic
