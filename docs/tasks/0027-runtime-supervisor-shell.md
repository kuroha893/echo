# Task Card 0027

## Title
Implement the first in-process runtime supervisor shell in `packages/runtime/runtime_supervisor.py`

## Role
Implementer

## Goal
Create the first bounded in-process outer shell above the current runtime primitives based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/event-routing.md`
- `docs/runtime/effect-forwarding.md`
- `docs/runtime/reset-recovery.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/roadmap.md`

This task implements one coherent runtime-facing entrypoint that:

- explicitly registers sessions
- processes one typed `ProtocolEvent` through registry routing and state application
- forwards any resulting runtime effect batches
- exposes the post-event recovery view for the touched session

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement persistence, event-bus forwarding, adapter bridges, async worker loops, or orchestrator integration.

---

## Scope Clarification
This card is intentionally larger than recent micro-steps.

It exists to assemble several already-completed runtime primitives into one coherent in-process shell:

- `RuntimeRegistry`
- `RuntimeEffectForwarder`
- session-local recovery inspection

This card includes only:

- one new runtime file containing the supervisor shell and its local result model
- one new dedicated test file
- explicit composition of existing runtime pieces into one authoritative process entrypoint

This card does **not** authorize:

- protocol changes
- `SessionState` schema changes
- automatic recovery or reset policy
- persistence or replay
- event-bus transport logic
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a bounded runtime outer shell, not a full runtime platform.

---

## Implementation Size Expectation
This task is explicitly authorized and expected to be a **larger** implementation than the recent micro-cards.

Requirements:

- it is allowed and desired to write **several hundred lines of non-test code**
- a rough target of **200-400 lines of non-test Python** in `packages/runtime/runtime_supervisor.py` is acceptable
- do **not** artificially minimize the implementation into a thin placeholder if the behavior is already defined by the local docs and existing runtime code
- do **not** split obviously coupled supervisor behaviors into extra mini-tasks inside this card

The purpose of this section is to prevent under-sizing, not to encourage gratuitous complexity.

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
- `docs/runtime/reset-recovery.md`
- `docs/runtime/recovery-inspection.md`
- `docs/runtime/supervisor-shell.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/runtime_registry.py`
- `packages/runtime/effect_forwarder.py`
- `packages/runtime/recovery_snapshot.py`
- `packages/runtime/state_driver.py`

If they already exist, you may also read:

- `tests/runtime/test_runtime_supervisor.py`
- `tests/runtime/test_runtime_registry.py`
- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`
- `tests/runtime/test_effect_forwarder.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/runtime_supervisor.py`
- `tests/runtime/test_runtime_supervisor.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/session_runtime.py`
- do not modify `packages/runtime/runtime_registry.py`
- do not modify `packages/runtime/effect_forwarder.py`
- do not modify `packages/runtime/recovery_snapshot.py`
- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. New runtime supervisor file
Create:

- `packages/runtime/runtime_supervisor.py`

This file must contain:

- one shell class such as `RuntimeSupervisor`
- one typed local result model such as `RuntimeProcessResult`

Both types are runtime-local.
They are not protocol events and not persistence schemas.

### 2. Typed process result model
Add one typed result model that represents the post-processing view of one processed event.

Use a clear name such as:

- `RuntimeProcessResult`

It must contain at least:

- the `ApplyEventResult`
- the forwarded `SessionEffectBatch` tuple
- the resulting `SessionRecoverySnapshot`

If you add a local base model, use **Pydantic v2** style with:

- `extra="forbid"`
- `frozen=True`

### 3. Supervisor ownership
`RuntimeSupervisor` must own:

- one `RuntimeRegistry`
- one `RuntimeEffectForwarder`

Requirements:

- allow dependency injection for tests and bounded future extension
- provide sensible defaults when dependencies are not supplied explicitly

### 4. Explicit session registration
Add a bounded session registration method such as:

- `register_session(initial_state: SessionState)`

Requirements:

