# Task Card 0065

> Status note (2026-03-19): historically completed, but superseded as target
> product UI by the browser web console plus floating `avatar/chat/bubble`
> reset line. Keep this card only as prototype context.

## Title
Reduce the console window to config/debug scope and add three-window verification

## Role
Implementer

## Goal
Turn the console window into a config/debug shell only, and add bounded
verification for the corrected three-window desktop suite.

## Scope Clarification
This task is the final convergence step after the suite, avatar, and chat
windows exist.

It must:

- remove embedded chat/stage ownership from the console
- preserve provider settings and voice enrollment
- add suite-aware verification for `demo_scripted`

It must not:

- add multi-session shell
- add screenshot UI
- add standby/presence behavior

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/architecture.md`
- `docs/runtime/desktop-companion-session-service.md`
- completed implementations from tasks57 through 64
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/scripts/*`

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/scripts/*`
- related JS self-check files

If strictly required for suite verification, you may also modify:

- `apps/desktop-live2d/shared/*`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*` public foundation semantics
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Console window must become config/debug only.
2. Console window may contain:
   - `Services`
   - `Voice`
   - readiness / provider state
   - bounded debug summaries
3. Console window must not contain:
   - embedded character stage
   - transcript history
   - writable composer
4. Keep provider settings, secret masking, and voice enrollment fully usable.
5. Add bounded three-window verification proving:
   - `demo_scripted` settings can be saved and loaded
   - one text turn can be submitted from the chat window
   - transcript updates land in the chat window
   - bubble updates land in the avatar window
   - renderer activity, playback, and lipsync occur in the avatar window
6. Preserve current single-session composition root and typed host boundary.

## Explicitly Out Of Scope
- protocol redesign
- real-provider verification redesign
- ambient presence
- screenshot flow
- multi-session desktop shell

## Validation Expectations
1. Preserve offline self-checks where still valid.
2. Add a suite-aware smoke path for the three-window launch.
3. Add bounded verification of `demo_scripted` through the corrected desktop
   suite.
4. Clearly report any Electron-only verification that remains opt-in or
   environment-gated.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- console is config/debug only
- chat and avatar surfaces are fully externalized into their own windows
- three-window suite can be launched and verified deterministically
- the current single-session runtime composition remains intact
