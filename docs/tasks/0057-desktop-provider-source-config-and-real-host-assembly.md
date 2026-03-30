# Task Card 0057

## Title
Implement desktop provider/source config foundation and real host assembly

## Role
Implementer

## Goal
Replace the scripted default desktop companion host with one explicit typed
provider/source settings foundation and one real host assembly path for the
already-implemented Echo providers.

## Scope Clarification
This task is the first post-task56 milestone.

It must:

- keep the single-session desktop demo architecture intact
- keep provider settings local to the desktop app/host
- keep `DesktopCompanionSessionService` as the composition root
- replace the scripted default path for real desktop runs

It must not:

- redesign runtime core
- redesign protocol contracts
- build the full console UI
- land real device playback

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
- `docs/tts/voice-clone-enrollment.md`
- `docs/runtime/README.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/renderer/desktop-provider-settings.md`
- completed implementations from tasks53 through 56

## Files To Create Or Modify
- `apps/desktop-live2d/python/*`
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/shared/*`
- `tests/runtime/test_desktop_companion_session_service.py`

If strictly required to preserve the already-approved typed desktop bridge or
host protocol surface, you may also modify:

- `packages/runtime/desktop_companion_session_service.py`
- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

Do not modify:

- `packages/protocol/*`
- `packages/orchestrator/*`
- `packages/llm/*` provider semantics
- `packages/tts/*` provider semantics

## Hard Requirements
1. Add one app-local typed provider settings model stored in a single JSON file
   under Electron `userData`.
2. The real host assembly path must support exactly:
   - local OpenAI-compatible fast-path LLM
   - cloud OpenAI Responses primary LLM
   - Qwen3 voice-clone TTS
3. Preserve an explicit `demo_scripted` mode for tests, self-checks, and
   bounded offline fallback, but it must not remain the default real desktop
   path.
4. Extend the existing desktop companion host protocol with typed operations
   for:
   - load settings
   - save settings
   - validate/test settings
   - run TTS voice enrollment
   - report provider/runtime readiness
5. Renderer must not read the config file directly.
6. Preload/main must expose masked snapshots to renderer and accept typed
   secret updates without returning raw stored secrets.
7. `DesktopCompanionSessionService` must keep consuming already-assembled
   `LLMService` and `TTSService`; it must not absorb UI or config parsing.
8. Do not change protocol semantics or public package boundaries.
9. Reasonable target size: one bounded host/config slice, typically
   **700-1500 lines of non-test code** across the allowed files.

## Explicitly Out Of Scope
- full console shell layout
- full provider/settings UI
- real device audio output
- real Pixi/Cubism dependency landing
- multi-session desktop shell
- OS keychain integration
- screenshot flow
- standby/presence behavior

## Validation Expectations
1. Add Python tests for provider-settings parsing, masking behavior, secret
   update behavior, and real host assembly.
2. Add tests proving the host can switch between `demo_scripted` and
   real-provider config without changing runtime/orchestrator semantics.
3. Add smoke or self-check coverage for:
   - load settings
   - save settings
   - validate settings
   - provider readiness reporting
   - voice enrollment operation routing
4. Re-run touched runtime and desktop bridge tests.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- the desktop app has one typed local provider/source settings foundation
- the default desktop host path is no longer permanently scripted
- the host can assemble real llm/tts services from saved settings
- renderer only sees masked settings snapshots and typed host operations
- protocol semantics and stable runtime/orchestrator boundaries remain unchanged
