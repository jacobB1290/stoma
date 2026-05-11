#!/usr/bin/env node
/**
 * test-forecast-diff.mjs
 *
 * Parity harness for the case-modal Risk Forecast.
 *
 * The in-modal forecast and the Efficiency screen now share one code
 * path: both go through `calculateStageStatistics` →
 * `calculateDepartmentEfficiency`. CaseHistory's wrapper
 * (`computeCaseForecast` in src/utils/caseForecastCompute.js) just
 * pulls the focal case's prediction out of the same result object
 * Efficiency renders.
 *
 * The harness invokes that production function directly (no
 * re-implementation) and ALSO invokes the Efficiency entry points
 * directly. Both must produce the same prediction object for the
 * focal case — by construction. The test is regression coverage.
 *
 * Usage:
 *   node scripts/test-forecast-diff.mjs --case=459
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

  // Stub browser globals that production code reaches for. ThrottledProcessor
  // uses requestIdleCallback for UI smoothness; in Node we just run synchronously.
  const ric = (cb) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
  globalThis.window = globalThis.window || {
    requestIdleCallback: ric,
    cancelIdleCallback: clearTimeout,
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: clearTimeout,
  };
  globalThis.requestIdleCallback = globalThis.requestIdleCallback || ric;
  globalThis.cancelIdleCallback = globalThis.cancelIdleCallback || clearTimeout;
  globalThis.document = globalThis.document || {};

  // ─── transpile production source through babel ──
  const babel = require("@babel/core");
  const fs = require("node:fs");
  const os = require("node:os");

  // Map of original module path → transpiled tmp path. Other prod
  // modules' `require("./relative")` calls get rewritten to point at
  // the corresponding tmp file so the harness loads a coherent graph.
  const moduleMap = new Map();

  // Stub the shared db client: returns the fixture's cases + history.
  // `calculateStageStatistics` issues exactly one query:
  //   db.from("cases").select("*, case_history(*)")
  //     .eq("department", "General").eq("archived", false)
  //     .order("created_at", { ascending: false });
  // We embed history into each case row at fetch time.
  function buildFakeDb() {
    const histByCase = new Map();
    for (const h of snap.history) {
      if (!histByCase.has(h.case_id)) histByCase.set(h.case_id, []);
      histByCase.get(h.case_id).push(h);
    }
    return {
      from: (table) => {
        const state = { table, filters: {}, order: null };
        const builder = {
          select() {
            return builder;
          },
          eq(col, val) {
            state.filters[col] = val;
            return builder;
          },
          in(col, vals) {
            state.filters[col] = { in: new Set(vals) };
            return builder;
          },
          order(col, opts) {
            state.order = { col, opts };
            return builder;
          },
          single() {
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve, reject) {
            return Promise.resolve(this._exec()).then(resolve, reject);
          },
          _exec() {
            if (state.table === "cases") {
              let rows = snap.cases.slice();
              for (const [col, val] of Object.entries(state.filters)) {
                if (val && typeof val === "object" && val.in) {
                  rows = rows.filter((r) => val.in.has(r[col]));
                } else {
                  rows = rows.filter((r) => r[col] === val);
                }
              }
              rows = rows.map((r) => ({
                ...r,
                case_history: histByCase.get(r.id) || [],
              }));
              if (state.order) {
                const c = state.order.col;
                const asc = state.order.opts?.ascending !== false;
                rows = rows
                  .slice()
                  .sort((a, b) =>
                    asc
                      ? new Date(a[c]) - new Date(b[c])
                      : new Date(b[c]) - new Date(a[c])
                  );
              }
              return { data: rows, error: null };
            }
            if (state.table === "case_history") {
              let rows = snap.history.slice();
              for (const [col, val] of Object.entries(state.filters)) {
                if (val && typeof val === "object" && val.in) {
                  rows = rows.filter((r) => val.in.has(r[col]));
                } else {
                  rows = rows.filter((r) => r[col] === val);
                }
              }
              return { data: rows, error: null };
            }
            return { data: [], error: null };
          },
        };
        return builder;
      },
    };
  }
  const fakeDb = buildFakeDb();

  function loadProdModule(srcPath, depRewrites = {}) {
    const transpiled = babel.transformFileSync(srcPath, {
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
      .replace(/require\(["']motion\/react["']\)/g, "new Proxy({}, { get: () => () => null })")
      .replace(/require\(["']clsx["']\)/g, "() => ''");

    // Rewrite relative requires to point at already-transpiled tmp files.
    for (const [needle, replacement] of Object.entries(depRewrites)) {
      const re = new RegExp(
        `require\\(["'][^"']*${needle}["']\\)`,
        "g"
      );
      code = code.replace(re, `require(${JSON.stringify(replacement)})`);
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `prod-${path.basename(srcPath, ".js")}-${process.pid}.cjs`
    );
    fs.writeFileSync(tmpFile, code);
    moduleMap.set(srcPath, tmpFile);
    return tmpFile;
  }

  // Order matters: leaves first, then modules that depend on them.
  const srcDir = path.join(REPO_ROOT, "src");
  const caseServicePath = path.join(srcDir, "services", "caseService.js");
  const enginePath = path.join(srcDir, "utils", "caseRiskPredictions.js");
  const stageTimePath = path.join(srcDir, "utils", "stageTimeCalculations.js");
  const throttledPath = path.join(srcDir, "utils", "throttledProcessor.js");
  const efficiencyPath = path.join(srcDir, "utils", "efficiencyCalculations.js");
  const forecastPath = path.join(srcDir, "utils", "caseForecastCompute.js");

  // Stub caseService entirely — replace with our fakeDb at load time.
  const caseServiceTmp = path.join(
    os.tmpdir(),
    `prod-caseService-${process.pid}.cjs`
  );
  fs.writeFileSync(
    caseServiceTmp,
    `module.exports = { db: ${JSON.stringify(null)}, parseNoteTime: () => null };`
  );
  moduleMap.set(caseServicePath, caseServiceTmp);

  const throttledTmp = loadProdModule(throttledPath, {});
  const engineTmp = loadProdModule(enginePath, {});
  const engine = require(engineTmp);

  const stageTimeTmp = loadProdModule(stageTimePath, {
    "services/caseService": caseServiceTmp,
    "throttledProcessor": throttledTmp,
    "caseRiskPredictions": engineTmp,
  });
  const efficiencyTmp = loadProdModule(efficiencyPath, {
    "services/caseService": caseServiceTmp,
    "throttledProcessor": throttledTmp,
    "caseRiskPredictions": engineTmp,
    "stageTimeCalculations": stageTimeTmp,
  });
  const forecastTmp = loadProdModule(forecastPath, {
    "stageTimeCalculations": stageTimeTmp,
    "efficiencyCalculations": efficiencyTmp,
  });

  // Inject the fake db into the stubbed caseService so any later
  // require("services/caseService") gets our test db.
  fs.writeFileSync(
    caseServiceTmp,
    `const db = ${JSON.stringify(null)};
     module.exports = ${JSON.stringify({ parseNoteTime: null }).slice(0, -1)}, db: globalThis.__TEST_DB__ };`
  );
  // Actually simpler: set globalThis and have caseService read from it.
  fs.writeFileSync(
    caseServiceTmp,
    `module.exports = {
       get db() { return globalThis.__TEST_DB__; },
       parseNoteTime: () => null,
     };`
  );
  globalThis.__TEST_DB__ = fakeDb;

  // Bust require cache for files that imported the (initially empty) caseService
  delete require.cache[stageTimeTmp];
  delete require.cache[efficiencyTmp];
  delete require.cache[forecastTmp];

  const stageTime = require(stageTimeTmp);
  const efficiency = require(efficiencyTmp);
  const { computeCaseForecast } = require(forecastTmp);

  // Load the XGBoost model so ML inference runs.
  const modelPath = path.join(REPO_ROOT, "public", "xgb_v10_origdue.json");
  engine.setModels(JSON.parse(fs.readFileSync(modelPath, "utf8")));
  console.log(`Loaded XGBoost model from ${path.basename(modelPath)}.`);

  // ─── pick focal case ──
  function stageFromModifiers(mods) {
    if (!Array.isArray(mods)) return null;
    if (mods.includes("stage-qc")) return "qc";
    if (mods.includes("stage-finishing")) return "finishing";
    if (mods.includes("stage-production")) return "production";
    if (mods.includes("stage-design")) return "design";
    return null;
  }
  const focal = snap.cases.find(
    (c) =>
      String(c.casenumber || "").trim() === String(FOCAL).trim() &&
      c.completed !== true
  );
  if (!focal) {
    console.error(`No active case with casenumber=${FOCAL}`);
    process.exit(1);
  }
  const stage = stageFromModifiers(focal.modifiers);
  console.log(
    `\nFocal case: #${focal.casenumber} (${focal.department}, stage=${stage}, completed=${focal.completed})\n`
  );

  // ────────────────────────────────────────────────────────────────────
  //   Path A — invoke Efficiency's entry points directly. This is
  //   exactly what the Efficiency screen runs on load.
  // ────────────────────────────────────────────────────────────────────
  const tA0 = Date.now();
  const stats = await stageTime.calculateStageStatistics(stage);
  const effRes = await efficiency.calculateDepartmentEfficiency(
    focal.department,
    stage,
    stats,
    0
  );
  const tA = Date.now() - tA0;
  const predA = (effRes?.predictions?.predictions || []).find(
    (p) => p.id === focal.id
  );

  // ────────────────────────────────────────────────────────────────────
  //   Path B — invoke computeCaseForecast (what CaseHistory.jsx calls).
  //   This function internally calls the same two Efficiency functions,
  //   so the result MUST be the same as Path A. The cache will likely
  //   hit on the second call within the TTL window, so we clear it.
  // ────────────────────────────────────────────────────────────────────
  const { clearForecastCache } = require(forecastTmp);
  clearForecastCache();
  const tB0 = Date.now();
  const predB = await computeCaseForecast({ caseData: focal });
  const tB = Date.now() - tB0;

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
    console.log("  ✓ PARITY: Efficiency and CaseHistory share a single prediction.");
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
    // 5e-3 tolerance covers the ~200ms gap between the two paths
    // calling `new Date()` for `elapsedBH` and `progressPercent`. Real
    // ML output (probabilities, work-hour predictions, counts) match
    // exactly because they're deterministic given the same inputs.
    return Math.abs(a - b) < 5e-3;
  }
  return a === b;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
