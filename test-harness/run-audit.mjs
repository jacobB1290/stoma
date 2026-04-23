// QA Kernel conversational-flow + capability audit harness.
//
// Imports AppQAKernel, builds a fake context, runs a battery of representative
// questions (normal / hard / capability-gap / out-of-scope / multi-turn),
// and scores each response on whether it sounds like a thoughtful colleague
// answering — or a robot dumping a bulleted KV table.
//
// Run with:
//   node --import ./test-harness/register.mjs test-harness/run-audit.mjs
//
// Optional: pass a category filter to focus on one segment:
//   node ... run-audit.mjs --only=HARD
//   node ... run-audit.mjs --verbose

import { AppQAKernel, CONFIG } from "../src/qa/AppQAKernel.js";
import { QUESTIONS } from "./battery.mjs";

// Quiet the routing console.log so the report stays readable
CONFIG.DEBUG.SHOW_ROUTING = false;

// CLI flags
const args = new Set(process.argv.slice(2));
const only = [...args].find((a) => a.startsWith("--only="))?.split("=")[1] || null;
const verbose = args.has("--verbose");
const json = args.has("--json");

// ---------------------------------------------------------------------------
// Mock context payload — mirrors what Board.jsx injects, including the rich
// shapes pulled in via the survey of efficiencyCalculations / stageTimeCalcs.
// ---------------------------------------------------------------------------
const mockContext = {
  efficiency: {
    score: 72.4,
    sampleSize: 96,
    confidence: "moderate",
    activeCases: 67,
    completedCases: 96,
    department: "Digital",
    stage: "production",
    onTimeDelivery: {
      overall: {
        count: 96,
        actualOnTime: 75,
        actualRate: 78.2,
        effectiveOnTime: 78,
        effectiveRate: 81.0,
        avgScore: 71,
        bufferCompliance: { design: 0.62, production: 0.71, finishing: 0.85, current: 0.71 },
        avgHoursLate: 4.2,
        criticalViolations: 3,
        rushPriorityCount: 9,
        rushReductionFactor: 0.18,
      },
      byType: {
        bbs: { actualRate: 65.0, count: 14 },
        flex: { actualRate: 84.0, count: 22 },
        general: { actualRate: 80.5, count: 60 },
      },
      stageBufferAnalysis: {
        designViolations: 4,
        productionViolations: 7,
        finishingViolations: 1,
        commonPatterns: ["short design buffer on rush jobs"],
      },
      caseInsights: {
        casesWithPenalties: [
          { caseNumber: "12345" }, { caseNumber: "12346" }, { caseNumber: "12347" },
        ],
      },
    },
    throughput: {
      overall: 65.0,
      averageTime: 9 * 3600 * 1000,
      medianTime: 7.5 * 3600 * 1000,
      byType: {
        bbs:     { count: 14, mean: 14 * 3600 * 1000, median: 12 * 3600 * 1000, velocityScore: 55 },
        flex:    { count: 22, mean: 7  * 3600 * 1000, median: 6  * 3600 * 1000, velocityScore: 78 },
        general: { count: 31, mean: 8  * 3600 * 1000, median: 7  * 3600 * 1000, velocityScore: 72 },
      },
      insights: [
        "BBS cases are running ~80% slower than Flex",
        "Production stage has the largest spread",
      ],
    },
    predictions: {
      urgent: [
        { caseNumber: "20001", lateProbability: 0.92, daysUntilDue: -1.5, riskLevel: "critical" },
        { caseNumber: "20002", lateProbability: 0.86, daysUntilDue: 0.4, riskLevel: "critical" },
      ],
      high: [
        { caseNumber: "30001", lateProbability: 0.65, daysUntilDue: 2.1, riskLevel: "high" },
      ],
      predictions: [
        { caseNumber: "20001", lateProbability: 0.92, daysUntilDue: -1.5, riskLevel: "critical" },
        { caseNumber: "20002", lateProbability: 0.86, daysUntilDue: 0.4, riskLevel: "critical" },
        { caseNumber: "30001", lateProbability: 0.65, daysUntilDue: 2.1, riskLevel: "high" },
        { caseNumber: "40001", lateProbability: 0.42, daysUntilDue: 3.5, riskLevel: "medium" },
        { caseNumber: "50001", lateProbability: 0.18, daysUntilDue: 6.0, riskLevel: "low" },
      ],
    },
    caseInsights: {
      casesWithPenalties: [
        { caseNumber: "12345", hoursLate: 6.2 },
        { caseNumber: "12346", hoursLate: 14.0 },
        { caseNumber: "12347", hoursLate: 3.8 },
      ],
      lateCases: [
        { caseNumber: "12345", hoursLate: 6.2, type: "bbs" },
        { caseNumber: "12346", hoursLate: 14.0, type: "flex" },
      ],
      bufferViolations: { design: 4, production: 7 },
      summary: { totalCases: 96, completedCases: 96, lateCases: 3 },
    },
  },
  stage: "production",
  stageStats: {
    averageTime: 8 * 3600 * 1000,
    medianTime: 7 * 3600 * 1000,
    p25Time: 5 * 3600 * 1000,
    p75Time: 11 * 3600 * 1000,
    p90Time: 16 * 3600 * 1000,
    sampleSize: 67,
    dataQuality: { score: 0.78, issues: ["a few outliers above 24h"] },
    typeStats: {
      bbs:  { count: 14, mean: 14 * 3600 * 1000 },
      flex: { count: 22, mean: 7  * 3600 * 1000 },
    },
  },
  activeDept: "Digital",
  stageCount: 67,
  hasData: true,
  isCalculating: false,
  showingStats: true,
};

