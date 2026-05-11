#!/usr/bin/env node
/**
 * test-forecast-diff.mjs
 *
 * For one focal case, runs the prediction engine the way the case-history
 * modal would AND the way the efficiency / risk modal would, then prints
 * every numeric field on both prediction objects side-by-side so you can
 * see exactly which features differ.
 *
 * Both paths use the SAME production code from
 * src/utils/caseRiskPredictions.js (transpiled at runtime). The only
 * thing the harness controls is the data shape each path passes in.
 *
 * Usage:
 *   node scripts/test-forecast-diff.mjs --case=845
 *   node scripts/test-forecast-diff.mjs --case=459
 *   node scripts/test-forecast-diff.mjs --case=332
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
  // ─── args ──
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
    })
  );
  const FOCAL = args.case;
  if (!FOCAL) {
    console.error("Usage: node scripts/test-forecast-diff.mjs --case=<casenumber>");
    process.exit(2);
  }

  // ─── load fixture ──
  const snap = JSON.parse(readFileSync(FIXTURE, "utf8"));
  console.log(
    `Fixture: ${snap.cases.length} non-archived cases, ${
      snap.history.length
    } history rows.`
  );

  // ─── transpile + load the engine ──
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
  });
  let code = transpiled.code
    .replace(/require\(["']react["']\)/g, "{}")
    .replace(/require\(["']react-dom["']\)/g, "{}")
    .replace(/require\(["']react-dom\/client["']\)/g, "{}")
    .replace(/require\(["']lucide-react["']\)/g, "new Proxy({}, { get: () => () => null })")
    .replace(/require\(["']framer-motion["']\)/g, "new Proxy({}, { get: () => () => null })")
    .replace(/require\(["']motion\/react["']\)/g, "new Proxy({}, { get: () => () => null })");
  const tmpFile = path.join(os.tmpdir(), `engine-${process.pid}.cjs`);
  fs.writeFileSync(tmpFile, code);
  const engine = require(tmpFile);
  const {
    generateCaseRiskPredictions,
    extractRecentCompletedVisits,
    computeLabContextV9,
    setModels,
  } = engine;

  // Load the XGBoost model the same way production does. Without it the
  // engine's ML path silently degrades to quantile-only, and the test
  // can't see ML-driven feature differences (concurrent, sameDayCases,
  // batchSiblings, etc. all feed the model — none of them affect the
  // quantile fallback).
  const modelPath = path.join(REPO_ROOT, "public", "xgb_v10_origdue.json");
  const modelJson = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  setModels(modelJson);
  console.log(`Loaded XGBoost model from ${path.basename(modelPath)}.`);

  // ─── helpers (mirror production) ──
  function stageFromModifiers(mods) {
    if (!Array.isArray(mods)) return null;
    if (mods.includes("stage-qc")) return "qc";
    if (mods.includes("stage-finishing")) return "finishing";
    if (mods.includes("stage-production")) return "production";
    if (mods.includes("stage-design")) return "design";
    return null;
  }
  function mapRow(rec) {
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
  function enrichStage(c) {
    const s = stageFromModifiers(c.modifiers);
    return s ? { ...c, currentStage: s, current_stage: s, stage: s } : c;
  }

  // ─── attach history per case ──
  const histByCase = new Map();
  for (const h of snap.history) {
    if (!histByCase.has(h.case_id)) histByCase.set(h.case_id, []);
    histByCase.get(h.case_id).push(h);
  }
  for (const arr of histByCase.values()) {
    arr.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  const allRows = snap.cases.map((rec) => {
    const mapped = mapRow(rec);
    mapped.case_history = histByCase.get(rec.id) || [];
    return mapped;
  });

  // ─── find the focal case ──
  const focal = allRows.find(
    (c) =>
      String(c.casenumber || "").trim() === String(FOCAL).trim() &&
      c.completed !== true
  );
  if (!focal) {
    console.error(`No active case with casenumber=${FOCAL}`);
    process.exit(1);
  }
  const stage = stageFromModifiers(focal.modifiers) || "design";
  console.log(
    `\nFocal case: #${focal.casenumber} (${focal.department}, stage=${stage}, completed=${focal.completed})`
  );
  console.log(`History rows attached: ${(focal.case_history || []).length}\n`);

  // ────────────────────────────────────────────────────────────────────
  //   Path A — "Efficiency"
  //   Mirrors efficiencyCalculations.js exactly:
  //     - allCasesInStage: active cases filtered to focal.stage
  //     - labPoolSource:   ALL active cases (any stage), enriched
  //     - recentCompletedVisits derived from labPoolSource — but
  //       Efficiency separately *also* feeds stageStatistics.allActiveCases
  //       which can include completed cases recently. Here we pass the
  //       active pool with history attached, plus a completedCasesForContext
  //       option so the engine extracts completed-stage visits properly.
  // ────────────────────────────────────────────────────────────────────
  const activePool = allRows
    .filter((r) => r.completed !== true)
    .filter((r) => !r.modifiers?.includes("excluded"))
    .map(enrichStage);
  const recentCompletedWithHistory = allRows
    .filter((r) => r.completed === true)
    .filter((r) => (r.case_history || []).length > 0) // limited to last 30d
    .map(enrichStage);

  const inStagePool = activePool.filter((c) => c.currentStage === stage);

  const tA0 = Date.now();
  const visitsA = extractRecentCompletedVisits(
    recentCompletedWithHistory,
    new Date(),
    30
  );
  const labCtxA = computeLabContextV9(activePool, visitsA, new Date());
  const resultA = generateCaseRiskPredictions(
    inStagePool,
    null,
    stage,
    null,
    { labContext: labCtxA, recentCompletedVisits: visitsA }
  );
  const tA = Date.now() - tA0;
  const predA = (resultA?.predictions || []).find((p) => p.id === focal.id);

  // ────────────────────────────────────────────────────────────────────
  //   Path B — "CaseHistory" (what the in-modal forecast currently does)
  //     - activeCases: [focal]
  //     - peerPool:    full active pool
  //     - labContext + visits derived from active pool only (no completed
  //       cases' history) — this is what production does today
  // ────────────────────────────────────────────────────────────────────
  const tB0 = Date.now();
  const visitsB = extractRecentCompletedVisits(activePool, new Date(), 30);
  const labCtxB = computeLabContextV9(activePool, visitsB, new Date());
  const resultB = generateCaseRiskPredictions(
    [enrichStage(focal)],
    null,
    stage,
    null,
    {
      peerPool: activePool,
      labContext: labCtxB,
      recentCompletedVisits: visitsB,
    }
  );
  const tB = Date.now() - tB0;
  const predB = resultB?.predictions?.[0];

  // ────────────────────────────────────────────────────────────────────
  //   Path C — "CaseHistory FIXED" (proposed: feed completed-case history)
  //     Same as B but with completed-case visits feeding labContext.
  // ────────────────────────────────────────────────────────────────────
  const tC0 = Date.now();
  const visitsC = extractRecentCompletedVisits(
    [...activePool, ...recentCompletedWithHistory],
    new Date(),
    30
  );
  const labCtxC = computeLabContextV9(activePool, visitsC, new Date());
  const resultC = generateCaseRiskPredictions(
    [enrichStage(focal)],
    null,
    stage,
    null,
    {
      peerPool: activePool,
      labContext: labCtxC,
      recentCompletedVisits: visitsC,
    }
  );
  const tC = Date.now() - tC0;
  const predC = resultC?.predictions?.[0];

  // ─── print labContext diff ──
  const labKeys = [
    "labActive",
    "labRush",
    "labOverdue",
    "labDueToday",
    "labDue3d",
  ];
  console.log("─".repeat(78));
  console.log("labContext (top-level)");
  console.log("─".repeat(78));
  console.log(
    pad("key", 20),
    pad("Efficiency", 14),
    pad("CaseHistory", 14),
    pad("FIXED (with hist)", 18)
  );
  for (const k of labKeys) {
    console.log(
      pad(k, 20),
      pad(fmt(labCtxA[k]), 14),
      pad(fmt(labCtxB[k]), 14),
      pad(fmt(labCtxC[k]), 18)
    );
  }

  const stgKeys = [
    "stageActiveCount",
    "stageActiveRush",
    "stageAvg7d",
    "stageThroughput7d",
    "stageAvg30d",
    "stageTrend",
  ];
  console.log(`\nlabContext.perStage[${stage}]`);
  console.log("─".repeat(78));
  console.log(
    pad("key", 20),
    pad("Efficiency", 14),
    pad("CaseHistory", 14),
    pad("FIXED (with hist)", 18)
  );
  for (const k of stgKeys) {
    console.log(
      pad(k, 20),
      pad(fmt(labCtxA.perStage?.[stage]?.[k]), 14),
      pad(fmt(labCtxB.perStage?.[stage]?.[k]), 14),
      pad(fmt(labCtxC.perStage?.[stage]?.[k]), 18)
    );
  }

  console.log(
    `\nrecentCompletedVisits.length: A=${visitsA.length}  B=${visitsB.length}  C=${visitsC.length}`
  );

  // ─── print prediction diff ──
  console.log("\n" + "─".repeat(78));
  console.log(`Prediction for #${focal.casenumber}`);
  console.log("─".repeat(78));
  const fields = [
    "riskLevel",
    "lateProbability",
    "lateProbabilityDirect",
    "lateProbabilityQuantile",
    "completionConfidence",
    "rescheduleProbability",
    "progressPercent",
    "elapsedWorkHours",
    "stageWorkHours",
    "totalStageWorkHours",
    "backlogCount",
    "stageCapacity",
    "currentStage",
  ];
  console.log(
    pad("field", 28),
    pad("Efficiency", 14),
    pad("CaseHistory", 14),
    pad("FIXED (with hist)", 18)
  );
  let anyDiff = false;
  for (const f of fields) {
    const a = predA?.[f];
    const b = predB?.[f];
    const c = predC?.[f];
    const diffAB = !same(a, b);
    const diffAC = !same(a, c);
    if (diffAB) anyDiff = true;
    console.log(
      pad(f, 28),
      pad(fmt(a), 14),
      pad(fmt(b) + (diffAB ? " ◀" : ""), 14),
      pad(fmt(c) + (diffAC ? " ◀" : "  ✓"), 18)
    );
  }

  console.log("\nTimings (lower is better):");
  console.log(
    `  Efficiency   : ${tA}ms  (${inStagePool.length}-case predict + completed history visits)`
  );
  console.log(
    `  CaseHistory  : ${tB}ms  (single predict, no completed history)`
  );
  console.log(
    `  FIXED        : ${tC}ms  (single predict + completed history visits)`
  );

  console.log("\nVerdict:");
  if (!anyDiff) {
    console.log("  ✓ Path A and Path B produce identical predictions.");
  } else {
    console.log("  ✗ Path A and Path B disagree — see ◀ marks above.");
    const labStageA = labCtxA.perStage?.[stage] || {};
    const labStageB = labCtxB.perStage?.[stage] || {};
    if (labStageA.stageAvg7d !== labStageB.stageAvg7d) {
      console.log(
        "    Root cause: stageAvg7d differs (Efficiency sees completed-case stage timings; CaseHistory does not)."
      );
    }
    if (same(predA, predC) && !same(predA, predB)) {
      console.log(
        "  → Fixed path C matches Efficiency. Adding completed-case history to CaseHistory closes the gap."
      );
    }
  }
}

function fmt(v) {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(3);
  }
  return String(v);
}
function pad(s, w) {
  s = String(s);
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}
function same(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-6;
  }
  return a === b;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
