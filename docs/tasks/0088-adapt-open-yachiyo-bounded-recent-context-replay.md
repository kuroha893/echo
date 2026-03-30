# Task Card 0088

## Title
Adapt open-yachiyo's bounded recent-message context replay for Echo's post-task85 same-session continuity

## Role
Implementer

## Goal
Give Echo real short-term same-session continuity so follow-up questions are no
longer treated like isolated one-turn prompts.

The user-visible problem is simple:

- even in the same chat session, Echo behaves as if each question is unrelated
  to the previous one

The technical cause in current Echo is also simple:

- the primary LLM path currently builds messages from only the current user
  utterance
- recent transcript history is not being replayed into the active prompt
- after task85, Echo may also have a composed assistant turn whose visible form
  is:
  - spoken local quick prefix
  - plus primary continuation
  so recent-context replay must source from the **canonical composed turn**, not
  from internal quick-reaction candidates or duplicated assistant-prefill state

This task adopts open-yachiyo's bounded recent-message replay pattern.

## Scope Clarification
This task is only for **same-session short-term context continuity**.

It is not a long-term memory redesign.
It is not about vector memory, memory tools, or cross-session recall.

Assume the following tasks are already complete and must remain true:

- task85: visible/audible assistant output now follows conditional dual-track
  handoff
- if a genuine local quick prefix is spoken, the desktop-visible assistant turn
  becomes the composed result of:
  - spoken quick prefix
  - plus primary continuation

This task must replay the **same assistant turn the user actually experienced**.
It must not replay:

- raw QuickReactionReadyEvent candidate text that was never spoken
- duplicated copies of a spoken quick prefix plus assistant-prefill plus final
  transcript text
- hidden internal routing artifacts

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [events.md](/C:/Users/123/Desktop/echo/docs/protocol/events.md)
- [orchestrator-spec.md](/C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md)
- [0085-unify-audible-and-visible-assistant-output.md](/C:/Users/123/Desktop/echo/docs/tasks/0085-unify-audible-and-visible-assistant-output.md)
- Primary mirrored reference repo:
  - [contextBuilder.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/runtime/session/contextBuilder.js)
  - [server.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/gateway/server.js)
- Supplementary mirrored reference repo:
  - [Stage.vue](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/components/scenes/Stage.vue)
- Existing Echo implementation files:
  - [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
  - [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)

## How open-yachiyo solves this
open-yachiyo explicitly rebuilds a bounded recent-message context from the
session store.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\runtime\session\contextBuilder.js`

```javascript
function buildRecentContextMessages(session, { maxMessages = 12, maxChars = 12000 } = {}) {
  ...
  return collected.reverse();
}
```

and then injects it into prompt construction:

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\gateway\server.js`

```javascript
const recentMessages = buildRecentContextMessages(session, {
  maxMessages: contextMaxMessages,
  maxChars: contextMaxChars
});

return [...seedMessages, ...recentMessages];
```

This matters because it is simple, deterministic, bounded, and already proven to
solve exactly the "same session feels stateless" problem.

The open-yachiyo lesson to copy is the replay policy shape:

- take recent canonical session messages
- cap message count
- cap character budget
- preserve turn order

The part **not** to copy blindly is its exact storage model. Echo must replay
from its own canonical session transcript state.

## How AIRI solves this
AIRI is supplementary here, not primary. The useful reinforcement from AIRI is
that the stage runtime clearly distinguishes streaming token handling,
assistant-response end, and other live interaction hooks. That confirms Echo can
preserve streaming behavior while still improving turn-to-turn continuity.

This task should not imitate an AIRI memory subsystem. The primary model is
open-yachiyo.

## What Echo should adopt
- Add a bounded recent-transcript replay step to Echo's primary LLM message
  assembly.
- Preserve user/assistant ordering.
- Cap both:
  - number of entries
  - total character budget
- Use the current session's transcript/snapshot data as the source of truth for
  recent conversation replay.
- After task85, define the replay source carefully:
  - replay the canonical assistant-visible turn
  - not raw internal quick-reaction candidate text
  - not duplicated assistant-prefill text when it has already been absorbed into
    the canonical assistant transcript
- Ensure assistant-prefill handoff for the **current** turn and bounded replay
  of **previous** turns do not double-count the same spoken prefix.

## What Echo must not copy directly
- Do not transplant open-yachiyo's gateway/session store structure wholesale.
- Do not turn this task into long-term memory or vector retrieval.
- Do not make prompt construction unbounded.
- Do not change Echo protocol semantics unless a separate protocol task is
  required.
- Do not replay hidden routing decisions, raw QuickReactionReadyEvent candidate
  text, or internal handoff bookkeeping as user-visible conversation history.

## Files To Create Or Modify
- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- relevant tests under:
  - [tests/orchestrator](/C:/Users/123/Desktop/echo/tests/orchestrator)
  - [tests/runtime](/C:/Users/123/Desktop/echo/tests/runtime)

## Hard Requirements
1. The active primary LLM path must no longer send only the current utterance.
2. Same-session recent transcript history must be replayed in bounded form.
3. The replay policy must be deterministic and capped.
4. This task must not expand into long-term memory redesign.
5. The replay source must be the canonical composed session transcript the user
   actually saw/heard after task85, not internal prefill/handoff artifacts.

## Out Of Scope
- long-term memory search/write
- memory tools
- cross-session recall
- TTS transport
- lipsync/expression work

## Validation Expectations
1. Add tests proving turn 2 includes turn 1 context.
2. Add tests proving user/assistant order is preserved in injected context.
3. Add tests proving the history budget is bounded by both entry count and text
   size.
4. Add tests proving a spoken local quick prefix plus primary continuation is
   replayed once as one canonical assistant turn, not duplicated as:
   - quick candidate
   - assistant prefill
   - final assistant text
5. Add a test proving a silent/internal cloud-backed quick candidate is not
   replayed as a historical assistant turn.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Same-session follow-up questions no longer behave like fresh isolated prompts.
- Echo can refer back to recent user and assistant turns within the same
  session.
- The implementation remains bounded and deterministic.
- Task85's canonical audible/visible assistant turn remains the replay source of
  truth.
