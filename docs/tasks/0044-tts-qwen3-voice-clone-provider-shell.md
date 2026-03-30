# Task Card 0044

## Title
Implement the first commercial voice-clone provider shell in `packages/tts`

## Role
Implementer

## Goal
Add the first real TTS provider adapter on top of the TTS foundation, using a
Qwen3 TTS VC / realtime-style commercial API family as Echo's first
demo-oriented concrete backend.

## Scope Clarification
This is the first concrete TTS provider task.

It should add one real provider family to `packages/tts`, but it must still
remain:

- TTS-local
- provider-family specific, not provider-global
- adapter-agnostic above the provider port
- free of playback-device ownership
- free of orchestrator/runtime redesign

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/tts/README.md`
- `docs/tts/architecture.md`
- `docs/tts/contracts.md`
- `docs/tts/provider-interface.md`
- `docs/tts/voice-profile-boundary.md`
- `docs/tts/playback-and-chunking.md`
- `docs/tts/error-handling.md`
- `docs/tts/demo-path.md`
- `docs/tts/qwen3-voice-clone-provider.md`
- `docs/tts/roadmap.md`
- `docs/reference/approved/open-yachiyo-qwen3-tts-vc.md`
- the completed `packages/tts/*` foundation implementation from task 0043

## Files To Create Or Modify
- `packages/tts/qwen3_voice_clone_provider.py`
- `packages/tts/service.py`
- `packages/tts/registry.py`
- `tests/tts/test_qwen3_voice_clone_provider.py`
- `tests/tts/test_service.py`
- `tests/tts/test_registry.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/tts/models.py`
- `packages/tts/provider_ports.py`
- `packages/tts/errors.py`

## Hard Requirements
1. Implement one concrete Qwen3 TTS VC provider adapter that satisfies the existing `TTSProviderPort`.
2. The adapter must be Echo-owned and must treat the provider as an external commercial HTTP service, not as an embedded SDK-first stack.
3. Do not copy or import `open-yachiyo`'s tool layer, Python CLI wrapper, runtime event names, or desktop bridge structure.
4. Add typed provider-local config at minimum for:
   - provider key identity
   - base URL
   - API key
   - request timeout
   - standard model id
   - standard voice id
   - optional realtime model id
   - optional realtime voice id
5. Map Echo's typed `TTSVoiceProfile` and `TTSSynthesisRequest` into provider payloads conservatively.
6. The first concrete provider must support at minimum:
   - visible text synthesis
   - language / voice-tag style selection if required by the provider family
   - provider-managed voice ids
   - optional typed realtime-capability metadata, even if the first transport path still uses conservative baseline HTTP synthesis
7. Normalize provider output into ordered `TTSAudioFragment` values.
8. Preserve provider transport details below `packages/tts`; callers above the boundary must only see Echo-owned TTS-local models.
9. Implement typed error mapping for malformed payloads, timeout, cancellation, provider unavailable, authentication failure, rate limiting, and unsupported capability mismatches.
10. The provider must not emit protocol events or mutate orchestrator/runtime state.
11. The provider must be usable through the existing `TTSProviderRegistry` and `TTSService`.
12. Tests must not hit the real network. Use fake raw responses or a fake transport double.
13. Allowed and expected size: write a substantial concrete adapter, not a thin HTTP wrapper. A reasonable target is **1000-1700 lines of non-test Python** across the allowed `packages/tts` files.

## Explicitly Out Of Scope
- backend process supervision or auto-start
- automated voice-clone enrollment workflow
- playback device implementation
- orchestrator integration
- renderer / STT code
- app/demo shell code
- multi-provider fallback
- GPT-SoVITS or other local-provider transports

## Validation Expectations
1. Add provider-focused tests for typed config validation and constructor behavior.
2. Add tests proving synthesis works through fake transport payloads.
3. Add tests proving provider-managed voice ids and other voice-profile fields are mapped through the provider adapter.
4. Add tests proving ordered audio fragments are normalized correctly.
5. Add tests for malformed payloads, timeout/cancellation, authentication failure, rate limiting, and unsupported capability mapping.
6. Add at least one `TTSService` integration test that routes through the registry into the new provider adapter.
7. Run the TTS provider tests plus the existing TTS service/registry/model regression tests that cover the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/tts` contains one real commercial voice-clone provider adapter
- the adapter consumes Echo-owned voice profiles and synthesis requests
- the adapter can be exercised through the existing registry/service boundary
- no `open-yachiyo` tool layer, CLI wrapper, or desktop bridge architecture was copied into Echo
- tests prove deterministic behavior without real network I/O
