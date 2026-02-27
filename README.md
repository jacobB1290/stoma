# stoma
Created with CodeSandbox

## Release Smoke Test (Automated Versioning + Update Notifier)

Use this when validating the end-to-end automated release flow.

1. Create a small PR commit (example commit message):
   - `fix: release smoke test`
2. Merge PR to `main`.
3. Confirm GitHub Action `Bump Version` runs and creates a bump commit:
   - expected bump for `fix:` is **patch** (example: `11.0.0` -> `11.0.1`)
4. Confirm Vercel deploys the new `main` commit.
5. Validate release metadata on deployed app:
   - `https://<your-domain>/version.json`
   - `https://<your-domain>/changelog.json`
6. On a device still running the older build, wait up to 60 seconds for polling.
7. Open Settings and verify update UX appears:
   - standard releases show normal update notice
   - urgent releases (commit message contains `urgent|hotfix|critical|security`) show high-priority notice
   - changelog text from `changelog.json` appears in release notes

### Commit message rules (current automation)
- `BREAKING...` => major bump
- `feat...` / `feature...` / `new...` => minor bump
- everything else => patch bump


### Required GitHub setting (important)
- In **Repo Settings → Actions → General → Workflow permissions**, select:
  - **Read and write permissions**
- This is required so the `Bump Version` workflow can commit/push the version bump back to `main` using `GITHUB_TOKEN`.
