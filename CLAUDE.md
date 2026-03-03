# CLAUDE.md — Stomaboard Codebase Guide

This file provides context for AI assistants working in this repository.

---

## Project Overview

**Stomaboard** is a React-based case management and workflow optimization system for a dental/medical prosthetics business. It tracks cases through multi-stage production workflows, provides real-time efficiency analytics, and includes an AI-powered Q&A interface backed by OpenAI.

- **App version source:** `package.json` via `src/version.js` (currently starts at `11.0.0`)
- **Deployment target:** Vercel
- **Backend:** Supabase (PostgreSQL)
- **AI integration:** OpenAI GPT API via `src/qa/LLMChatService.js`

---

## Development Commands

```bash
npm start          # Start dev server (CRA, port 3000)
npm run build      # Production build (CI=false to suppress warnings-as-errors)
npm test           # Run tests (jsdom environment)
```

There is no standalone lint script. ESLint runs automatically through `react-scripts`. Configuration is in `.eslintrc.json` (extends `react-app` and `react-app/jest`).

> **Note:** `package.json` uses `"CI=false"` in the build script — this is intentional for Vercel deployments to prevent ESLint warnings from failing the build.

---

## Environment Variables

Copy `.env.example` to `.env` for local development. **Never commit `.env`.**

| Variable | Purpose |
|---|---|
| `REACT_APP_SUPABASE_URL` | Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `REACT_APP_OPENAI_API_KEY` | OpenAI API key for AI Q&A |

In Vercel, set these under **Project Settings → Environment Variables**.

---

## Directory Structure

```
src/
├── components/         # 22 React UI components
├── context/            # Global state providers
│   ├── DataContext.jsx     # Case data + Supabase operations
│   └── UserContext.jsx     # User identity + heartbeat
├── hooks/
│   └── usePrioBar.js       # Animated priority bar (Framer Motion)
├── qa/                 # AI / LLM integration
│   ├── LLMChatService.js   # OpenAI API client + tool-calling loop
│   └── QAEngine.js         # Smart routing, context-aware Q&A (v3.1.0)
├── services/           # Database & external service abstractions
│   ├── caseService.js      # Supabase CRUD + audit logging
│   ├── userService.js      # Multi-layer user storage
│   └── printingService.js  # Printer tracking + build name parsing
├── utils/              # Pure logic helpers
│   ├── workflowDetection.js      # Workflow grouping & analysis
│   ├── efficiencyCalculations.js # Velocity scoring (engine v2.1.0)
│   ├── stageTimeCalculations.js  # Working-hour calculations
│   ├── caseRiskPredictions.js    # Risk assessment
│   ├── date.js
│   ├── nameNormalization.js
│   ├── motion.js
│   └── throttledProcessor.js
├── styles/             # Shared CSS utilities
├── App.jsx             # Root component: providers, theme, layout
├── index.js            # Entry point — mounts app, configures LLM
├── constants.js        # APP_VERSION
├── FlashContext.jsx    # Animation context
├── LiteModePerformancePatch.jsx
├── animationEngine.js
├── theme-dark.css
├── theme-pink.css
└── theme-white.css
```

---

## Architecture

### State Management

State flows top-down through two React Context providers:

1. **`DataContext`** (`src/context/DataContext.jsx`) — The primary data layer. Subscribes to Supabase real-time updates, exposes case CRUD via `useMut()` hook, and builds the workflow map. All components that read or mutate case data consume this context.

2. **`UserContext`** (`src/context/UserContext.jsx`) — Manages the current user's identity. Implements a heartbeat system for presence tracking. User identity is stored across `localStorage`, `sessionStorage`, and `IndexedDB` (via `userService`).

### Component Hierarchy

```
App.jsx
├── DataProvider         (DataContext)
│   └── UserProvider     (UserContext)
│       └── FlashProvider
│           ├── Board.jsx           (main weekly board view)
│           ├── BoardMobile.jsx     (mobile-optimized view)
│           ├── Editor.jsx          (case creation/editing — ~127KB)
│           └── SystemManagementScreen.jsx  (admin/analytics — ~101KB)
```

