# TTS Orchestrator Integration

## Purpose

This document defines the accepted way `TurnOrchestrator` integrates with
`packages/tts`.

The original goal was to replace `_send_tts_chunk(...)` placeholder dispatch
with real `TTSService` synthesis while still avoiding premature playback-device
design. That integration is now complete and serves as the baseline for the
next desktop playback task.

---

## Accepted Baseline

`TurnOrchestrator` now:

1. keeps using protocol `TTSChunk` as the upstream chunk contract
2. invokes Echo-owned `TTSService`, not provider adapters directly
3. receives ordered `TTSAudioFragment` values
4. forwards those fragments to an Echo-owned sink seam above `packages/tts`
5. reconciles playback lifecycle locally enough to keep `AudioMutex` and turn
   resolution consistent

This means TTS dispatch is no longer a placeholder path.

---

## Ownership Rules

`packages/tts` owns:

- synthesis request normalization
- provider/profile/voice resolution through the TTS registry/service
- provider transport and error normalization
- ordered `TTSAudioFragment` output

`packages/orchestrator` still owns:

- when a `TTSChunk` is emitted
- interrupt and queue policy
- audio mutex ownership
- playback lifecycle interpretation
- turn resolution

---

## What Comes Next

The accepted baseline above is still a bounded bridge, not final playback
truth.

The next demo task should:

- keep the sink above `packages/tts`
- move material playback ownership into the desktop app
- return typed playback lifecycle from that desktop layer
- stop extending local reconciliation indefinitely

That next step belongs to the desktop playback bridge and later demo
composition work, not to `packages/tts` itself.

---

## What This Layer Must Still Not Do

Even after task47, the orchestrator/TTS line must not:

- move provider logic into orchestrator
- redesign `AudioMutex`
- redesign runtime bridge topology
- turn `packages/tts` into a speaker playback package
- add lip-sync behavior inside the TTS package
