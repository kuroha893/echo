# Task Card 0054

## Title
Implement runtime desktop companion session service shell

## Role
Implementer

## Goal
Create the first real single-session composition root in `packages/runtime`
that wires Echo's existing llm, orchestrator, tts, renderer, and desktop bridge
lines into a runnable desktop turn loop.

## Scope Clarification
This task is the runnable-demo composition task.

It should create a desktop companion session service, but it must still remain:

- single-session
- composition-root focused
- free of multi-session desktop shell scope
- free of standby/presence logic
- free of screenshot/multimodal scope

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/runtime/README.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/runtime/roadmap.md`
- `docs/tts/README.md`
- `docs/tts/desktop-playback-bridge.md`
- `docs/renderer/README.md`
- `docs/renderer/chat-history-panel.md`
- `docs/renderer/demo-path.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md`
- the completed implementation from tasks 0037 through 0053

## Files To Create Or Modify
- `packages/runtime/desktop_companion_session_service.py`
- `tests/runtime/test_desktop_companion_session_service.py`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`
- `apps/desktop-live2d/*`

If a narrowly scoped support edit is strictly required to preserve already
approved seams, you may also modify:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/desktop_live2d_audio_sink.py`

only if the existing seams need typed injection or event plumbing and the local
docs remain accurate afterward.

## Hard Requirements
1. Create one explicit single-session desktop companion session service under
   `packages/runtime`.
2. The service must wire together:
   - `LLMService`
   - `TurnOrchestrator`
   - `TTSService`
   - `RendererService`
   - the concrete desktop renderer bridge
   - the concrete desktop audio sink
3. Expose one session-level text-turn entrypoint such as `run_text_turn(...)`.
4. Consume orchestrator protocol events to drive:
   - bubble streaming updates
   - desktop-side assistant transcript updates
   - desktop-side user transcript updates
   - playback settlement coordination
5. Make the desktop bridge/session full-duplex so app-originated UI input can
   be surfaced back into Python through a typed boundary.
6. Keep the first runnable demo single-session only.
7. Do not redesign runtime core state application, orchestrator strategy, or
   protocol semantics.
8. Do not implement standby/presence, screenshot flow, or multi-session
   management here.
9. Allowed and expected size: this should be a substantial Python-first slice,
   with bounded app/bridge support if needed. A reasonable target is
   **1100-1900 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- multi-session desktop shell
- standby/presence logic
- screenshot or multimodal input
- provider redesign
- lipsync

## Validation Expectations
1. Add unit tests for the desktop companion session service wiring and typed
   service-local results/failures.
2. Add orchestrator/protocol-event-driven tests for bubble updates and desktop
   transcript updates.
3. Add full-duplex bridge tests proving app-originated input can reach the
   Python-side service cleanly.
4. Add one bounded end-to-end smoke proving a text turn produces renderer
   activity, bubble updates, and audio playback through the composed service.
5. Re-run touched Python suites and any bounded app-side verification
   introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- one real single-session desktop companion session service exists in
  `packages/runtime`
- Echo has one runnable text-turn composition root above the already-real
  llm/orchestrator/tts/renderer lines
- bubble and transcript updates are driven from orchestrator-owned outputs
- app-originated input can flow back into Python through a typed boundary
