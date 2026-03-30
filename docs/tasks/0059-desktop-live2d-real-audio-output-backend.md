# Task Card 0059

## Title
Implement real desktop audio output backend for `desktop-live2d`

## Role
Implementer

## Goal
Replace the current headless playback path used in real app runs with one real
desktop audio output backend while preserving the existing typed playback
reports, sink lifecycle, and app-side lipsync flow.

## Scope Clarification
This task is playback-backend work inside `apps/desktop-live2d`.

It must:

- keep playback ownership in the desktop app
- preserve the existing typed playback bridge and report flow
- keep headless playback available for deterministic tests and self-checks

It must not:

- redesign `packages/tts`
- redesign orchestrator playback policy
- redesign lipsync semantics

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/tts/README.md`
- `docs/tts/desktop-playback-bridge.md`
- `docs/renderer/README.md`
- `docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md`
- completed implementations from tasks53 through 58

## Files To Create Or Modify
- `apps/desktop-live2d/shared/*audio*`
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/scripts/*`

If strictly required to preserve typed playback bridge compatibility, you may
also modify:

- `packages/orchestrator/desktop_live2d_audio_sink.py`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/orchestrator/test_desktop_live2d_audio_sink.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

Do not modify:

- `packages/tts/*`
- `packages/protocol/*`

## Hard Requirements
1. Add one real DOM/Electron audio output backend and make it the default
   backend for real app runs.
2. Preserve the headless backend for self-checks and offline deterministic
   tests.
3. Preserve the existing typed playback lifecycle:
   - accepted
   - started
   - finished
   - aborted
   - failed
4. Keep the playback sink above `packages/tts`; do not move playback into the
   TTS package.
5. Keep the current app-side lipsync path driven from the real playback path;
   do not invent a separate fake mouth-driving path.
6. Preserve playback abort/failure behavior and current desktop-owned playback
   truth.
7. Do not change protocol semantics or public `RendererCommand` support claims.

## Explicitly Out Of Scope
- Pixi/Cubism dependency landing
- screenshot flow
- standby/presence behavior
- multi-session shell
- audio-device abstraction redesign inside `packages/tts`

## Validation Expectations
1. Add app-side checks proving real playback backend start/finish/abort paths
   work and still emit the expected typed playback reports.
2. Re-run existing smoke, scene, chat-panel, and lipsync self-checks.
3. Keep offline deterministic checks working through the headless backend.
4. Add bounded verification proving real app-mode playback and current lipsync
   do not regress renderer command handling.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- real app runs use a real desktop audio output backend
- typed playback reports remain compatible with the current sink/report flow
- headless playback remains available for deterministic tests
- existing app-side lipsync continues to follow the real playback path
