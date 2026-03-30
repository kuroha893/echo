# Task Card 0055

## Title
Implement desktop-live2d chat history panel shell

## Role
Implementer

## Goal
Add the first real desktop input/history UI on top of the already-runnable
desktop companion session service so the demo has a current-session chat panel
instead of only a bubble overlay.

## Scope Clarification
This task is the first desktop input/history UI task.

It should add a chat history panel, but it must still remain:

- app-side
- current-session only
- bounded to history + input
- free of multi-session shell scope
- free of screenshot scope

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/README.md`
- `docs/renderer/chat-history-panel.md`
- `docs/renderer/demo-path.md`
- `docs/renderer/roadmap.md`
- `docs/runtime/desktop-companion-session-service.md`
- the completed implementation from tasks 0050 through 0054

## Files To Create Or Modify
- `apps/desktop-live2d/*`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

If a narrowly scoped support edit is strictly required to preserve already
approved seams, you may also modify:

- `packages/runtime/desktop_companion_session_service.py`
- `tests/runtime/test_desktop_companion_session_service.py`

only if the panel needs a bounded new typed history/input surface from the
already-approved companion service.

## Hard Requirements
1. Add one desktop chat history panel with:
   - input box
   - send action
   - current-session history list
   - basic assistant/user message rendering
2. Keep the panel app-side; do not move panel state into `packages/renderer`.
3. Hook panel input into the full-duplex desktop companion session service from
   task0054.
4. Keep the bubble overlay as a lightweight live layer; do not replace it with
   the panel.
5. Keep history scope bounded to the current session only.
6. Do not add multi-session switching UI.
7. Do not add screenshot input in this task.
8. Do not redesign runtime or protocol semantics.
9. Allowed and expected size: write a bounded app-shell slice. A reasonable
   target is **900-1500 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- multi-session desktop shell
- screenshot UI
- standby/presence UI
- lipsync
- product-config shell redesign

## Validation Expectations
1. Add app-side tests or bounded smoke coverage for panel state, input, and
   current-session history rendering behavior.
2. Add validation proving input submit reaches the companion session service and
   drives a turn.
3. Add checks proving current-session history stays in sync while bubble
   overlay behavior still works.
4. Re-run touched Python bridge/service tests and any bounded app-side
   verification introduced by the task.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the desktop-live2d app now has a current-session chat history panel
- input flows through the typed full-duplex companion-session boundary
- bubble overlay remains intact as the lightweight live layer
- multi-session shell scope remains deferred
