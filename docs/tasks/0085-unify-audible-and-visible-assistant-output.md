# Task Card 0085

## Title
Implement conditional audible quick reaction, local short-circuit, and assistant-prefill handoff without losing transcript/speech alignment

## Role
Implementer

## Goal
Replace Echo's current "quick reaction and primary response can both speak without
knowing about each other" behavior with a bounded dual-track handoff policy that:

- preserves the latency advantage of a real local fast model when one exists
- prevents duplicated greetings/openers
- prevents the user from hearing text that never appears in the visible assistant turn
- allows trivial phatic turns to complete locally without unnecessary cloud calls

This task intentionally supersedes the previous 0085 policy that muted quick
reaction speech unconditionally. That earlier rule was safe, but it also threw
away the main user-facing benefit of a deployed local fast model.

## Problem in User Terms
Right now Echo has a production behavior that feels wrong to users:

- the assistant may say "晚上好" or "我来看看" first
- then the full reply starts and says a similar opener again
- sometimes the user hears extra spoken words that are not present in the final
  visible transcript
- sometimes a trivial greeting still triggers a full cloud call even though a
  local fast model could have handled it immediately

This is not just a TTS quality issue. It is a source-of-truth issue. Echo
currently has two independent assistant-generation paths:

1. a quick-reaction path
2. a primary-response path

Both can influence speech, but the system does not yet give them a strict,
deterministic handoff policy.

## Scope Clarification
This task is about **assistant speech-source alignment and turn handoff policy**.

It is not the task that makes the audio transport truly realtime, and it is not
the task that upgrades lipsync, emotion queueing, or long-form session memory.

This card adapts the user's proposed dual-track idea into Echo's current
contracts:

- keep quick reaction as a real low-latency track
- allow it to become audible only when that track is genuinely backed by the
  local fast route
- allow local short-circuit for trivial phatic turns
- otherwise hand off from the audible local prefix into cloud primary through an
  assistant-prefill continuation strategy

Very important boundary:

- **Do not invent new public protocol fields like `response_padding` or
  `requires_cloud_inference` in this task.**
- Adapt the same behavior using Echo's existing orchestrator-owned routing,
  existing `QuickReaction.text`, existing `LLMMessageRole.ASSISTANT`, and
  internal prompt assembly.

If an implementer concludes that a public protocol/schema change is truly
required, they must stop and raise that as a blocker instead of widening this
task silently.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [events.md](/C:/Users/123/Desktop/echo/docs/protocol/events.md)
- [orchestrator-spec.md](/C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md)
- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- [models.py](/C:/Users/123/Desktop/echo/packages/llm/models.py)

Primary mirrored reference repo:
- [voice.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/runtime/tooling/adapters/voice.js)

Supplementary mirrored reference repo:
- [tts.ts](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/utils/tts.ts)
- [Stage.vue](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/components/scenes/Stage.vue)

## How open-yachiyo solves this
open-yachiyo does not treat speech as a fuzzy side effect of "whatever text
happened to come out first." It treats voice as an explicit, owned request path.

That matters because once speech has a clear request owner, Echo can reason
about:

- which track is allowed to speak
- whether a spoken prefix has already happened
- whether a later track is continuing the same spoken turn or starting a new one

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\runtime\tooling\adapters\voice.js`

```javascript
const payload = {
  request_id: jobId,
  session_id: sessionId,
  text: normalizedText,
  voiceTag,
  model: String(args.model || 'qwen3-tts-vc-2026-01-22'),
  voiceId: String(args.voiceId || ''),
  policyReason: policyResult.reason,
  idempotencyKey: idempotencyKey || null,
  turnId: args.turnId ? String(args.turnId) : null,
  timeoutSec: Math.max(1, Number(args.timeoutSec || 45))
};

publishVoiceEvent(context, 'voice.requested', payload);
return JSON.stringify({
  status: 'accepted',
  route: 'electron_native',
  message: 'Voice request accepted and forwarded to desktop playback pipeline.'
});
```

What Echo should learn from open-yachiyo here is not "copy this file." The
important lesson is:

- one voice request should have one owner
- the desktop speech path should not be a hidden blend of competing assistant
  text sources
- once a prefix is spoken, later continuation should be deliberate, not
  accidental

open-yachiyo also shows that local/runtime-side logic can make bounded,
deterministic decisions before involving heavier downstream work. Echo should
adapt that discipline for local short-circuit behavior.

## How AIRI solves this
AIRI separates literal text flow from special-control flow instead of treating
every emitted token as the same kind of content.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenes\Stage.vue`

