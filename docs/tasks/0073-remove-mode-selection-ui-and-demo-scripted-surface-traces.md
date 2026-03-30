# Task Card 0073

## Title
Remove mode-selection UI and `demo_scripted` traces from browser and desktop surfaces

## Role
Implementer

## Goal
Update the active browser and floating desktop surfaces so they no longer show,
store, or explain multiple modes. The product should present one production
configuration only, with the local fast LLM described as an optional
optimization.

## Scope Clarification
This task is UI-surface cleanup only.

It must:

- remove mode selectors/chips/copy from active surfaces
- update config/onboarding wording to one production path
- keep browser chat, floating chat, avatar, and bubble topology unchanged

It must not:

- redesign provider assembly semantics
- redesign page/window layout
- change protocol or runtime boundaries

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/desktop-provider-settings.md`
- `docs/tasks/0066-browser-web-console-foundation-and-local-control-plane.md`
- `docs/tasks/0067-open-yachiyo-browser-chat-surface-recreation.md`
- `docs/tasks/0068-open-yachiyo-browser-config-v2-and-onboarding-recreation.md`
- `docs/tasks/0069-desktop-live2d-avatar-chat-bubble-suite-reset.md`
- `docs/tasks/0070-open-yachiyo-desktop-window-ui-fidelity-and-sync-verification.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- completed implementations from tasks66 through 71

## Files To Create Or Modify
- `apps/web-ui/public/index.html`
- `apps/web-ui/public/chat_surface.mjs`
- `apps/web-ui/public/config-v2.html`
- `apps/web-ui/public/config-v2.css`
- `apps/web-ui/public/config_surface.mjs`
- `apps/web-ui/public/onboarding.html`
- `apps/web-ui/public/onboarding.css`
- `apps/web-ui/public/onboarding_surface.mjs`
- `apps/web-ui/public/provider_settings_helpers.mjs`
- `apps/desktop-live2d/renderer/chat.html`
- `apps/desktop-live2d/renderer/bubble.html`
- related self-check/smoke files under `apps/web-ui/` and `apps/desktop-live2d/renderer/`

If strictly required for typed shell metadata only, you may also modify:

- `apps/desktop-live2d/electron/main.mjs`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- provider assembly Python files

## Hard Requirements
1. Remove all active product-path references to:
   - `demo_scripted`
   - `real_provider_stack`
   - `selected_mode`
   - “mode” UI chips or selectors
2. Browser config/onboarding must present:
   - required cloud primary configuration
   - required TTS configuration
   - optional local fast LLM section clearly marked as an optimization
3. Browser chat and floating chat must no longer display mode badges.
4. Error and readiness copy must no longer imply that a missing local fast LLM
   is fatal.
5. No active product-path surface may present canned demo wording such as
   “demo mode”, “scripted mode”, or equivalent.
6. Do not change the accepted open-yachiyo-class layout direction; only remove
   mode/de-moware traces from the existing accepted surfaces.

## Explicitly Out Of Scope
- changing provider readiness logic itself
- canonicalizing model asset paths
- removing debug panels wholesale
- changing desktop interaction mechanics

## Validation Expectations
1. Update UI self-checks/smokes so they assert the absence of mode-selection
   elements and demo-scripted labels in active surfaces.
2. Re-run relevant browser and desktop surface self-checks.
3. Clearly report any non-product self-check fixtures that still mention
   `demo_scripted`.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- no active browser or floating desktop surface exposes mode selection
- no active browser or floating desktop surface displays `demo_scripted`
- the local fast LLM is presented only as optional acceleration
- current accepted page/window topology remains intact
