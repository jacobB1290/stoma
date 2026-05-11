#!/usr/bin/env node
/**
 * test-forecast-diff.mjs
 *
 * Parity harness for the case-modal Risk Forecast.
 *
 * Calls the EXACT production functions both paths use — no
 * re-implementation. The "CaseHistory" path uses
 * `computeCaseForecast` from src/utils/caseForecastCompute.js (the
 * shared function CaseHistory.jsx itself calls). The "Efficiency"
 * path mirrors the call site in
 * src/utils/efficiencyCalculations.js (line 1486-…): same active-pool
 * shaping, same visit / labContext source, same engine entry point.
 *
 * Loads a real Supabase snapshot from
 * `scripts/fixtures/snapshot.json` and the XGBoost model from
 * `public/xgb_v10_origdue.json` so the ML inference is live (not the
 * quantile fallback). Prints every numeric prediction field side-by-
 * side with ◀ marks on any disagreement.
 *
 * Usage:
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

  const snap = JSON.parse(readFileSync(FIXTURE, "utf8"));
  console.log(
    `Fixture: ${snap.cases.length} non-archived cases, ${snap.history.length} history rows.`
  );

  // ─── transpile production source through babel so we can require it from Node ──
  const babel = require("@babel/core");
  const fs = require("node:fs");
  const os = require("node:os");

  function loadProdModule(srcPath) {
    const transpiled = babel.transformFileSync(srcPath, {
      presets: [
        [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
        require.resolve("@babel/preset-react"),
      ],
      babelrc: false,
      configFile: false,
    });
    // Stub React/etc. imports — we never render in Node. Also stub the
    // shared db client (caseService imports @supabase/supabase-js at
    // top level which would try to make network calls).
    let code = transpiled.code
      .replace(/require\(["']react["']\)/g, "{}")
      .replace(/require\(["']react-dom["']\)/g, "{}")
      .replace(/require\(["']react-dom\/client["']\)/g, "{}")
      .replace(/require\(["']lucide-react["']\)/g, "new Proxy({}, { get: () => () => null })")
      .replace(/require\(["']framer-motion["']\)/g, "new Proxy({}, { get: () => () => null })")
      .replace(/require\(["']motion\/react["']\)/g, "new Proxy({}, { get: () => () => null })")
      .replace(
        /require\(["'][^"']*services\/caseService["']\)/g,
        "{ db: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } }"
      );
    const tmpFile = path.join(
      os.tmpdir(),
      `prod-${path.basename(srcPath, ".js")}-${process.pid}.cjs`
    );
    fs.writeFileSync(tmpFile, code);
    return require(tmpFile);
  }

  // Transpile both modules (computeCaseForecast imports the engine,
  // so we need the engine loaded first so the require cache shares it).
  const enginePath = path.join(REPO_ROOT, "src", "utils", "caseRiskPredictions.js");
  const forecastPath = path.join(REPO_ROOT, "src", "utils", "caseForecastCompute.js");
  const engine = loadProdModule(enginePath);

  // Load the live XGBoost model so ML inference runs (without it the
  // engine silently falls back to quantile-only).
  const modelPath = path.join(REPO_ROOT, "public", "xgb_v10_origdue.json");
  engine.setModels(JSON.parse(fs.readFileSync(modelPath, "utf8")));
  console.log(`Loaded XGBoost model from ${path.basename(modelPath)}.`);

  // Manually rewrite caseForecastCompute's caseRiskPredictions import
  // so it picks up the same engine object we just primed.
  const forecastTranspiled = babel.transformFileSync(forecastPath, {
    presets: [
      [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
      require.resolve("@babel/preset-react"),
    ],
    babelrc: false,
    configFile: false,
  });
  let forecastCode = forecastTranspiled.code.replace(
    /require\(["'][^"']*services\/caseService["']\)/g,
    "{ db: null }"
  );
  // Point the engine require at the already-primed engine module
  forecastCode = forecastCode.replace(
    /require\(["'][^"']*caseRiskPredictions["']\)/g,
    `require(${JSON.stringify(
      path.join(os.tmpdir(), `prod-caseRiskPredictions-${process.pid}.cjs`)
    )})`
  );
  const forecastTmp = path.join(
    os.tmpdir(),
    `prod-caseForecastCompute-${process.pid}.cjs`
  );
  fs.writeFileSync(forecastTmp, forecastCode);
  const { computeCaseForecast } = require(forecastTmp);

  // ─── helpers (mirror DataContext.mapRow) ─────────────────────────────
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
  function stageFromModifiers(mods) {
    if (!Array.isArray(mods)) return null;
    if (mods.includes("stage-qc")) return "qc";
    if (mods.includes("stage-finishing")) return "finishing";
    if (mods.includes("stage-production")) return "production";
    if (mods.includes("stage-design")) return "design";
    return null;
  }

  // Attach history per case (CaseHistory.jsx attaches `case_history`
  // to caseData; DataContext rows have none until we fetch).
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
  const allRows = snap.cases.map(mapRow);
  // CaseHistory has caseData with case_history attached; allRows entries don't.
  const focal = allRows.find(
    (c) =>
      String(c.casenumber || "").trim() === String(FOCAL).trim() &&
      c.completed !== true
  );
  if (!focal) {
    console.error(`No active case with casenumber=${FOCAL}`);
    process.exit(1);
  }
  // Production CaseHistory sets `caseData = mapRow(rawCase); caseData.case_history = hist;`
  const caseData = { ...focal, case_history: histByCase.get(focal.id) || [] };
  const stage = stageFromModifiers(caseData.modifiers) || "design";
  console.log(
    `\nFocal case: #${focal.casenumber} (${focal.department}, stage=${stage}, completed=${focal.completed})`
  );
  console.log(
    `History rows attached: ${(caseData.case_history || []).length}\n`
  );

  // ─── Fake dbClient that returns the fixture's history rows for the
  //     active case IDs requested. computeCaseForecast issues a single
  //     `.from("case_history").select(...).in("case_id", activeIds)`.
  const dbClient = {
    from: (table) => ({
      select: () => ({
        in: async (column, ids) => {
          if (table !== "case_history") return { data: [], error: null };
          const idSet = new Set(ids);
          const rows = snap.history.filter((h) => idSet.has(h.case_id));
          return { data: rows, error: null };
        },
      }),
    }),
  };

  // Use the same `now` for both paths so elapsedWorkHours doesn't
  // drift by the ~30ms it takes to run one path before the other.
  const sharedNow = new Date();

  // ───────────────────────────────────────────────────────────────────
  //   Path B (CaseHistory) — invokes the EXACT production function.
  // ───────────────────────────────────────────────────────────────────
  const tB0 = Date.now();
  const predB = await computeCaseForecast({
    caseData,
    allRows,
    id: focal.id,
    dbClient,
    now: sharedNow,
  });
  const tB = Date.now() - tB0;

  // ───────────────────────────────────────────────────────────────────
  //   Path A (Efficiency) — mirrors lines 1364–1492 of
  //   src/utils/efficiencyCalculations.js exactly:
  //
  //     allActiveCases    = active cases with case_history (built by
  //                         calculateStageStatistics via shapeCase)
  //     allCasesInStage   = active in stage, with currentStage forced
  //     labPoolSource     = allActiveCases
  //     recentCompleted   = extractRecentCompletedVisits(labPoolSource)
  //     labContext        = computeLabContextV9(labPoolSource, …)
  //     generateCaseRiskPredictions(allCasesInStage, null, stage, null,
  //                                 { labContext, recentCompletedVisits })
  //
  //   We use the same shapeCase shape Efficiency builds.
  // ───────────────────────────────────────────────────────────────────
  function shapeCase(c, currentStageOverride = null) {
    const mods = c.modifiers || [];
    return {
      id: c.id,
      caseNumber: c.casenumber,
      casenumber: c.casenumber,
      caseType: mods.includes("bbs") ? "bbs"
        : mods.includes("flex") ? "flex"
        : "general",
      modifiers: mods,
      created_at: c.created_at,
      due: c.due,
      completed: !!c.completed,
      completed_at: c.completed_at,
      priority: !!c.priority,
      rush: mods.includes("rush") || !!c.priority,
      department: c.department,
      case_history: histByCase.get(c.id) || [],
      isActive: !c.completed,
      stage: stageFromModifiers(mods),
      currentStage: currentStageOverride || stageFromModifiers(mods),
    };
  }
  const casesWithHistoryRaw = snap.cases;
  const allActiveCases = casesWithHistoryRaw
    .filter((c) => !c.completed)
    .map((c) => shapeCase(c));
  const allCasesInStage = casesWithHistoryRaw
    .filter((c) => !c.completed && stageFromModifiers(c.modifiers || []) === stage)
    .map((c) => shapeCase(c, stage));

  const tA0 = Date.now();
  const visitsA = engine.extractRecentCompletedVisits(
    allActiveCases,
    sharedNow,
    30
  );
  const labCtxA = engine.computeLabContextV9(allActiveCases, visitsA, sharedNow);
  const resultA = engine.generateCaseRiskPredictions(
    allCasesInStage,
    null,
    stage,
    null,
    { labContext: labCtxA, recentCompletedVisits: visitsA }
  );
  const tA = Date.now() - tA0;
  const predA = (resultA?.predictions || []).find((p) => p.id === focal.id);

  // ─── Print ──────────────────────────────────────────────────────────
  console.log("─".repeat(78));
  console.log(`Prediction for #${focal.casenumber}`);
  console.log("─".repeat(78));
  const fields = [
    "riskLevel",
    "lateProbability",
    "lateProbabilityDirect",
    "lateProbabilityQuantile",
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
    pad("Efficiency (A)", 18),
    pad("CaseHistory (B)", 18)
  );
  console.log("─".repeat(78));
  let anyDiff = false;
  for (const f of fields) {
    const a = predA?.[f];
    const b = predB?.[f];
    const diff = !same(a, b);
    if (diff) anyDiff = true;
    console.log(
      pad(f, 28),
      pad(fmt(a), 18),
      pad(fmt(b) + (diff ? " ◀" : "  ✓"), 18)
    );
  }
  console.log("\nTimings:");
  console.log(`  Efficiency (A):  ${tA}ms`);
  console.log(`  CaseHistory (B): ${tB}ms`);
  console.log();
  if (!anyDiff) {
    console.log("  ✓ PARITY: Efficiency and CaseHistory produce identical predictions.");
    process.exit(0);
  } else {
    console.log("  ✗ MISMATCH — see ◀ marks above.");
    process.exit(1);
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
    // Allow ~4ms of drift for fields derived from `now` — the two paths
    // can't share Date.now() because the engine reads it internally.
    return Math.abs(a - b) < 1e-3;
  }
  return a === b;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
