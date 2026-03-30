# Task Card 0068

## Title
Implement high-fidelity browser `config-v2` and `onboarding` recreation

## Role
Implementer

## Goal
Rebuild Echo's browser `config-v2` and `onboarding` surfaces as high-fidelity
recreations of the corresponding open-yachiyo browser pages, using the browser
control plane and provider settings model already accepted in Echo.

## Scope Clarification
This task is browser config/onboarding UI work.

It must:

- recreate `config-v2` and `onboarding` at high fidelity
- wire provider settings, voice enrollment, and readiness into those pages
- keep Echo's single-session and app-local settings scope

It must not:

- redesign provider settings semantics
- redesign enrollment semantics
- redesign protocol or runtime boundaries
- change Electron floating-window topology

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/desktop-provider-settings.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/tts/voice-clone-enrollment.md`
- `docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md`
- completed implementations from tasks53 through 67
- local reference source under:
  - `docs/reference/open-yachiyo-main/apps/gateway/public`

## Files To Create Or Modify
- `apps/web-ui/*`

If strictly required for browser settings/enrollment support, you may also
modify:

- browser control-plane client helpers created in task0066

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*`
- `apps/desktop-live2d/python/*` semantics

## Hard Requirements
1. Recreate `config-v2` and `onboarding` at high fidelity from the approved
   local reference source.
2. Directly inspect the approved local reference source under:
   - `docs/reference/open-yachiyo-main/apps/gateway/public`
3. Reproduce at high fidelity:
   - layout proportions
   - style tokens and visual hierarchy
   - tab/panel/card structure
   - onboarding step flow
   - animation and interaction parameters
4. `config-v2` must expose Echo's already-approved provider settings and
   readiness surfaces.
5. `onboarding` must expose Echo's already-approved voice enrollment and first
   setup flow.
6. Keep the product scope bounded to Echo's current provider family and
   single-session rule.

## Explicitly Out Of Scope
- browser chat redesign
- Electron desktop-suite work
- screenshot, standby/presence, multi-session behavior

## Validation Expectations
1. Add browser self-checks for:
   - `config-v2` boot
   - settings load/save/masked secret behavior
   - readiness rendering
   - onboarding step flow
   - voice enrollment submission
2. Add smoke coverage for:
   - save settings
   - validate readiness
   - run one enrollment path through the browser surface

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- browser `config-v2` exists and boots independently
- browser `onboarding` exists and boots independently
- settings and enrollment are wired through Echo's existing host/control plane
- the pages are high-fidelity recreations rather than loose approximations