- delegate to `RuntimeRegistry.register_session()`
- preserve duplicate-registration failure behavior
- do not auto-create sessions from a bare `session_id`

### 5. Optional session lookup and recovery inspection delegation
Add bounded delegation helpers such as:

- `get_session(session_id)`
- `get_recovery_snapshot(session_id)`
- `peek_recovery_snapshots()`

Requirements:

- delegate to the owned `RuntimeRegistry`
- remain read-only where appropriate
- do not re-derive runtime state inside the supervisor

### 6. Main one-shot event processing entrypoint
Add one main processing method such as:

- `process_event(event: ProtocolEvent) -> RuntimeProcessResult`

This method must process one event in this order:

1. route and apply the event through `RuntimeRegistry`
2. forward pending runtime effect batches through `RuntimeEffectForwarder`
3. inspect the touched session's recovery snapshot
4. return one typed `RuntimeProcessResult`

Requirements:

- use `event.session_id` as the touched session id
- not bypass `RuntimeRegistry.ingest_event()`
- not bypass `RuntimeEffectForwarder.forward_pending_batches()`
- not mutate runtime state outside the already-owned runtime components

### 7. Failure semantics
The supervisor shell must remain conservative.

Requirements:

- if routing/application fails, surface the original exception
- if effect forwarding fails, surface the original exception
- do not roll back session state
- do not invent retry, compensation, or transactional semantics
- rely on the existing forwarder contract for pending batch preservation

### 8. Minimum test coverage
Create or update `tests/runtime/test_runtime_supervisor.py` with minimum coverage for:

- explicit session registration delegates correctly
- duplicate registration still fails clearly
- `process_event()` calls registry ingest, then effect forwarding, then recovery inspection in order
- `process_event()` returns a typed `RuntimeProcessResult`
- the result object contains the apply result, forwarded batches, and touched-session recovery snapshot
- effect forwarding is invoked through the supervisor-owned forwarder, not bypassed
- recovery inspection is delegated, not re-derived
- routing failure surfaces and does not call effect forwarding
- forwarding failure surfaces after state application and does not invent rollback
- read-only delegation helpers behave consistently with the registry

Keep the tests bounded to supervisor-shell behavior.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `RuntimeRegistry`
   - `RuntimeEffectForwarder`
   - `SessionRecoverySnapshot`
   - `SessionEffectBatch`
   - `ApplyEventResult`
3. `process_event()` must compose the existing runtime pieces instead of duplicating their logic.
4. The supervisor shell must not auto-create sessions.
5. The supervisor shell must not become an async worker loop, message bus, or persistence service.
6. Failure semantics must remain non-transactional and explicit.
7. Do **not** return or pass ad-hoc dict payloads.
8. Do **not** invent new event types, protocol semantics, or recovery policies.
9. The implementation should be substantial enough to fully realize the bounded supervisor shell in one card; do not leave obvious documented behavior as placeholder-only TODOs.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- auto-recovery
- registry-level reset commands
- persistence/replay
- event bus forwarding
- adapter callbacks or adapter wiring
- orchestrator integration
- async background loops
- concurrency primitives
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
   - `tests/runtime/test_runtime_supervisor.py`
   - `tests/runtime/test_runtime_registry.py`
   - `tests/runtime/test_session_runtime.py`
   - `tests/runtime/test_state_driver.py`
   - `tests/runtime/test_transition_context_tracker.py`
   - `tests/runtime/test_effect_forwarder.py`
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

- `packages/runtime/runtime_supervisor.py` exists
- it provides a bounded `RuntimeSupervisor` shell and typed local result model
- explicit session registration works through the supervisor
- one-shot event processing composes registry ingest, effect forwarding, and recovery inspection in the documented order
- `RuntimeProcessResult` exposes the apply result, forwarded batches, and touched-session recovery snapshot
- failure behavior is explicit and non-transactional
- existing runtime registry/session/effect-forwarder behavior remains intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded supervisor-shell behavior at least minimally
