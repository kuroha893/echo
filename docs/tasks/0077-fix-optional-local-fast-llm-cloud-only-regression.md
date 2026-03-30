# Task Card 0077

## Title
Fix optional local-fast-LLM regression so cloud-only production runs do not auto-enable localhost routing

## Role
Implementer

## Goal
Restore the intended post-task72 semantics for `local_fast_llm`:

- it is truly optional
- cloud-only production runs work without any local model service
- browser settings UI must not silently materialize a localhost local-fast config
  and then cause runtime turn failures

## Scope Clarification
This task is a narrow regression fix for provider-settings drafting, save
payload shape, and host assembly interpretation of optional local-fast LLM
configuration.

It must:

- stop the browser control plane from auto-saving a default localhost
  `local_fast_llm` block when the user has not explicitly enabled it
- preserve cloud-only production behavior when no local-fast provider is
  configured
- keep `local_fast_llm` available as an explicit optional accelerator when the
  user really wants to configure it

It must not:

- redesign provider families
- add online health checks or probe calls
- redesign browser config layout
- change protocol semantics
- reintroduce demo/scripted paths

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- completed implementations/reports from tasks72 through 75
- `apps/desktop-live2d/python/provider_settings.py`
- `apps/desktop-live2d/python/provider_host_assembly.py`
- `apps/web-ui/public/control_plane_contracts.mjs`
- `apps/web-ui/public/provider_settings_helpers.mjs`
- `apps/web-ui/public/config_surface.mjs`
- typed control-plane files if required

## Files To Create Or Modify
- `apps/desktop-live2d/python/provider_settings.py`
- `apps/desktop-live2d/python/provider_host_assembly.py`
- `apps/web-ui/public/control_plane_contracts.mjs`
- `apps/web-ui/public/provider_settings_helpers.mjs`
- `apps/web-ui/public/config_surface.mjs`
- related provider-settings self-check/smoke files only if required

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/llm/*` provider semantics
- `packages/tts/*` provider semantics
- Live2D avatar rendering files

## Hard Requirements
1. If `settings_snapshot.local_fast_llm` is `null`, the browser settings draft
   must keep it absent/null by default instead of auto-populating a localhost
   draft object.
2. Saving provider settings without explicitly enabling local-fast LLM must
   preserve:
   - `local_fast_llm: null`
3. The active product path must not attempt to connect to
   `http://127.0.0.1:30000/v1` unless the user has explicitly configured
   `local_fast_llm`.
4. Cloud-only production runs must succeed through the cloud primary route when:
   - cloud primary is configured
   - Qwen TTS is configured
   - local fast LLM is absent
5. If local-fast LLM is explicitly configured but unavailable, readiness may
   describe it as unavailable, but the system must not silently treat a
   UI-created default draft as an intentional enabled configuration.
6. Do not add fallback canned replies, demo providers, or degraded fake-local
   shims.

## Explicitly Out Of Scope
- fixing invalid/empty provider settings file recovery
- changing secret-field labels or UX copy
- real provider online health checks
- cloud provider compatibility expansion
- desktop/browser layout changes

## Validation Expectations
1. Add/update targeted checks proving:
   - `buildEditableProviderSettingsDraft()` keeps `local_fast_llm` absent when
     the snapshot is absent
   - saving cloud-only settings preserves `local_fast_llm: null`
   - host assembly with `local_fast_llm: null` binds quick reaction to cloud
     primary and does not instantiate the local provider
2. Re-run provider-settings self-checks and the smallest browser config/control
   plane smoke that covers save/load.
3. Clearly report any retained test-only harnesses that still hardcode a local
   localhost fast-model config.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- leaving local-fast LLM unconfigured no longer creates an implicit localhost
  provider config
- cloud-only production runs no longer fail with localhost `WinError 10061`
  solely because the optional local-fast section was never intentionally enabled
- the active control plane preserves `local_fast_llm: null` unless the user
  explicitly opts in