```typescript
chatHookCleanups.push(onTokenLiteral(async (literal) => {
  currentChatIntent?.writeLiteral(literal)
}))

chatHookCleanups.push(onTokenSpecial(async (special) => {
  currentChatIntent?.writeSpecial(special)
}))
```

And in AIRI's TTS utility:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\utils\tts.ts`

```typescript
const sanitizeChunk = (text: string) =>
  text
    .replaceAll(TTS_SPECIAL_TOKEN, '')
    .replaceAll(TTS_FLUSH_INSTRUCTION, '')
    .trim()
```

AIRI matters to this task for one reason: it proves that "what is spoken" does
not have to be a naive dump of every upstream low-level text artifact. Echo can
use that same discipline when deciding:

- what counts as the canonical visible assistant text
- what counts as a low-latency local prefix
- what counts as hidden control flow rather than user-visible content

This task is not the AIRI-style chunking task itself, but AIRI's separation of
literal flow from control flow is directly relevant to avoiding semantic
collision.

## Current Echo Constraints That This Task Must Respect
Current Echo already has these facts:

1. `QuickReaction` is a public protocol model with only:
   - `reaction_id`
   - `text`
   - `emotion_tags`
   - `is_interruptible`

   Source:
   [events.py](/C:/Users/123/Desktop/echo/packages/protocol/events.py)

2. Echo's LLM conversation model already allows:
   - `role="assistant"`

   Source:
   [models.py](/C:/Users/123/Desktop/echo/packages/llm/models.py)

3. The orchestrator currently builds LLM messages with only the current user
   utterance:

   Source:
   [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)

```python
def _build_llm_messages(
    self,
    ctx: TurnContext,
    route_kind: LLMRouteKind,
) -> tuple[LLMMessage, ...]:
    del route_kind
    return (
        LLMMessage(
            role=LLMMessageRole.USER,
            content=ctx.utterance_text,
        ),
    )
```

Therefore, this task may safely adapt assistant-prefill handoff inside Echo's
existing message model, but it must not invent a new public quick-reaction
schema in the process.

## What Echo should adopt
Echo should adopt a **conditional dual-track policy** instead of the previous
"quick reaction is always silent" policy.

The intended production behavior after this task is:

1. If quick reaction is actually backed by the configured local fast route,
   quick reaction may become audible.
2. If quick reaction is actually backed by the cloud primary route, quick
   reaction must not become separately audible.
3. If the local fast route determines the turn is a trivial phatic or light
   acknowledgement turn, Echo may complete the turn locally and skip cloud
   primary entirely.
4. If cloud primary is still required, the locally spoken quick reaction text
   must be handed off into the primary response through an injected assistant
   prefix so the primary response continues from that prefix instead of
   repeating it.
5. The visible assistant transcript must remain coherent with what the user
   heard.

In plain language:

- a real local quick reaction may speak first
- a cloud primary may continue after it
- but the cloud primary must not restart the conversation from zero
- and a cloud-backed quick reaction must not waste time by speaking separately
  and then repeating itself again

## Concrete implementation boundaries
This task should stay inside Echo-owned orchestration and runtime adaptation.

### A. Conditional audibility rule
- Determine whether the quick-reaction route is genuinely local-fast-backed.
- Only that case may enqueue audible quick-reaction speech.
- If the configured quick-reaction profile is the same cloud-primary route used
  by the main answer path, quick reaction stays renderer/expression-only.

### B. Local short-circuit rule
- For trivial phatic/action-feedback turns, allow the local quick-reaction path
  to end the turn without launching cloud primary.
- Use Echo's existing routing and orchestrator-owned decision flow.
- Do not invent a new public JSON quick-reaction payload format in this task.
- If the existing route signals are insufficient, stop and report the exact gap
  instead of guessing.

### C. Assistant-prefill handoff rule
- When a local audible quick reaction is emitted and cloud primary is still
  required, inject that exact spoken prefix into the primary LLM message history
  as an `assistant` message near the end of the request.
- The primary-response instructions must be tightened so the model is explicitly
  told to continue from the injected assistant prefix and not repeat it.
- This must be done through Echo's existing provider-neutral message model, not
  through provider-specific ad hoc knobs.

