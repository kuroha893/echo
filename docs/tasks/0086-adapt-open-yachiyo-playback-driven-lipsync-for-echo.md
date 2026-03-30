# Task Card 0086

## Title
Adapt open-yachiyo's playback-driven lipsync stack for Echo's post-task85 active speech path

## Role
Implementer

## Goal
Make Echo's Live2D mouth movement follow the actual active speech signal during
playback, instead of frequently staying still while speech is audible.

The user-visible problems are:

- speech can play while the mouth does not move
- long spoken answers feel lifeless
- current active audio formats do not reliably produce lipsync frames
- after task85, the audible assistant stream may begin with a genuine
  local-fast quick prefix and continue into the primary response, but the mouth
  still does not reliably track that full spoken stream

This task adopts open-yachiyo's playback-driven lipsync strategy and keeps AIRI
only as a secondary reference for the animation-loop shape.

## Scope Clarification
This task is only about lipsync driven by the real active playback signal.

It is not yet about emotion mixing, delay tokens, or broader face/expression
policy. Those are in the next task.

Assume the following tasks are already complete and must remain true:

- task83: active Qwen TTS playback is now realtime/prebuffered rather than
  final-fragment-only buffered playback
- task84: TTS-facing text shaping/sanitization exists
- task85: audible assistant output is now governed by conditional dual-track
  handoff, meaning a turn may contain:
  - a genuine local-fast audible quick prefix
  - followed by a primary continuation
  - or a local short-circuit spoken reply with no cloud primary at all

This task must make lipsync follow the **actual spoken stream after those
changes**, not the pre-task85 assumption that quick reaction is always silent.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md](/C:/Users/123/Desktop/echo/docs/tasks/0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md)
- [0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md](/C:/Users/123/Desktop/echo/docs/tasks/0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md)
- [0085-unify-audible-and-visible-assistant-output.md](/C:/Users/123/Desktop/echo/docs/tasks/0085-unify-audible-and-visible-assistant-output.md)
- Primary mirrored reference repo:
  - [bootstrap.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bootstrap.js)
  - [realtimeVoicePlayer.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/realtimeVoicePlayer.js)
  - [VOICE_LIPSYNC_DEBUG_GUIDE.md](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/docs/VOICE_LIPSYNC_DEBUG_GUIDE.md)
- Supplementary mirrored reference repo:
  - [Stage.vue](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/components/scenes/Stage.vue)
