# Task Card 0023

## Title
Add bounded multi-session effect batch collection to `packages/runtime/runtime_registry.py`

## Role
Implementer

## Goal
Create the next bounded runtime-side effect-routing step in `packages/runtime/runtime_registry.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest multi-session effect collection layer that:

- collects typed runtime effects from multiple already-registered sessions
- preserves per-session effect order
- avoids flattening all effects into one global stream

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement a bus, transport, persistence layer, or cross-session chronological ordering.

---

## Scope Clarification
This card is intentionally limited to conservative multi-session effect collection.

It includes only:

- one small typed batch shape for session-scoped runtime effects
- one registry peek API for non-mutating multi-session batch collection
- one registry drain API for mutating multi-session batch collection
- focused tests for session isolation and deterministic batch ordering

This card does **not** authorize:

- flattening all effects into one global event list
- forwarding to a bus, transport, or log sink
- persistence or replay
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a bounded collection layer, not a forwarding system.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_registry.py`
- `tests/runtime/test_runtime_registry.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/session_runtime.py`
- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Typed session-scoped effect batch
Add one small typed runtime-local batch shape in `packages/runtime/runtime_registry.py`.

Use a clear name such as:

- `SessionEffectBatch`

At minimum it must contain:

- `session_id`
- ordered typed runtime effects for that session

For this task, the contained effect type may be limited to the currently emitted runtime effect family:

- `SessionStateChangedEvent`

If you introduce a new typed model, use **Pydantic v2** style with:

- `extra="forbid"`
- `frozen=True`

### 2. Multi-session peek API
Add one registry method that non-mutatingly collects effect batches from all currently registered sessions that have non-empty outboxes.

Use a clear name such as:

- `peek_effect_batches()`

Requirements:

- return only sessions with non-empty outboxes
- preserve event order within each session batch
- not clear any session outbox
- use a deterministic batch ordering

For deterministic batch ordering in this task:

- order batches by `session_id.hex` ascending

This ordering is only a stable registry enumeration rule.
It must **not** be documented or treated as a cross-session temporal order.

### 3. Multi-session drain API
Add one registry method that mutatingly collects effect batches from all currently registered sessions that have non-empty outboxes.

Use a clear name such as:

- `drain_effect_batches()`

Requirements:

- return only sessions with non-empty outboxes
- preserve event order within each session batch
- clear only the outboxes for returned sessions
- leave empty-session outboxes untouched
- use the same deterministic batch ordering as `peek_effect_batches()`

### 4. Reuse existing session-local outbox behavior
The new multi-session APIs must build on existing registry/session-runtime behavior rather than reimplementing outbox logic.

At minimum:

- reuse registry session lookup
- reuse existing session-scoped peek/drain behavior or equivalent direct delegation to `SessionRuntime`
- do **not** duplicate effect ordering rules in a second place unnecessarily

### 5. Preserve existing APIs
This task must remain additive.

Requirements:

- keep `register_session()` behavior unchanged
- keep `get_session()` behavior unchanged
- keep `ingest_event()` behavior unchanged
- keep per-session `peek_session_outbox()` / `drain_session_outbox()` behavior unchanged

### 6. No global flattening
Do **not** add any API that returns one flat list of effects spanning multiple sessions in this task.

Examples explicitly out of scope:

- `drain_all_effects() -> list[SessionStateChangedEvent]`
- any API that implies a single authoritative cross-session event order

### 7. Minimum test coverage
Update `tests/runtime/test_runtime_registry.py` with minimum coverage for:

- `peek_effect_batches()` returns typed batches only for sessions with non-empty outboxes
- `peek_effect_batches()` does not clear any outbox
- `drain_effect_batches()` returns typed batches only for sessions with non-empty outboxes
- `drain_effect_batches()` clears only the returned sessions' outboxes
- per-session event order is preserved inside each batch
- batch ordering is deterministic by `session_id.hex`
- repeated drain after clearing returns no batches
- existing registration, routing, and session-scoped peek/drain tests still pass unchanged in meaning

Keep the tests bounded to registry behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `RuntimeRegistry`
   - `SessionRuntime`
   - `SessionStateChangedEvent`
3. Multi-session collection must remain batch-based and session-scoped in this task.
4. `peek_effect_batches()` must not mutate state.
5. `drain_effect_batches()` must clear only returned session outboxes.
6. Batch ordering must be deterministic by `session_id.hex`, but must not imply cross-session temporal meaning.
7. Do **not** introduce event bus integration, persistence, adapter logic, or orchestrator logic.
8. Do **not** return or pass ad-hoc dict payloads.
9. Do **not** invent new event types or forwarding semantics.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- flattened cross-session effect streams
- forwarding to a bus, log sink, or transport
- session persistence or replay
- auto-create session behavior
- orchestrator changes
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_runtime_registry.py`
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_state_driver.py`
   - `tests/runtime/test_transition_context_tracker.py`
3. If test execution is blocked by environment limits:
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

- `RuntimeRegistry` exposes bounded multi-session batch collection APIs
- collection returns session-scoped typed batches rather than one flat global effect list
- empty-session outboxes are omitted from returned batches
- per-session effect order remains preserved
- deterministic batch ordering is applied by `session_id.hex`
- existing registration/routing/session-scoped outbox APIs remain intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded multi-session effect batch behavior at least minimally
