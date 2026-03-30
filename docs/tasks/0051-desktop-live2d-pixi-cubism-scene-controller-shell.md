# Task Card 0051

## Title
Implement desktop-live2d Pixi/Cubism full-body scene controller shell

## Role
Implementer

## Goal
Create the first real scene runtime inside `apps/desktop-live2d` so Echo can
load one full-body model and execute state/expression/motion commands
deterministically.

## Scope Clarification
This task is the scene-runtime half of the first concrete renderer backend.

It should add the Pixi/Cubism scene controller, but it must still remain:

- scene-focused
- backend-first
- free of bubble/chat shell
- free of lip-sync implementation

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/renderer-commands.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/contracts.md`
- `docs/renderer/action-mapping.md`
- `docs/renderer/demo-path.md`
- `docs/renderer/roadmap.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/airi-pixi-live2d-scene.md`
- the completed desktop-live2d app shell from task 0050

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/shared/*`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/renderer/models.py`
- `packages/renderer/errors.py`

Do not create bubble/chat shell in this task.

## Hard Requirements
1. Add a real PixiJS + Live2D scene runtime for one full-body model.
2. Keep scene runtime concerns distinct from the Electron app shell.
3. The scene controller must support deterministic execution for:
   - `set_state`
   - `set_expression`
   - `set_motion`
   - `clear_expression`
4. The scene controller must load the model from repo-owned relative assets only.
5. The scene controller must return explicit typed success/failure through the existing bridge.
6. Unsupported commands must be explicit; `set_mouth_open` must remain deferred and must not be claimed as implemented.
7. Do not copy AIRI's Vue/store structure or open-yachiyo's renderer file layout directly.
8. If the app shell from task0050 introduced a bounded smoke path, extend it narrowly rather than inventing a broad new frontend test stack.
9. Allowed and expected size: write a substantial scene subsystem. A reasonable target is **1200-2200 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- bubble/chat shell
- lip sync
- idle/presence motion automation
- screenshot support
- alternate renderer backends

## Validation Expectations
1. Add bounded validation proving the scene can boot and load one model from relative assets.
2. Add tests or smoke coverage for deterministic execution of state/expression/motion/clear-expression commands.
3. Add checks proving unsupported commands surface clearly.
4. Re-run the Python bridge tests plus any bounded app-shell or scene verification introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the concrete desktop-live2d backend can load one full-body model
- state/expression/motion/clear-expression commands execute deterministically
- `set_mouth_open` remains explicitly deferred
- bubble/chat shell is still not mixed into the scene controller task
