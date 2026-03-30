# Task Card 0043

## Title
Implement `packages/tts` foundation and service shell

## Role
Implementer

## Goal
Create the first real `packages/tts` package with typed TTS-local contracts,
voice-profile models, provider ports, provider registry, a caller-facing TTS
service shell, and a deterministic fake or scripted provider for tests.

## Scope Clarification
This task is the TTS foundation layer.

It should make `packages/tts` real and usable by later orchestrator work, but
it must still remain:

- provider-agnostic
- transport-light
- demo-oriented
- free of playback-device ownership

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/feedback-rules.md`
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
- `packages/protocol/events.py`
- `packages/orchestrator/turn_orchestrator.py`

## Files To Create Or Modify
- `packages/tts/models.py`
- `packages/tts/errors.py`
- `packages/tts/provider_ports.py`
- `packages/tts/registry.py`
- `packages/tts/service.py`
- `packages/tts/scripted_provider.py`
- `tests/tts/test_models.py`
- `tests/tts/test_registry.py`
- `tests/tts/test_service.py`

## Hard Requirements
1. Implement the TTS-local typed model family in Pydantic v2 style with `extra="forbid"` and immutable semantics where appropriate.
2. Define a typed `TTSVoiceProfile` boundary instead of making callers pass raw backend payloads.
3. Define a typed synthesis request that consumes protocol `TTSChunk`.
4. Define a typed normalized audio-fragment model for provider output.
5. Implement a normalized typed TTS failure model and error-code enum.
6. Implement one unified provider port that supports synthesis and capability inspection.
7. Implement a typed provider registry that resolves provider/profile/voice choices explicitly and rejects unknown bindings clearly.
8. Implement a caller-facing `TTSService` above the registry/provider port.
9. `packages/tts` must not emit protocol events or mutate orchestrator/runtime state.
10. `packages/tts` must not own audio ownership decisions; `AudioMutex` semantics remain outside this package.
11. Add a deterministic fake or scripted provider for tests and local development. It must not use real network I/O.
12. Allowed and expected size: write a substantial implementation, not a stub. A reasonable target is **900-1500 lines of non-test Python** across the allowed `packages/tts` files.

## Explicitly Out Of Scope
- any concrete provider HTTP transport
- playback device implementation
- orchestrator integration
- renderer / STT code
- app/demo shell code
- voice marketplace management

## Validation Expectations
1. Add tests for model validation and locked contract behavior.
2. Add tests for registry resolution and failure on unknown providers/profiles/voices.
3. Add tests for `TTSService` synthesis delegation.
4. Add tests for deterministic scripted/fake provider behavior.
5. Run the new TTS test files plus any minimal dependent regression tests required by the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/tts` exists as a real package area with typed contracts, provider ports, registry, service, and scripted/fake provider
- protocol `TTSChunk` remains the upstream chunk contract
- TTS failures are normalized to typed TTS-local surfaces
- tests prove deterministic behavior without real provider transport
