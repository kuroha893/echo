# Task Card 0062

> Status note (2026-03-19): historically completed, but superseded as product
> topology by the browser web console plus floating `avatar/chat/bubble`
> reset line. Keep this card only as prototype context.

## Title
Implement desktop suite foundation and multi-window bridge routing

## Role
Implementer

## Goal
Replace the current single-window Electron shell with a desktop suite that
launches separate `console`, `avatar`, and `chat` windows, while keeping one
shared Python host and one typed app-local bridge router in Electron main.

## Scope Clarification
This task is Electron app-shell and routing work.

It must:

- create three window roles
- keep one shared `DesktopCompanionPythonHost`
- route typed bridge traffic to the correct renderer window by command family

It must not:

- redesign Python runtime composition
- redesign protocol semantics
- move stage/chat UI yet

UI extraction into dedicated windows is deferred to tasks0063 and 0064.

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/architecture.md`
- `docs/runtime/desktop-companion-session-service.md`
- completed implementations from tasks53 through 61
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/renderer/*`

## Files To Create Or Modify
- `apps/desktop-live2d/electron/main.mjs`
- `apps/desktop-live2d/electron/preload.mjs`
- `apps/desktop-live2d/electron/*.mjs` helper files if needed

If strictly required for app-local routing metadata, you may also modify:

- `apps/desktop-live2d/renderer/bootstrap.mjs`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*` public foundation semantics
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Electron main must create three window roles:
   - `console`
   - `avatar`
   - `chat`
2. All three windows must launch together by default.
3. Electron main must keep one shared `DesktopCompanionPythonHost`.
4. Add a window-scoped renderer bridge router in main that sends:
   - scene / renderer commands -> `avatar`
   - audio playback commands -> `avatar`
   - bubble commands -> `avatar`
   - companion transcript / input bridge commands -> `chat`
5. `console` must not register as a renderer bridge execution target.
6. Add app-local window role metadata so preload/renderer code can tell which
   surface it is running on.
7. Window defaults:
   - `console`: normal framed app window
   - `avatar`: transparent frameless always-on-top floating window
   - `chat`: compact always-on-top floating window
8. Keep typed bridge envelopes unchanged.

## Explicitly Out Of Scope
- removing stage UI from the current console renderer
- moving transcript/composer to the chat window
- reducing console UI scope
- screenshot or standby/presence behavior

## Validation Expectations
1. Add app-level verification that three windows are created with the expected
   roles.
2. Add tests or bounded checks proving that bridge commands are routed to the
   correct window role.
3. Preserve current single-window self-checks if still reusable; otherwise
   replace them with suite-aware equivalents in later tasks.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Electron launches `console`, `avatar`, and `chat`
- one shared Python host remains the only backend host
- typed bridge traffic is routed by command family without protocol changes
