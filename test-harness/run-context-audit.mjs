// QA Kernel CONVERSATIONAL CONTEXT audit harness.
//
// This harness specifically tests multi-turn conversational understanding:
//   • yes/no follow-through on offers the assistant just made
//   • topic continuation across short follow-ups ("fix it", "improve that")
//   • pronoun & reference resolution ("the first one", "#2")
//   • clarification answering ("design specifically?")
//   • subject entity carry-over ("compare BBS vs Flex" → "and finishing times?")
//   • interpretive probes ("is that bad?", "should I be worried?")
//   • topic expiry & switching (a fresh question changes subject)
//   • multi-step refinement (3+ turns where each builds on the prior)
//
// Each test is a CONVERSATION (sequence of turns) plus assertions per turn.
// An assertion is a small predicate over the response text. Conversations
// run on a single shared kernel instance so session state persists exactly
// the way it would in production.
//
// Run:
//   node --import ./test-harness/register.mjs test-harness/run-context-audit.mjs
//   ... --verbose to see every turn
//   ... --only=topic_continuation to filter by tag

import { AppQAKernel, CONFIG } from "../src/qa/AppQAKernel.js";

CONFIG.DEBUG.SHOW_ROUTING = false;

const args = new Set(process.argv.slice(2));
const only = [...args].find((a) => a.startsWith("--only="))?.split("=")[1] || null;
const verbose = args.has("--verbose");

// ---------------------------------------------------------------------------
// Mock context
// ---------------------------------------------------------------------------
const mockContext = {
  efficiency: {
    score: 72.4,
    sampleSize: 96,
    confidence: "moderate",
    completedCases: 96,
    department: "Digital",
    stage: "production",
    onTimeDelivery: {
      overall: {
        actualRate: 78.2, bufferCompliance: { design: 0.62, production: 0.71, finishing: 0.85, current: 0.71 },
        rushPriorityCount: 9, rushReductionFactor: 0.18,
      },
      caseInsights: { casesWithPenalties: [
        { caseNumber: "12345" }, { caseNumber: "12346" }, { caseNumber: "12347" }] },
      stageBufferAnalysis: { designViolations: 4, productionViolations: 7, finishingViolations: 1, commonPatterns: ["short design buffer on rush jobs"] },
      byType: { bbs: { actualRate: 65, count: 14 }, flex: { actualRate: 84, count: 22 }, general: { actualRate: 80, count: 60 } },
    },
    throughput: {
      overall: 65,
      averageTime: 9 * 3600 * 1000, medianTime: 7.5 * 3600 * 1000,
      byType: {
        bbs:     { count: 14, mean: 14 * 3600 * 1000, median: 12 * 3600 * 1000, velocityScore: 55 },
        flex:    { count: 22, mean:  7 * 3600 * 1000, median:  6 * 3600 * 1000, velocityScore: 78 },
        general: { count: 31, mean:  8 * 3600 * 1000, median:  7 * 3600 * 1000, velocityScore: 72 },
      },
    },
    predictions: {
      urgent: [
        { caseNumber: "20001", lateProbability: 0.92, daysUntilDue: -1.5, riskLevel: "critical" },
        { caseNumber: "20002", lateProbability: 0.86, daysUntilDue: 0.4, riskLevel: "critical" },
      ],
      high: [{ caseNumber: "30001", lateProbability: 0.65, daysUntilDue: 2.1, riskLevel: "high" }],
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
    },
  },
  stage: "production",
  stageStats: {
    averageTime: 8 * 3600 * 1000, medianTime: 7 * 3600 * 1000, sampleSize: 67,
    typeStats: { bbs: { count: 14, mean: 14*3600*1000 }, flex: { count: 22, mean: 7*3600*1000 } },
    dataQuality: { score: 0.78, issues: ["a few outliers above 24h"] },
  },
  activeDept: "Digital", stageCount: 67, hasData: true, isCalculating: false, showingStats: true,
};