Modals are rendered via `createPortal` to `document.body`.

### Service Layer

`src/services/caseService.js` is the single Supabase client entry point. Import `db` from here for any direct database access. All mutations go through named export functions (`addCase`, `updateCase`, `togglePriority`, etc.) so audit history (`case_history` table) is automatically logged.

---

## Database Schema (Supabase)

### `cases` table

Key columns inferred from service usage:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `case_number` | text | Human-readable identifier |
| `department` | text | `"Digital"`, `"Metal"`, or `"General"` |
| `due` | date/timestamp | Due date |
| `modifiers` | text[] | Array of status tags (see below) |
| `completed_at` | timestamp | Set when case is completed |
| `created_at` | timestamp | Auto-set on insert |

### Case Modifiers

Modifiers are stored as a string array on each case row. Known values:

| Modifier | Meaning |
|---|---|
| `rush` | Rush priority |
| `hold` | Case on hold |
| `newaccount` | New account flag |
| `bbs` | BBS case type |
| `flex` | Flex case type |
| `excluded` | Excluded from efficiency calculations |
| `completed` | Case is done |
| `stage-design` | In Design stage |
| `stage-production` | In Production stage |
| `stage-qc` | In QC stage |
| `stage-finishing` | In Finishing stage |
| `normal` / `high` / `force` | Update broadcast priority (internal signaling) |

### `case_history` table

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `case_id` | uuid | FK to `cases` |
| `action` | text | Description of what changed |
| `user_name` | text | Who performed the action |

---

## AI / LLM System

### LLMChatService (`src/qa/LLMChatService.js`)

- Model: `gpt-5-nano`
- Uses OpenAI tool-calling (function calling) to execute database queries and mutations
- Maintains a sliding 30-message conversation history window
- Has a local dev proxy fallback (`localhost:3001`) when `REACT_APP_OPENAI_API_KEY` is not set
- Configured at app startup in `src/index.js` via `configureLLM({ apiKey })`
- Key exports: `configureLLM`, `setStatusCallback`, `setEventLogCallback`, `sendMessage`

### QAEngine (`src/qa/QAEngine.js`, v3.1.0)

Wraps `LLMChatService` with smart routing and component-based response handling. Query categories: CORE, DISCOVERY, ANALYSIS, and more. Import and use `QAEngine` in UI components rather than calling `LLMChatService` directly.

---

## Styling Conventions

The app uses **three concurrent CSS systems** — be aware of all three when modifying styles:

1. **Tailwind CSS** (utility classes) — available via CDN in `public/index.html` and PostCSS in the build. Use for layout and spacing.
2. **Theme CSS files** (`theme-dark.css`, `theme-pink.css`, `theme-white.css`) — CSS custom properties applied via a class on `<html>` or a wrapper element. Modify here for theme-specific colors.
3. **Material-UI** (`@mui/material` + `@emotion/styled`) — used for specific UI components. MUI theme overrides live within the components that use them.

Glass/blur effects are defined in `src/styles/glass.css`. Flash animations are in `src/flash.css`.

---

## Animation Libraries

Two animation libraries are in use — use the right one for the right job:

| Library | Version | Use for |
|---|---|---|
| **Framer Motion** | 12.34.3 | React component enter/exit animations, spring physics, `usePrioBar` hook |
| **GSAP** | 3.13.0 | Imperative timeline animations, canvas effects, `animationEngine.js` |

> The `package.json` overrides section forces `framer-motion` and its sub-packages to a consistent version. Do not change these overrides without testing a Vercel build, as mismatched motion packages caused a past build failure.

---

## Key Conventions

