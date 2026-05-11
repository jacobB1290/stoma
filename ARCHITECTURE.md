# Architecture

This document is the human-friendly overview of how Stomaboard is put together. Once you've read this, [CLAUDE.md](CLAUDE.md) is the exhaustive deep-dive — same content, more density, AI-oriented tone.

## High-level overview

Stomaboard is a single-page React 19 app (Create React App) that talks to Supabase for data and OpenAI for AI features. The whole UI is mounted from `src/index.js` → `App.jsx`. There is no server-side code in this repository — all logic runs in the browser.

The application is organized around four big ideas:

1. **Cases** flow through a multi-stage production workflow.
2. **Two React contexts** carry all global state — `DataContext` for case data, `UserContext` for the current user.
3. **One Supabase client singleton** (in `src/services/caseService.js`) is the only entry point to the database. All mutations go through audit-logged wrappers.
4. **Build-time release metadata** (version + changelog) drives an in-app update notifier that polls every 60 seconds.

## Directory layout

```
src/
├── components/         React UI components (Board, BoardMobile, Editor, modals, panels)
├── context/            Global state providers
│   ├── DataContext.jsx     case data, Supabase realtime, workflow map
│   └── UserContext.jsx     identity + heartbeat presence
├── hooks/              shared React hooks (usePrioBar, etc.)
├── qa/                 AI / LLM integration
│   ├── AppQAKernel.js      actual kernel used by the app (3286 lines)
│   └── LLMChatService.js   OpenAI tool-calling client
├── services/           Supabase and external service wrappers
│   ├── caseService.js          Supabase client singleton + CRUD + audit logging
│   ├── userService.js          multi-layer user identity storage
│   ├── printingService.js      printer tracking, build-name parsing
│   └── versionCheckService.js  /version.json poller, fires update-available event
├── utils/              pure logic helpers (workflow grouping, efficiency math, risk model)
├── styles/             shared CSS utilities (glass effects)
├── App.jsx             root component — providers, theme switching, layout
├── index.js            entry point — mounts app, calls configureLLM
├── theme-dark.css      theme CSS custom properties
├── theme-pink.css      theme CSS custom properties
├── theme-white.css     theme CSS custom properties
└── version.js          re-exports APP_VERSION from package.json
```

## State management

State flows top-down through two React Contexts and one purely-presentational provider:

```
App.jsx
└── DataProvider                     (DataContext — case data + Supabase)
    └── UserProvider                 (UserContext — identity + heartbeat)
        └── FlashProvider            (UI flash/animation triggers)
            ├── Board                weekly board view
            ├── BoardMobile          mobile-optimized board
            ├── Editor               case creation/editing (very large component)
            └── SystemManagementScreen   admin + analytics
```

Modals (the Case Editor, archive view, settings, etc.) are rendered into `document.body` via `createPortal` so they sit above the board's stacking context.

### DataContext

`src/context/DataContext.jsx` is the heart of the app. It:

- subscribes to Supabase real-time updates on the `cases` table
- exposes the case list, the workflow map, and a `useMut()` hook for mutations
- handles the "manual update push" flow (a sentinel `casenumber: "update"` row signals every connected client to fire `update-available` locally)

Any component that needs to read or change case data consumes this context.

### UserContext

`src/context/UserContext.jsx` tracks the current user's identity. User names are read from a multi-layer storage chain so the app survives across tabs, sessions, and devices:

```
sessionStorage.tempUserName   →   localStorage.userName   →   IndexedDB   →   bypassUser fallback
```

Identity persistence is implemented in `src/services/userService.js`. A heartbeat keeps presence current.

## Data flow

The end-to-end path for any case-data change looks like this:

```
User action in a component
  → component calls a named export from caseService.js (e.g. updateCase, togglePriority)
    → caseService writes via the Supabase client and logs the action in case_history
      → Supabase realtime channel fires on the cases table
        → DataContext's subscription updates its cached array
          → every consumer re-renders
```

