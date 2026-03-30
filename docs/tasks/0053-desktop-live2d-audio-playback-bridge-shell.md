# Task Card 0053

## Title
Implement desktop-live2d audio playback bridge shell

## Role
Implementer

## Goal
Create the first real desktop-owned audio playback path above `packages/tts` so
Echo can deliver synthesized audio fragments into `apps/desktop-live2d` and
receive typed playback lifecycle truth back from the desktop app.

## Scope Clarification
This task is the first real playback-device task for the runnable desktop demo.

It should add a concrete desktop playback bridge and sink, but it must still
remain:

- above `packages/tts`
- single-session
- local desktop only
- free of chat-panel scope
- free of lip-sync implementation

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/tts/README.md`
- `docs/tts/desktop-playback-bridge.md`
- `docs/tts/orchestrator-integration.md`
- `docs/tts/roadmap.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/demo-path.md`
- `docs/renderer/roadmap.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md`
- the completed implementation from tasks 0047 and 0050 through 0052

## Files To Create Or Modify
- `packages/orchestrator/tts_audio_sink.py`
- `packages/orchestrator/desktop_live2d_audio_sink.py`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/orchestrator/test_tts_audio_sink.py`
- `tests/orchestrator/test_desktop_live2d_audio_sink.py`
- `tests/renderer/test_desktop_live2d_bridge.py`
- `apps/desktop-live2d/*`

If a narrowly scoped support edit is strictly required to preserve already
approved seams, you may also modify:

- `packages/orchestrator/turn_orchestrator.py`

only if the existing audio-fragment sink seam needs a typed injection or
settlement hook that remains consistent with local docs.

## Hard Requirements
1. Create one concrete `TTSAudioSinkPort` implementation that routes
   `TTSAudioFragment` delivery into `apps/desktop-live2d`.
2. Keep this sink above `packages/tts`; do not move playback into the TTS
   package.
3. Extend the existing `desktop-live2d` bridge/session with typed audio
   playback commands and typed playback lifecycle reporting.
4. The desktop app must materially own playback truth for the first demo,
   including explicit reporting for at least:
   - accepted
   - started
   - finished
   - aborted or failed
5. Preserve Echo-owned typed boundaries; do not leak raw provider payloads or
   ad-hoc dict envelopes across package boundaries.
6. Preserve the current local-only bridge model; do not redesign this into a
   network bridge.
7. Do not implement lip-sync in this task.
8. Do not implement chat-panel UI in this task.
9. Do not redesign protocol `TTSChunk`, `RendererCommand`, or `AudioMutex`.
10. If JS-side audio helpers or minimal app dependencies are strictly required,
    introduce them explicitly and narrowly for `apps/desktop-live2d`; do not
    silently add a broad frontend stack.
11. Allowed and expected size: this should be a substantial cross-language
    slice. A reasonable target is **1200-2200 lines of non-test code** across
    the allowed files.

## Explicitly Out Of Scope
- lip-sync
- chat history panel
- multi-session desktop shell
- screenshot flow
- provider redesign
- protocol redesign

## Validation Expectations
1. Add Python unit tests for the concrete desktop audio sink and any new typed
   playback models or bridge normalization.
2. Add bridge protocol tests proving audio playback requests/responses are
   validated and normalized deterministically.
3. Add bounded smoke coverage proving desktop playback start/finish is surfaced
   deterministically.
4. Re-run touched Python test suites and any bounded app-side verification
   introduced by the task.
5. Ensure existing renderer bridge tests do not regress.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- a concrete desktop audio sink exists above `packages/tts`
- `apps/desktop-live2d` can accept synthesized audio fragments through a typed
  local bridge
- the desktop app now owns first-demo playback lifecycle truth
- chat-panel scope and lip-sync remain deferred