// ---------------------------------------------------------------------------
// Scoring rubric — each rule returns either { ok: true } or { ok: false, why }
// Higher score = more LLM-like, less robotic.
// Some rules are category-aware (e.g. NORMAL questions can be slightly shorter
// than HARD ones; OUT-of-scope responses don't need rich connectives).
// ---------------------------------------------------------------------------
const RULES = [
  {
    id: "not_too_short",
    weight: 1,
    appliesTo: (cat) => cat !== "OUT",
    check: (text) => {
      const body = stripMeta(text);
      const words = body.split(/\s+/).filter(Boolean).length;
      return words >= 14
        ? { ok: true }
        : { ok: false, why: `only ${words} words — too terse for a colleague-style answer` };
    },
  },
  {
    id: "not_too_long",
    weight: 1,
    check: (text) => {
      const words = stripMeta(text).split(/\s+/).filter(Boolean).length;
      return words <= 160
        ? { ok: true }
        : { ok: false, why: `${words} words — verbose, trim it` };
    },
  },
  {
    id: "uses_prose_not_just_bullets",
    weight: 2,
    appliesTo: (cat) => cat !== "OUT",
    check: (text) => {
      const body = stripMeta(text);
      const bulletLines = (body.match(/^[••]/gm) || []).length;
      const proseSentences = body
        .replace(/^[••].*$/gm, "")
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.split(/\s+/).length >= 4).length;
      if (bulletLines === 0) return { ok: true };
      if (proseSentences >= 2) return { ok: true };
      return { ok: false, why: `${bulletLines} bullet line(s) but only ${proseSentences} real sentence(s) of prose` };
    },
  },
  {
    id: "has_natural_connective",
    weight: 2,
    appliesTo: (cat) => cat !== "OUT",
    check: (text) => {
      const body = stripMeta(text).toLowerCase();
      const connectives = [
        "so ", "right now", "looking at", "from what i ", "the thing", "what stands out",
        "biggest", "main thing", "honestly", "couple of", "few of",
        "if you ", "you'll ", "you're ", "you've ", "i'd ", "i'm ",
        "that means", "which is", "which means", "translating", "in other words",
        "for context", "here's", "the short", "the big",
        "worth ", "good news", "bad news", "the catch",
        "and that", "but ", "though", "however", "meanwhile",
        "currently", "today", "this week",
      ];
      const hits = connectives.filter((c) => body.includes(c));
      return hits.length > 0
        ? { ok: true }
        : { ok: false, why: "no natural connective tissue (no 'so', 'right now', 'the thing is', etc.)" };
    },
  },
  {
    id: "no_robotic_template",
    weight: 2,
    check: (text) => {
      const body = stripMeta(text);
      const robotic = /^[A-Z][^.!?\n]{0,30}\s+[—–-]\s+[A-Z][a-z]+\s*$/m.test(body);
      const allCaps = /^[A-Z\s]{8,}$/m.test(body);
      const stiffOpen = /^(Score|Brief|Scenario|Current score|Score breakdown):\s/i.test(body);
      if (robotic || allCaps) return { ok: false, why: "stiff label-style header" };
      if (stiffOpen && body.split(/[.!?]/)[0].split(/\s+/).length < 6) {
        return { ok: false, why: "opens with a stiff label rather than a sentence" };
      }
      return { ok: true };
    },
  },
  {
    id: "varies_opener",
    weight: 1,
    appliesTo: (cat) => cat !== "OUT",
    check: (text, _q, allResponses) => {
      const opener = stripMeta(text).split(/[.!?\n]/)[0].trim().toLowerCase().slice(0, 18);
      const matches = allResponses.filter(
        (r) => stripMeta(r).split(/[.!?\n]/)[0].trim().toLowerCase().slice(0, 18) === opener
      ).length;
      return matches <= 3
        ? { ok: true }
        : { ok: false, why: `opener "${opener}…" repeats across ${matches} responses` };
    },
  },
  {
    id: "complete_sentences",
    weight: 1,
    check: (text) => {
      const body = stripMeta(text)
        .replace(/^[••].*$/gm, "")
        .trim();
      if (!body) return { ok: false, why: "no prose, only bullets" };
      const ends = /[.!?]\s*$/.test(body);
      return ends
        ? { ok: true }
        : { ok: false, why: "doesn't end with proper punctuation" };
    },
  },
  {
    id: "no_emoji_arrow_lead",
    weight: 1,
    check: (text) => {
      const lead = stripMeta(text).split(/\n/)[0];
      if (/[↑↓→←]/.test(lead)) {
        return { ok: false, why: "leads with an arrow glyph instead of words" };
      }
      return { ok: true };
    },
  },
  {
    id: "no_crash",
    weight: 3,
    check: (text) => {
      if (/^\[ERROR\]/.test(text)) {
        return { ok: false, why: "kernel threw" };
      }
      return { ok: true };
    },
  },
  {
    id: "out_of_scope_pivots",
    weight: 2,
    appliesTo: (cat) => cat === "OUT",
    check: (text) => {
      const body = stripMeta(text).toLowerCase();
      // For OOS questions: expect a graceful one-liner + a pivot/CTA
      const hasButton = /\[ACTION:/.test(text);
      const hasOffer = /(want to|how about|i can|let me|try|check|look at|here's|score|case|critical)/i.test(body);
      if (body.length < 20) return { ok: false, why: "too brief for an out-of-scope deflection" };
      if (!hasButton && !hasOffer)
        return { ok: false, why: "no pivot / no CTA / no offer of relevant help" };
      return { ok: true };
    },
  },
  {
    id: "domain_relevant",
    weight: 2,
    appliesTo: (cat) => cat === "HARD" || cat === "GAP" || cat === "NORMAL",
    check: (text, q) => {
      const body = stripMeta(text).toLowerCase();
      const ql = q.toLowerCase();
      // If the question mentions a domain noun, the answer should reference
      // something in the same family (loose check — substring of any keyword).
      const domainPairs = [
        ["bbs", ["bbs", "case type", "type"]],
        ["flex", ["flex", "case type", "type"]],
        ["buffer", ["buffer", "handoff", "compliance"]],
        ["rush", ["rush", "priority"]],
        ["bottleneck", ["bottleneck", "slow", "choke", "drag", "production", "design"]],
        ["score", ["score", "rating", "%"]],
        ["late", ["late", "overdue", "behind", "penalty"]],
        ["sample", ["sample", "data", "confidence", "reliab"]],
        ["weather", []], // out-of-domain triggers nothing
      ];
      const required = [];
      for (const [needle, allowed] of domainPairs) {
        if (ql.includes(needle) && allowed.length) required.push({ needle, allowed });
      }
      for (const r of required) {
        if (!r.allowed.some((kw) => body.includes(kw))) {
          return {
            ok: false,
            why: `question mentions "${r.needle}" but answer doesn't reference any of [${r.allowed.join(", ")}]`,
          };
        }
      }
      return { ok: true };
    },
  },
];

function stripMeta(text) {
  return String(text || "")
    .replace(/\[ACTION:[^\]]*\]/g, "")
    .replace(/\[MODAL:[^\]]*\]/g, "")
    .replace(/\[COMPONENTS:[^\]]*\]/g, "")
    .replace(/\[INTENT:[^\]]*\]/g, "")
    .replace(/\[FOLLOWUPS:[^\]]*\]/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function ask(kernel, q) {
  try {
    return await kernel.ask(q, mockContext);
  } catch (e) {
    return `[ERROR] ${e.message}`;
  }
}