All mutations go through `caseService.js`, never raw Supabase queries from components. This is what makes the audit trail in `case_history` reliable.

## Service layer

`src/services/caseService.js` exports:

- `db` — the singleton Supabase client. Import from here if you need direct access (read-only queries are fine).
- Named mutation helpers (`addCase`, `updateCase`, `togglePriority`, …) — each writes the change *and* writes a corresponding row into `case_history`.

Do not create additional Supabase clients elsewhere. There is exactly one.

The audit log uses a chain (`sessionStorage.tempUserName` → `localStorage.userName` → `bypassUser`) to identify the actor. Anything that mutates a case appears in `case_history` with `case_id`, `action`, and `user_name`.

## Workflow stages

Each case lives in one of four production stages:

```
Design  →  Production  →  QC  →  Finishing
```

Stage membership is stored as a modifier flag on the `cases.modifiers` array (the column is a Postgres text array). The flags are:

- `stage-design`
- `stage-production`
- `stage-qc`
- `stage-finishing`

`src/utils/workflowDetection.js` groups cases by stage and computes the workflow map. `src/utils/efficiencyCalculations.js` computes per-case velocity scores. `src/utils/stageTimeCalculations.js` does working-hour-aware duration math. `src/utils/caseRiskPredictions.js` runs the XGBoost-based late-risk classifier.

