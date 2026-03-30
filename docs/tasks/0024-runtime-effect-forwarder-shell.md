# Task Card 0024

## Title
Implement bounded runtime effect forwarding in `packages/runtime/effect_forwarder.py`

## Role
Implementer

## Goal
Create the first bounded runtime-side effect-forwarding shell in `packages/runtime/effect_forwarder.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/effect-forwarding.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest forwarding layer that:

- reads pending typed runtime effect batches from `RuntimeRegistry`
- forwards one `SessionEffectBatch` at a time through a typed boundary
- drains only the session outbox that was forwarded successfully

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement a bus, transport, persistence layer, or adapter-facing delivery.

---

## Scope Clarification
This card is intentionally limited to the first local effect-forwarding shell.

It includes only:

- one small runtime helper class in a new file
- one public method that forwards currently pending batches
- one typed batch-forwarding boundary method
- focused tests for ordering, drain timing, and partial-failure behavior

This card does **not** authorize:

- changes to `RuntimeRegistry` semantics
- changes to `SessionRuntime` semantics
- global flattening of effects across sessions
- event bus integration
- persistence or replay
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a bounded forwarding shell, not a transport system.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/effect-forwarding.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/runtime_registry.py`
- `packages/runtime/session_runtime.py`

If they already exist, you may also read:

- `tests/runtime/test_effect_forwarder.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/effect_forwarder.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/runtime_registry.py`
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

### 1. Runtime effect forwarder shell
Create a new runtime helper class in `packages/runtime/effect_forwarder.py`.

Use a clear name such as:

- `RuntimeEffectForwarder`

This shell must remain local and adapter-agnostic.

### 2. Public forwarding method
Add one public method that forwards the currently pending runtime effect batches from a supplied registry.

Use a clear name such as:

- `forward_pending_batches(registry: RuntimeRegistry) -> tuple[SessionEffectBatch, ...]`

Requirements:

- use `RuntimeRegistry.peek_effect_batches()` to enumerate current pending batches
- forward batches in the same stable order provided by the registry
- return the tuple of successfully forwarded batches
- return an empty tuple if there are no pending batches

### 3. Typed forwarding boundary
Add one typed boundary method that receives exactly one session-scoped effect batch.

Use a clear name such as:

- `_forward_batch(batch: SessionEffectBatch) -> None`

Requirements:

- accept the whole typed `SessionEffectBatch`
- do **not** flatten batch effects into a global list
- keep the initial implementation as a safe no-op boundary

### 4. Success-then-drain behavior
The forwarding shell must follow the bounded contract from `docs/runtime/effect-forwarding.md`.

Requirements:

- do **not** pre-drain all session outboxes before attempting forwarding
- after one batch is forwarded successfully, drain only that batch's `session_id`
- use `RuntimeRegistry.drain_session_outbox(session_id)` for that drain step
- do not drain unrelated sessions

### 5. Partial failure behavior
If forwarding one batch raises an exception:

- stop immediately
- surface the original exception
- keep the failing batch pending in the registry
- keep any later unattempted batches pending in the registry
- allow already successful earlier batches to remain drained

Do **not** invent retry or rollback semantics in this task.

### 6. Preserve existing runtime layers
This task must remain additive.

Requirements:

- do not reimplement registry batch collection
- do not move outbox ownership out of `SessionRuntime`
- do not change current runtime outbox type restrictions
- do not change current registry ordering semantics

### 7. Minimum test coverage
Create or update `tests/runtime/test_effect_forwarder.py` with minimum coverage for:

- no pending batches returns an empty tuple and does not call the forwarding boundary
- successful forwarding calls the boundary once per batch in registry order
- successful forwarding drains only the session that was just forwarded
- effect order inside each batch remains unchanged
- forwarding never flattens multiple sessions into one global effect list
- partial failure stops forwarding, drains earlier successful sessions only, and leaves failing/later session outboxes pending

Keep the tests bounded to effect-forwarder behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `RuntimeRegistry`
   - `SessionEffectBatch`
   - `SessionStateChangedEvent`
3. `forward_pending_batches()` must enumerate batches via `peek_effect_batches()`, not `drain_effect_batches()`.
4. The forwarding shell must drain one session only after that session's batch was forwarded successfully.
5. Batch forwarding must preserve registry-provided batch order and batch-internal effect order.
6. The public API must remain batch-based and session-scoped in this task.
7. Do **not** introduce bus integration, transport logic, persistence, adapter logic, or orchestrator logic.
8. Do **not** return or pass ad-hoc dict payloads.
9. Do **not** invent new event types, retry semantics, or cross-session total-order semantics.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- draining all session outboxes before forwarding
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
   - `tests/runtime/test_effect_forwarder.py`
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

- `packages/runtime/effect_forwarder.py` exists
- it provides a bounded typed effect-forwarding shell
- forwarding consumes registry batches without flattening them
- successful forwarding drains only the successfully forwarded session outbox
- partial failure preserves the failing and later pending batches in the registry
- existing runtime registry/session behavior remains intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded effect-forwarding behavior at least minimally