- **File extensions:** React components use `.jsx`; plain JS modules use `.js`. Do not rename without updating all imports.
- **Component size:** Several components (Editor, SystemManagementScreen) are intentionally large monoliths. Do not split them without a clear reason — they hold complex inter-related state.
- **No test coverage:** There are currently no unit or integration tests. `npm test` runs the CRA test runner but will find no test files.
- **Credentials:** All secrets come from `process.env.REACT_APP_*`. Never hardcode API keys, URLs, or passwords. Previous commits had to remove hardcoded credentials (see git history).
- **Legacy peer deps:** `.npmrc` sets `legacy-peer-deps=true`. This is required due to React 19 not yet being supported by all peer-dep declarations. Do not remove this flag.
- **User name resolution:** `caseService.js` reads the current user from `sessionStorage.tempUserName` → `localStorage.userName` → `bypassUser` fallback. All audit log entries use this chain.
- **Supabase client singleton:** `db` is exported from `src/services/caseService.js`. Import from there — do not create additional Supabase clients.

---

## Deployment

Deployed on **Vercel** with GitHub Actions release automation (`.github/workflows/version-bump.yml`). Vercel auto-deploys from the connected branch on push.

Build command: `node scripts/generate-changelog.mjs && CI=false react-scripts build`
Output directory: `build/`
Environment variables: configured in Vercel dashboard, not in repo files.


---

## Automated Versioning + Update Notifier (Important)

This repository uses a fully automated release metadata flow:

1. **Single source of truth:** `package.json` `version`
2. **Runtime version export:** `src/version.js` (`APP_VERSION`, `compareVersions`)
3. **Build-time metadata generation:** `scripts/generate-changelog.mjs`
4. **Generated artifacts:** `public/version.json`, `public/changelog.json` — **not committed; Vercel regenerates them on every deploy**
5. **Runtime polling:** `src/services/versionCheckService.js` polls `/version.json` every 60s
6. **Notifier trigger:** Dispatches `window` `update-available` event consumed by existing settings/update UI

### End-to-end release flow

```
PR merged to main
  → GitHub Action (version-bump.yml) runs
    → reads all non-merge commit subjects in the push range
    → determines semver bump (major / minor / patch)
    → npm version <bump> --no-git-tag-version   ← updates package.json only
    → git commit package.json package-lock.json [skip ci]
    → git tag v<new-version>
    → git push origin HEAD:main
    → git push origin v<new-version>
  → Vercel detects the [skip ci] commit and builds
    → generate-changelog.mjs fetches full history (unshallows clone)
    → writes public/version.json + public/changelog.json from package.json version
    → CRA build bakes APP_VERSION from package.json into the JS bundle
  → deployed app serves /version.json with the new version
    → existing browser sessions (old bundle) detect version > APP_VERSION
    → fire update-available event → user sees update notifier
```

> **Important:** The update notifier only fires for users who already have an older version of the app open in their browser. A fresh page load always has matching `APP_VERSION` and `/version.json` — this is by design (stale-session detection).

### Prerequisites — one-time setup

| Requirement | Where to configure |
|---|---|
| `GH_PAT` secret with `contents: write` scope | GitHub repo → Settings → Secrets and variables → Actions |
| Squash-and-merge enabled (recommended) | GitHub repo → Settings → General → Merge button → Allow squash merging |

`GH_PAT` must have write access to the repo so the Action can push the version bump commit and the git tag back to `main`. The default `GITHUB_TOKEN` cannot push to protected branches.

Using **squash-and-merge** ensures the squash commit subject (= PR title) is what the Action reads for bump-type detection. If you use regular merge commits (`Merge pull request #N…`), the Action falls back to `patch` for every merge regardless of PR content.

### Semantic version bump model

The Action inspects **all non-merge commit subjects** in the push range (`git log BEFORE..AFTER --no-merges`):

- any subject contains `BREAKING` → **major**
- any subject starts with `feat(`, `feat:`, `feature(`, `feature:`, `new(`, or `new:` → **minor**
- otherwise → **patch**

### Priority model (standard vs urgent)

- any subject contains `urgent`, `hotfix`, `critical`, or `security` → `priority: "urgent"` → notifier `"high"`
- otherwise → `priority: "standard"` → notifier `"normal"`
- `"force"` is a manual exceptional path only

### Generated artifacts

`public/version.json` and `public/changelog.json` are **build-time outputs** listed in `.gitignore`. Never commit them manually. The changelog range is scoped from the most recent git tag to `HEAD`; each version bump creates a tag so the next changelog only includes new commits.

### How to use the system