// ---------------------------------------------------------------------------
// Predicate helpers
// ---------------------------------------------------------------------------
const stripMeta = (t) => String(t || "")
  .replace(/\[ACTION:[^\]]*\]/g, "")
  .replace(/\[MODAL:[^\]]*\]/g, "")
  .replace(/\[(?:COMPONENTS|INTENT|FOLLOWUPS):[^\]]*\]/g, "")
  .trim();

const contains = (substr) => ({
  desc: `contains "${substr}"`,
  test: (t) => stripMeta(t).toLowerCase().includes(substr.toLowerCase()),
});
const matches = (re, label) => ({
  desc: `matches ${label || re}`,
  test: (t) => re.test(stripMeta(t)),
});
// Same as matches() but checks against the raw response, including
// [ACTION:...]/[MODAL:...] meta tags. Use this when the assertion is
// specifically about whether a meta tag was emitted.
const matchesRaw = (re, label) => ({
  desc: `raw-matches ${label || re}`,
  test: (t) => re.test(String(t || "")),
});
const notContains = (substr) => ({
  desc: `does NOT contain "${substr}"`,
  test: (t) => !stripMeta(t).toLowerCase().includes(substr.toLowerCase()),
});
const notDeflected = () => ({
  desc: "is not an out-of-scope deflection",
  test: (t) => {
    const body = stripMeta(t).toLowerCase();
    const deflectionPhrases = [
      "outside what i can see", "not really my territory", "not my area",
      "i'll pass on that", "weather's not my thing", "comedy's not my strong",
      "not much of a poet",
    ];
    return !deflectionPhrases.some((p) => body.includes(p));
  },
});
const minWords = (n) => ({
  desc: `has at least ${n} words`,
  test: (t) => stripMeta(t).split(/\s+/).filter(Boolean).length >= n,
});
const offersFollowup = () => ({
  desc: "offers a follow-up question or button",
  test: (t) => /\?\s*$/.test(stripMeta(t).split("\n").pop() || "")
            || /\[ACTION:/.test(t),
});
const buttonHas = (re) => ({
  desc: `has a button matching ${re}`,
  test: (t) => {
    const buttons = [...t.matchAll(/\[ACTION:([^|]+)\|([^\]]+)\]/g)];
    return buttons.some(([, label, cmd]) => re.test(label) || re.test(cmd));
  },
});

// ---------------------------------------------------------------------------
// Direct case-lookup tests using a stub that mimics real Supabase rows.
// These exercise the case_lookup component without going through the
// pendingClarification machinery — pure regression coverage for the
// boolean-vs-timestamp bug we fixed in v4.2.1.
// ---------------------------------------------------------------------------
import { DBKnowledge } from "../src/qa/AppQAKernel.js";

