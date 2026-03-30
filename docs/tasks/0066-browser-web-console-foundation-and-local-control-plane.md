# Task Card 0066

## Title
Implement browser web console foundation and app-local control plane

## Role
Implementer

## Goal
Create Echo's browser-served web console foundation above the existing
single-session desktop companion session service, and establish the app-local
 HTTP + SSE control plane that future browser pages will use.

## Scope Clarification
This task is browser-surface foundation work.

It must:

- create a new browser web-console app surface
- serve static browser pages on a local port
- expose typed app-local endpoints for settings, readiness, enrollment,
  desktop-state snapshot, and text-turn submit
- expose SSE for transcript/readiness/debug streaming updates

It must not:

- attempt the high-fidelity chat page recreation yet
- attempt config-v2 or onboarding recreation yet
- redesign protocol, runtime, host, or bridge semantics
- remove the current Electron prototype UI during this task

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/desktop-provider-settings.md`
- `docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md`
- completed implementations from tasks53 through 65
- local reference source under:
  - `docs/reference/open-yachiyo-main/apps/gateway/public`

## Files To Create Or Modify
- `apps/web-ui/*`
- `apps/desktop-live2d/electron/*` only if needed to host or open the browser
  console entrypoint
- app-local support files needed for HTTP + SSE hosting

If strictly required for app-local control-plane integration, you may also
modify:

- `apps/desktop-live2d/python/companion_service_host.py`
- `apps/desktop-live2d/python/provider_host_assembly.py`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*` semantics
- `packages/orchestrator/*`
- `packages/renderer/*` foundation semantics

## Hard Requirements
1. Create a new browser-served web console app under `apps/web-ui`.
2. The web console must be reachable on a local port.
3. Add typed app-local HTTP operations for:
   - provider settings load/save/validate/readiness
   - text-turn submit
   - desktop-state snapshot
   - TTS voice enrollment
4. Add SSE for transcript/readiness/debug streaming updates.
5. Keep one shared single-session `DesktopCompanionSessionService` as the
   backend composition root.
6. Do not redesign or extend `packages/protocol`.
7. Do not copy gateway/backend semantics from the reference source; only the
   browser UI topology is a future fidelity target.

## Explicitly Out Of Scope
- high-fidelity browser UI recreation
- Electron window-topology changes
- bubble ownership changes
- screenshot or standby/presence behavior

## Validation Expectations
1. Add bounded checks for local HTTP route registration and SSE emission.
2. Add smoke coverage proving:
   - settings can be loaded and saved
   - readiness can be queried
   - one text turn can be submitted through the browser control plane
3. Clearly report any environment-gated browser/Electron launch steps.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- a new browser web-console app exists under `apps/web-ui`
- the app serves on a local port
- typed control-plane operations exist for settings/readiness/enrollment/turns
- SSE updates are available for transcript/readiness/debug state
- the existing single-session runtime composition remains intact
