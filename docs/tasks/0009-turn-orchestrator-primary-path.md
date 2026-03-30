# Task Card 0009

## Title
Implement `packages/orchestrator/turn_orchestrator.py` primary-path slice

## Role
Implementer

## Goal
Create the first bounded implementation of `packages/orchestrator/turn_orchestrator.py` based on:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task implements only the primary-response consumption and dispatch slice of the orchestrator:

- turn context
- primary chunk parsing
- renderer command fan-out
- TTS chunk submission decisions through `AudioMutex`
- minimal adapter-boundary dispatch helpers

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/expression_parser.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/protocol/events.py`

This task is intentionally **not** the full turn orchestrator.

---

## Scope Clarification
This card is intentionally limited to the self-contained primary-path portion of the `TurnOrchestrator` skeleton:

- `TurnContext`
- `TurnOrchestrator.__init__()`
- `_consume_primary_chunks()`
- `_dispatch_renderer_commands()`
- `_dispatch_tts_chunks()`
- `_apply_interrupt_signal()` as a boundary method only

This card also authorizes the minimum config alignment needed to support that slice:

- expand `packages/orchestrator/audio_mutex.py`'s `OrchestratorConfig` to match the full config fields used by this primary-path skeleton

This card does **not** authorize:

- full `handle_user_turn()` orchestration
- `_run_local_drafter()`
- `_run_primary_reasoning()`
- `_generate_quick_reaction()`
- `_stream_primary_response()`
- real interrupt reconciliation
- event-bus publishing
- playback-device integration
- state-machine integration
- tool-loop integration

The target is a clean, testable primary-path coordinator that can later be composed into the full orchestrator without redesign.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
- `packages/orchestrator/expression_parser.py`
- `packages/orchestrator/audio_mutex.py`

If they already exist, you may also read:

- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`
- `tests/orchestrator/test_audio_mutex.py`
- `tests/orchestrator/test_expression_parser.py`

