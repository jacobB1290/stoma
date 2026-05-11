# Contributing

Thank you for working on Stomaboard. This guide covers everything you need before opening a PR. Read [README.md](README.md) for setup and [ARCHITECTURE.md](ARCHITECTURE.md) for context first.

## PR title convention

**The PR title is load-bearing.** The GitHub Action that bumps the version reads the squash-and-merge commit subject, which on this repository is the PR title. Set it deliberately.

| Work type | Required PR title prefix | Version bump |
|---|---|---|
| New user-facing feature or capability | `feat:` or `feature:` or `new:` | **minor** (e.g. 11.0.4 → 11.1.0) |
| Bug fix, refactor, docs, chore | `fix:` (or any other prefix) | **patch** (e.g. 11.0.3 → 11.0.4) |
| Breaking change (schema, removed feature, behavior change) | Include `BREAKING` anywhere in the title | **major** (e.g. 11.x.x → 12.0.0) |
| Urgent / security fix | Include `urgent`, `hotfix`, `critical`, or `security` | Same bump, but with a high-priority update notifier |

Examples:

```
fix: correct rush case sorting              → 11.0.1, normal notifier
feat: add weekly efficiency export          → 11.1.0, normal notifier
fix: critical null pointer in Editor        → 11.0.1, HIGH notifier
feat: BREAKING redesign case schema         → 12.0.0, normal notifier
```

Before opening a PR, state explicitly in the PR body what semver bump the title will produce. For example: *"This PR title will trigger a minor bump (11.0.4 → 11.1.0)."* If you are not sure whether a change is a feature or a fix, err toward `feat:`.

A common mistake: describing a feature in the PR body while giving the title a non-`feat:` prefix. The Action only reads the title.

## Mandatory release notes entry

Every PR must include or overwrite a file called `RELEASE_NOTES_ENTRY.md` at the repository root. This is the content the app's update notifier shows users when the new version ships.

Format rules:

- Plain markdown bullets only. Every line starts with `- ` and is a single sentence.
- Use `-` for bullets, not `*`.
- No headings, no bold, no emojis, no horizontal rules, no code blocks, no nested bullets.
- Use plain English. No tech vocabulary. Imagine a coworker reading this on their phone.
- Past tense for fixes (*"used to do X, now does Y"*); present tense for new behavior (*"Each case now shows…"*).
- Keep it short — usually two to six bullets.
- Skip internal-only refactors, build scaffolding, and test plumbing.

Words to avoid: modal, dialog, sync, cache, render, state, component, prop, deploy, build, schema, query, page lag/freeze (say *"the page felt slow"*), cross-device / per-user / per-device (say *"on your computer"* or *"for your account"*). Don't name internal screens by their developer names (e.g. *"Risk Modal"*, *"Efficiency Screen"*) — describe what the user sees and does.

Good example:

```
- The case details and the Efficiency page used to sometimes show different predictions for the same case. Now they always agree.
- Opening a case used to make the page feel slow for a second. It opens instantly now.
- Each case now shows a quick on-track or at-risk tag near the top.
- Turning on Performance Mode now only affects the computer you turn it on with.
```

If your change is purely internal (refactor with no observable user effect), still write a single bullet such as *"Small under-the-hood improvements for the team."* — don't leave the file blank or unchanged.

## Branch naming

There is no enforced branch naming convention. Conventional choices:

- `feat/<short-description>` for new features
- `fix/<short-description>` for bug fixes
- `chore/<short-description>` for build / docs / dependency work

Branches are short-lived. Open the PR early, even as a draft.

## Pre-push validation

**Run `npm run build` before every push.** This is the same command Vercel runs, and it will catch ESLint rule violations that a syntax-only parser (Babel/AST) will miss — most importantly `react-hooks/rules-of-hooks` and `no-undef`.

```bash
npm run build
```

If you only changed a few files and want a faster signal, run ESLint directly against just those paths:

```bash
npx eslint --resolve-plugins-relative-to ./node_modules/react-scripts <changed paths>
```

A green Babel parse is not a substitute for `npm run build`. The build script intentionally runs with `CI=false` to keep ESLint **warnings** from failing the build, but ESLint **errors** still fail it.

## Code style

- **Linter:** ESLint runs automatically via `react-scripts` (config: `.eslintrc.json`, extending `react-app` and `react-app/jest`). No separate lint script exists.
- **Formatter:** Prettier is not yet configured. Match the surrounding file's style (indentation, quote style, trailing commas).
- **File extensions:** React components use `.jsx`; plain JS modules use `.js`. Don't rename without updating every import.
- **Tests:** There are currently no test files. `npm test` will exit cleanly. If you add tests, please use the CRA test runner (Jest + React Testing Library) so they run with `npm test`.
- **Component size:** `Editor.jsx` and `SystemManagementScreen.jsx` are intentionally large. Don't split them without a concrete reason — they hold tightly coupled state.

## Do not

A short list of things that break the app, the build, or the security model:

- **Do not** hardcode secrets (API keys, URLs, passwords). All configuration is read from `process.env.REACT_APP_*`. See [SECURITY.md](SECURITY.md) for what may live in `REACT_APP_*` and what may not.
- **Do not** put server-only secrets in `REACT_APP_*` variables — they are inlined into the client bundle at build time.
- **Do not** hardcode `APP_VERSION` anywhere. Always read it from `src/version.js`.
- **Do not** commit `public/version.json` or `public/changelog.json`. They are generated at build time and listed in `.gitignore`.
- **Do not** commit `.env`. Use `.env.example` to document new variables.
- **Do not** use `force` priority in automated flows — it triggers an immediate hard-refresh on every connected tab with no warning. Reserve it for exceptional manual admin actions.
- **Do not** reintroduce eager `loadModels()` calls at app start. The XGBoost late-risk classifier loads on demand for a reason.
- **Do not** create a second Supabase client. `db` exported from `src/services/caseService.js` is the singleton.
- **Do not** add a second Supabase realtime subscription or a second `/version.json` polling interval — both already exist. Adding duplicates causes double-notifications.
- **Do not** remove `legacy-peer-deps=true` from `.npmrc`. React 19 needs it until peer-dep declarations catch up.
- **Do not** skip Git hooks (`--no-verify`, `--no-gpg-sign`) or amend commits to dodge a pre-commit failure. If a hook fails, fix the underlying issue and make a new commit.
- **Do not** force-push to `main`.

## What goes in a good PR

A PR description that makes review fast:

1. **Summary** — one or two sentences describing what changed and why.
2. **Semver bump** — explicit statement of what bump the title produces.
3. **Test plan** — what you did to verify (which screens you clicked through, which `npm run build` output you saw).
4. **Screenshots** — for any UI change.
5. **Risk / rollback notes** — if the change touches data, auth, or the release flow.

## Where to ask questions

- For implementation questions, open a draft PR early and ask in the description or as a comment thread.
- For architectural questions, read [ARCHITECTURE.md](ARCHITECTURE.md) and [CLAUDE.md](CLAUDE.md) first — most answers are there.
- For security concerns, follow the private reporting process in [SECURITY.md](SECURITY.md).
