# Task Card 0083

## Title
Adapt open-yachiyo's realtime desktop voice streaming contract for Echo's active Qwen TTS path

## Role
Implementer

## Goal
Replace Echo's current active cloned-voice playback path with a true realtime,
prebuffered desktop streaming path modeled on the locally mirrored
open-yachiyo implementation.

The user-visible problem is:

- Echo can already synthesize speech, but the active cloned-voice path is still
  effectively buffered and non-streaming
- playback waits too long before starting
- short clauses have obvious gaps
- long replies can fail midway with desktop audio-sink fragment errors
- lipsync is starved because the active path is not built around a stable,
  playback-driven realtime audio signal

This task is the first speech-path correction. It does not solve text shaping,
audible/visible mismatch, or context continuity by itself.

## Scope Clarification
This task is only about the active production speech transport and desktop
playback contract for Qwen TTS.

It must not redesign protocol semantics or package boundaries.

It must not add fallback buffered playback in the active production path. If the
configured provider/model/voice cannot satisfy the new realtime contract, the
system should fail fast and surface the error.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [events.md](/C:/Users/123/Desktop/echo/docs/protocol/events.md)
- [orchestrator-spec.md](/C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md)
- Primary mirrored reference repo:
  - [realtimeVoicePlayer.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/realtimeVoicePlayer.js)
  - [bootstrap.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bootstrap.js)
  - [voice.js](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main/apps/runtime/tooling/adapters/voice.js)
- Supplementary mirrored reference repo:
  - [tts.ts](/C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui/src/utils/tts.ts)

## How open-yachiyo solves this
open-yachiyo does not treat TTS playback as "wait for a complete file, then
play". It has an explicit renderer-side realtime voice player that accepts:

- stream start
- stream chunk
- stream end
- stream error

and starts playback as soon as a small prebuffer is filled.

Relevant local snippet:

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\realtimeVoicePlayer.js`

```javascript
if (!forceStart && pendingDurationMs < session.prebufferMs) {
  return;
}
session.started = true;
session.nextStartTime = Math.max(
  this.audioContext.currentTime + 0.025 + outputDelaySec,
  this.audioContext.currentTime
);
```

This matters because open-yachiyo starts from a small realtime prebuffer
instead of waiting for the final fragment of a speech unit.

It also wires the desktop renderer to explicit stream lifecycle callbacks.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\bootstrap.js`

```javascript
bridge.onVoiceStreamStart?.((payload) => {
  void startRealtimeVoicePlayback(payload);
});
bridge.onVoiceStreamChunk?.((payload) => {
  appendRealtimeVoiceChunk(payload);
});
bridge.onVoiceStreamEnd?.((payload) => {
  endRealtimeVoicePlayback(payload);
});
```

## How AIRI solves this
AIRI is not the primary model for the transport contract, but it reinforces the
same design direction: text and playback should keep moving in small units, and
the first audible response should arrive quickly instead of waiting for a full
buffered response.

Its chunking system exposes a `boost` concept specifically to reduce the delay
before the first spoken chunk is emitted.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\utils\tts.ts`

```typescript
const {
  boost = 2,
  minimumWords = 4,
  maximumWords = 12,
} = options ?? {}
```

That does not define desktop transport, but it confirms that low initial delay
is a first-class design goal rather than an afterthought.

## What Echo should adopt
- Adopt open-yachiyo's event-shaped realtime desktop playback contract for the
  active Qwen TTS path.
- Make the active production path stream audio fragments to the desktop as they
  arrive instead of waiting for final buffered completion.
- Start playback after a small prebuffer threshold, not after the final
  fragment.
- Use an active audio format that is suitable for both playback and later
  lipsync work in Echo. Prefer a PCM S16LE mono 24kHz contract for the active
  streaming path.
- Preserve Echo's own protocol/event model and package boundaries while
  adapting this behavior.

## What Echo must not copy directly
- Do not transplant open-yachiyo renderer files wholesale.
- Do not copy open-yachiyo bridge, preload, or runtime host semantics.
- Do not import open-yachiyo event names into Echo if they conflict with Echo
  protocol docs.
- Do not preserve Echo's current final-fragment-only playback gating as a
  hidden fallback.

## Files To Create Or Modify
- [qwen3_voice_clone_provider.py](/C:/Users/123/Desktop/echo/packages/tts/qwen3_voice_clone_provider.py)
- [desktop_live2d_audio_sink.py](/C:/Users/123/Desktop/echo/packages/orchestrator/desktop_live2d_audio_sink.py)
- [audio_playback_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_playback_controller.mjs)
- [dom_audio_playback_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/dom_audio_playback_backend.mjs)
- relevant tests under:
  - [tests/tts](/C:/Users/123/Desktop/echo/tests/tts)
  - [tests/orchestrator](/C:/Users/123/Desktop/echo/tests/orchestrator)

## Hard Requirements
1. The active cloned-voice production path must no longer be effectively
   non-streaming.
2. Desktop playback must be able to start before the final fragment of a speech
   unit.
3. The playback lifecycle must stay explicit and classify start, chunk, end,
   and error states.
4. The implementation must fail fast if the active provider/voice/model path
   cannot satisfy the chosen realtime contract.
5. Do not introduce a buffered MP3/OGG fallback as a silent degraded mode.
6. Do not modify public Echo protocol semantics unless a separate protocol task
   is explicitly required.

## Out Of Scope
- TTS text sanitization and emoji handling
- visible-text vs audible-text unification
- lipsync and expression mixer logic
- same-session context replay
- long-term memory

## Validation Expectations
1. Add tests showing the active speech path accepts realtime fragments and does
   not wait for the final fragment to begin playback.
2. Add or update a desktop playback test proving a long multi-fragment reply
   completes without mid-utterance fragment-delivery failure.
3. Validate that the chosen active format is compatible with the downstream
   desktop playback path.
4. Validate that unsupported provider/voice/model realtime configurations fail
   explicitly instead of silently degrading.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- A long Chinese answer no longer stops midway with
  `desktop-live2d audio sink failed to deliver a playback fragment`.
- Speech starts before the final fragment of the spoken unit is received.
- Short clauses have materially smaller dead air between them than the current
  build.
- No silent fallback path is added.
