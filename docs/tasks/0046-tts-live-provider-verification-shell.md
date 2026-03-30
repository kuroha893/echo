# Task Card 0046

## Title
Implement opt-in live verification for the Qwen3 TTS provider

## Role
Implementer

## Goal
Add a small but explicit live verification path for the real Qwen3 TTS
provider, gated by environment/config so Echo can verify actual network and
credential behavior without making default tests depend on the network.

## Scope Clarification
This task addresses the current limitation that task44 only proved the provider
through fake transport tests.

It should add a real-provider verification path, but it must still remain:

- opt-in
- non-default
- bounded to provider verification
- free of orchestrator/runtime redesign
- free of CI-mandatory network dependency

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tts/README.md`
- `docs/tts/provider-interface.md`
- `docs/tts/provider-verification.md`
- `docs/tts/qwen3-voice-clone-provider.md`
- `docs/tts/roadmap.md`
- `docs/reference/approved/open-yachiyo-qwen3-tts-vc.md`
- the completed `packages/tts/*` implementation from tasks 0043, 0044, and 0045 if present

## Files To Create Or Modify
- `packages/tts/qwen3_voice_clone_provider.py`
- `tests/tts/test_qwen3_voice_clone_provider_live.py`

If strictly required to keep the verification path Echo-owned and typed, you
may also modify:

- `packages/tts/models.py`
- `packages/tts/service.py`
- `tests/tts/test_qwen3_voice_clone_provider.py`

## Hard Requirements
1. Add an explicit live verification entrypoint for the real Qwen3 provider. It may live in the provider module or an adjacent typed helper, but it must remain inside `packages/tts`.
2. Live verification must be gated by explicit environment/config. It must not run by default.
3. The gating must be narrow and deterministic, for example:
   - explicit base URL
   - explicit API key
   - explicit model / voice ids
   - explicit opt-in flag
4. The verification path must exercise the real provider through Echo-owned boundaries and report success/failure through typed Echo-owned results or assertions.
5. At minimum, the live verification path should cover one baseline synthesis request.
6. If task45 has already landed, the live verification path may also cover one enrollment request, but this is optional.
7. Add an env-gated live verification test file that skips cleanly when the required environment/config is absent.
8. The default unit suite must remain fully offline and deterministic.
9. Allowed and expected size: write a real verification shell, not a comment-only stub. A reasonable target is **400-900 lines of non-test Python** across the allowed implementation files.

## Explicitly Out Of Scope
- making live verification mandatory in CI
- orchestrator integration
- playback device or renderer work
- retry orchestration redesign
- provider fallback
- unrelated refactors in the TTS foundation

## Validation Expectations
1. Keep all existing fake-transport unit tests passing.
2. Add one live verification test file that skips clearly when env/config is absent.
3. If network access is available and credentials are configured, run the live verification test and report the result.
4. If live verification cannot be run in the current environment, say so explicitly in the task output.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- Echo has an explicit, opt-in live verification path for the Qwen3 provider
- the default TTS test suite still does not require network access
- live verification is clearly gated and does not silently run in normal tests