- Existing Echo implementation files:
  - [dom_audio_playback_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/dom_audio_playback_backend.mjs)
  - [audio_lipsync_analyzer.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_lipsync_analyzer.mjs)
  - [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
  - [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)

## How open-yachiyo solves this
open-yachiyo does not treat lipsync as an afterthought. It builds a full
playback-driven chain:

- analyse the active voice signal
- derive raw mouth parameters
- enhance them using speaking-aware rules
- smooth them over time
- write them into Live2D model params

The most important local anchor is `enhanceMouthParams(...)`.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\bootstrap.js`

```javascript
function enhanceMouthParams({ mouthOpen = 0, mouthForm = 0, voiceEnergy = 0, speaking = false } = {}) {
  const rawOpen = clamp(Number(mouthOpen) || 0, 0, 1);
  const rawForm = clamp(Number(mouthForm) || 0, -1, 1);
  const energy = clamp(Number(voiceEnergy) || 0, 0, 1);
  const active = Boolean(speaking);
  ...
}
```

That matters because open-yachiyo is not just reading waveform energy and
dumping it straight into the model. It adds speaking-aware shaping and
stability.

Its debug guide also makes clear the internal chain is:

- viseme analysis
- mouth enhancement
- transition smoothing
- final parameter write

The other crucial point from open-yachiyo is that lipsync is tied to the same
realtime playback chain that actually speaks. It is not derived from the text,
and it is not reconstructed later from a compressed bytestream after the fact.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\realtimeVoicePlayer.js`

```javascript
function enqueuePcm16Chunk(base64Data) {
  const float32 = pcm16ToFloat32(base64ToArrayBuffer(base64Data));
  const buffer = audioContext.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);
  scheduleBufferPlayback(buffer);
}
```

The exact helper names in Echo do not need to match, but the behavior does:

- active playback receives realtime PCM chunks
- the same playback-owned audio signal is available for lipsync analysis
- mouth movement follows what is really being heard, including a local audible
  quick prefix when task85 allows one

## How AIRI solves this
AIRI's useful idea here is the runtime loop shape: playback audio is connected
to lip-sync processing, and a live loop keeps pulling the mouth-open value while
speech is active.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenes\Stage.vue`

```typescript
const lipSync = await createLive2DLipSync(audioContext, wlipsyncProfile as Profile, live2dLipSyncOptions)
live2dLipSync.value = lipSync
lipSyncNode.value = lipSync.node
```

and:

```typescript
if (!nowSpeaking.value || !live2dLipSync.value) {
  mouthOpenSize.value = 0
}
else {
  mouthOpenSize.value = live2dLipSync.value.getMouthOpen()
}
```

This reinforces that lipsync should be tied to the actual audio path and
polled/updated while speaking is active.

The AIRI lesson here is not to copy its whole stage component. The lesson is
that the runtime loop should treat "speaking right now" as a first-class state,
and keep pulling mouth-open values while the audio path is active.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenes\Stage.vue`

```typescript
if (sourceNode.value && lipSyncNode.value) {
  sourceNode.value.connect(audioAnalyser.value!)
  sourceNode.value.connect(lipSyncNode.value)
}
```

## What Echo should adopt
- Make the active streaming playback signal the source of lipsync analysis.
- Ensure the active audio format used after task 0083 can drive lipsync without
  lossy compressed-fragment tricks.
- Add speaking-aware mouth enhancement and smoothing modeled on open-yachiyo.
- Treat task85's audible quick-prefix + primary-continuation stream as one
  continuous lipsync-driving speech source from the user's perspective.
- Ensure local short-circuit turns still produce mouth motion even though no
  primary cloud continuation exists.
- Keep the implementation inside Echo's existing renderer/audio boundaries.

## What Echo must not copy directly
- Do not transplant open-yachiyo's entire renderer bootstrap.
- Do not introduce open-yachiyo-specific debug-event semantics into Echo unless
  separately defined.
- Do not rely on compressed-audio fragment concatenation for lipsync in the
  active path.
- Do not infer mouth motion from transcript text, queued TTS text, or raw
  QuickReactionReadyEvent candidate text.
- Do not reintroduce a second independent lipsync source that ignores task85's
  audible/visible alignment rules.

## Files To Create Or Modify
- [audio_lipsync_analyzer.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_lipsync_analyzer.mjs)
- [dom_audio_playback_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/dom_audio_playback_backend.mjs)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [audio_playback_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_playback_controller.mjs)
- relevant tests or self-checks under:
  - [apps/desktop-live2d/renderer](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer)
  - [tests](/C:/Users/123/Desktop/echo/tests)

## Hard Requirements
1. The active speech path must produce usable lipsync frames.
2. Mouth motion must be driven by actual playback, not guessed from text.
3. Mouth motion must continue to work for long streaming utterances.
4. Mouth motion must work across all task85-valid spoken patterns:
   - local audible quick prefix followed by primary continuation
   - local short-circuit spoken reply
   - cloud-only primary reply
5. If the active playback signal cannot supply the data required for lipsync,
   the implementation must fail fast rather than silently animating a fake
   mouth pattern.

## Out Of Scope
- face/expression mixer
- special-token emotion queue
- quick reaction policy
- assistant-prefill routing semantics
- same-session context replay

## Validation Expectations
1. Add a validation path showing active speech produces nonzero mouth movement.
2. Add coverage for long streaming utterances, not just one-shot short clips.
3. Verify the active speech format is supported by the lipsync analyzer.
4. Add at least one scenario where an audible local quick prefix hands off into
   primary continuation and the mouth does not freeze during the handoff.
5. Add at least one scenario where a local short-circuit spoken reply still
   produces mouth movement without any primary stream.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Speech in the active production path visibly moves the mouth.
- Long spoken replies do not leave the avatar with a static mouth while audio is
  playing.
- The solution is playback-driven rather than text-guessed.
- Task85's conditional audible quick-reaction path does not bypass lipsync.
