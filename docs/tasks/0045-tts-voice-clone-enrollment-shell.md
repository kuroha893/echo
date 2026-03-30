# Task Card 0045

## Title
Implement TTS voice-clone enrollment and local reference-audio upload shell

## Role
Implementer

## Goal
Extend `packages/tts` so a caller can upload a local reference audio file
through a typed Echo-owned enrollment boundary and receive a provider-managed
`TTSVoiceProfile` suitable for later synthesis.

## Scope Clarification
This task addresses the current limitation that the first Qwen3 provider can
only synthesize with existing provider-managed voice ids and cannot yet turn a
local reference audio file into a reusable cloned voice profile.

It should add one bounded enrollment path, but it must still remain:

- TTS-local
- provider-family specific only where required by the concrete adapter
- free of playback-device ownership
- free of orchestrator/runtime redesign
- free of persistent voice-library management

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
- `docs/tts/voice-clone-enrollment.md`
- `docs/tts/qwen3-voice-clone-provider.md`
- `docs/tts/provider-verification.md`
- `docs/tts/roadmap.md`
- `docs/reference/approved/open-yachiyo-qwen3-tts-vc.md`
- the completed `packages/tts/*` implementation from tasks 0043 and 0044

## Files To Create Or Modify
- `packages/tts/models.py`
- `packages/tts/provider_ports.py`
- `packages/tts/registry.py`
- `packages/tts/service.py`
- `packages/tts/qwen3_voice_clone_provider.py`
- `tests/tts/test_models.py`
- `tests/tts/test_service.py`
- `tests/tts/test_qwen3_voice_clone_provider.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/tts/errors.py`
- `tests/tts/test_registry.py`

## Hard Requirements
1. Add a typed `TTSVoiceEnrollmentRequest` model that captures at minimum:
   - `provider_key`
   - `display_name`
   - local `reference_audio_path`
   - optional local realtime reference audio path
   - optional prompt text / prompt language
2. Add a typed `TTSVoiceEnrollmentResult` model that returns a fully formed Echo-owned `TTSVoiceProfile` plus any minimal provider-local metadata needed for later verification.
3. Extend provider capability modeling so a provider can explicitly declare whether it supports voice enrollment from local reference audio.
4. Add a provider-port enrollment seam. Keep it typed and Echo-owned.
5. Add service-level enrollment entrypoints so callers do not need to invoke the concrete provider class directly.
6. Implement Qwen3 provider enrollment by treating the commercial backend as an external HTTP service. Do not import external SDKs or copy `open-yachiyo` CLI structure.
7. The Qwen3 enrollment path must support local reference audio upload from a file path and must normalize the provider response into provider-managed standard and optional realtime voice ids.
8. Enrollment must remain distinct from synthesis. Do not redesign ordinary synthesis so that every speech request uploads local files.
9. The resulting `TTSVoiceProfile` must be reusable through the existing registry/service synthesis path without ad-hoc dict manipulation.
10. Add deterministic fake-transport tests for enrollment success and failure. Tests must not hit the real network.
11. Allowed and expected size: write a substantial implementation, not a tiny helper. A reasonable target is **900-1500 lines of non-test Python** across the allowed `packages/tts` files.

## Explicitly Out Of Scope
- persistent voice library storage or UI
- bulk voice management
- playback device implementation
- orchestrator integration
- realtime transport redesign
- GPT-SoVITS or other local-provider enrollment
- mandatory real-network testing

## Validation Expectations
1. Add model tests for enrollment request/result validation.
2. Add provider tests for local reference audio upload mapping and response normalization.
3. Add tests for unsupported enrollment capability, malformed provider response, timeout/cancellation, authentication failure, and rate limiting.
4. Add at least one `TTSService` integration test that exercises enrollment through the service boundary.
5. Re-run the affected TTS regression suite.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Echo can create a cloned `TTSVoiceProfile` from a local reference audio file through `packages/tts`
- Qwen3 enrollment is implemented as a typed Echo-owned boundary
- ordinary synthesis remains separate from enrollment
- no real network I/O is required by tests