### D. Canonical transcript rule
- If a quick reaction was materially spoken as part of the assistant turn, the
  user-visible assistant transcript must reflect that same prefix rather than
  hiding it and showing only a later cloud continuation.
- The user must not hear one assistant turn and read a different one.
- This may be implemented as a single coherent assistant entry that begins with
  the quick-reaction prefix and then appends primary continuation.

### E. No silent fallback widening
- Do not silently fall back from "audible local quick reaction with handoff" to
  "audible cloud quick reaction" when no local fast route exists.
- Do not silently fabricate assistant-prefill text that was not actually
  spoken.
- Do not add a hidden second assistant transcript source.

## What Echo must not copy directly
- Do not transplant open-yachiyo's entire voice adapter, request store, or
  event bus design.
- Do not transplant AIRI's full token/special-token runtime.
- Do not change public protocol semantics in `packages/protocol` as part of this
  card.
- Do not invent new public quick-reaction fields like `response_padding` or
  `requires_cloud_inference`.
- Do not add provider-specific prefill hacks that bypass Echo's `LLMMessage`
  contract.
- Do not implement cloud and local tracks as two unrelated assistant-visible
  transcript sources.

## Files To Create Or Modify
- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- relevant tests under:
  - [tests/orchestrator](/C:/Users/123/Desktop/echo/tests/orchestrator)
  - [tests/runtime](/C:/Users/123/Desktop/echo/tests/runtime)

## Hard Requirements
1. Do not keep the old blanket rule "quick reaction is always silent."
2. Quick reaction may be audibly spoken only when it is genuinely backed by the
   local fast route.
3. Cloud-backed quick reaction must not be emitted as separate audible speech in
   active production.
4. Echo must support local short-circuit for trivial low-information turns when
   the local fast route can complete them without cloud inference.
5. When a local audible quick reaction hands off to cloud primary, the primary
   request must include that spoken prefix as an `assistant` message and must be
   instructed to continue instead of repeating the prefix.
6. The canonical visible assistant turn must remain aligned with what the user
   materially heard.
7. Use existing Echo protocol models and existing `LLMMessageRole.ASSISTANT`;
   do not add new public protocol fields in this card.
8. No fallback or degraded-mode behavior may be added silently.

## Out Of Scope
- realtime audio transport redesign
- PCM prebuffered streaming playback
- TTS chunking/sanitization implementation details from task 0084
- lipsync
- emotion queueing / face mixer
- bounded recent session replay from task 0088
- long-term memory

## Validation Expectations
1. Add orchestrator tests proving that in a cloud-only configuration,
   quick reaction is not enqueued as separate audible speech.
2. Add orchestrator tests proving that in a true local-fast configuration,
   quick reaction may become audible.
3. Add tests proving trivial phatic turns can short-circuit locally without
   launching cloud primary.
4. Add tests proving that when local audible quick reaction hands off to cloud
   primary, the primary request messages include an `assistant` prefill message
   containing the exact spoken prefix.
5. Add tests proving the primary response no longer repeats the handed-off
   greeting/opener in the user-visible assistant turn.
6. Add runtime/session tests proving the transcript shown to the user remains
   coherent with what was actually spoken.

## Acceptance Scenarios
- User says "晚上好呀" with a real local fast model available:
  Echo may respond locally and finish the turn without a cloud call.
- User says "晚上好，请帮我检查这段 Python 代码" with a real local fast model
  available:
  Echo may audibly say a short local prefix such as "晚上好，让我来看看……",
  then the cloud primary continues from there instead of greeting again.
- User runs Echo without a local fast model:
  quick reaction may still exist internally, but it does not become a separate
  spoken cloud prefix that duplicates the primary reply.
- The user no longer hears text that is absent from the final visible assistant
  turn.
- Greetings/openers are not spoken twice from quick reaction plus primary
  overlap.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Echo preserves the user-facing latency advantage of a real local fast
  quick-reaction route instead of muting it unconditionally.
- Echo no longer produces a separately audible cloud quick reaction that then
  repeats itself in the primary reply.
- Trivial phatic turns can terminate locally when the local fast route is
  sufficient.
- Complex turns can audibly start locally and continue in cloud primary without
  duplicated greetings/openers.
- The assistant turn the user hears and the assistant turn the user reads are
  coherent and materially aligned.