async function run() {
  const kernel = new AppQAKernel();
  const flat = [];

  for (const item of QUESTIONS) {
    if (only && item.category !== only) continue;
    if (item.sequence) {
      // Multi-turn: reuse same kernel so session state carries
      const seqKernel = new AppQAKernel();
      for (let i = 0; i < item.sequence.length; i++) {
        const text = await ask(seqKernel, item.sequence[i]);
        flat.push({
          category: item.category,
          id: `${item.id}_t${i + 1}`,
          q: item.sequence[i],
          text,
        });
      }
    } else {
      const text = await ask(kernel, item.q);
      flat.push({ category: item.category, id: item.id, q: item.q, text });
    }
  }

  const allTexts = flat.map((r) => r.text);

  let totalEarned = 0;
  let totalPossible = 0;
  const details = [];
  const perCategory = {};

  for (const r of flat) {
    let earned = 0;
    let possible = 0;
    const failures = [];
    for (const rule of RULES) {
      if (rule.appliesTo && !rule.appliesTo(r.category)) continue;
      possible += rule.weight;
      const result = rule.check(r.text, r.q, allTexts);
      if (result.ok) earned += rule.weight;
      else failures.push({ id: rule.id, weight: rule.weight, why: result.why });
    }
    totalEarned += earned;
    totalPossible += possible;
    details.push({ ...r, earned, possible, failures });
    if (!perCategory[r.category]) perCategory[r.category] = { e: 0, p: 0, n: 0 };
    perCategory[r.category].e += earned;
    perCategory[r.category].p += possible;
    perCategory[r.category].n += 1;
  }

  return { details, totalEarned, totalPossible,
    pct: (100 * totalEarned) / totalPossible, perCategory };
}

