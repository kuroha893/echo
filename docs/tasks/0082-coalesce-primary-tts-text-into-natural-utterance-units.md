# Task Card 0082

## Title
Coalesce primary-response TTS text into natural utterance units instead of per-word playback

## Role
Implementer

## Goal
Repair the active primary-response TTS path so speech is synthesized and played
back in natural utterance-sized units rather than tiny streamed fragments that
produce long pauses between words.

## Scope Clarification
This task is a bounded orchestration/TTS delivery refinement for the active
production path.

It must:

- stop primary-response TTS from synthesizing obviously too-small fragments such
  as single words or token-level deltas when that produces unnatural pacing
- preserve low-latency behavior while raising the minimum utterance quality of
  active speech playback

It must not:

- redesign the overall runtime architecture
- redesign the cloud-primary provider contract
- redesign desktop audio sink semantics
- introduce fallback canned speech or fake buffering results

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/tasks/0078-align-qwen-tts-provider-with-current-dashscope-api.md`
- active files under:
  - `packages/orchestrator/turn_orchestrator.py`
  - `packages/orchestrator/audio_mutex.py`
  - `packages/orchestrator/desktop_live2d_audio_sink.py`
  - `packages/tts/service.py`
  - `packages/tts/qwen3_voice_clone_provider.py`
- related runtime/orchestrator tests

## Files To Create Or Modify
- `packages/orchestrator/turn_orchestrator.py`
- `packages/tts/service.py` only if a bounded TTS-facing flush/coalescing helper
  is the smallest correct place
- `packages/orchestrator/audio_mutex.py` only if strictly required by the new
  coalescing behavior
- relevant runtime/orchestrator tests strictly required by the fix

Do not modify:

- `packages/protocol/*` public semantics unless absolutely required and
  explicitly documented
- browser/desktop UI layout files
- provider settings UI/contracts

## Hard Requirements
1. The active primary-response TTS path must no longer synthesize/play back
   obviously too-small units that produce audible long pauses between English
   words in normal prose.
2. The repair must remain low-latency and interrupt-safe. Do not block until the
   entire final response is complete unless no smaller bounded design is viable.
3. Coalescing must be deterministic and bounded. Acceptable examples include:
   - sentence-like boundaries
   - punctuation-aware flushing
   - minimum character/word thresholds with a final flush
4. The implementation must not change transcript fidelity. Text shown in chat
   still comes from the actual response stream, not from a rewritten TTS-only
   paraphrase.
5. The implementation must not insert fake pauses, fake joins, or fallback audio
   to hide the issue.
6. Quick-reaction audio semantics must not be accidentally regressed while
   fixing primary-response pacing.

## Explicitly Out Of Scope
- full prosody control redesign
- realtime TTS transport redesign
- changing voice enrollment/customization contracts
- changing browser control-plane behavior

## Validation Expectations
1. Add or update tests proving:
   - multiple tiny streamed response deltas are coalesced into larger active TTS
     units before synthesis/playback
   - final tail text still flushes correctly
   - interruptibility and ordering remain deterministic
   - quick-reaction path still behaves as intended
2. If useful, add a bounded unit test that simulates a reply arriving as
   word-sized deltas and verifies the produced TTS chunks are no longer
   one-word-at-a-time.
3. Re-run the affected runtime/orchestrator/TTS tests.
4. Explicitly report the chosen coalescing rule and why it was selected.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- primary-response playback no longer sounds like one word per long pause in
  ordinary prose
- interrupt safety and bounded latency remain intact
- transcript text remains faithful to the original streamed response
- no fallback/demo behavior is introduced
