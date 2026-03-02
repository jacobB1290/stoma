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
   - these files are **not committed** (listed in `.gitignore`); Vercel generates them fresh on every build
4. Runtime update checks must use `src/services/versionCheckService.js` polling `/version.json`.
5. Existing UI notification system remains event-driven via `update-available` event.

## End-to-end release flow

```
PR merged to main (use squash-and-merge so the commit subject = PR title)
  → GitHub Action (version-bump.yml) runs
    → collects all non-merge commit subjects in the push range
    → determines bump type (major / minor / patch)
    → npm version <bump> --no-git-tag-version
    → git commit package.json package-lock.json  [skip ci]
    → git tag v<new-version>
    → git push origin HEAD:main
    → git push origin v<new-version>
  → Vercel detects the bump commit and builds
    → generate-changelog.mjs unshallows the clone, then reads git history
    → writes public/version.json + public/changelog.json
    → CRA build bakes APP_VERSION from package.json into the JS bundle
  → users with old sessions detect version mismatch → update-available event fires
```

## One-time setup requirements (repo owner must do these)

| Requirement | Where |
|---|---|
| `GH_PAT` secret with `repo` (or `contents: write`) scope | GitHub → Settings → Secrets and variables → Actions |
| Squash-and-merge enabled | GitHub → Settings → General → Merge button |

Without `GH_PAT`, the Action's `git push` will fail and the version will never bump.
Without squash-and-merge, merge commit subjects ("Merge pull request #N…") never match `feat:` or `BREAKING`, so every release is a patch regardless of actual content.

## How to use the update notifier system

### Controlling version bump + notifier via commit messages

Set the PR title (squash-and-merge commit subject) deliberately:

| Intent | Commit/PR title pattern | Result |
|---|---|---|
| Bug fix, small change | Anything not matching below | `patch` bump, `normal` notifier |
| New feature | Starts with `feat:`, `feat(`, `feature:`, `feature(`, `new:`, or `new(` | `minor` bump, `normal` notifier |
| Breaking change | Contains `BREAKING` | `major` bump, `normal` notifier |
| Urgent fix (any bump type) | Contains `urgent`, `hotfix`, `critical`, or `security` | same bump type + `high` notifier (flashing alert) |

Examples:
```
fix: correct rush case sorting              → 11.0.1, normal notifier
feat: add weekly efficiency export          → 11.1.0, normal notifier
fix: critical null pointer in Editor        → 11.0.1, HIGH notifier (flashing)
feat: BREAKING redesign case schema         → 12.0.0, normal notifier
fix: urgent security patch in auth layer    → 11.0.1, HIGH notifier (flashing)
```

### Two trigger paths

**Automatic (every deploy):** `src/services/versionCheckService.js` polls `/version.json` every 60s on every client. Fires `update-available` when server version > `APP_VERSION` baked in the bundle. Guarded by `localStorage.lastNotifiedVersion` so each version notifies each user only once.

**Manual (admin UI):** Inserting a `casenumber: "update"` row into the `cases` table triggers `DataContext`'s existing Supabase realtime subscription on every connected tab, which fires the same `update-available` event locally. The row is deleted immediately after processing. Use this path for instant notification with custom release notes, not for version control.

### Notifier levels

| Priority | User experience |
|---|---|
| `normal` | Quiet update banner |
| `high` | Flashing alert + `update-critical` CSS class on `<html>` |
| `force` | Immediate hard-reload on all tabs, cache cleared, no user prompt — manual admin action only |

### Standard vs Urgent updates
- `standard` release priority => notifier priority `normal`
- `urgent` release priority => notifier priority `high`
- `force` should be reserved for exceptional break/fix scenarios only

Mapping implementation lives in `src/services/versionCheckService.js` (`mapPriority`).

## Version bump rules (semantic versioning)
The Action scans **all non-merge commit subjects** in the push (`git log BEFORE..AFTER --no-merges`):

- any subject contains `BREAKING` => `major`
- any subject starts with `feat(`, `feat:`, `feature(`, `feature:`, `new(`, or `new:` => `minor`
- otherwise => `patch`

Any subject contains `urgent`, `hotfix`, `critical`, or `security` => priority `urgent`.

Implemented by `.github/workflows/version-bump.yml`.

## Git tags
The Action creates a git tag (`v<version>`) after every version bump. The changelog generator (`scripts/generate-changelog.mjs`) uses the most recent tag as the lower bound of `git log`, so each release changelog only shows commits since the previous release.

## AI workflow requirements (Codex/Claude)
When making any release-affecting change:
1. Keep version reads through `src/version.js` (do not hardcode versions in components).
2. If metadata schema changes, update both generator and polling consumer.
3. Regenerate metadata locally when needed:
   - `node scripts/generate-changelog.mjs`
4. Validate app still builds:
   - `npm run build`
5. If changing release policy, update both `AGENTS.md` and `CLAUDE.md` in same PR.
6. Do not commit `public/version.json` or `public/changelog.json` — they are generated artifacts.

## Do not do
- Do not reintroduce hardcoded `APP_VERSION` constants in feature files.
- Do not bypass generated metadata by manually editing runtime-only values.
- Do not disable update polling without replacing it with an equivalent automated mechanism.
- Do not commit `public/version.json` or `public/changelog.json`.
- Do not change `git push` in the workflow to omit the explicit `origin HEAD:main` — bare `git push` is unreliable in Actions environments.

## Quick checklist before PR
- [ ] Version source still `package.json`
- [ ] `src/version.js` still canonical app version export
- [ ] `scripts/generate-changelog.mjs` still writes both metadata files
- [ ] `src/services/versionCheckService.js` still dispatches `update-available`
- [ ] `.github/workflows/version-bump.yml` still enforces semver bump logic
- [ ] `public/version.json` and `public/changelog.json` are in `.gitignore` (not committed)
- [ ] `GH_PAT` secret is configured in the repo