// Each casenumber can map to multiple historical rows (reuse of the
// number over time), which is how the production bug surfaced. The
// keys here are the casenumber strings; the values are arrays of rows.
const FIXTURES = {
  // Case 1202 has TWO rows: an old archived/completed one from 2025, and
  // the currently-active one from 2026. The picker should prefer the
  // active row.
  "1202": [
    {
      id: "uuid-1202-archived",
      casenumber: "1202",
      department: "C&B",
      completed: true,
      completed_at: null,
      archived: true,
      created_at: "2025-05-27T12:00:00Z",
      updated_at: "2025-07-30T17:17:00Z",
      due: "2025-06-05T23:00:00Z",
      modifiers: ["completed", "archived"],
    },
    {
      id: "uuid-1202-active",
      casenumber: "1202",
      department: "Digital",
      completed: false,
      archived: false,
      created_at: "2026-04-21T19:45:00Z",
      updated_at: "2026-04-23T18:00:00Z",
      due: "2026-04-23T19:00:00Z",
      modifiers: ["stage-design"],
      priority: true,
    },
  ],
  "9999": [
    {
      id: "uuid-9999",
      casenumber: "9999",
      department: "Digital",
      completed: false,
      completed_at: null,
      created_at: "2025-04-01T08:00:00Z",
      updated_at: "2025-04-15T11:00:00Z",
      due: "2025-05-01T00:00:00Z",
      modifiers: ["stage-production", "rush"],
    },
  ],
  "5555": [
    {
      // No id field — exposes the broken History button bug
      casenumber: "5555",
      department: "C&B",
      completed: false,
      due: "2025-12-31T00:00:00Z",
      modifiers: ["stage-design"],
    },
  ],
  // Timezone edge: plain date in DB that should render as the intended
  // calendar day, not flip to the previous day in negative-offset TZs.
  "8820": [
    {
      id: "uuid-8820",
      casenumber: "8820",
      department: "Digital",
      completed: false,
      archived: false,
      created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 86400000).toISOString(),
      due: "2026-04-23",  // plain date, no time component
      modifiers: ["stage-design"],
    },
  ],
  // Plain date that is "today" — should not be considered overdue yet.
  "8830": [
    (() => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      return {
        id: "uuid-8830",
        casenumber: "8830",
        department: "Digital",
        completed: false,
        archived: false,
        created_at: new Date(Date.now() - 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        due: `${y}-${m}-${d}`,
        modifiers: ["stage-design"],
      };
    })(),
  ],
  // Full timestamp — should render the correct calendar day regardless.
  "8840": [
    {
      id: "uuid-8840",
      casenumber: "8840",
      department: "Digital",
      completed: false,
      archived: false,
      created_at: "2026-05-01T14:00:00Z",
      updated_at: "2026-05-03T10:00:00Z",
      due: "2026-05-10T16:00:00Z",
      modifiers: ["stage-production"],
    },
  ],
};

// Exercise the real _rankCandidates ranking logic by going through the
// method the kernel calls, not by hard-returning the first row.
DBKnowledge.caseByNumber = async (cn) => {
  const rows = FIXTURES[cn] || [];
  return DBKnowledge._rankCandidates(rows);
};

