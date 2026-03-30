# Task Card 0047

## Title
Implement `TurnOrchestrator` TTS service integration shell

## Role
Implementer

## Goal
Replace the current orchestrator TTS placeholder path with a real
`TTSService`-backed synthesis flow that turns protocol `TTSChunk` objects into
ordered `TTSAudioFragment` deliveries through a playback-facing sink boundary.

## Scope Clarification
This task is the first orchestrator/TTS integration layer.

It should let `TurnOrchestrator` synthesize real audio fragments through the
existing `packages/tts` service line, but it must still remain:

- orchestrator-owned above the TTS package
- free of concrete playback-device ownership
- free of renderer redesign
- free of runtime redesign
- explicit about its bounded pre-device lifecycle shell

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/tts/README.md`
- `docs/tts/architecture.md`
- `docs/tts/contracts.md`
- `docs/tts/provider-interface.md`
- `docs/tts/orchestrator-integration.md`
- `docs/tts/roadmap.md`
- the completed `packages/tts/*` implementation from tasks 0043 through 0046
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

## Files To Create Or Modify
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/tts_audio_sink.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_tts_audio_sink.py`
- `tests/orchestrator/test_turn_orchestrator.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/tts/service.py`

## Hard Requirements
1. Add a typed `tts_service` seam to `TurnOrchestrator`. The orchestrator must call `TTSService`, not concrete providers directly.
2. Add explicit orchestrator config for TTS voice/profile selection at minimum for:
   - quick-reaction voice profile key
   - quick-reaction provider profile key
   - primary-response voice profile key
   - primary-response provider profile key
3. Add a typed playback-facing audio-fragment sink boundary owned above `packages/tts`.
4. The sink boundary must accept Echo-owned typed data, not raw provider payloads.
5. Add one concrete in-memory recording sink for tests and bounded development use.
6. Replace the current `_send_tts_chunk(...)` placeholder behavior so TTS dispatch:
   - resolves the correct quick/primary TTS binding
   - synthesizes through `TTSService`
   - forwards ordered `TTSAudioFragment` values to the audio-fragment sink
7. Preserve the existing parser, protocol-event-outbox, interrupt, and audio-mutex ownership rules.
8. Add a bounded local playback-lifecycle reconciliation shell so the existing `AudioMutex` and turn-resolution logic stay consistent before a real playback device layer exists.
9. This bounded shell may use the existing typed playback lifecycle handlers, but it must be clearly local and must not be presented as final playback-device truth.
10. Do not move provider logic into orchestrator.
11. Do not redesign `packages/tts`.
12. Failure semantics must be explicit:
   - TTS synthesis or sink delivery failure must surface clearly
   - if local bounded lifecycle reconciliation has already started for a chunk, cleanup must avoid leaving turn resolution permanently stuck
13. Allowed and expected size: write a substantial integration slice, not a thin wrapper. A reasonable target is **1000-1700 lines of non-test Python** across the allowed implementation files.

## Explicitly Out Of Scope
- playback device implementation
- renderer integration
- lip sync
- runtime bridge redesign
- provider fallback
- STT work
- app/demo shell code

## Validation Expectations
1. Add tests for the new audio-fragment sink models and recording sink behavior.
2. Add orchestrator tests proving quick and primary `TTSChunk` objects are synthesized through `TTSService`.
3. Add tests proving quick vs primary TTS profile selection works as configured.
4. Add tests proving bounded local playback-lifecycle reconciliation keeps turn resolution from stalling.
5. Add tests for TTS synthesis failure and sink failure surfaces.
6. Re-run the affected orchestrator and TTS regression suites.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `TurnOrchestrator` no longer relies on a pure TTS placeholder path
- orchestrator TTS dispatch uses `TTSService`
- synthesized audio fragments cross an Echo-owned typed sink boundary
- bounded local playback-lifecycle reconciliation keeps existing audio-mutex and turn-resolution logic coherent
- tests prove deterministic integration without requiring real network playback
