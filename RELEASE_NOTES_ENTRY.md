# Release Notes: QA Kernel v4.2 — Conversational Context System

## What's New ✨
- **Yes/no follow-through**: When the assistant offers something ("Want me to pull the critical cases?"), replying "yes", "sure", "yeah", "ok", "go ahead" now actually triggers the offer instead of being treated as a fresh question. "No" / "not really" / "skip" gets a brief acknowledgement and a pivot to other options.
- **Topic memory across turns**: After asking about your score, "fix it" routes to the improvement advisor with the score in mind. After comparing case types, "and General?" continues the comparison. After listing critical cases, "the first one" or "the worst one" pulls up that specific case.
- **The assistant asks follow-up questions**: The case-type comparator asks which type to drill into. The buffer compliance check asks which stage. After a status overview, it offers "want me to pull them up?" and listens for a yes.
- **Reference resolution**: "the first one", "the worst one", "the second one", "#2" — all resolve to items in the most recent list the assistant showed (cases, types, etc.). Common typos for "first" ("frist", "fisrt") still work.
- **Interpretive probes**: "is that bad?", "is that a lot?", "should I be worried?", "anything critical today?" map to the right component based on the active topic.

## What Got Fixed 🐛
- Pending offers now expire correctly after a few turns of staleness so a stale "yes" doesn't accidentally trigger something the user has long forgotten about
- Auto-captured offers no longer override explicit ones set by component handlers
- Indexed-reference detection ("first", "worst") tightened so it doesn't false-fire on prose like "what should I focus on first?"
- Topic switching: a fresh fully-formed question correctly resets the active topic so unrelated answers don't bleed across turns
- Out-of-scope deflections no longer kill the topic — saying "tell me a joke" mid-conversation still leaves the prior topic intact for the next valid follow-up

## For Users 👤
- Conversations feel like talking to someone who remembers the last thing you discussed
- Short follow-ups work the way you'd expect them to: "yes", "no", "fix it", "the worst one", "and design specifically?"
- The assistant takes initiative — it asks for clarification when there's a sensible drill-down, instead of dumping everything at once

## For Developers 👨‍💻
- New session state on `KernelContext`:
  - `pendingOffer` — `{ command, prompt, turnSet }` for yes/no follow-through
  - `pendingClarification` — `{ kind, command|choices }` for shaped clarification answers (case_type, stage, case_number, choice)
  - `conversation.topic` + `topicHistory` — current and prior topics with auto-expiry
  - `conversation.subjectEntities` — caseType / stage / caseNumber / metric carried across turns
  - `conversation.recentList` — last enumerable list shown, kind-tagged so "the first one" knows what it indexes
- New helpers: `setPendingOffer`, `setPendingClarification`, `setRecentList`, `setSubjectEntity`, `setTopic`
- New routing helpers: `enrichWithContext`, `applyClarification`, `parseFirstActionButton`, `autoCapturePendingOffer`
- Component-to-topic mapping in `COMPONENT_TOPICS`, topic-continuation routes in `TOPIC_CONTINUATIONS`
- New audit harness: `test-harness/run-context-audit.mjs` — 39 multi-turn conversations, 146 assertions, organized by tag (yes_no, topic_continuation, reference, clarification, entity_carry, interpretive, multistep, topic_switch, robustness, adversarial)
- Both audits at 100%: conversational flow (1132/1132) + context (146/146)
