# Task Card 0058

> Status note (2026-03-19): historically completed, but superseded as target
> product UI by the browser web console plus floating `avatar/chat/bubble`
> reset line. Keep this card only as prototype context.

## Title
Implement full console desktop shell and provider/settings UI

## Role
Implementer

## Goal
Turn the current engineering-style desktop panel into a fuller single-session
console shell with Chat, Services, and Voice views on top of the typed desktop
host/settings foundation from task0057.

## Scope Clarification
This task is app-shell and UI work.

It must:

- improve the desktop demo's presentation
- expose the already-supported provider settings and voice enrollment paths
- keep the current bubble overlay and current-session chat behavior

It must not:

- add multi-session shell management
- redesign the provider host protocol again
- land real device playback

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/chat-history-panel.md`
- `docs/renderer/desktop-provider-settings.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/tts/voice-clone-enrollment.md`
- `docs/reference/photos/open-yachiyo.png`
- `docs/reference/photos/chatbox.png`
- `docs/reference/photos/airi-choose-llm.png`
- `docs/reference/photos/airi-choose-llm-api.png`
- `docs/reference/photos/airi-choose-tts.png`
- `docs/reference/photos/airi-tts-config.png`
- `docs/reference/photos/airi-tts-config-2.png`
- `docs/reference/photos/qwen3-tts-ui.png`
- completed implementations from tasks53 through 57

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/preload.mjs`
- `apps/desktop-live2d/electron/main.mjs`
- `apps/desktop-live2d/shared/*`

If strictly required for already-approved typed host operations, you may also
modify:

- `apps/desktop-live2d/electron/python_companion_host.mjs`
- `apps/desktop-live2d/electron/companion_service_protocol.mjs`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*` core semantics
- `packages/renderer/*` foundation semantics

## Hard Requirements
1. Reshape the desktop app into a full console-style shell with:
   - left navigation rail
   - central workspace
   - right-side stage/character area
2. Keep the shell single-session only. Do not add session switching or session
   list management.
3. Add exactly three bounded views:
   - `Chat`
   - `Services`
   - `Voice`
4. `Chat` must preserve:
   - current-session history
   - composer/send action
   - bubble overlay coexistence
5. `Services` must expose typed source/config UI for the currently supported
   desktop providers and the explicit `demo_scripted` fallback.
6. `Voice` must expose:
   - local reference-audio upload
   - reference transcript input
   - enrollment submit
   - current voice summary/selection
7. The UI should use the local photo set as visual guidance only; do not copy
   exact layout trees or exact component scopes from reference products.
8. Secret fields must stay masked when preloaded from the host.
9. No screenshot UI, no standby/presence UI, no multi-session shell.

## Explicitly Out Of Scope
- real device audio output
- real Pixi/Cubism dependency landing
- OS keychain integration
- screenshot attachments
- standby/presence controls
- product-grade config/account shell

## Validation Expectations
1. Add JS self-check coverage for:
   - shell view switching
   - settings form state
   - masked secret behavior
   - voice enrollment page behavior
   - current-session chat history rendering
2. Preserve and re-run existing chat panel, bubble, scene, and smoke checks.
3. Add bounded smoke coverage proving:
   - save settings
   - load settings
   - submit one text turn
   - transcript and bubble remain in sync

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the desktop app presents a full console-style shell
- Chat / Services / Voice views are real and bounded
- provider/source settings are configurable through the desktop UI
- voice enrollment is reachable through the desktop UI
- bubble overlay and current-session chat behavior remain intact
