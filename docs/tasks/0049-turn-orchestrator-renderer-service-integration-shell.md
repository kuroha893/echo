# Task Card 0049

## Title
Implement `TurnOrchestrator` renderer service integration shell

## Role
Implementer

## Goal
Replace the current orchestrator renderer placeholder path with a real
`RendererService`-backed dispatch flow that preserves existing protocol-event,
interrupt, and queue semantics.

## Scope Clarification
This task is the first orchestrator/renderer integration layer.

It should let `TurnOrchestrator` dispatch real renderer commands through the
existing renderer foundation, but it must still remain:

- orchestrator-owned above the renderer package
- free of any concrete Electron desktop backend
- free of lip-sync work
- free of runtime or state-machine redesign

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/renderer-commands.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/contracts.md`
- `docs/renderer/adapter-interface.md`
- `docs/renderer/action-mapping.md`
- `docs/renderer/orchestrator-integration.md`
- `docs/renderer/roadmap.md`
- the completed `packages/renderer/*` implementation from task 0048
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

## Files To Create Or Modify
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/renderer/service.py`
- `packages/renderer/registry.py`
- `tests/renderer/test_service.py`

Do not add any concrete desktop-live2d code in this task.

## Hard Requirements
1. Add a typed `renderer_service` seam to `TurnOrchestrator`.
2. Replace `_send_renderer_command(...)` no-op behavior so renderer dispatch goes through `RendererService`.
3. Preserve the existing `renderer.command.issued` protocol-event semantics.
4. Add explicit quick and primary renderer profile selection if renderer foundation supports profiles.
5. Renderer dispatch failure must surface clearly and must not silently mutate runtime/session state.
6. Preserve existing parser ownership and interrupt behavior.
7. Preserve deterministic queue-clearing and turn-resolution behavior.
8. Do not move renderer-adapter logic into orchestrator.
9. Do not create a concrete desktop backend in this task.
10. Do not claim `set_mouth_open` support.
11. Allowed and expected size: write a substantial integration slice, not a thin wrapper. A reasonable target is **700-1300 lines of non-test Python** across the allowed implementation files.

## Explicitly Out Of Scope
- Electron app shell
- Pixi/Cubism scene runtime
- bubble/chat UI
- lip sync
- renderer-driven state transitions
- TTS redesign

## Validation Expectations
1. Add tests proving quick-reaction parser output reaches `RendererService`.
2. Add tests proving primary-response parser output reaches `RendererService`.
3. Add tests proving `renderer.command.issued` ordering/behavior does not drift.
4. Add tests for renderer failure surfaces and deterministic interrupt/queue handling.
5. Re-run affected orchestrator and renderer regression suites.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `TurnOrchestrator` no longer relies on a pure renderer no-op path
- renderer dispatch uses `RendererService`
- protocol-event semantics remain stable
- tests prove deterministic integration without any concrete desktop renderer backend
