# Task Card 0064

> Status note (2026-03-19): historically completed, but now treated as
> prototype groundwork only. The accepted product topology is the
> browser-console plus floating `avatar/chat/bubble` line.

## Title
Extract the floating chat window renderer and move transcript/composer there

## Role
Implementer

## Goal
Move current-session transcript history and text input out of the console shell
 into a dedicated floating `chat` window renderer.

## Scope Clarification
This task is chat-surface extraction work for the `chat` window only.

It must:

- create a dedicated chat renderer/page
- make chat window the only text input surface
- keep transcript synchronized with the single-session desktop companion
  service

It must not:

- move bubble ownership out of the avatar window
- leave a writable chat composer in the console window
- add multi-session UI

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/chat-history-panel.md`
- `docs/runtime/desktop-companion-session-service.md`
- completed implementations from tasks54 through 63
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/*`

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/main.mjs`
- `apps/desktop-live2d/electron/preload.mjs`
- `apps/desktop-live2d/renderer/*.html` entrypoint files if needed

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*` composition-root semantics
- `packages/orchestrator/*`
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Create a dedicated chat renderer/page for the `chat` window role.
2. Move current-session transcript history and composer/send action into the
   chat window.
3. Chat window must own:
   - transcript history
   - input box
   - send action
   - current-session-only message rendering
4. Companion transcript upsert and input queue bridge traffic must resolve
   through the chat window only.
5. Bubble state must remain avatar-local and must not become the transcript
   source of truth.
6. Console window must no longer contain a Chat view or writable composer after
   this task.
7. Chat input must remain usable without the console window being focused.

## Explicitly Out Of Scope
- console settings/voice UI reduction
- screenshot attachments
- standby/presence UI
- bubble ownership changes

## Validation Expectations
1. Add or update self-checks proving the chat renderer boots independently.
2. Add checks proving transcript updates remain in sync during streaming.
3. Add smoke coverage for submitting one text turn from the chat window.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- user can chat entirely through the floating chat window
- transcript updates appear in the chat window during a turn
- console no longer acts as the chat surface