Other modifier flags on the same array carry orthogonal state — `rush`, `hold`, `bbs`, `flex`, `newaccount`, `excluded`, `completed`, and broadcast-priority markers `normal` / `high` / `force`. The full list lives in [CLAUDE.md](CLAUDE.md#case-modifiers).

## AI / LLM

There are two files in `src/qa/`:

- `LLMChatService.js` — the OpenAI tool-calling client. Manages a 30-message sliding context window, exposes `configureLLM`, `sendMessage`, `setStatusCallback`, `setEventLogCallback`. Configured at app start in `src/index.js`.
- `AppQAKernel.js` — the actual kernel used by the app's Q&A surface. This is a large, 3286-line file (significantly bigger than `LLMChatService.js`) that orchestrates routing, context retrieval, and response handling.

**Honesty note:** [CLAUDE.md](CLAUDE.md) refers to a `QAEngine.js` v3.1.0 file. That file no longer exists — `AppQAKernel.js` is the real entry point today. If you're tracing how a user message reaches OpenAI, start in `AppQAKernel.js` and follow its calls into `LLMChatService.js`.

The OpenAI model is `gpt-5-nano`. The API key is read from `REACT_APP_OPENAI_API_KEY` at build time. There is a local dev proxy fallback on `localhost:3001` when the key is absent. See [SECURITY.md](SECURITY.md) for why this client-side key is a known issue.

## Theming

Three themes ship with the app: `white`, `dark`, `pink`. Each is a set of CSS custom properties in a dedicated file:

- `src/theme-white.css`
- `src/theme-dark.css`
- `src/theme-pink.css`

Switching themes adds the corresponding class (`theme-white`, `theme-dark`, `theme-pink`) to `<html>`. `App.jsx` handles this and persists the choice. The active class on `document.documentElement` is the source of truth — read it with `document.documentElement.classList.contains('theme-X')` if your code needs to branch on theme.

In addition to themes, three CSS systems run concurrently:

1. **Tailwind CSS** — utility classes, used heavily for layout and spacing.
2. **Theme CSS** — the three files above, owning all color tokens.
3. **Material-UI** — used for specific UI controls; MUI theme overrides live in the components that use them.

Glass/blur effects are in `src/styles/glass.css`. Flash animations are in `src/flash.css`.

## Animation libraries

Two animation libraries are intentionally in use:

| Library | Use for |
|---|---|
| Framer Motion 12.34.3 | React component enter/exit, spring physics, `usePrioBar` |
| GSAP 3.13.0 | Imperative timeline animations, canvas effects (`animationEngine.js`) |

`package.json` has an `overrides` block pinning Framer Motion's internal packages to a single version. Don't change those overrides without verifying a Vercel build — mismatched motion packages caused a build failure historically.

## Version metadata flow

Version, changelog, and the in-app update notifier are fully automated. The high level looks like:

```
PR merged to main (squash-and-merge)
  → GitHub Action (.github/workflows/version-bump.yml)
    → reads non-merge commit subjects in the push range
    → npm version <bump> --no-git-tag-version   (major / minor / patch)
    → commit + tag + push back to main with [skip ci]
  → Vercel builds the bumped commit
    → scripts/generate-changelog.mjs writes public/version.json + public/changelog.json
    → CRA bakes APP_VERSION (from package.json) into the JS bundle
  → already-open browser sessions poll /version.json every 60s
    → version mismatch fires the `update-available` window event
    → existing settings/update UI shows the notifier
```

Implementation details and the full set of rules (priority levels, manual push path via Supabase realtime, the GH_PAT requirement) are in [CLAUDE.md](CLAUDE.md#automated-versioning--update-notifier-important) and [AGENTS.md](AGENTS.md). The runtime polling lives in `src/services/versionCheckService.js`. The app version is always read from `src/version.js`.

## Database schema (Supabase)

The two tables this app touches:

### `cases`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `case_number` | text | Human-readable identifier |
| `department` | text | `"Digital"`, `"Metal"`, or `"General"` |
| `due` | date / timestamp | Due date |
| `modifiers` | text[] | Status tags (see below) |
| `completed_at` | timestamp | Set when case is completed |
| `created_at` | timestamp | Auto on insert |

Modifier flag values are listed in [CLAUDE.md](CLAUDE.md#case-modifiers).

### `case_history`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `case_id` | uuid | FK to `cases` |
| `action` | text | What changed (free text) |
| `user_name` | text | Who did it |

All tables must have Row Level Security (RLS) enabled — see [SECURITY.md](SECURITY.md).

## Known limitations

These are real, current limitations. Document and fix rather than gloss over.

- **No automated tests.** `npm test` runs the CRA test runner but finds nothing. Contributors are expected to test manually; `npm run build` is the only mandatory pre-push check.
- **OpenAI API key is client-bundled.** `REACT_APP_OPENAI_API_KEY` is baked into the JS bundle at build time, which means anyone who downloads the app can extract it. Planned remediation: move OpenAI calls behind a serverless function. See [SECURITY.md](SECURITY.md).
- **Some components are very large.** `Editor.jsx` (~3.5K lines) and `SystemManagementScreen.jsx` (~3K lines) intentionally hold tightly-coupled state. Do not split them without a concrete reason.
- **`AppQAKernel.js` is 3286 lines** in a single file. Splitting it is a known improvement opportunity.
- **The `caseRiskPredictions_v10_redesign.js` file at the repo root** is a redesign work-in-progress and is not yet wired up. The active risk model is `src/utils/caseRiskPredictions.js`.
- **CSS is layered three ways** (Tailwind + theme CSS + MUI). Be deliberate about which layer owns a given style.

## Where to start reading

If you are new and want to understand a specific area:

| Goal | Start here |
|---|---|
| How data is loaded and updated | `src/context/DataContext.jsx`, then `src/services/caseService.js` |
| How a case is rendered on the board | `src/components/Board.jsx` |
| How the editor works | `src/components/Editor.jsx` — large; use search aggressively |
| How efficiency is computed | `src/utils/efficiencyCalculations.js` and `src/utils/stageTimeCalculations.js` |
| How risk predictions work | `src/utils/caseRiskPredictions.js` (XGBoost classifier) |
| How AI Q&A is routed | `src/qa/AppQAKernel.js` → `src/qa/LLMChatService.js` |
| How releases work | `.github/workflows/version-bump.yml`, `scripts/generate-changelog.mjs`, [AGENTS.md](AGENTS.md) |
