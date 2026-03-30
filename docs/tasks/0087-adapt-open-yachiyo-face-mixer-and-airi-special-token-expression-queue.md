# Task Card 0087

## Title
Adapt open-yachiyo's face mixer and AIRI's special-token expression queue for Echo's post-task85 liveliness

## Role
Implementer

## Goal
Make Echo's expression behavior feel alive without letting expressions fight the
mouth or pollute the canonical transcript text.

The user-visible problems are:

- expressions are too sparse
- speaking and expression can feel disconnected
- mouth shape and emotion can work against each other
- future delay/emotion cues should not appear as weird visible text
- after task85, quick reaction may now be a genuinely audible local prefix in
  some turns, so expression logic must not accidentally create a second hidden
  speech source or drift away from the canonical audible assistant turn

## Scope Clarification
This task comes after realtime playback and playback-driven lipsync.

It is about the next layer:

- how expression targets are blended with mouth movement
- how special non-visible cues can trigger delay/emotion/motion behavior

It must not redesign the whole renderer or invent a new public protocol.

Assume the following tasks are already complete and must remain true:

- task83: active speech is realtime/prebuffered
- task84: TTS-only shaping/sanitization exists
- task85: audible assistant output follows the conditional dual-track handoff
  rule
- task86: mouth movement follows actual playback

This task must make the avatar feel more alive **without undoing task85's
single coherent spoken/visible assistant-turn rule**.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [0085-unify-audible-and-visible-assistant-output.md](/C:/Users/123/Desktop/echo/docs/tasks/0085-unify-audible-and-visible-assistant-output.md)
- [0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md](/C:/Users/123/Desktop/echo/docs/tasks/0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md)
- Primary mirrored reference repo:
  - [bootstrap.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bootstrap.js)
- Supplementary mirrored reference repo:
  - [Stage.vue](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/components/scenes/Stage.vue)
- Existing Echo implementation files:
  - [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
  - [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
  - [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)

## How open-yachiyo solves this
open-yachiyo has an explicit face-mixing layer instead of letting expressions
blindly overwrite mouth-related parameters.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\bootstrap.js`

```javascript
function setFaceBlendTarget(nextValues = {}, { replace = false } = {}) {
  const target = replace
    ? { ...FACE_BLEND_DEFAULTS, ...(nextValues || {}) }
    : { ...faceBlendState.target, ...(nextValues || {}) };
  faceBlendState.target = createFaceBlendValues(target);
  return faceBlendState.target;
}
```

and:

```javascript
const finalMouthForm = clamp(
  resolvedMouthForm + faceBlend.mouthForm * emotionMouthWeight,
  -1,
  1
);
```

This matters because expression is not a totally separate override; it is mixed
into the final face pose in a controlled way.

open-yachiyo's important lesson is not just "add more expressions." It is:

- keep one final face state
- blend mouth, emotion, and baseline into that final state
- prevent smile/greet/emotion logic from flattening or overwriting active
  speech mouth parameters

## How AIRI solves this
AIRI treats delay/emotion signals as queueable specials rather than raw visible
text.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenes\Stage.vue`

```typescript
function playSpecialToken(special: string) {
  delaysQueue.enqueue(special)
  emotionMessageContentQueue.enqueue(special)
}
```

and:

```typescript
const emotionsQueue = createQueue<EmotionPayload>({
  handlers: [
    async (ctx) => {
      ...
      currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }
    },
  ],
})
```

This matters because AIRI separates "what the user reads" from "what the stage
should do".

That is especially relevant after task85. Echo now has a sharper distinction
between:

- internal quick-reaction candidate text
- genuinely spoken quick prefix text
- canonical visible assistant turn text

This task should copy AIRI's idea of a separate control stream for stage cues,
not turn those cues back into visible or audible duplicate content.

## What Echo should adopt
- Add an open-yachiyo-style face mixer so mouth shape and emotional face targets
  can coexist.
- Add an AIRI-style queue for non-visible expression/delay cues.
- Keep these cues out of the visible transcript.
- Keep quick reaction available as a low-latency cue source for expression, but
  only as part of task85's already-governed audible/visible path.
- Let both:
  - a genuine audible local quick prefix
  - and a primary continuation
  feed expression intent into the same face-mixing system without producing two
  competing facial stories.

## What Echo must not copy directly
- Do not transplant open-yachiyo's full bootstrap or AIRI's full stage
  component.
- Do not invent new public protocol semantics without a separate protocol task.
- Do not leak special control tokens into user-visible transcript text.
- Do not create hidden extra spoken lines just to make the avatar seem more
  alive.
- Do not treat raw QuickReactionReadyEvent candidate text as the canonical
  visible assistant reply.

## Files To Create Or Modify
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- renderer-side expression/motion helpers under the existing desktop-live2d
  boundaries
- relevant tests and self-checks

## Hard Requirements
1. Expression targets must no longer blindly fight mouth motion.
2. Non-visible emotion/delay cues must not pollute transcript text.
3. Expression liveliness must improve without adding hidden extra spoken text.
4. The implementation must remain deterministic and bounded inside Echo's
   current architecture.
5. Task85's conditional audible quick-prefix behavior must remain intact:
   expression control may observe it, but must not duplicate it or turn a
   non-audible quick candidate into audible speech.

## Out Of Scope
- provider transport
- TTS sanitization
- playback-driven lipsync signal extraction itself
- same-session context replay
- long-term memory

## Validation Expectations
1. Add checks showing expression cues can coexist with mouth motion.
2. Add checks showing delay/emotion cues do not appear in visible transcript
   text.
3. Add at least one scenario proving the avatar feels more lively during speech
   than in the current build.
4. Add a scenario where:
   - a genuine local audible quick prefix occurs
   - primary continuation follows
   - expression/motion feel coherent across the handoff
   - no duplicate audible or visible assistant content appears
5. Add a scenario where cloud-only primary speech still gets expression support
   without requiring a local audible quick prefix.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- The avatar shows more expression during interaction.
- Speaking no longer looks flat because mouth and emotion are fighting each
  other.
- Delay/emotion control does not leak into user-visible text.
- Task85's audible/visible assistant alignment still holds after this work.
