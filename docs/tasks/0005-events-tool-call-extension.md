# Task Card 0005

## Title
Extend `packages/protocol/events.py` with the `tool.call.*` event family

## Role
Implementer

## Goal
Update `packages/protocol/events.py` to implement the tool lifecycle protocol objects and event classes newly defined in:

- `docs/protocol/events.md`
- `docs/protocol/reasoning-tool-loop.md`

This task adds the **tool.call event family only** to the protocol layer.

It must not implement runtime tool execution, orchestrator waiting logic, plugin registration, or memory tooling.

Use **Python 3.10+ + Pydantic v2**.

---

## Scope Clarification

This card is intentionally narrow.

It authorizes only:

- protocol enum additions
- protocol payload/data model additions
- concrete tool lifecycle event classes
- discriminated union updates
- focused protocol tests

It does **not** authorize:

- runtime tool loop implementation
- `PrimaryReasoningTask`
- `ToolCallDispatcher`
- plugin tool registration
- memory-as-tool integration
- state machine redesign

---

## Allowed Context
You may read only:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/reasoning-tool-loop.md`
- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

Do **not** read `docs/protocol/orchestrator-spec.md` or `docs/protocol/state-machine.md` for this task unless you are blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may modify only:

- `packages/protocol/events.py`
- `tests/protocol/test_events.py`

Do **not** create or modify any other file.

In particular:

- do not modify docs
- do not modify `packages/protocol/state_machine.py`
- do not modify `packages/protocol/feedback_rules.py`
- do not create runtime/orchestrator/plugin files
- do not create `__init__.py`

---

## Required Scope
You must implement the following additions from `docs/protocol/events.md`.

### 1. New enum
- `ToolErrorCode`

It must include exactly:

- `validation_error`
- `tool_not_found`
- `permission_denied`
- `timeout`
- `runtime_error`
- `interrupted`

### 2. New protocol models
- `ToolCallRequest`
- `ToolCallStarted`
- `ToolCallResult`
- `ToolCallFailure`
- `ToolCallCancelled`
- `ToolObservation`

### 3. New concrete events
- `ToolCallRequestedEvent`
- `ToolCallStartedEvent`
- `ToolCallCompletedEvent`
- `ToolCallFailedEvent`
- `ToolCallCancelledEvent`

### 4. Event union update
- extend `ProtocolEvent` so it can parse all `tool.call.*` event types by `event_type`

### 5. Focused tests
Extend `tests/protocol/test_events.py` with minimum coverage for:

- UTC-aware validation on the new datetime fields
- `ToolCallResult.ok` being fixed to `True`
- `ToolCallFailure.error_code` using the locked enum
- `ProtocolEvent` discriminator parsing for at least one successful tool event and one failed tool event
- `ToolCallRequest.arguments` remaining open-shaped inside the typed wrapper while undeclared wrapper fields are still forbidden

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Strictly use **Pydantic v2**
2. All newly added datetime fields must be **timezone-aware** and normalized to **UTC**
3. All protocol models must keep:
   - `extra="forbid"`
   - `frozen=True`
4. Do **not** change existing enum values or existing event type strings
5. The new `tool.call.*` event type strings must match the spec exactly:
   - `tool.call.requested`
   - `tool.call.started`
   - `tool.call.completed`
   - `tool.call.failed`
   - `tool.call.cancelled`
6. `ToolCallResult.ok` must be locked to `True`
7. `ToolCallFailure.error_code` must use `ToolErrorCode`
8. `arguments` and `structured_data` may remain `dict[str, Any]` only inside their typed wrapper models
9. Do **not** weaken typed wrapper models into raw event payload dicts
10. Do **not** add new session statuses or modify state-machine semantics
11. Do **not** invent additional tool lifecycle events beyond this task card
12. Keep the change protocol-only; no business/runtime behavior beyond validation

---

## Explicitly Out Of Scope
The following are explicitly out of scope:

- `ToolLoopRunner`
- tool execution middleware
- permission enforcement runtime logic
- timeout/retry runtime policy
- background tool protocol
- plugin manifests
- memory tool implementations
- late-result suppression logic in runtime
- changes to `orchestrator-spec.md`
- changes to `state-machine.md`

---

## Do Not
Do not:

- modify any document
- implement runtime or orchestrator code
- introduce new dependencies
- install dependencies
- rename documented fields
- replace typed protocol objects with dataclasses or plain dicts
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
2. If `pydantic v2` is available locally, run `tests/protocol/test_events.py`
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

- `packages/protocol/events.py` implements the new tool lifecycle protocol models
- `packages/protocol/events.py` implements the `tool.call.*` concrete event classes
- `ProtocolEvent` can parse the new tool events by discriminator
- enum values and event type strings exactly match the docs
- no runtime/orchestrator behavior was implemented
- tests cover the new protocol surface at least minimally
