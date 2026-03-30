# Task Card 0050

## Title
Implement desktop-live2d app-shell and bridge shell

## Role
Implementer

## Goal
Create Echo's first concrete renderer app shell under `apps/desktop-live2d`
and the bounded bridge path that lets Python-side renderer adapters talk to a
local Electron desktop app.

## Scope Clarification
This task is the first concrete desktop renderer task.

It should add the app shell and the Python <-> Electron bridge, but it must
still remain:

- backend-first
- full-body-character oriented
- free of bubble/chat shell
- free of lip-sync implementation
- bounded to local desktop use

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
- `docs/renderer/demo-path.md`
- `docs/renderer/roadmap.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/airi-pixi-live2d-scene.md`
- the completed `packages/renderer/*` implementation from tasks 0048 and 0049

## Files To Create Or Modify
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`
- `apps/desktop-live2d/*`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/renderer/models.py`
- `packages/renderer/errors.py`
- `packages/renderer/service.py`
- `packages/orchestrator/turn_orchestrator.py`

only if the concrete bridge must be injected through already-approved seams.

## Hard Requirements
1. Create `apps/desktop-live2d` as Echo's first concrete renderer app shell.
2. The first concrete app shell must target one full-body Live2D character window, not a head-only widget.
3. Add a bounded Python-side renderer bridge adapter under `packages/renderer`.
4. The bridge adapter must talk to the desktop app through an explicit local boundary, not shared memory objects.
5. The app shell must clearly separate:
   - Electron main/preload/renderer boot
   - local RPC/IPC bridge
   - later scene runtime hooks
6. Enforce repo-owned relative model asset path rules at the app boundary; do not allow arbitrary absolute-path model loading as first-backend behavior.
7. The first app shell must be able to:
   - start
   - expose a bounded local command path
   - accept typed expression/motion/state commands through that path
   - return typed success/failure to the Python bridge
8. Do not implement bubble/chat shell in this task.
9. Do not implement lip sync or `set_mouth_open` support in this task.
10. Do not copy `open-yachiyo` RPC method names, tool names, or runtime structure.
11. If adding JavaScript or Electron dependencies is strictly required, they must be introduced explicitly and minimally for `apps/desktop-live2d`; do not silently add unrelated frontend stacks.
12. If the repo has no existing JS test harness, create a bounded smoke/self-check path rather than inventing a broad app test platform.
13. Allowed and expected size: write a substantial cross-language slice. A reasonable target is **1200-2200 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- bubble/chat panel
- lip sync
- screenshot UX
- VTube Studio backend
- renderer idle/presence behaviors
- runtime or protocol redesign

## Validation Expectations
1. Add Python-side tests for bridge request encoding, result decoding, and typed error normalization.
2. Add bounded validation or smoke coverage for the app shell startup/command path.
3. Add tests or static checks proving relative asset-path enforcement.
4. Re-run touched Python test suites and any bounded app-shell verification introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `apps/desktop-live2d` exists as a real app-shell baseline
- Python-side renderer bridge can talk to the desktop app through a bounded local path
- the backend target is clearly full-body desktop Live2D
- bubble/chat and lip-sync remain deferred instead of being mixed into the first backend
