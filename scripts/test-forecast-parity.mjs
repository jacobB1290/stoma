#!/usr/bin/env node
/**
 * test-forecast-parity.mjs
 *
 * Parity harness for the case-modal risk forecast.
 *
 * Loads a real snapshot of cases and case_history from
 * `scripts/fixtures/snapshot.json` (produced by dumping the live
 * Supabase via the MCP `execute_sql` tool — see
 * scripts/fixtures/README.md for the SQL).
 *
 * Runs the prediction engine in three configurations:
 *
 *   A) "Efficiency"   — full active pool as activeCases. Predictions
 *                       are generated for the whole pool. The focal
 *                       case's verdict is pulled from the result. This
 *                       mirrors how the Efficiency screen renders.
 *
 *   B) "CaseHistory"  — single-case predict for the focal case using
 *                       `peerPool: <full pool>`. The engine runs ONE
 *                       per-case loop iteration but still reads peer
 *                       features from the full pool. This is the new
 *                       path used by the in-modal forecast strip.
 *
 *   C) "Broken"       — regression: simulates the prior bug where the
 *                       filter used `!r.completed_at` (a column that
 *                       does not exist in the cases table), so every
 *                       ever-completed case fell into the pool. Just
 *                       counts pool sizes — doesn't run the engine.
 *
 * For each focal case it prints pool sizes, verdicts, peer counts, and
 * timings. Then asserts that A and B agree on verdict + risk level +
 * backlog count.
 *
 * Usage:
 *   node scripts/test-forecast-parity.mjs               # 3 production cases
 *   node scripts/test-forecast-parity.mjs --case=845    # focus on one
 *   node scripts/test-forecast-parity.mjs --all-stages  # one per stage
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.join(REPO_ROOT, "scripts", "fixtures", "snapshot.json");

async function main() {

// ─── arg parsing ────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  })
);
const FOCAL = args.case || null;
const ALL_STAGES = !!args["all-stages"];

// ─── helpers (mirror production behavior) ───────────────────────────────────

function stageFromModifiers(mods) {
  if (!Array.isArray(mods)) return null;
  if (mods.includes("stage-qc")) return "qc";
  if (mods.includes("stage-finishing")) return "finishing";
  if (mods.includes("stage-production")) return "production";
  if (mods.includes("stage-design")) return "design";
  return null;
}

function mapRow(rec) {
  // Mirrors DataContext mapRow — no stage field is added here.
  const mods = rec.modifiers ?? [];
  return {
    ...rec,
    department: rec.department ?? "General",
    rush: mods.includes("rush"),
    hold: mods.includes("hold"),
    newAccount: mods.includes("newaccount"),
    stage2: mods.includes("stage2"),
    priority: rec.priority ?? false,
    caseNumber: rec.casenumber,
    caseType: mods.includes("bbs")
      ? "bbs"
      : mods.includes("flex")
      ? "flex"
      : "general",
  };
}

function enrichWithStage(c) {
  const s = stageFromModifiers(c.modifiers);
  return s ? { ...c, currentStage: s, current_stage: s, stage: s } : c;
}

// ─── load fixture ───────────────────────────────────────────────────────────

const snap = JSON.parse(readFileSync(FIXTURE, "utf8"));
console.log(
  `Loaded fixture: ${snap.cases.length} non-archived cases, ${
    (snap.history_845 || []).length
  } history rows for case 845.`
);

const allRows = snap.cases.map(mapRow);

// Attach case_history for case 845 (the harness pre-loads only this one's
// history because peer history isn't needed to verify parity of `concurrent`
// and the related cross-case features that are computed from the active pool).
const focal845 = allRows.find((c) => c.casenumber === "845");
if (focal845) {
  focal845.case_history = (snap.history_845 || []).slice();
}

// ─── transpile + import the prediction engine ───────────────────────────────
// The engine file lives alongside React components and uses JSX. We use
// @babel/core directly to transform it into a Node-runnable CommonJS module
// in os.tmpdir(), then dynamic-import the transformed file. This keeps the
// harness independent of the production build pipeline.

const enginePath = path.join(
  REPO_ROOT,
  "src",
  "utils",
  "caseRiskPredictions.js"
);

const babel = require("@babel/core");
const fs = require("node:fs");
const os = require("node:os");

const transpiled = babel.transformFileSync(enginePath, {
  presets: [
    [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
    require.resolve("@babel/preset-react"),
  ],
  babelrc: false,
  configFile: false,
  // Don't try to load JSX-only sibling files (lucide-react etc.) — we
  // rewrite their imports to noops below since the harness never renders.
});

// Stub out the React/Lucide imports so Node doesn't try to load JSX runtime
// when this transpiled file is required. The math functions don't need
// React; only the JSX components do, and the harness doesn't render them.
let code = transpiled.code
  .replace(/require\(["']react["']\)/g, "{}")
  .replace(/require\(["']react-dom["']\)/g, "{}")
  .replace(/require\(["']react-dom\/client["']\)/g, "{}")
  .replace(/require\(["']lucide-react["']\)/g, "new Proxy({}, { get: () => () => null })")
  .replace(/require\(["']framer-motion["']\)/g, "new Proxy({}, { get: () => () => null })")
  .replace(/require\(["']motion\/react["']\)/g, "new Proxy({}, { get: () => () => null })");

const tmpFile = path.join(
  os.tmpdir(),
  `caseRiskPredictions-${process.pid}.cjs`
);
fs.writeFileSync(tmpFile, code);

const engine = require(tmpFile);
const {
  generateCaseRiskPredictions,
  extractRecentCompletedVisits,
  computeLabContextV9,
} = engine;

// ─── pick focal cases ───────────────────────────────────────────────────────

const activeRows = allRows.filter((r) => r.completed !== true);

let focalCases;
if (FOCAL) {
  // Match active cases only — completed cases aren't in the pool, so
  // the engine returns nothing for them and we'd get a vacuous "null"
  // result instead of a meaningful parity check.
  focalCases = activeRows.filter((c) =>
    String(c.casenumber || "").includes(FOCAL)
  );
} else if (ALL_STAGES) {
  focalCases = ["design", "production", "finishing", "qc"]
    .map((stg) =>
      activeRows.find((c) => stageFromModifiers(c.modifiers) === stg)
    )
    .filter(Boolean);
} else {
  focalCases = activeRows
    .filter((r) => stageFromModifiers(r.modifiers) === "production")
    .slice(0, 3);
}

if (focalCases.length === 0) {
  console.error("No focal cases matched");
  process.exit(1);
}

console.log(`Running parity check on ${focalCases.length} case(s).\n`);

// ─── parity check ───────────────────────────────────────────────────────────

function summarize(prediction) {
  if (!prediction) return null;
  return {
    label: prediction.statusLabel || prediction.status || "?",
    riskLevel: prediction.riskLevel,
    lateProbability: prediction.lateProbability,
    backlogCount: prediction.backlogCount,
    stageCapacity: prediction.stageCapacity,
    currentStage: prediction.currentStage,
  };
}

let allPass = true;

for (const focal of focalCases) {
  const stage = stageFromModifiers(focal.modifiers) || "design";

  console.log("═".repeat(78));
  console.log(
    `# case ${focal.casenumber}  (stage=${stage}, completed=${focal.completed})`
  );
  console.log("═".repeat(78));

  // ── Path A: Efficiency-style ──
  const activePoolA = activeRows
    .filter((r) => !r.modifiers?.includes("excluded"))
    .map(enrichWithStage);

  const inProdA = activePoolA.filter(
    (c) => c.currentStage === "production"
  ).length;

  const tA0 = Date.now();
  const visitsA = extractRecentCompletedVisits(activePoolA, new Date(), 30);
  const labCtxA = computeLabContextV9(activePoolA, visitsA, new Date());
  const resultA = generateCaseRiskPredictions(
    activePoolA,
    null,
    stage,
    null,
    { labContext: labCtxA, recentCompletedVisits: visitsA }
  );
  const tA = Date.now() - tA0;
  const predA = (resultA?.predictions || []).find((p) => p.id === focal.id);

  // ── Path B: CaseHistory-style ──
  const peerPoolB = activePoolA;
  const tB0 = Date.now();
  const visitsB = extractRecentCompletedVisits(peerPoolB, new Date(), 30);
  const labCtxB = computeLabContextV9(peerPoolB, visitsB, new Date());
  const resultB = generateCaseRiskPredictions(
    [enrichWithStage(focal)],
    null,
    stage,
    null,
    {
      peerPool: peerPoolB,
      labContext: labCtxB,
      recentCompletedVisits: visitsB,
    }
  );
  const tB = Date.now() - tB0;
  const predB = resultB?.predictions?.[0];

  // ── Path C: regression — old broken filter ──
  const brokenPool = allRows
    .filter(
      (r) =>
        !r.completed_at && // column doesn't exist → always truthy
        !r.modifiers?.includes("completed") &&
        !r.modifiers?.includes("excluded")
    )
    .map(enrichWithStage);
  const inProdBroken = brokenPool.filter(
    (c) => c.currentStage === "production"
  ).length;

  // ── print ──
  console.log("Pool sizes:");
  console.log(
    `  Efficiency  : pool=${activePoolA.length}, in-${stage}=${
      activePoolA.filter((c) => c.currentStage === stage).length
    }`
  );
  console.log(
    `  CaseHistory : pool=${peerPoolB.length}, in-${stage}=${
      peerPoolB.filter((c) => c.currentStage === stage).length
    }`
  );
  console.log(
    `  Broken (regression): pool=${brokenPool.length}, in-production=${inProdBroken}  ← what the bug produced`
  );

  console.log("\nVerdict:");
  console.log("  Efficiency : ", summarize(predA));
  console.log("  CaseHistory: ", summarize(predB));

  console.log("\nTimings:");
  console.log(
    `  Efficiency : ${tA}ms (full-pool predict, ${activePoolA.length} cases)`
  );
  console.log(`  CaseHistory: ${tB}ms (single predict + peerPool)`);

  // ── assertions ──
  const sA = summarize(predA);
  const sB = summarize(predB);
  const ok =
    sA &&
    sB &&
    sA.label === sB.label &&
    sA.riskLevel === sB.riskLevel &&
    sA.backlogCount === sB.backlogCount;

  console.log(
    `\n${ok ? "✓ PARITY" : "✗ MISMATCH"}: Efficiency vs CaseHistory ${
      ok
        ? "agree on verdict, risk level, and backlog count."
        : "disagree."
    }\n`
  );
  if (!ok) allPass = false;
}

// Speedup summary
console.log("─".repeat(78));
console.log(
  "Speedup: CaseHistory path is faster because it computes ONE prediction"
);
console.log(
  "(`activeCases.length === 1`) instead of N. Cross-case features are"
);
console.log(
  "preserved via the `peerPool` option, so the verdict still matches."
);
console.log("─".repeat(78));

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
