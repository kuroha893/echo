# Task Card 0015

## Title
Extend `packages/orchestrator/turn_orchestrator.py` with protocol-event outbox shell

## Role
Implementer

## Goal
Extend the current orchestrator shell so it can emit the protocol events that are already defined in `packages/protocol/events.py`, based on:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

This task is intentionally limited to the **internal protocol-event outbox shell**:

- build typed protocol events inside the orchestrator
- place them onto an orchestrator-owned outbox queue
- optionally forward them through a typed boundary method

Use **Python 3.10+** and existing local modules:

- `packages/orchestrator/turn_orchestrator.py`
- `packages/protocol/events.py`

This task is still **not** event-bus integration or runtime adapter wiring.

---

## Scope Clarification
This card is intentionally limited to the events the orchestrator spec already says the orchestrator paths should emit:

- `assistant.quick_reaction.ready`
- `assistant.response.chunk`
- `assistant.response.completed`
- `renderer.command.issued`
- `tts.chunk.queued`
- `system.interrupt.signal`

This card includes only:

- an orchestrator-owned protocol event outbox queue
- typed event construction helpers
- a bounded protocol-event dispatch helper / boundary
- emission from existing orchestrator subpaths

This card does **not** authorize:

- event bus integration
- state-machine advancement
- playback-device integration
- STT / TTS / renderer adapter implementation
- redesign of protocol event schemas
- adding the recommended but not yet protocol-defined events such as `assistant.quick_reaction.suppressed` or `assistant.primary.buffered`

The target is a clean internal outbox so that the orchestrator can already speak in typed protocol events before any real bus or runtime adapter exists.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`
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
You must implement the following bounded additions.

### 1. Protocol-event outbox shell
Add an orchestrator-owned protocol event outbox path inside `TurnOrchestrator`.

At minimum this must include:

- an internal `asyncio.Queue` for typed protocol events during `handle_user_turn()`
- active-turn references needed to emit events with correct session/trace/turn metadata
- safe cleanup/restoration when the turn exits

You may choose a concise internal name such as:

- `protocol_event_queue`

### 2. Typed event boundary helper
Add a bounded helper for protocol-event emission.

At minimum implement:

- one helper that builds/enqueues typed protocol events
- one boundary method that can forward a typed protocol event outward and may remain a no-op placeholder

You may choose concise names such as:

- `_emit_protocol_event()`
- `_send_protocol_event()`
- `_dispatch_protocol_events()`

If you add a protocol-event dispatch task, keep it bounded and analogous to the existing renderer/TTS dispatch helpers.

### 3. Event emission from current orchestrator paths
Update existing orchestrator subpaths so they emit the following typed protocol events:

- `_run_local_drafter()`:
  - emit `QuickReactionReadyEvent` when a `QuickReaction` exists
- `_consume_primary_chunks()`:
  - emit `AssistantResponseChunkEvent` for each clean primary text chunk
  - emit `RendererCommandIssuedEvent` for renderer commands produced by parsing
  - emit `TTSChunkQueuedEvent` whenever a TTS chunk is actually queued
- `_run_primary_reasoning()`:
  - emit `AssistantResponseCompletedEvent` when the primary stream completes normally inside this bounded shell
- `_apply_interrupt_signal()`:
  - emit `InterruptSignalEvent` at the start of bounded interrupt application

Do **not** invent additional event types in this task.

### 4. Typed payload construction
When constructing the above events:

- use the exact typed payload models already defined in `packages/protocol/events.py`
- use the current active turn context for:
  - `trace_id`
  - `session_id`
- keep source/source_type consistent inside this bounded shell
- do not use ad-hoc dict payloads

### 5. Minimum test coverage
Extend `tests/orchestrator/test_turn_orchestrator.py` to cover at least:

- quick-reaction path emits one `assistant.quick_reaction.ready` when a quick reaction exists
- primary clean text emits `assistant.response.chunk`
- parser-generated renderer command emits `renderer.command.issued`
- actually queued TTS chunk emits `tts.chunk.queued`
- primary completion emits `assistant.response.completed`
- interrupt application emits `system.interrupt.signal`
- emitted outbox events are typed protocol event objects, not dicts
- emitted events carry the current turn’s `session_id` and `trace_id`

You may use a recording test subclass to capture emitted protocol events deterministically.

---

## Behavioral Requirements
The implementation must satisfy all of the following:

1. The orchestrator must emit typed protocol events for work it is already performing.
2. Event emission must stay decoupled from event-bus/runtime integration.
3. Only chunks that are actually queued for TTS should emit `tts.chunk.queued`.
4. Renderer command events must reflect parser output, not ad-hoc reconstructed data.
5. Interrupt signal emission in this task is bounded shell emission only; it must not pretend that `system.interrupt.applied` already happened.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing protocol event classes and payload models instead of redefining them:
   - `QuickReactionReadyEvent`
   - `AssistantResponseChunkEvent`
   - `AssistantResponseCompletedEvent`
   - `RendererCommandIssuedEvent`
   - `TTSChunkQueuedEvent`
   - `InterruptSignalEvent`
3. Do **not** return or pass ad-hoc dict payloads.
4. Do **not** invent new protocol event types or session states.
5. Do **not** emit `system.interrupt.applied` in this task.
6. Do **not** add event-bus integration or adapter logic.
7. Do **not** modify protocol docs or schemas.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- event bus integration
- state-machine advancement
- STT/TTS/VTube adapter work
- playback-device integration
- authoritative interrupt-applied emission
- `assistant.quick_reaction.suppressed`
- `assistant.primary.buffered`
- tool-calling runtime execution

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

- `turn_orchestrator.py` has a bounded typed protocol-event outbox path
- current orchestrator subpaths emit the required existing protocol events
- emitted events are typed and carry active turn metadata
- no event-bus / STT / TTS / VTube adapter code was implemented
- tests cover the new protocol-event outbox behavior at least minimally
