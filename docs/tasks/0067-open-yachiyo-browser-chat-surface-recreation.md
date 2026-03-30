# Task Card 0067

## Title
Implement high-fidelity browser chat surface recreation

## Role
Implementer

## Goal
Rebuild Echo's browser `chat` page as a high-fidelity recreation of the
open-yachiyo browser chat surface, on top of the app-local browser control
plane from task0066.

## Scope Clarification
This task is browser chat UI work.

It must:

- recreate the browser chat layout and interaction style at high fidelity
- wire transcript history, composer, and submit behavior to the task0066
  control plane
- keep the page single-session

It must not:

- build `config-v2` or onboarding yet
- redesign control-plane endpoint semantics
- change floating desktop window ownership

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md`
- completed implementations from tasks53 through 66
- local reference source under:
  - `docs/reference/open-yachiyo-main/apps/gateway/public`

## Files To Create Or Modify
- `apps/web-ui/*`

If strictly required for browser chat streaming/rendering support, you may also
modify:

- browser control-plane client helpers created in task0066

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*`
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Recreate the open-yachiyo-class browser `chat` surface at high fidelity.
2. Directly inspect the approved local reference source under:
   - `docs/reference/open-yachiyo-main/apps/gateway/public`
3. Reproduce at high fidelity:
   - dark glassmorphism theme
   - sidebar/header/composer proportions
   - spacing and typography density
   - hover/focus/streaming animation parameters
4. Keep the page single-session only.
5. Browser chat must support:
   - transcript history
   - current assistant streaming updates
   - user composer/send
   - readiness/debug visibility
6. Do not copy gateway backend logic, route semantics, or non-UI JS behavior
   that conflicts with Echo's control plane.

## Explicitly Out Of Scope
- `config-v2`
- onboarding
- Electron chat window changes
- screenshot, standby/presence, multi-session behavior

## Validation Expectations
1. Add browser self-check coverage for:
   - page boot
   - transcript rendering
   - streaming assistant update behavior
   - composer/send behavior
2. Add smoke coverage proving one submitted turn updates the browser chat
   transcript through the control plane.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- browser `chat` exists and boots independently
- the UI is a high-fidelity recreation target, not a loose reinterpretation
- one text turn can be submitted from the browser chat page
- transcript and streaming updates render correctly
