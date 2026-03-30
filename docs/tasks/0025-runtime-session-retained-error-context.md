# Task Card 0025

## Title
Add bounded retained error context to `packages/runtime/session_runtime.py`

## Role
Implementer

## Goal
Create the first bounded reset/recovery step in `packages/runtime/session_runtime.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/reset-recovery.md`
- `docs/runtime/roadmap.md`

This task implements only the smallest session-local recovery shell that:

- retains the latest session-blocking `SystemErrorRaisedEvent`
- exposes that retained context through a typed accessor
- clears the retained context when `SystemResetRequestedEvent` is observed

Use **Python 3.10+** and existing local runtime/protocol modules.

This task intentionally does **not** implement persistence, cross-session recovery coordination, event-bus forwarding, or adapter shutdown behavior.

---

## Scope Clarification
This card is intentionally limited to session-local retained error context.

It includes only:

- one bounded extension to `SessionRuntime`
- one typed accessor for retained error state
- bounded event-observation logic for error retention and reset clearing
- focused tests for blocking/non-blocking behavior and direct-ingest consistency

This card does **not** authorize:

- changes to `SessionState`
- changes to protocol event schemas
- changes to `RuntimeRegistry`
- changes to `RuntimeEffectForwarder`
- persistence of retained errors
- multi-error history
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a bounded session-local diagnostic/recovery shell, not a full recovery supervisor.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/README.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/reset-recovery.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/state_driver.py`
- `packages/runtime/transition_context_tracker.py`

If they already exist, you may also read:

- `tests/runtime/test_session_runtime.py`
- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_transition_context_tracker.py`

Do **not** read orchestrator / memory / plugin / STT / TTS / renderer files for this task.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/runtime/session_runtime.py`
- `tests/runtime/test_session_runtime.py`

Do **not** create or modify any other file.
In particular:

- do not modify `packages/runtime/state_driver.py`
- do not modify `packages/runtime/transition_context_tracker.py`
- do not modify `packages/runtime/runtime_registry.py`
- do not modify `packages/runtime/effect_forwarder.py`
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Session-local retained error field
Extend `SessionRuntime` with one session-local retained error slot.

The bounded retained type for this task is:

- `SystemErrorRaisedEvent | None`

This retained value represents the latest session-blocking error context for that session.

### 2. Typed accessor
Add one public typed accessor such as:

- `get_retained_error() -> SystemErrorRaisedEvent | None`

Requirements:

- return `None` when no retained blocking error exists
- return the retained typed protocol event unchanged when one exists

### 3. Retention rule for blocking errors
When `SessionRuntime` processes a `SystemErrorRaisedEvent`:

- retain it only if `payload.is_session_blocking` is `True`
- ignore it for retention purposes if `payload.is_session_blocking` is `False`

If a later session-blocking `SystemErrorRaisedEvent` arrives, it may replace the previously retained one.

### 4. Reset clearing rule
When `SessionRuntime` processes `SystemResetRequestedEvent`:

- clear the retained error context

This clearing rule is intentionally session-local and immediate in this task.

### 5. Both public event paths must respect retention
The retained error bookkeeping must not be bypassed by using the explicit ingest path.

Requirements:

- `observe_event()` must update retained error context correctly
- `ingest_observed_event()` must continue to work correctly
- `ingest_event(event, context)` must also update retained error context correctly when called directly

Do **not** require callers to use only one of those paths.

### 6. Preserve existing runtime contracts
This task must remain additive.

Requirements:

- keep current session ownership validation semantics
- keep current outbox type restriction semantics
- keep current tracker ownership semantics
- keep current `ingest_event(event, context)` explicit-context contract
- keep `session.state.changed` as the only runtime outbox effect family

### 7. No outbox/persistence side effects
Retained error context is runtime-local diagnostic state only.

Requirements:

- do not emit any new protocol event because of retention/clearing
- do not clear or rewrite existing outbox contents
- do not persist retained error state

### 8. Minimum test coverage
Update `tests/runtime/test_session_runtime.py` with minimum coverage for:

- observing a blocking `SystemErrorRaisedEvent` retains it
- observing a non-blocking `SystemErrorRaisedEvent` does not retain it
- a later blocking error replaces the earlier retained one
- observing `SystemResetRequestedEvent` clears retained error context
- `observe_event()` retention/clearing does not mutate `SessionState` or outbox
- direct `ingest_event(event, context)` also updates retained error context instead of bypassing it
- existing session-runtime tests still pass unchanged in meaning

Keep the tests bounded to `SessionRuntime`.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionRuntime`
   - `SystemErrorRaisedEvent`
   - `SystemResetRequestedEvent`
3. Retained error context for this task must be session-local and singular, not a history list.
4. Only session-blocking errors may be retained.
5. `SystemResetRequestedEvent` must clear retained error context.
6. Both `observe_event()` and direct `ingest_event(event, context)` must honor the same retained-error rules.
7. Do **not** change `SessionState` schema, runtime outbox schema, or protocol semantics.
8. Do **not** introduce persistence, bus forwarding, registry coordination, or adapter logic.
9. Do **not** return or pass ad-hoc dict payloads.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- persistence of retained errors
- multi-error history
- registry-level retained-error aggregation
- global recovery supervisor behavior
- session deletion or auto-removal
- event bus error forwarding
- orchestrator changes
- STT/TTS/VTube adapter work
- memory / plugin integration
- tool runtime

---

## Validation Expectations
Please do as much validation as the environment allows:

1. Run Python syntax validation at minimum
2. If a working Python interpreter and required dependencies are available locally, run:
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

- `SessionRuntime` exposes a bounded retained-error accessor
- only session-blocking `SystemErrorRaisedEvent` values are retained
- `SystemResetRequestedEvent` clears retained error context
- direct `ingest_event(event, context)` does not bypass retained-error bookkeeping
- runtime outbox semantics remain unchanged
- existing runtime state-driver/tracker/registry/effect-forwarder behavior remains intact
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded retained-error behavior at least minimally
