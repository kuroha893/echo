# Task Card 0011

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with dual-track shell coordination

## Role
Implementer

## Goal
Extend `packages/orchestrator/turn_orchestrator.py` so it implements the bounded dual-track coordination shell defined in:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task wires together the orchestrator pieces already implemented in earlier tasks:

- quick-reaction drafter path
- primary chunk consumption path
- renderer/TTS dispatch helpers

The task covers only the **turn-level coordination shell**:

- `handle_user_turn()`
- `_run_primary_reasoning()`
- `_stream_primary_response()` as a typed boundary method

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/expression_parser.py`
- `packages/protocol/events.py`

This task is intentionally **not** full runtime integration.

---

## Scope Clarification
This card is intentionally limited to the orchestrator shell that coordinates dual-track tasks and queues.

It includes only:

- `handle_user_turn()`
- `_run_primary_reasoning()`
- `_stream_primary_response()` as a typed placeholder boundary
- minimal shutdown / task cancellation handling consistent with the skeleton

This card does **not** authorize:

- STT / TTS adapter implementation
- playback device integration
- event bus integration
- state-machine advancement
- tool-loop integration
- memory / plugin integration
- redesign of `AudioMutex`, `ExpressionParser`, or protocol models

The target is a clean, testable dual-track shell that later runtime tasks can connect to real providers and adapters.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/expression_parser.py`
- `packages/orchestrator/turn_orchestrator.py`

If it already exists, you may also read:

- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** read unrelated runtime / memory / plugin / STT / TTS / renderer files for this task unless blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may modify only:

- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/orchestrator/audio_mutex.py`
- do not modify `packages/orchestrator/expression_parser.py`
- do not modify `packages/protocol/events.py`
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following additions from the `TurnOrchestrator` skeleton in `docs/protocol/orchestrator-spec.md`.

### 1. `handle_user_turn()`
Implement `handle_user_turn()` so it:

- creates the documented events/queues:
  - `interrupt_event`
  - `drafter_done_event`
  - `primary_done_event`
  - `primary_first_chunk_ready_event`
  - `quick_reaction_finished_event`
  - `primary_chunk_queue`
  - `renderer_command_queue`
  - `tts_request_queue`
- starts the documented task set:
  - `_run_local_drafter()`
  - `_run_primary_reasoning()`
  - `_consume_primary_chunks()`
  - `_dispatch_renderer_commands()`
  - `_dispatch_tts_chunks()`
- awaits the bounded coordination set
- reconciles background dispatch tasks in `finally`

You do **not** need to add extra task groups, supervisors, or lifecycle systems beyond this bounded shell.

### 2. `_run_primary_reasoning()`
Implement `_run_primary_reasoning()` so it:

- iterates `async for` over `_stream_primary_response(ctx)`
- stops early if `interrupt_event` is set
- writes raw chunks into `primary_chunk_queue`
- always enqueues the `None` sentinel in `finally`
- always sets `primary_done_event` in `finally`

### 3. `_stream_primary_response()`
Implement `_stream_primary_response()` as a typed async boundary method.

For this task it may remain a safe placeholder that yields no chunks.
It must:

- exist on `TurnOrchestrator`
- be async iterable compatible
- return `AsyncIterator[str]`

Do **not** add provider/model integration or hard-coded production logic beyond a safe placeholder.

### 4. Minimum test coverage
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- `_stream_primary_response()` default boundary behavior is typed and non-crashing
- `_run_primary_reasoning()` forwards streamed chunks into `primary_chunk_queue`
- `_run_primary_reasoning()` always appends the `None` sentinel
- `_run_primary_reasoning()` always sets `primary_done_event`
- `interrupt_event` stops `_run_primary_reasoning()` from forwarding later chunks
- `handle_user_turn()` starts both drafter and primary path without serializing them
- `handle_user_turn()` still completes if drafter path returns `None`
- drafter failure does not prevent primary path completion
- primary failure still triggers bounded shutdown / cancellation of dispatch tasks

You may use a test subclass of `TurnOrchestrator` to observe task order, injected failures, and dispatch cancellation deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. Dual-track startup must be concurrent, not a blocking drafter-then-primary sequence.
2. Drafter and primary paths must communicate only through orchestrator-owned queues/events in this bounded shell.
3. `_run_primary_reasoning()` must always leave the consumer path a terminating sentinel.
4. `_run_primary_reasoning()` must always signal completion even on failure or interruption.
5. `handle_user_turn()` must reconcile dispatch tasks in `finally`, not leak them.
6. This task must not infer playback completion from task completion.
7. This task must not emit real protocol events or touch adapters directly.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing local types instead of redefining semantics:
   - `TurnContext`
   - `QuickReaction`
   - `RendererCommand`
   - `TTSChunk`
   - `ExpressionParser`
   - `AudioMutex`
   - `OrchestratorConfig`
3. Do **not** return or pass ad-hoc dict payloads.
4. Do **not** invent new event types, state statuses, or interrupt policies.
5. Do **not** implement real provider/model streaming.
6. Do **not** implement STT/TTS/renderer device adapters.
7. Do **not** redesign previously implemented subpaths.
8. Keep `_stream_primary_response()` as a boundary method, not a real backend.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- STT integration
- TTS adapter/device implementation
- VTube / renderer adapter integration
- event bus integration
- state-machine advancement
- tool-calling runtime execution
- memory / plugin integration
- playback-truth reconciliation beyond current bounded placeholders

---

## Do Not
Do not:

- modify any document
- implement runtime adapters
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
2. If a working Python interpreter and required dependencies are available locally, run `tests/orchestrator/test_turn_orchestrator.py`
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

- `packages/orchestrator/turn_orchestrator.py` implements the bounded dual-track shell in this card
- both drafter and primary paths are started from `handle_user_turn()`
- `_run_primary_reasoning()` is sentinel-safe and completion-safe
- dispatch tasks are reconciled in bounded shutdown logic
- no STT/TTS/VTube/runtime adapter code was implemented
- tests cover the new dual-track shell surface at least minimally