Do **not** read `docs/protocol/state-machine.md` or `docs/protocol/reasoning-tool-loop.md` for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/audio_mutex.py`
- `tests/orchestrator/test_turn_orchestrator.py`

If a directory does not exist, you may create:

- `packages/orchestrator/`
- `tests/orchestrator/`

Do **not** create or modify any other files.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/orchestrator/expression_parser.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following additions from the `TurnOrchestrator` skeleton in `docs/protocol/orchestrator-spec.md`.

### 1. Config alignment
Update `packages/orchestrator/audio_mutex.py` so `OrchestratorConfig` includes the full fields needed by this stage of the orchestrator skeleton:

- `quick_reaction_max_wait_ms`
- `interrupt_replace_timeout_ms`
- `allow_crossfade`
- `parser_max_tag_buffer_chars`
- `max_pending_primary_chunks`

Do **not** add any other config fields.

### 2. Turn context model
Implement `TurnContext` in `packages/orchestrator/turn_orchestrator.py`.

It must expose:

- `turn_id`
- `session_id`
- `trace_id`
- `utterance_text`
- `quick_reaction_stream_id`
- `primary_response_stream_id`
- `primary_tts_stream_id`

### 3. Turn orchestrator class
Implement `TurnOrchestrator` with at least:

- `__init__()`
- `_consume_primary_chunks()`
- `_dispatch_renderer_commands()`
- `_dispatch_tts_chunks()`
- `_apply_interrupt_signal()`
- `_send_renderer_command()`
- `_send_tts_chunk()`

`_apply_interrupt_signal()` / `_send_renderer_command()` / `_send_tts_chunk()` are adapter-boundary methods in this task.
They may remain no-op placeholders, but they must exist and stay typed.

### 4. Primary-path behavior
`_consume_primary_chunks()` must:

- read from `primary_chunk_queue`
- stop on `None`
- honor `interrupt_event`
- feed text through `ExpressionParser`
- forward parsed renderer commands to `renderer_command_queue`
- convert clean text into `TTSChunk`
- set `primary_first_chunk_ready_event` on the first clean primary chunk
- call `AudioMutex.submit_primary_chunk()`
- respect the documented decision branches:
  - `"play_now"`
  - `"replace_after_chunk"`
  - `"buffer"`
- call `wait_for_safe_handoff()` when required
- call `force_replace()` and `_apply_interrupt_signal()` when wait times out
- enqueue the final clean tail from `parser.end_of_stream()` if appropriate

### 5. Dispatch helper behavior
`_dispatch_renderer_commands()` must:

- drain `renderer_command_queue`
- stop when `interrupt_event` is set
- forward commands to `_send_renderer_command()`

`_dispatch_tts_chunks()` must:

- drain `tts_request_queue`
- stop when `interrupt_event` is set
- forward chunks to `_send_tts_chunk()`

### 6. Minimum test coverage
Create `tests/orchestrator/test_turn_orchestrator.py` with minimum unit coverage for:

- `TurnContext.utterance_text` rejects empty text
- first clean primary chunk sets `primary_first_chunk_ready_event`
- tag-only primary chunk emits renderer commands but no TTS chunk
- `"play_now"` queues TTS immediately
- `"replace_after_chunk"` waits for safe handoff and then queues TTS
- `"buffer"` waits for safe handoff and then queues TTS
- timeout in `"replace_after_chunk"` or `"buffer"` path triggers `force_replace()` and `_apply_interrupt_signal()`
- `parser.end_of_stream()` tail clean text is queued as final TTS chunk
- `_dispatch_renderer_commands()` forwards one queued renderer command to `_send_renderer_command()`
- `_dispatch_tts_chunks()` forwards one queued TTS chunk to `_send_tts_chunk()`

You may use a test subclass / fake mutex to observe boundary calls deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Primary text must always pass through `ExpressionParser` before TTS submission.
2. Renderer commands must be separated from audible text.
3. `AudioMutex` remains the sole authority for playback ownership decisions.
4. `primary_first_chunk_ready_event` must reflect the first clean primary text chunk, not the first raw chunk.
5. Tag-only chunks must not produce empty or fake TTS chunks.
6. Timeout-triggered replacement must produce a typed interrupt path, not ad-hoc branching state.
7. End-of-stream tail text must not be lost.
8. This task must not infer playback completion from parser or queue completion.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Any new typed models in this task must use **Pydantic v2** style with:
   - `extra="forbid"`
   - `frozen=True`
3. Reuse existing local types instead of redefining protocol semantics:
   - `ExpressionParser`
   - `AudioMutex`
   - `OrchestratorConfig`
   - `RendererCommand`
   - `TTSChunk`
   - `InterruptSignal`
4. Do **not** return or pass ad-hoc dict payloads.
5. Do **not** invent new event types, state statuses, or interrupt policies.
6. Do **not** implement quick-reaction generation logic.
7. Do **not** implement primary model streaming providers.
8. Do **not** emit actual protocol events from this task.
9. Do **not** bypass `AudioMutex` when submitting primary TTS chunks.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `handle_user_turn()`
- dual-track task spawning
- drafter/primary concurrency wiring
- runtime shutdown / cancellation choreography
- quick-reaction generation
- primary reasoning provider integration
- actual interrupt reconciliation
- playback adapter/device code
- event bus integration
- state-machine advancement
- tool-calling integration

---

## Do Not
Do not:

- modify any document
- implement the full orchestrator
- introduce new dependencies
- install dependencies
- rename documented fields
- replace typed protocol objects with plain dicts
- claim tests passed unless you actually ran them

---

## Execution Protocol
Before editing, follow `AGENTS.md`:

1. State your role as `Implementer`
2. State which files you will read
3. State which files you will modify
4. State which files you will not modify
5. If anything is missing, state it explicitly instead of guessing

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If `pydantic v2` is available locally, run `tests/orchestrator/test_turn_orchestrator.py`
3. If test execution is blocked by missing dependencies or environment limits:
   - do not install dependencies
   - do not fake results
   - explicitly state what was not run and why

---

## Output Format
At completion, report exactly:

1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

---

## Acceptance Criteria
This task is complete only if:

- `packages/orchestrator/turn_orchestrator.py` exists
- `TurnContext` exists and matches the documented fields
- `TurnOrchestrator` implements the bounded primary-path methods in this card
- `packages/orchestrator/audio_mutex.py`'s `OrchestratorConfig` is expanded only to the documented full skeleton fields
- primary chunks are parser-mediated and `AudioMutex`-mediated
- timeout replacement path produces a typed `InterruptSignal` handoff
- no quick-reaction runtime, full handle loop, or provider integration was implemented
- tests cover the new primary-path coordination surface at least minimally
