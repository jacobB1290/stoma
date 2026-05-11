# Security

This document describes Stomaboard's security posture, known issues, and how to report problems.

## Reporting a vulnerability

If you believe you have found a security vulnerability in Stomaboard, please **do not open a public GitHub issue**. Instead:

1. Open a private GitHub Security Advisory on this repository (**Security → Advisories → Report a vulnerability**), or
2. Email the repository owner directly.

Please include enough detail to reproduce the issue: affected version, steps to reproduce, expected vs. actual behavior, and any proof-of-concept payload. We'll acknowledge receipt within a few business days.

Do not test for vulnerabilities against the production deployment. A local checkout against a personal Supabase project is the safest way to investigate.

## Environment variable policy

**All variables prefixed with `REACT_APP_` are bundled into the client at build time.** Create React App inlines them into the JavaScript bundle. They are *not* secret — anyone who downloads the app can extract them with browser DevTools.

Rules:

- Never put server-only secrets (admin keys, service-role keys, signing secrets, third-party tokens with write scope) in any `REACT_APP_*` variable.
- The Supabase **anon** key (`REACT_APP_SUPABASE_ANON_KEY`) is safe to expose — it is designed to be public and is gated by Row Level Security on every table.
- The Supabase **service-role** key must never appear in client code or any `REACT_APP_*` variable.
- If you need a true secret in a feature, put it behind a serverless function (Vercel Functions or similar) and have the client call your function rather than the third-party API.

## Known issue: OpenAI API key is client-bundled

`REACT_APP_OPENAI_API_KEY` is currently inlined into the client bundle. This means:

- The key is visible to anyone who inspects the deployed JavaScript.
- A leaked key allows third parties to make OpenAI requests on the project's account, with associated cost.
- This is a known issue, not a recommended pattern.

**Planned remediation:** move OpenAI requests behind a serverless function. The client calls our function; the function holds the API key as a server-side secret and forwards the request to OpenAI. Until that work lands, the key should be:

- scoped to the minimum capabilities the app needs,
- rate-limited at the OpenAI account level,
- monitored for unusual usage spikes,
- rotated on any suspected leak.

A local dev proxy fallback at `localhost:3001` exists in `src/qa/LLMChatService.js` for development without a key configured in `.env`.

## Supabase Row Level Security

**Every table the client can reach must have Row Level Security (RLS) enabled.** This is the only thing standing between the public anon key and arbitrary read/write access to the database. Treat RLS as a hard requirement, not a best practice.

Auditing responsibility:

- Whenever a new table is added (via migrations or the Supabase dashboard), confirm RLS is enabled and a deliberate policy is in place before any client code uses it.
- Whenever a table's schema changes, re-check that existing policies still cover the new columns/rows correctly.
- Periodically run the Supabase advisors (`get_advisors` in the dashboard or MCP) to surface tables with RLS disabled or policies that are over-permissive.

If you add a new table without RLS, treat it as a security incident and fix before merging.

## Dependencies

The project uses `npm` with a `package-lock.json` checked in. `.npmrc` sets `legacy-peer-deps=true` for React 19 compatibility.

To check for known vulnerabilities in dependencies:

```bash
npm audit
```

If `npm audit` reports a high-severity or critical issue:

1. Run `npm audit fix` first and verify nothing breaks (`npm run build`).
2. For issues that `npm audit fix` cannot resolve, open a tracking issue describing the affected package, severity, and impact.
3. For transitive dependencies stuck on an old version, consider adding an `overrides` entry in `package.json` after testing a Vercel build.

The `package.json` `overrides` block currently pins Framer Motion's internal packages. Do not remove or change those overrides without verifying a Vercel build — mismatched motion packages have caused build failures historically.

## HTTP response headers

`vercel.json` applies security headers to every response served at the top-level `/(.*)` route:

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Block MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking via iframe embedding |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter hint for older browsers |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable powerful browser features the app does not use |

Static assets under `/static/*` and `/icons/*` are served with long-lived immutable cache headers. `service-worker.js` is explicitly `no-cache`. `manifest.json` is cached for one day.

If you add an integration that needs camera, microphone, geolocation, framing, or relaxed referrer rules, update `vercel.json` deliberately — don't simply remove headers.

## What is *not* yet hardened

Be honest about gaps:

- No Content Security Policy (CSP) is set. Tailwind's CDN script and inline event handlers from third-party libraries make this non-trivial; it should be revisited.
- No Subresource Integrity (SRI) hashes on the Tailwind CDN tag.
- No automated dependency scanning in CI — `npm audit` is run manually.
- No formal incident response procedure documented.

Tracking and closing these gaps is welcome work — open an issue first to discuss approach.

## Credentials in git history

Past commits have removed hardcoded credentials. If you spot a secret in current source or in history:

1. Rotate the credential immediately at its origin (Supabase project, OpenAI key page, etc.).
2. Remove it from the working tree if still present.
3. Flag the leak in a security advisory so we can audit access logs.

Do not attempt to rewrite git history without coordinating — it breaks every open branch and clone.
