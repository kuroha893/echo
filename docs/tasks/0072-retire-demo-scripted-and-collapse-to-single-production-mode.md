# Task Card 0072

## Title
Retire `demo_scripted` and collapse desktop/browser control plane to one production mode

## Role
Implementer

## Goal
Remove `demo_scripted` and other multi-mode selection semantics from the active
desktop/browser control plane so Echo exposes one production run mode only:

- cloud primary LLM
- TTS
- optional local fast LLM as a latency optimization

## Scope Clarification
This task is limited to provider/settings semantics, host assembly, readiness,
and app-local control-plane behavior.

It must:

- remove `demo_scripted` from active product-path settings and host assembly
- remove `real_provider_stack` as a named selectable mode
- make the local fast LLM optional instead of mode-selecting
- keep the single-session composition root intact

It must not:

- redesign runtime/orchestrator semantics
- redesign web or desktop UI layout
- change protocol/package boundaries
- redesign Live2D scene topology

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/llm/README.md`
- `docs/llm/openai-responses-provider.md`
- `docs/llm/openai-compatible-local-provider.md`
- `docs/tts/README.md`
- `docs/tts/qwen3-voice-clone-provider.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/renderer/desktop-provider-settings.md`
- `docs/tasks/0057-desktop-provider-source-config-and-real-host-assembly.md`
- `docs/tasks/0061-desktop-demo-scripted-host-fallback.md`
- completed implementations from tasks57 through 71

## Files To Create Or Modify
- `apps/desktop-live2d/python/provider_settings.py`
- `apps/desktop-live2d/python/provider_host_assembly.py`
- `apps/desktop-live2d/python/companion_service_host.py`
- `apps/desktop-live2d/shared/provider_settings_contracts.mjs`
- `apps/web-ui/control_plane_server.mjs`
- related tests under `tests/runtime/`

If strictly required to keep the current app-local control plane typed and
coherent, you may also modify:

- `apps/desktop-live2d/electron/main.mjs`
- `apps/web-ui/public/control_plane_contracts.mjs`

Do not modify:

- `packages/protocol/*`
- `packages/orchestrator/*`
- `packages/llm/*` provider semantics
- `packages/tts/*` provider semantics
- desktop/browser surface layout files

## Hard Requirements
1. Remove `selected_mode`, `demo_scripted`, and `real_provider_stack` from the
   active provider settings document and typed UI-facing settings snapshot.
2. The only active product run mode must be one production configuration that
   includes:
   - cloud primary LLM
   - TTS
   - optional local fast LLM
3. Local fast LLM must be optional:
   - if configured and ready, it may be used for fast-path intent/quick work
   - if absent or unready, the system must still run through the cloud primary
     path without treating that as a mode error
4. No active product-path host assembly may return canned deterministic
   `demo_scripted` replies or route-level stub outputs.
5. Provider readiness must reflect the new semantics:
   - cloud primary and TTS are required for a full production run
   - local fast LLM is an optional accelerator, not a blocker
6. Keep the `DesktopCompanionSessionService` boundary unchanged: it must still
   consume assembled services, not parse provider forms.
7. Do not change protocol semantics or package boundaries.

## Explicitly Out Of Scope
- removing old UI components from browser/Electron pages
- canonicalizing Live2D model asset paths
- deleting non-product self-check harnesses
- screenshot, standby/presence, multi-session

## Validation Expectations
1. Add/update Python tests proving:
   - host assembly works without any mode selector
   - local fast LLM omitted still yields a valid production assembly
   - missing required cloud/TTS settings fail readiness correctly
   - no `demo_scripted` fallback path remains in active product mode
2. Re-run touched runtime host/service tests.
3. Clearly report any retained non-product test harnesses that still mention
   `demo_scripted`.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- active product settings no longer expose a mode selector
- `demo_scripted` is no longer usable in the active control plane
- local fast LLM is optional and no longer mode-defining
- cloud primary + TTS remain the required production path
- no active product-path canned demo reply logic remains
