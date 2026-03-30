# Task Card 0056

## Title
Implement desktop-live2d audio-driven lipsync shell

## Role
Implementer

## Goal
Add the first real app-side lipsync enhancement so the full-body Live2D
character reacts to real desktop playback/audio analysis after the runnable
desktop demo is already wired.

## Scope Clarification
This task is the first polish task after the runnable demo exists.

It should add audio-driven lipsync, but it must still remain:

- app-side
- tied to real playback
- free of protocol redesign
- free of generic upstream `set_mouth_open` claims

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/action-mapping.md`
- `docs/renderer/chat-history-panel.md`
- `docs/renderer/roadmap.md`
- `docs/tts/desktop-playback-bridge.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md`
- `docs/reference/approved/airi-pixi-live2d-scene.md`
- the completed implementation from tasks 0050 through 0055

## Files To Create Or Modify
- `apps/desktop-live2d/*`

If a narrowly scoped support edit is strictly required to preserve already
approved typed bridge or smoke surfaces, you may also modify:

- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

only if existing playback-owned data must be exposed through an already-local
typed bridge boundary without changing protocol semantics.

## Hard Requirements
1. Implement the first lipsync enhancement app-side inside
   `apps/desktop-live2d`.
2. Lipsync must be driven from real desktop playback/audio analysis, not from a
   fake timer or parser guess.
3. Integrate lipsync with the real playback path created by task0053.
4. Do not change protocol `RendererCommand` semantics to claim generic
   `set_mouth_open` support.
5. Preserve existing scene command handling and playback behavior; lipsync must
   not break motion/expression/state dispatch.
6. Keep the implementation bounded to the first demo polish layer; do not fold
   in full presence automation or new renderer backends.
7. Allowed and expected size: write a bounded app-side slice. A reasonable
   target is **700-1400 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- protocol `set_mouth_open` redesign
- presence/idle automation
- screenshot UX
- alternate renderer backends
- multi-session desktop shell

## Validation Expectations
1. Add bounded tests or self-check coverage proving audio-driven mouth updates
   react to real playback/audio data.
2. Add checks proving lipsync does not break playback or existing scene-command
   handling.
3. Preserve explicit non-support for generic upstream `set_mouth_open`
   semantics.
4. Re-run any touched bridge tests and any bounded app-side verification
   introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the desktop-live2d app has a real audio-driven lipsync shell
- the implementation is tied to real playback rather than fake mouth-driving
- protocol semantics remain unchanged
- runnable demo wiring remains intact after the polish layer lands
