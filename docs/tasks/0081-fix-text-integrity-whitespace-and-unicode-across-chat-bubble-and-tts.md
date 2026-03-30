# Task Card 0081

## Title
Fix text integrity, whitespace preservation, and Unicode handling across chat, bubble, and TTS

## Role
Implementer

## Goal
Repair the active production text path so assistant/user text preserves exact
whitespace and non-ASCII characters end-to-end across:

- cloud-primary streamed text
- runtime transcript accumulation
- browser chat rendering
- desktop floating chat rendering
- bubble text rendering
- active TTS request payload construction

## Scope Clarification
This task is a bounded active-path text-integrity repair.

It must:

- preserve spaces exactly in streamed and finalized assistant text
- preserve Unicode characters such as Chinese without mojibake, lossy escaping,
  or UI corruption
- keep the active transcript/chat/bubble/TTS text path internally consistent

It must not:

- redesign provider semantics
- redesign the browser or desktop layouts
- redesign TTS chunking policy
- add fallback text normalization, canned text rewriting, or heuristic space
  insertion that guesses user-facing wording

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0078-align-qwen-tts-provider-with-current-dashscope-api.md`
- active files under:
  - `packages/llm/openai_responses_provider.py`
  - `packages/runtime/desktop_companion_session_service.py`
  - `packages/tts/qwen3_voice_clone_provider.py`
  - `apps/web-ui/public/chat_surface.mjs`
  - `apps/desktop-live2d/renderer/chat_history_panel_controller.mjs`
  - `apps/desktop-live2d/renderer/chat_history_panel_shell.mjs`
  - `apps/desktop-live2d/renderer/bubble_shell.mjs`
- closely related self-check/smoke tests only as needed

## Files To Create Or Modify
- `packages/llm/openai_responses_provider.py` only if the streamed text path is
  dropping whitespace or Unicode fidelity
- `packages/runtime/desktop_companion_session_service.py`
- `packages/tts/qwen3_voice_clone_provider.py`
- `apps/web-ui/public/chat_surface.mjs`
- `apps/desktop-live2d/renderer/chat_history_panel_controller.mjs`
- `apps/desktop-live2d/renderer/chat_history_panel_shell.mjs`
- `apps/desktop-live2d/renderer/bubble_shell.mjs`
- relevant browser/desktop self-check or runtime tests strictly required by the
  repair

Do not modify:

- `packages/protocol/*` semantics
- provider-family selection logic
- desktop window topology
- unrelated config/onboarding surfaces

## Hard Requirements
1. Active streamed/final assistant text must preserve exact spaces from the
   upstream provider path. If the upstream provider yields `"Hi there"`, the
   active transcript and visible chat/bubble text must not collapse it into
   `"Hithere"`.
2. The implementation must not "guess" missing spaces by adding heuristic
   whitespace between tokens after the fact unless the exact upstream chunk
   semantics require deterministic reassembly and can be justified from the
   provider contract.
3. Active Unicode text such as Chinese must survive end-to-end through:
   - transcript state
   - browser chat
   - desktop chat
   - bubble text
   - TTS synthesis request payloads
4. Remove any active-path ASCII-forcing or lossy JSON serialization that breaks
   user-visible text fidelity.
5. User-facing active UI strings that are visibly mojibaked or corrupted must be
   repaired.
6. Keep fail-fast behavior. If the upstream provider returns malformed text
   events, surface a real error; do not silently rewrite content into a guessed
   "nice" form.

## Explicitly Out Of Scope
- changing how frequently TTS chunks are generated
- changing Qwen TTS voice enrollment flow
- changing provider readiness/config contracts
- redesigning chat or bubble visual styling

## Validation Expectations
1. Add or update tests/self-checks proving:
   - streamed English text with spaces remains correctly spaced after final
     transcript accumulation
   - Chinese (or another non-ASCII sample) survives transcript -> UI rendering
     without corruption
   - active TTS request construction preserves non-ASCII requested text without
     lossy escaping
2. Re-run affected browser/desktop self-checks.
3. Re-run any touched Python tests around the runtime text path and TTS payload
   construction.
4. Explicitly report where the root causes were found:
   - upstream provider stream decoding
   - runtime transcript accumulation
   - UI rendering
   - TTS payload serialization

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- English spaces are preserved in the active transcript/chat/bubble path
- Chinese and other non-ASCII text render correctly in the active UI path
- active TTS requests preserve the intended text content without lossy
  serialization
- no fallback/demo behavior is introduced
