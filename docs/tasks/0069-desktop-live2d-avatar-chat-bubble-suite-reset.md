# Task Card 0069

## Title
Reset desktop-live2d to avatar/chat/bubble suite only

## Role
Implementer

## Goal
Rescope `apps/desktop-live2d` so Electron owns only the floating desktop suite:
`avatar`, `chat`, and `bubble`, and remove the Electron console path from the
normal product surface.

## Scope Clarification
This task is Electron window-topology and bridge-routing work.

It must:

- remove the Electron console window from the normal user-facing path
- add a dedicated `bubble` window
- keep `avatar`, `chat`, and `bubble` as the only Electron product windows
- route scene/playback/lipsync/chat/bubble traffic to the correct windows

It must not:

- recreate final high-fidelity desktop UI yet
- redesign protocol semantics
- redesign the Python host or session-service boundary

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/renderer/architecture.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md`
- completed implementations from tasks53 through 68
- local reference source under:
  - `docs/reference/open-yachiyo-main/apps/desktop-live2d`

## Files To Create Or Modify
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/scripts/*` if suite smoke paths need updates

If strictly required for window-role metadata or desktop-suite routing, you may
also modify:

- `apps/desktop-live2d/shared/*`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*`
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Electron must launch only:
   - `avatar`
   - `chat`
   - `bubble`
2. The old Electron `console` window must be removed from the normal product
   path.
3. Add a dedicated floating `bubble` window.
4. Route command families as follows:
   - scene / renderer -> `avatar`
   - audio playback / lipsync-driving playback -> `avatar`
   - transcript / composer -> `chat`
   - bubble updates -> `bubble`
5. Keep one shared Python host and one shared single-session composition root.
6. Keep typed bridge envelopes unchanged.
7. Directly inspect the approved local reference source under:
   - `docs/reference/open-yachiyo-main/apps/desktop-live2d`
   for window topology and UI-surface behavior only.

## Explicitly Out Of Scope
- final pixel-level desktop window recreation
- browser-console work
- screenshot, standby/presence, multi-session behavior

## Validation Expectations
1. Add suite checks proving only `avatar/chat/bubble` launch in the normal
   product path.
2. Add bridge-routing checks for the four command families above.
3. Add smoke coverage proving one turn updates all three windows through the
   existing single-session host path.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the Electron product suite is `avatar + chat + bubble`
- the old Electron console window is no longer a normal user surface
- one shared Python host still powers the suite
- typed bridge routing works without protocol changes