#### Controlling version bump type via commit messages

The GitHub Action reads commit subjects automatically — no manual version editing ever needed.

| Goal | Write your commit/PR title like this |
|---|---|
| Patch release `11.0.0 → 11.0.1` | `fix: correct due-date calculation` *(any subject not matching below)* |
| Minor release `11.0.0 → 11.1.0` | `feat: add bulk case export` or `feature: ...` or `new: ...` |
| Major release `11.0.0 → 12.0.0` | Include the word `BREAKING` anywhere: `feat: BREAKING redesign case schema` |
| Urgent / high-priority notifier | Include `urgent`, `hotfix`, `critical`, or `security`: `fix: critical null pointer in Editor` |

With squash-and-merge the **PR title** is the commit subject the Action reads. Set it deliberately.

#### What the three notifier levels look like for users

| Level | How it's triggered | What the user sees |
|---|---|---|
| `normal` | Standard release, or manual "Standard Update" push | Quiet update banner in the UI |
| `high` | Commit contains `urgent`/`hotfix`/`critical`/`security`, or manual "High Priority" push | Flashing alert, `update-critical` CSS class added to `<html>` |
| `force` | Manual "Force Reload" push only — **never set automatically** | Every open tab is immediately hard-refreshed with no prompt (cache cleared, service worker updated) |

#### Two paths that can trigger the notifier

**Path 1 — Automatic (every deploy):**
Every user session polls `/version.json` every 60 seconds via `src/services/versionCheckService.js`. When `version.json.version` is newer than the `APP_VERSION` baked into their bundle, the `update-available` event fires. Each version only notifies a user once (guarded by `localStorage.lastNotifiedVersion`). Users who open a fresh tab after a deploy get the new bundle immediately and never see the notifier.

**Path 2 — Manual push (admin UI only):**
An admin opens the "Push Update" panel (accessible from settings). It inserts a sentinel row (`casenumber: "update"`) into the Supabase `cases` table. Every connected client receives the row via the existing Supabase realtime subscription in `DataContext`, which fires the same `update-available` event locally on each tab. The row is immediately deleted after being processed. This path is for notifying users right now without waiting up to 60 seconds, or for attaching custom release notes.

#### Rules for AI assistants

- Never hardcode app version in components or services.
- Always read app version through `src/version.js`.
- If release metadata format changes, update both generator and polling consumer in the same PR.
- Keep docs in sync (`AGENTS.md` + `CLAUDE.md`) whenever release automation rules change.
- Do not commit `public/version.json` or `public/changelog.json` — they are generated artifacts.
- Do not use `force` priority in automated flows — it causes an immediate hard-reload for all users with no warning.
- Do not add a second Supabase realtime subscription or a second polling interval for version checking — both already exist and adding duplicates will cause double-notifications.

#### PR title / semver bump — AI responsibility

The GitHub Action reads the **squash commit subject** (= PR title) to decide the version bump. You are responsible for setting the PR title correctly.

**Rules:**

| Work type | Required PR title prefix | Resulting bump |
|---|---|---|
| New user-facing feature or capability | `feat:` or `feature:` or `new:` | **minor** (e.g. 11.0.x → 11.1.0) |
| Bug fix, refactor, docs, chore | anything else (e.g. `fix:`) | **patch** (e.g. 11.0.3 → 11.0.4) |
| Breaking change | include `BREAKING` anywhere | **major** (e.g. 11.x.x → 12.0.0) |
| Urgent/security | include `urgent`, `hotfix`, `critical`, or `security` | high-priority notifier |

**Before opening a PR, you MUST:**
1. Identify whether the work contains any new user-facing feature (new screen, new button, new behaviour the user didn't have before).
2. If yes → prefix the PR title with `feat: `.
3. State explicitly in your PR summary what semver bump the title will produce (e.g. "This PR title will trigger a **minor** bump: 11.0.4 → 11.1.0").

**Common mistake to avoid:** Describing a feature in the PR body but giving the title a non-`feat:` prefix (e.g. "Add URL-based user identification"). The Action only reads the title, not the body. If it's a feature, the title must start with `feat:`.