function format(report) {
  const lines = [];
  lines.push("=".repeat(78));
  lines.push("QA KERNEL CONVERSATIONAL-FLOW + CAPABILITY AUDIT");
  lines.push("=".repeat(78));

  // Per-category summary first (always shown)
  lines.push("");
  lines.push("Per-category scores:");
  for (const [cat, s] of Object.entries(report.perCategory)) {
    const pct = (100 * s.e) / s.p;
    lines.push(`  ${cat.padEnd(10)} ${s.e}/${s.p}  (${pct.toFixed(1)}%)  across ${s.n} questions`);
  }
  lines.push("");

  // Show only failures unless --verbose
  for (const r of report.details) {
    if (!verbose && r.failures.length === 0) continue;
    const score = `${r.earned}/${r.possible}`;
    lines.push(`[${score}] ${r.category}/${r.id}  —  Q: "${r.q}"`);
    lines.push("---");
    lines.push(stripMetaForReport(r.text).split("\n").map((l) => "  " + l).join("\n"));
    if (r.failures.length) {
      lines.push("  FAILS:");
      for (const f of r.failures) lines.push(`    - ${f.id} (-${f.weight}): ${f.why}`);
    }
    lines.push("");
  }

  // Per-rule failure summary
  const ruleFails = {};
  for (const r of report.details)
    for (const x of r.failures) ruleFails[x.id] = (ruleFails[x.id] || 0) + 1;
  lines.push("Failures per rule:");
  for (const [id, n] of Object.entries(ruleFails).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id}: ${n}`);
  }

  lines.push("");
  lines.push("=".repeat(78));
  lines.push(`TOTAL: ${report.totalEarned}/${report.totalPossible}  (${report.pct.toFixed(1)}%)`);
  lines.push("=".repeat(78));

  return lines.join("\n");
}

function stripMetaForReport(text) {
  return String(text || "").replace(/\[ACTION:([^|]+)\|[^\]]+\]/g, "[$1]");
}

const report = await run();
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(format(report));
}
process.exit(report.pct >= 90 ? 0 : 1);