// ---------------------------------------------------------------------------
// Conversation test definitions
// ---------------------------------------------------------------------------
const CONVERSATIONS = [
  // ── DB LOOKUP REGRESSIONS ──────────────────────────────────────────────
  {
    tag: "db_lookup",
    id: "prefers_active_over_archived_duplicate",
    description: "When the same casenumber exists as active AND archived rows, the picker should return the active one",
    turns: [
      { q: "look up case 1202",
        expect: [
          contains("1202"),
          matches(/in design|due|active/i, "active-state language"),
          notContains("archived"),
          notContains("marked completed"),
          notContains("12/31/1969"),
          notContains("1969"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "no_nested_action_modal_tag_leak",
    description: "History modal should be emitted as a flat tag so no broken [ACTION:History|] literal appears",
    turns: [
      { q: "look up case 1202",
        expect: [
          notContains("[ACTION:History|]"),
          notContains("MODAL:HISTORY|undefined"),
          notContains("[ACTION:History|[MODAL:"),
          matchesRaw(/\[MODAL:HISTORY\|[^|]+\|1202\]/, "flat MODAL tag for the case"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "plain_date_due_does_not_flip_to_prev_day",
    description: "Plain-date `due` values must not render as the previous calendar day in negative-offset timezones",
    turns: [
      { q: "tell me about case 8820",
        expect: [
          contains("8820"),
          // Source due is "2026-04-23" (plain date) — must render as 4/23, not 4/22
          contains("4/23/2026"),
          notContains("4/22/2026"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "plain_date_due_overdue_uses_end_of_day",
    description: "When only a plain date is stored, overdue logic must treat end-of-day as the deadline, not midnight",
    turns: [
      { q: "tell me about case 8830",
        expect: [
          contains("8830"),
          // now is Apr 23 afternoon, due is "2026-04-23" — must NOT be overdue
          notContains("overdue"),
          matches(/due today|due in/i, "not-yet-due phrasing"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "full_timestamp_due_renders_correctly",
    description: "Full ISO timestamps should render a sensible local calendar day — not crash or flip arbitrarily",
    turns: [
      { q: "tell me about case 8840",
        expect: [
          contains("8840"),
          // Source is 2026-05-10T16:00:00Z. In any TZ it's May 9, 10, or 11
          // (UTC-12 edge to UTC+14 edge). The key is we render SOMETHING
          // reasonable, not "Invalid Date" or garbage.
          matches(/5\/(9|10|11)\/2026/, "plausible May 9–11 rendering"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "history_button_skipped_when_no_id",
    description: "When data.id is missing the History MODAL tag should NOT be emitted",
    turns: [
      { q: "tell me about case 5555",
        expect: [
          contains("5555"),
          notContains("[ACTION:History|]"),
          notContains("MODAL:HISTORY|undefined"),
          notContains("[MODAL:HISTORY|"),
        ] },
    ],
  },
  {
    tag: "db_lookup",
    id: "active_case_renders_status",
    description: "Active (non-completed) case should describe its current state, not call it complete",
    turns: [
      { q: "tell me about case 9999",
        expect: [
          contains("9999"),
          notContains("completed"),
          matches(/due|in production|overdue/i, "active state phrasing"),
        ] },
    ],
  },



  // ── YES / NO follow-through ─────────────────────────────────────────────
  {
    tag: "yes_no",
    id: "yes_to_main_critical_offer",
    description: "After 'how am I doing?' the assistant offers to pull critical cases. 'yes' should do that.",
    turns: [
      { q: "how am I doing?",
        expect: [contains("72.4"), offersFollowup()] },
      { q: "yes",
        expect: [contains("critical"), contains("20001"), notDeflected()] },
    ],
  },
  {
    tag: "yes_no",
    id: "sure_to_problem_offer",
    description: "'sure' as agreement to walk through fixes",
    turns: [
      { q: "what's wrong?",         expect: [contains("urgent"), offersFollowup()] },
      { q: "sure",                  expect: [notDeflected(), minWords(20)] },
    ],
  },
  {
    tag: "yes_no",
    id: "no_acknowledgement",
    description: "'no' should ack and pivot, not crash or repeat",
    turns: [
      { q: "how am I doing?",       expect: [contains("72.4")] },
      { q: "no",                    expect: [notDeflected(), buttonHas(/Performance|Problems|Help/i)] },
    ],
  },
  {
    tag: "yes_no",
    id: "yeah_after_bottleneck_offer",
    description: "'yeah' should follow through on a bottleneck offer",
    turns: [
      { q: "how am I doing?",       expect: [contains("72.4")] },
      { q: "yeah",                  expect: [notDeflected()] },
    ],
  },

  // ── TOPIC CONTINUATION ─────────────────────────────────────────────────
  {
    tag: "topic_continuation",
    id: "score_then_fix_it",
    description: "After explaining score, 'fix it' should route to improvement advisor",
    turns: [
      { q: "why is my score what it is?", expect: [contains("on-time")] },
      { q: "how do I fix it?",            expect: [contains("on-time"), notDeflected()] },
    ],
  },
  {
    tag: "topic_continuation",
    id: "problems_then_improve_that",
    description: "After listing problems, 'improve that' continues to advisor",
    turns: [
      { q: "what needs attention?",       expect: [contains("urgent")] },
      { q: "how do I improve that?",      expect: [matches(/biggest|focus on|start|lever|movement|critical|on-time/i, "advisor signature"), notDeflected()] },
    ],
  },
  {
    tag: "topic_continuation",
    id: "bottleneck_then_fix",
    description: "After bottleneck identification, 'how do I tackle it?' improves",
    turns: [
      { q: "where are the bottlenecks?",  expect: [contains("velocity").test ? contains("velocity") : minWords(15)] },
      { q: "how do I tackle that?",       expect: [notDeflected(), minWords(20)] },
    ],
  },
  {
    tag: "topic_continuation",
    id: "rush_then_is_that_bad",
    description: "After rush count, 'is that a lot?' should give an interpretive response",
    turns: [
      { q: "how many rush cases?",        expect: [contains("rush")] },
      { q: "is that a lot?",              expect: [notDeflected(), minWords(15)] },
    ],
  },

  // ── PRONOUN / REFERENCE RESOLUTION ─────────────────────────────────────
  {
    tag: "reference",
    id: "first_one_after_critical",
    description: "After listing critical cases, 'tell me about the first one' resolves to case 20001",
    turns: [
      { q: "show me critical cases",      expect: [contains("20001")] },
      { q: "tell me about the first one", expect: [contains("20001"), notDeflected()] },
    ],
  },
  {
    tag: "reference",
    id: "the_worst_one",
    description: "'the worst one' resolves to the top-ranked critical case",
    turns: [
      { q: "show me critical cases",      expect: [contains("20001")] },
      { q: "the worst one?",              expect: [contains("20001"), notDeflected()] },
    ],
  },
  {
    tag: "reference",
    id: "second_late_case",
    description: "'the second one' after a late list",
    turns: [
      { q: "list every case that completed late", expect: [contains("12345")] },
      { q: "the second one",              expect: [contains("12346"), notDeflected()] },
    ],
  },

  // ── CLARIFICATION ANSWERING ────────────────────────────────────────────
  {
    tag: "clarification",
    id: "case_type_then_bbs",
    description: "Case-type comparison asks which type to drill into; 'BBS' answers it",
    turns: [
      { q: "compare BBS vs Flex",         expect: [contains("BBS"), contains("FLEX")] },
      { q: "BBS",                          expect: [contains("BBS"), notDeflected()] },
    ],
  },
  {
    tag: "clarification",
    id: "buffer_then_design",
    description: "Buffer ask should let user say 'design' to drill in",
    turns: [
      { q: "how's our buffer compliance?", expect: [contains("design"), contains("production")] },
      { q: "design",                       expect: [contains("design"), notDeflected()] },
    ],
  },

  // ── SUBJECT ENTITY CARRY-OVER ──────────────────────────────────────────
  {
    tag: "entity_carry",
    id: "compare_then_drill",
    description: "After comparing types, 'and General?' continues with that type as subject",
    turns: [
      { q: "compare case types",          expect: [contains("BBS"), contains("FLEX")] },
      { q: "and general?",                expect: [matches(/general/i, "general"), notDeflected()] },
    ],
  },
  {
    tag: "entity_carry",
    id: "stage_in_buffer_carries",
    description: "After buffer compliance, the chosen stage carries over",
    turns: [
      { q: "buffer compliance?",          expect: [contains("design")] },
      { q: "production specifically",     expect: [contains("production"), notDeflected()] },
    ],
  },

  // ── INTERPRETIVE PROBES ────────────────────────────────────────────────
  {
    tag: "interpretive",
    id: "should_i_be_worried",
    description: "Bare 'should I be worried?' should map to problem sweep",
    turns: [
      { q: "should I be worried?",        expect: [contains("urgent"), notDeflected()] },
    ],
  },
  {
    tag: "interpretive",
    id: "anything_critical_today",
    description: "'anything critical today?' maps to attention sweep",
    turns: [
      { q: "anything critical today?",    expect: [contains("urgent"), notDeflected()] },
    ],
  },

  // ── MULTI-STEP REFINEMENT (3+ turns) ───────────────────────────────────
  {
    tag: "multistep",
    id: "score_why_fix_chain",
    description: "Score → why → fix it (three-step refinement)",
    turns: [
      { q: "what's my score?",            expect: [contains("72.4")] },
      { q: "why?",                        expect: [contains("on-time"), notDeflected()] },
      { q: "how do I fix it?",            expect: [notDeflected(), minWords(25)] },
    ],
  },
  {
    tag: "multistep",
    id: "risk_first_then_dig",
    description: "Risk list → first one → tell me more",
    turns: [
      { q: "show me critical cases",      expect: [contains("20001")] },
      { q: "the first one",               expect: [contains("20001")] },
      { q: "tell me more",                expect: [notDeflected(), minWords(15)] },
    ],
  },
  {
    tag: "multistep",
    id: "buffer_design_then_problems",
    description: "Buffer overview → design drilldown → problem list",
    turns: [
      { q: "buffer compliance?",          expect: [contains("design"), contains("production")] },
      { q: "design",                      expect: [contains("design"), notDeflected()] },
      { q: "what needs attention?",       expect: [contains("urgent")] },
    ],
  },
  {
    tag: "multistep",
    id: "main_yes_then_more",
    description: "Main → yes (critical) → tell me more",
    turns: [
      { q: "how am I doing?",             expect: [contains("72.4")] },
      { q: "yes",                          expect: [contains("critical")] },
      { q: "tell me more",                 expect: [notDeflected(), minWords(15)] },
    ],
  },

  // ── TOPIC SWITCHING (context should not bleed) ─────────────────────────
  {
    tag: "topic_switch",
    id: "switch_from_score_to_risk",
    description: "Asking a fresh fully-formed question should reset topic",
    turns: [
      { q: "score breakdown please",      expect: [contains("on-time")] },
      { q: "what tables are in the database?", expect: [contains("cases"), notContains("score")] },
    ],
  },
  {
    tag: "topic_switch",
    id: "switch_from_critical_to_main",
    description: "After risk list, a status check should not be derailed",
    turns: [
      { q: "show critical cases",          expect: [contains("20001")] },
      { q: "how am I doing today?",        expect: [contains("72.4"), notContains("20001")] },
    ],
  },

  // ── ROBUSTNESS / EDGE CASES ────────────────────────────────────────────
  {
    tag: "robustness",
    id: "yes_with_no_pending",
    description: "Bare 'yes' with nothing pending should ask what they mean, not crash",
    turns: [
      { q: "yes",                          expect: [notDeflected(), minWords(8)] },
    ],
  },
  {
    tag: "robustness",
    id: "back_to_back_yes",
    description: "Two yeses in a row should not loop",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "yes",                          expect: [contains("critical")] },
      { q: "yes",                          expect: [notDeflected()] },
    ],
  },
  {
    tag: "robustness",
    id: "interleaved_unrelated",
    description: "Unrelated question mid-conversation should reset topic, not carry it incorrectly",
    turns: [
      { q: "what's my score?",             expect: [contains("72.4")] },
      { q: "what's the weather?",          expect: [matches(/weather|outside what i can see/i, "weather deflection")] },
      { q: "how do I improve?",            expect: [matches(/biggest|focus on|start|lever|movement|critical|on-time/i, "advisor signature"), notDeflected()] },
    ],
  },
  {
    tag: "robustness",
    id: "long_conversation_persists",
    description: "After 6 turns, context should still resolve a pronoun",
    turns: [
      { q: "what's my score?",             expect: [contains("72.4")] },
      { q: "why?",                         expect: [contains("on-time")] },
      { q: "what's wrong?",                expect: [contains("urgent")] },
      { q: "show critical cases",          expect: [contains("20001")] },
      { q: "tell me more",                 expect: [notDeflected()] },
      { q: "the first one",                expect: [contains("20001"), notDeflected()] },
    ],
  },

  // ── ADVERSARIAL: harder context tests ──────────────────────────────────
  {
    tag: "adversarial",
    id: "yes_yes_yes_chain",
    description: "Three yeses in a row should keep advancing the conversation, never loop",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "yes",                          expect: [contains("critical"), notDeflected()] },
      { q: "yes",                          expect: [notDeflected(), minWords(15)] },
      { q: "yes",                          expect: [notDeflected(), minWords(15)] },
    ],
  },
  {
    tag: "adversarial",
    id: "stale_yes_does_not_fire",
    description: "After 4 unrelated turns a yes should NOT trigger the original offer",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "what tables are there?",       expect: [contains("cases")] },
      { q: "compare case types",           expect: [contains("BBS")] },
      { q: "buffer compliance?",           expect: [contains("design")] },
      { q: "yes",                          expect: [notDeflected(), minWords(8)] },
    ],
  },
  {
    tag: "adversarial",
    id: "context_survives_typo",
    description: "Misspellings shouldn't break context flow",
    turns: [
      { q: "show me critical cases",       expect: [contains("20001")] },
      { q: "the frist one",                expect: [notDeflected()] },  // typo for 'first'
    ],
  },
  {
    tag: "adversarial",
    id: "conflicting_signals",
    description: "Question has both yes-words and a fresh query — should treat as fresh",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "yes please show me the bottlenecks", expect: [matches(/bottleneck|slow|choke|production|design/i, "bottleneck signature"), notDeflected()] },
    ],
  },
  {
    tag: "adversarial",
    id: "double_drilldown",
    description: "Drill into a type, then drill into another — context should switch correctly",
    turns: [
      { q: "compare case types",           expect: [contains("BBS")] },
      { q: "BBS",                          expect: [contains("BBS")] },
      { q: "and Flex?",                    expect: [matches(/flex/i, "flex"), notDeflected()] },
    ],
  },
  {
    tag: "adversarial",
    id: "topic_recovery_after_oos",
    description: "An OOS question shouldn't kill the topic for the next valid follow-up",
    turns: [
      { q: "show critical cases",          expect: [contains("20001")] },
      { q: "tell me a joke",               expect: [matches(/comedy|joke|outside/i, "deflection")] },
      { q: "the first one",                expect: [contains("20001"), notDeflected()] },
    ],
  },
  {
    tag: "adversarial",
    id: "indirect_pronoun_chain",
    description: "Pronoun resolution across two layers of indirection",
    turns: [
      { q: "what needs attention?",        expect: [contains("urgent")] },
      { q: "tell me about the worst one", expect: [matches(/case|critical|risk|attention|urgent/i, "answers about the worst case"), notDeflected()] },
      { q: "how do I fix it?",             expect: [notDeflected(), minWords(20)] },
    ],
  },
  {
    tag: "adversarial",
    id: "ambiguous_pronoun_resolves_via_topic",
    description: "Bare 'and that?' should drill via active topic",
    turns: [
      { q: "how many rush cases?",         expect: [contains("rush")] },
      { q: "is that a problem?",           expect: [notDeflected(), minWords(20)] },
    ],
  },
  {
    tag: "adversarial",
    id: "reverse_yes_no",
    description: "After a 'no', a follow-up question should be honored without offer-baggage",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "no",                           expect: [matches(/skip|all good|no worries|got it/i, "ack pivot")] },
      { q: "what's at risk?",              expect: [contains("20001"), notDeflected()] },
    ],
  },
  {
    tag: "adversarial",
    id: "scenario_then_compare",
    description: "Run a what-if then ask a comparison — both topics should work cleanly",
    turns: [
      { q: "what if 3 cases go late?",     expect: [contains("3 late"), contains("63.5")] },
      { q: "compare case types",           expect: [contains("BBS"), contains("FLEX")] },
    ],
  },
  {
    tag: "adversarial",
    id: "negation_in_answer",
    description: "Replying 'not really' to an offer should ack and pivot, not deflect",
    turns: [
      { q: "how am I doing?",              expect: [contains("72.4")] },
      { q: "not really",                   expect: [notDeflected(), minWords(8)] },
    ],
  },
  {
    tag: "adversarial",
    id: "long_pronoun_chain",
    description: "Five-turn refinement: score → why → fix it → and what about velocity → and that?",
    turns: [
      { q: "what's my score?",             expect: [contains("72.4")] },
      { q: "why?",                         expect: [contains("on-time")] },
      { q: "how do I improve it?",         expect: [notDeflected(), minWords(20)] },
      { q: "where are the bottlenecks?",   expect: [matches(/bottleneck|bbs|production|slow/i, "bottleneck signature")] },
      { q: "and how do I fix that?",       expect: [notDeflected(), minWords(20)] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function runConvo(convo) {
  const kernel = new AppQAKernel();
  const turnResults = [];
  let passes = 0, fails = 0;
  for (const turn of convo.turns) {
    let response = "";
    let error = null;
    try {
      response = await kernel.ask(turn.q, mockContext);
    } catch (e) {
      error = e.message;
      response = `[ERROR] ${e.message}`;
    }
    const checks = turn.expect.map((p) => ({
      desc: p.desc,
      ok: !error && p.test(response),
    }));
    const turnPasses = checks.filter((c) => c.ok).length;
    const turnFails = checks.length - turnPasses;
    passes += turnPasses;
    fails += turnFails;
    turnResults.push({ q: turn.q, response, checks, error });
  }
  return { ...convo, turnResults, passes, fails };
}

async function run() {
  const out = [];
  for (const convo of CONVERSATIONS) {
    if (only && convo.tag !== only) continue;
    out.push(await runConvo(convo));
  }
  let totalPasses = 0, totalFails = 0;
  const perTag = {};
  for (const r of out) {
    totalPasses += r.passes;
    totalFails += r.fails;
    if (!perTag[r.tag]) perTag[r.tag] = { p: 0, f: 0, n: 0 };
    perTag[r.tag].p += r.passes;
    perTag[r.tag].f += r.fails;
    perTag[r.tag].n += 1;
  }
  return { conversations: out, totalPasses, totalFails, perTag };
}

function format(report) {
  const L = [];
  L.push("=".repeat(80));
  L.push("QA KERNEL — CONVERSATIONAL CONTEXT AUDIT");
  L.push("=".repeat(80));
  L.push("");
  L.push("Per-tag scores:");
  for (const [tag, s] of Object.entries(report.perTag)) {
    const total = s.p + s.f;
    const pct = total ? (100 * s.p / total).toFixed(1) : "0.0";
    L.push(`  ${tag.padEnd(22)} ${s.p}/${total} checks  (${pct}%)  across ${s.n} conversations`);
  }
  L.push("");

  for (const c of report.conversations) {
    const total = c.passes + c.fails;
    const pct = total ? (100 * c.passes / total).toFixed(0) : "0";
    if (!verbose && c.fails === 0) continue;
    L.push(`▸ [${c.passes}/${total} = ${pct}%]  ${c.tag}/${c.id}`);
    L.push(`    ${c.description}`);
    for (let i = 0; i < c.turnResults.length; i++) {
      const t = c.turnResults[i];
      L.push(`    Turn ${i + 1}: USER: "${t.q}"`);
      L.push(`            BOT:  ${stripMeta(t.response).split("\n").map((l) => l).join(" ⏎ ").substring(0, 220)}`);
      for (const ch of t.checks) {
        L.push(`              ${ch.ok ? "✓" : "✗"} ${ch.desc}`);
      }
      if (t.error) L.push(`              !! error: ${t.error}`);
    }
    L.push("");
  }

  const total = report.totalPasses + report.totalFails;
  const pct = total ? (100 * report.totalPasses / total).toFixed(1) : "0.0";
  L.push("=".repeat(80));
  L.push(`TOTAL: ${report.totalPasses}/${total} checks  (${pct}%)`);
  L.push("=".repeat(80));
  return L.join("\n");
}

const report = await run();
console.log(format(report));
const total = report.totalPasses + report.totalFails;
process.exit(total && report.totalPasses === total ? 0 : 1);
