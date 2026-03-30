# Task Card 0052

## Title
Implement desktop-live2d bubble demo shell

## Role
Implementer

## Goal
Add the first app-side streaming bubble shell on top of the already-real
desktop-live2d backend so Echo reaches a more readable visible demo without
changing `packages/renderer` boundaries.

## Scope Clarification
This task comes only after the backend is already real.

It should add a bubble shell, but it must still remain:

- app-side
- renderer-adjacent, not renderer-foundation
- free of full chat-panel scope
- free of lip-sync redesign

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/renderer-commands.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/demo-path.md`
- `docs/renderer/roadmap.md`
- the completed renderer foundation/orchestrator/backend implementation from tasks 0048 through 0051

## Files To Create Or Modify
- `apps/desktop-live2d/*`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/orchestrator/turn_orchestrator.py`

only if the existing renderer/TTS seams must expose already-produced text in a
strictly bounded way.

## Hard Requirements
1. Add one app-side bubble UI shell to the desktop-live2d backend.
2. Keep bubble behavior outside `packages/renderer`.
3. Bubble rendering must be driven by explicit bounded inputs; do not redesign protocol or runtime semantics.
4. Bubble work must not delay or replace already-landed motion/expression/state dispatch.
5. Do not merge this task into a full chat-panel shell.
6. Do not implement lip sync here.
7. Allowed and expected size: write a bounded app-shell slice, not a foundation redesign. A reasonable target is **700-1400 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- chat-panel shell
- lip sync
- idle/presence automation
- screenshot UX
- alternate renderer backends

## Validation Expectations
1. Add bounded smoke coverage for bubble display/update/clear behavior.
2. Add tests or checks proving the bubble shell does not break existing backend command handling.
3. Re-run any touched Python bridge tests and any bounded app-side verification introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the concrete desktop-live2d backend now has a visible bubble shell
- renderer foundation boundaries remain intact
- full chat-panel scope remains deferred
