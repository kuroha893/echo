# Task Card 0063

> Status note (2026-03-19): historically completed, but now treated as
> prototype groundwork only. The accepted product topology is the
> browser-console plus floating `avatar/chat/bubble` line.

## Title
Extract the avatar window renderer from the embedded console stage

## Role
Implementer

## Goal
Move the current embedded right-side stage stack into a dedicated `avatar`
window renderer so that the floating character surface owns scene, bubble,
audio-playback-facing surface state, and lipsync.

## Scope Clarification
This task is renderer extraction work for the `avatar` window only.

It must:

- create a dedicated avatar renderer entrypoint/page
- boot scene runtime independently in the avatar window
- keep bubble and lipsync near the avatar

It must not:

- keep any embedded character stage inside the console window
- move transcript/composer into the avatar window
- redesign bridge envelopes

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/architecture.md`
- completed implementations from tasks50 through 62
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/shared/*`

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/main.mjs`
- `apps/desktop-live2d/electron/preload.mjs`
- `apps/desktop-live2d/renderer/*.html` entrypoint files if needed

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*` public command semantics
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Create a dedicated avatar renderer/page for the `avatar` window role.
2. Move the following concerns entirely into the avatar window:
   - scene runtime
   - full-body character rendering
   - bubble overlay
   - app-side playback-facing visual state
   - app-side lipsync
3. Remove provider/settings UI and transcript/composer UI from the avatar
   renderer.
4. Console window must no longer render the character stage after this task.
5. `set_mouth_open` must remain unsupported as a public renderer command.
6. Avatar window must boot independently and consume only the command families
   assigned to it by task0062.

## Explicitly Out Of Scope
- chat transcript/composer extraction
- console UI reduction
- protocol changes
- alternate renderer backends

## Validation Expectations
1. Add or update self-checks proving the avatar renderer can boot independently.
2. Re-run scene, bubble, playback, and lipsync checks against the avatar path.
3. Verify that renderer/audio/bubble bridge traffic resolves through `avatar`
   only.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- avatar window owns the visible character surface
- bubble and lipsync run in the avatar window
- no embedded character stage remains in the console window
