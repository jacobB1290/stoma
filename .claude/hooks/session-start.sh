#!/bin/bash
# Installs npm dependencies so Claude can run the same checks Vercel does
# (react-scripts build / ESLint with react-hooks rules) before pushing.
#
# Only runs in remote (web) sessions; local devs already have node_modules.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# .npmrc already pins legacy-peer-deps=true (required by React 19).
# Use `npm install` rather than `npm ci` so the cached container layer can
# short-circuit when nothing has changed.
npm install --no-audit --no-fund
