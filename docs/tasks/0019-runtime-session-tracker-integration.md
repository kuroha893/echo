# Task Card 0019

## Title
Integrate `TransitionContextTracker` into `packages/runtime/session_runtime.py`

## Role
Implementer

## Goal
Create the next bounded runtime-core step in `packages/runtime/session_runtime.py` based on:

- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/transition-context-tracker.md`
- `docs/runtime/roadmap.md`

This task implements only the minimal SessionRuntime-side ownership of the already completed
`TransitionContextTracker`.

The target is:

- `SessionRuntime` owns one session-local tracker
- `SessionRuntime` can observe typed protocol events into that tracker
- `SessionRuntime` can build a typed `TransitionContext` snapshot from its current `SessionState`

This task intentionally does **not** yet create the full runtime ingress shell that removes
explicit caller-supplied context from state application.

Use **Python 3.10+** and existing local runtime/protocol modules.

---

## Scope Clarification
This card completes the remaining bounded part of runtime roadmap Phase 1:

- `transition_context_tracker.py` already exists
- `SessionRuntime` does not yet own or expose it

This card includes only:

- tracker ownership inside `SessionRuntime`
- one bounded tracker-observation method
- one bounded context-build helper
- tests proving tracker state stays session-owned and does not mutate runtime state/outbox by itself

This card does **not** authorize:

- a new runtime ingress/router shell
- automatic context derivation inside `ingest_event()`
- event bus integration
- session persistence
- orchestrator changes
- STT / TTS / renderer / VTube adapter work
- tool-loop runtime execution

The target is a narrow ownership/integration step, not a full runtime API redesign.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/runtime/architecture.md`
- `docs/runtime/session-runtime.md`
- `docs/runtime/transition-context-tracker.md`
- `docs/runtime/roadmap.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`
- `packages/runtime/state_driver.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/transition_context_tracker.py`

If they already exist, you may also read:

- `tests/runtime/test_state_driver.py`
- `tests/runtime/test_session_runtime.py`
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
- do not modify protocol files
- do not modify orchestrator files
- do not modify docs
- do not create `__init__.py`

---

## Required Scope
You must implement the following bounded additions.

### 1. Tracker ownership inside SessionRuntime
`SessionRuntime` must own exactly one `TransitionContextTracker` bound to its authoritative
`session_id`.

At minimum:

- construct the tracker from the initial state's `session_id`
- keep it private to the runtime shell
- do not allow cross-session contamination

### 2. Bounded tracker observation API
Add one small typed method to `SessionRuntime` that lets callers feed a typed `ProtocolEvent`
into the owned tracker without applying a state transition.

Use a clear name such as:

- `observe_event()`

Behavior requirements:

- validate event `session_id` against the runtime's owned session
- delegate to `TransitionContextTracker.apply_event()`
- do **not** mutate current `SessionState`
- do **not** enqueue anything into runtime outbox
- do **not** call `apply_event()` from `state_driver.py`

### 3. Bounded context snapshot API
Add one small typed helper that builds a `TransitionContext` from:

- the owned current `SessionState`
- the owned tracker

Use a clear name such as:

- `build_context()`

Behavior requirements:

- delegate to `TransitionContextTracker.build_context(self._current_state)`
- return a typed `TransitionContext`
- use owned state status/trace as authoritative inputs

### 4. Preserve existing explicit-ingest behavior
In this task, `SessionRuntime.ingest_event()` must remain the current explicit-context path.

Requirements:

- keep `ingest_event(event, context)` behavior intact
- do **not** remove the explicit `context` argument in this task
- do **not** make `ingest_event()` auto-derive context in this task
- do **not** silently turn SessionRuntime into the runtime ingress shell yet

This phase is only about tracker ownership, not the final ingestion contract.

### 5. Minimum test coverage
Update `tests/runtime/test_session_runtime.py` with minimum coverage for:

- `SessionRuntime` owns a tracker and `build_context()` returns a typed `TransitionContext`
- `build_context()` uses current `SessionState.status` and `current_trace_id`
- `observe_event(user.speech.start)` updates derived context flags
- `observe_event()` rejects cross-session events clearly
- `observe_event()` does not mutate current `SessionState`
- `observe_event()` does not enqueue outbox events
- existing `ingest_event()` behavior still works with explicit context
- tracker-derived context and explicit ingest can coexist across calls without hidden state mutation

You may keep the existing 0017 tests and add focused new ones.

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing throughout.
2. Reuse existing runtime/protocol types instead of redefining them:
   - `SessionRuntime`
   - `TransitionContextTracker`
   - `ProtocolEvent`
   - `TransitionContext`
   - `SessionState`
   - `ApplyEventResult`
3. `SessionRuntime` must remain session-owned and reject cross-session events clearly.
4. `observe_event()` must be tracker-only; it must not change runtime state or outbox.
5. `build_context()` must be derived from the owned `SessionState` plus owned tracker facts only.
6. `ingest_event()` must continue delegating transition logic to `apply_event()`, not reimplement rules.
7. Do **not** auto-derive or auto-apply `TransitionContext` inside `ingest_event()` in this task.
8. Do **not** introduce event bus integration, persistence, adapter logic, or orchestrator logic.
9. Do **not** return or pass ad-hoc dict payloads.
10. Do **not** invent new session states, event types, or transition rules.

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- replacing `ingest_event(event, context)` with a context-free API
- a runtime ingress/router shell
- multi-session runtime registry
- event bus integration
- session persistence
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

- `SessionRuntime` owns a session-local `TransitionContextTracker`
- `SessionRuntime` exposes a bounded tracker-observation method
- `SessionRuntime` exposes a bounded typed context-build helper
- `observe_event()` does not mutate current state or outbox
- `ingest_event(event, context)` remains explicit-context based in this task
- no orchestrator / STT / TTS / VTube / adapter code was implemented
- tests cover the bounded tracker-integration behavior at least minimally
