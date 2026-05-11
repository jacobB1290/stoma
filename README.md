# Stomaboard

Stomaboard — case management and workflow optimization for a dental/medical prosthetics business.

Cases flow through a multi-stage production pipeline (Design → Production → QC → Finishing). The app provides a weekly board view, mobile-optimized board, a case editor, real-time efficiency analytics, and an AI-powered Q&A assistant backed by OpenAI.

## Stack

| Layer | Technology |
|---|---|
| UI | React 19 (Create React App), Tailwind CSS, Material-UI, Framer Motion, GSAP |
| Backend | Supabase (PostgreSQL + Realtime) |
| AI | OpenAI GPT API (`gpt-5-nano`, tool-calling) |
| Hosting | Vercel |
| Versioning | GitHub Actions (auto-bump from PR titles) |

## Quick start

```bash
git clone <repository-url>
cd stoma
cp .env.example .env   # then fill in the three REACT_APP_* keys (see below)
npm install
npm start              # opens http://localhost:3000
```

`.npmrc` sets `legacy-peer-deps=true`. This is required for React 19 compatibility — do not remove it.

If `npm install` fails on a fresh checkout, run it again with `--no-audit --no-fund`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the CRA dev server on port 3000 |
| `npm run build` | Generate release metadata, then build for production with `CI=false` (same command Vercel runs) |
| `npm test` | Run the CRA test runner (jsdom). There are no test files yet — see [CONTRIBUTING.md](CONTRIBUTING.md) |

There is no separate lint script. ESLint runs automatically via `react-scripts`. Configuration lives in `.eslintrc.json` (extends `react-app` and `react-app/jest`).

Before pushing, run `npm run build` to catch ESLint rule violations Vercel will reject (Babel-level syntax checks miss these — e.g. `react-hooks/rules-of-hooks`, `no-undef`).

## Environment variables

All runtime configuration is supplied through `REACT_APP_*` variables. Copy `.env.example` to `.env` for local development and never commit `.env`.

| Variable | Purpose |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase project URL — found in Supabase dashboard → Project Settings → API |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase anon/public key — same dashboard page |
| `REACT_APP_OPENAI_API_KEY` | OpenAI API key for the AI Q&A interface |

In Vercel, set each variable under **Project Settings → Environment Variables**. See [SECURITY.md](SECURITY.md) for important caveats about `REACT_APP_*` variables being bundled into the client.

## Deployment

Deployed on Vercel. Pushes to `main` deploy automatically. The build command (configured in `package.json`) is:

```
node scripts/generate-changelog.mjs && CI=false react-scripts build
```

`scripts/generate-changelog.mjs` generates `public/version.json` and `public/changelog.json` from the latest `package.json` version and git history. Those files are git-ignored — Vercel regenerates them on every build.

PR titles drive version bumps automatically:

- `feat:` / `feature:` / `new:` → **minor** bump
- contains `BREAKING` → **major** bump
- anything else → **patch** bump
- contains `urgent`, `hotfix`, `critical`, or `security` → high-priority update notifier

Full release flow is documented in [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md#automated-versioning--update-notifier-important).

## Documentation

| Document | Audience |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | New contributors — high-level system map, data flow, key conventions |
| [SECURITY.md](SECURITY.md) | Anyone touching auth, secrets, dependencies, or HTTP headers |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Required reading before opening a PR |
| [CLAUDE.md](CLAUDE.md) | Deep-dive (originally written for AI assistants, but accurate and exhaustive). Read after ARCHITECTURE.md if you need more detail |
| [AGENTS.md](AGENTS.md) | Operational contract for AI contributors — focuses on release automation |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Historical user-facing release notes |

## Release smoke test

This is the manual procedure for validating the automated release flow end to end.

1. Create a small PR with a commit such as `fix: release smoke test`.
2. Merge with squash-and-merge.
3. Confirm the **Bump Version** GitHub Action creates a bump commit (patch for `fix:`).
4. Confirm Vercel deploys the new `main` commit.
5. Fetch `https://<your-domain>/version.json` and `/changelog.json` — both should reflect the new version.
6. On a device still running the older build, wait up to 60 seconds for the version poll.
7. Open Settings and confirm the update notice appears (normal for standard, flashing for urgent).
