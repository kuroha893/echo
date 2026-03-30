# Task Card 0048

## Title
Implement `packages/renderer` foundation and service shell

## Role
Implementer

## Goal
Create Echo's first renderer foundation package so the repo has a typed,
provider-neutral renderer core before any concrete desktop-live2d backend is
added.

## Scope Clarification
This task is the renderer equivalent of the completed `packages/llm` and
`packages/tts` foundation tasks.

It should create a real `packages/renderer` package, but it must still remain:

- Python-only
- adapter-agnostic
- transport-agnostic
- free of Electron app code
- free of orchestrator integration changes

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
- `docs/renderer/roadmap.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/airi-pixi-live2d-scene.md`
- existing patterns in `packages/llm/*` and `packages/tts/*`

## Files To Create Or Modify
- `packages/renderer/models.py`
- `packages/renderer/errors.py`
- `packages/renderer/adapter_ports.py`
- `packages/renderer/registry.py`
- `packages/renderer/service.py`
- `packages/renderer/scripted_adapter.py`
- `tests/renderer/test_models.py`
- `tests/renderer/test_registry.py`
- `tests/renderer/test_service.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `tests/orchestrator/test_turn_orchestrator.py`

only if the new renderer package must be imported in a type-safe way by shared
test helpers. Do not modify orchestrator implementation in this task.

## Hard Requirements
1. Create a typed renderer-local model family analogous in quality to the existing llm/tts foundations.
2. The upstream public command contract must remain protocol `RendererCommand`.
3. Add a typed renderer adapter port and typed capability surface.
4. Add a typed renderer registry and caller-facing `RendererService`.
5. Add one deterministic scripted or recording adapter for tests and bounded local development use.
6. The scripted adapter must be able to:
   - record call history
   - return deterministic success results
   - return deterministic typed failures
   - explicitly reject unsupported command types
7. Renderer failures must be normalized into Echo-owned typed failures, not raw dicts or transport exceptions.
8. The first foundation must explicitly model unsupported-command behavior instead of silently dropping commands.
9. Do not add Electron, PixiJS, Live2D, or other concrete desktop dependencies in this task.
10. Do not change protocol command semantics.
11. Do not modify `TurnOrchestrator` in this task.
12. Allowed and expected size: write a substantial foundation slice, not a thin wrapper. A reasonable target is **900-1500 lines of non-test Python** across the allowed implementation files.

## Explicitly Out Of Scope
- concrete desktop-live2d backend
- orchestrator integration
- bubble/chat UI
- lip sync
- `set_mouth_open` implementation
- runtime redesign

## Validation Expectations
1. Add tests for renderer model validation and enum/capability rules.
2. Add tests for registry resolution success and mismatch failures.
3. Add tests proving `RendererService` dispatches through the typed adapter port.
4. Add tests proving the scripted adapter preserves deterministic ordering and explicit unsupported-command behavior.
5. Re-run the renderer tests plus any touched shared tests.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/renderer` exists with strong typed contracts
- renderer dispatch goes through a typed registry/service boundary
- unsupported command handling is explicit and typed
- tests prove deterministic foundation behavior without any concrete desktop backend
