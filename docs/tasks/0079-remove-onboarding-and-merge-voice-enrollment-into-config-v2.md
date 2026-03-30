# Task Card 0079

## Title
Remove browser onboarding and merge active voice enrollment into `config v2`

## Role
Implementer

## Goal
Delete the current browser onboarding surface from the active product path and
move the active voice-enrollment / cloned-voice setup workflow into the browser
`config v2` page so provider setup and voice setup live in one place.

## Scope Clarification
This task is a bounded browser control-plane surface consolidation.

It must:

- remove onboarding from the active browser product path
- move the active voice enrollment UI and actions into `config v2`
- keep browser chat and desktop suite topology unchanged
- keep the existing app-local control-plane endpoints and typed contracts unless
  a small UI-facing adjustment is strictly required

It must not:

- redesign desktop avatar/chat/bubble windows
- redesign provider semantics
- redesign TTS provider contracts
- add new product features beyond relocating the existing enrollment workflow

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0068-open-yachiyo-browser-config-v2-and-onboarding-recreation.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- `docs/tasks/0073-remove-mode-selection-ui-and-demo-scripted-surface-traces.md`
- completed implementations/reports from tasks66 through 78
- active browser control-plane files under:
  - `apps/web-ui/public/index.html`
  - `apps/web-ui/public/config-v2.html`
  - `apps/web-ui/public/config_surface.mjs`
  - `apps/web-ui/public/onboarding.html`
  - `apps/web-ui/public/onboarding.css`
  - `apps/web-ui/public/onboarding.mjs`
  - `apps/web-ui/public/onboarding_surface.mjs`
  - related self-check/smoke files

## Files To Create Or Modify
- `apps/web-ui/public/index.html`
- `apps/web-ui/public/config-v2.html`
- `apps/web-ui/public/config_surface.mjs`
- `apps/web-ui/public/provider_settings_helpers.mjs` only if required for the merged enrollment UI
- `apps/web-ui/public/onboarding.html`
- `apps/web-ui/public/onboarding.css`
- `apps/web-ui/public/onboarding.mjs`
- `apps/web-ui/public/onboarding_surface.mjs`
- `apps/web-ui/config_surface_self_check.mjs`
- `apps/web-ui/config_onboarding_smoke.mjs`
- `apps/web-ui/onboarding_surface_self_check.mjs`
- any closely related browser control-plane self-check/smoke file strictly required by the consolidation

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/llm/*`
- `packages/tts/*`
- `apps/desktop-live2d/**`

## Hard Requirements
1. `Onboarding` must be removed from the active browser navigation and active
   user flow.
2. The browser root/chat page must no longer link to `/onboarding.html`.
3. `config v2` must expose the active voice-enrollment workflow needed for:
   - entering a voice display name
   - entering a local reference audio path
   - running the existing voice enrollment request
   - surfacing the enrollment result or error
4. The merged `config v2` voice-enrollment UI must stay on the active product
   path and must not be hidden behind a deprecated onboarding dependency.
5. If the onboarding files remain in the repo for compatibility, they must be
   clearly deprecated and non-entrypoint; otherwise they should be removed.
6. Do not duplicate provider settings forms inside `config v2`; integrate
   voice enrollment into the existing page structure.
7. Keep the existing control-plane endpoint usage bounded to the current typed
   voice-enrollment operation; do not invent a new backend contract unless
   strictly necessary.
8. Keep fail-fast behavior for enrollment errors; do not add fake success,
   placeholder voices, or canned enrollment results.

## Explicitly Out Of Scope
- changing provider readiness semantics
- changing the cloud/local provider split
- changing TTS contract shape
- redesigning the entire `config v2` look and feel
- desktop UI changes

## Validation Expectations
1. Update browser self-checks to prove:
   - `index.html` no longer exposes onboarding navigation
   - `config v2` contains the merged voice-enrollment controls
   - onboarding is no longer an active entrypoint
2. Update the existing browser smoke to cover:
   - loading `config v2`
   - filling voice-enrollment fields
   - invoking the existing enrollment action path
3. Re-run the affected browser self-checks and smokes.
4. Explicitly report whether onboarding files were:
   - deleted
   - or retained as deprecated/non-entrypoint residue

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the active browser UI no longer presents `Onboarding` as a separate page or nav item
- users can configure providers and run voice enrollment from `config v2`
- no active browser flow depends on the old onboarding page
- no fallback or fake voice-enrollment behavior is introduced
