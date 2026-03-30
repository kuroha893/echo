~~~md
# Echo Protocol Specification: Reasoning Tool Loop

> Status: Draft v0.1  
> Scope: Bounded reasoning-action loop, tool call lifecycle, and tool-result reintegration for Echo  
> Authority: This document is constrained by **Echo AI Engineering Constitution** and must remain consistent with:
>
> - `docs/protocol/events.md`
> - `docs/protocol/state-machine.md`
> - `docs/protocol/orchestrator-spec.md`
>
> This document is the source of truth for future tool-aware protocol objects and for the tool-calling boundary inside `PrimaryReasoningTask`.

---

## 1. Purpose

This document defines the **canonical reasoning-action tool loop** for Echo.

Its goals are:

- define how `PrimaryReasoningTask` performs bounded tool-aware reasoning
- define the minimal shared contracts for tool requests and tool outcomes
- define how tool execution interacts with:
  - session state
  - interrupts
  - replay / traceability
  - future plugin and memory integration
- prevent hidden coupling between the reasoner and concrete tool execution

This document covers:

- step-bounded reasoning loop semantics
- tool decision vs tool execution boundary
- minimal tool lifecycle event surface
- tool result reintegration rules
- cancellation and late-result handling
- v0.1 restrictions for safe initial implementation

This document does **not** define:

- plugin registration manifests
- concrete tool catalog or YAML format
- provider-specific tool API wiring
- memory storage internals
- renderer behavior
- background task protocol

Those belong in later specs.

---

## 2. Position in the architecture

### 2.1 This is not a separate top-level runtime subsystem

The reasoning tool loop is a **sub-protocol of `PrimaryReasoningTask`**.

It is not a declaration that Echo must have a standalone package named `tool-calling`.

Its role is narrower:

- the reasoner decides whether a tool is needed
- the runtime executes the tool through a constrained boundary
- the reasoner receives the observation and continues the turn

---

### 2.2 Relationship to existing loops

- `LocalDrafterTask` is unaffected and remains tool-free in v0.1
- `PrimaryReasoningTask` may use this loop while the session is still in `thinking`
- `ExpressionParser` still applies only to assistant text that is actually committed downstream
- `AudioMutex` remains the only authority for audible playback ownership

---

### 2.3 No new session status is introduced

Tool-aware reasoning does **not** create a new session status.

While the system is:

- deciding whether to call a tool
- waiting for a tool result
- reintegrating a tool observation

the session remains in:

- `thinking`

Only actual playback start may move the session into `speaking`, exactly as already defined by `state-machine.md`.

---

## 3. Mandatory design decisions

### 3.1 Bounded step loop

Tool-aware reasoning must be modeled as a bounded sequence of steps:

- step `0`
- step `1`
- ...
- step `N - 1`

Each step belongs to a single accepted turn and must have a stable `step_index`.

The loop must never run unboundedly.

An implementation must enforce a configured `max_reasoning_steps`.

---

### 3.2 Tool decision and tool execution are separate

The reasoner may decide:

- no tool is needed
- one tool call is needed
- the turn can terminate

But the reasoner must **not** directly invoke the concrete tool implementation.

Instead it must emit a structured tool request and wait for a structured outcome to return through a constrained execution boundary.

This is mandatory for:

- replay
- audit
- testing
- mocking
- permission enforcement
- interrupt safety

---

### 3.3 v0.1 is sequential, not parallel

To keep the first implementation bounded and deterministic:

- at most one tool call may be active at a time for a turn
- at most one tool call may be issued in a single reasoning step
- multiple tool calls across a turn are allowed only **serially**

Parallel tool execution is out of scope for v0.1.

---

### 3.4 v0.1 tool calling is pre-speech for the primary response

For v0.1, the primary response must not begin audible playback until all required tool steps for that response have settled.

Therefore:

- a primary response may think and call tools while quick reaction playback is happening
- but once primary audible playback starts, no new tool call may be introduced for that same primary response turn

This restriction is intentional.

Reason:

- it preserves compatibility with the current orchestrator and state-machine model
- it avoids mid-speech tool-induced rollback semantics
- it keeps interruption and chunk ownership manageable in the first protocol version

Future RFCs may relax this.

---

### 3.5 Tool results are observations, not direct speech

Raw tool output must never be routed directly into:

- TTS
- renderer
- committed assistant response chunks

The runtime must first convert a tool outcome into a **tool observation** that the reasoner can consume.

This protects the loop from:

- oversized raw output leaking into speech
- malformed payloads becoming user-visible
- hidden prompt pollution

---

### 3.6 Ordinary tool failure is not automatically session error

A tool may fail for ordinary reasons such as:

- validation failure
- timeout
- permission denial
- tool-specific runtime failure

These do **not** automatically mean the session must enter `error`.

Default rule:

- ordinary tool failure becomes a structured observation for the reasoner
- session `error` is reserved for session-blocking or protocol-breaking failures

This keeps tool unreliability from poisoning the whole session by default.

---

### 3.7 Interrupts and reset are authoritative

If an interrupt or reset invalidates the active turn while a tool call is in flight:

- the active wait must be cancelled or detached
- the turn must stop waiting for that tool result
- late tool results must not mutate the superseded turn state

Late results may be:

- logged
- persisted for audit
- ignored for active turn progression

But they must not be treated as valid observations for the cancelled turn.

---

## 4. Canonical step model

### 4.1 Step outcomes

Each reasoning step must resolve to exactly one of the following outcomes:

1. `tool_call`
2. `final_response`
3. `abort`

For v0.1, this document deliberately excludes richer mixed outcomes such as:

- partial natural-language answer plus tool call in the same step
- multiple parallel tool calls in one step
- background task submission

---

### 4.2 `tool_call`

The reasoner requests exactly one tool call for the current step.

The runtime must:

1. validate and publish the request
2. wait for the outcome
3. convert the outcome into an observation
4. append the observation to the reasoning context
5. continue with the next step

The session remains `thinking` during this process.

---

### 4.3 `final_response`

The reasoner decides it has enough information to produce the user-facing answer.

At that point the system may:

- begin streaming assistant text
- run the text through `ExpressionParser`
- emit `assistant.response.chunk`
- eventually emit `assistant.response.completed`

If playback actually starts, the state machine still enters `speaking` only on `tts.playback.started`.

---

### 4.4 `abort`

The reasoning loop stops without a committed final answer for the current active step chain.

Typical causes:

- interrupt superseded the turn
- reset cleared the session
- max step budget was exhausted
- a session-blocking error occurred

The exact user-facing fallback text is implementation-defined and belongs to runtime/orchestrator policy, not this document.

---

## 5. Canonical contracts

This section defines the minimum shared semantics for future protocol objects.

The exact Python module may be introduced later, but the field meanings below are locked by this document.

---

### 5.1 `ToolCallRequest`

Represents one requested tool execution.

Required fields:

- `call_id: UUID`
- `trace_id: UUID`
- `session_id: UUID`
- `turn_id: UUID`
- `step_index: int`
- `tool_name: str`
- `arguments: dict[str, Any]`
- `requested_at: datetime`

Optional fields:

- `timeout_ms: int | None`
- `idempotency_key: str | None`
- `requested_by: str | None`

Rules:

- `arguments` is the only intentionally open structured field in this contract family
- the open shape exists because tool-specific schemas are an open set
- concrete validation of `arguments` must occur against the selected tool schema before execution
- the wrapper contract itself must still be strongly typed and immutable

---

### 5.2 `ToolCallResult`

Represents a successful tool outcome before or during observation reintegration.

Required fields:

- `call_id: UUID`
- `trace_id: UUID`
- `session_id: UUID`
- `turn_id: UUID`
- `step_index: int`
- `tool_name: str`
- `completed_at: datetime`
- `ok: Literal[True]`

Optional fields:

- `summary_text: str | None`
- `structured_data: dict[str, Any] | None`
- `artifact_refs: list[str]`
- `latency_ms: int | None`

Rules:

- `summary_text` is the preferred text form for reintegration into the reasoner
- `structured_data` may preserve machine-readable output
- large raw artifacts should be referenced, not blindly embedded

---

### 5.3 `ToolCallFailure`

Represents a failed tool outcome.

Required fields:

- `call_id: UUID`
- `trace_id: UUID`
- `session_id: UUID`
- `turn_id: UUID`
- `step_index: int`
- `tool_name: str`
- `failed_at: datetime`
- `error_code: ToolErrorCode`
- `error_message: str`
- `retryable: bool`

Canonical `ToolErrorCode` values for v0.1:

- `validation_error`
- `tool_not_found`
- `permission_denied`
- `timeout`
- `runtime_error`
- `interrupted`

These values may be extended only by later protocol revision.

---

### 5.4 `ToolObservation`

Represents the normalized observation that is appended back into reasoning context.

Required fields:

- `call_id: UUID`
- `tool_name: str`
- `step_index: int`
- `observation_text: str`
- `ok: bool`

Optional fields:

- `structured_data: dict[str, Any] | None`
- `error_code: ToolErrorCode | None`
- `artifact_refs: list[str]`

Rules:

- the reasoner consumes `ToolObservation`, not arbitrary executor internals
- observation text should be concise and stable
- raw results may be persisted elsewhere for audit or later retrieval

---

## 6. Tool lifecycle event surface

The current `events.md` does not yet define tool lifecycle events.

This document introduces the following **required additional event types** for the next relevant protocol patch:

- `tool.call.requested`
- `tool.call.started`
- `tool.call.completed`
- `tool.call.failed`
- `tool.call.cancelled`

These are reasoning-loop-critical for replayable tool-aware execution.

---

### 6.1 `tool.call.requested`

Meaning:

- a tool request was accepted by the reasoning loop and emitted to the execution boundary

Payload semantic base:

- `ToolCallRequest`

Typical source:

- `system.primary_reasoner`
- or `system.orchestrator`

---

### 6.2 `tool.call.started`

Meaning:

- the execution boundary actually started attempting the tool

This event is useful for:

- timeout accounting
- audit visibility
- replay

---

### 6.3 `tool.call.completed`

Meaning:

- the tool produced a successful outcome that can be converted into a `ToolObservation`

Payload semantic base:

- `ToolCallResult`

---

### 6.4 `tool.call.failed`

Meaning:

- the tool attempt completed unsuccessfully and produced a structured failure outcome

Payload semantic base:

- `ToolCallFailure`

This event does not automatically imply `system.error.raised`.

---

### 6.5 `tool.call.cancelled`

Meaning:

- the active turn stopped waiting for the tool because interruption, reset, or task cancellation invalidated the call

This event exists so that replay/debugging can distinguish:

- ordinary failure
- active cancellation
- successful completion

---

## 7. Canonical lifecycle

For one accepted user turn, the canonical v0.1 flow is:

1. `user.speech.end` finalizes the turn input
2. orchestrator starts `LocalDrafterTask` and `PrimaryReasoningTask`
3. session remains in `thinking`
4. the reasoner evaluates step `0`
5. if a tool is needed:
   - emit `tool.call.requested`
   - execute through the constrained tool boundary
   - emit `tool.call.started`
   - then emit exactly one of:
     - `tool.call.completed`
     - `tool.call.failed`
     - `tool.call.cancelled`
   - build `ToolObservation`
   - continue to the next reasoning step
6. if no further tool is needed:
   - produce final assistant text
   - pass text through `ExpressionParser`
   - emit `assistant.response.chunk`
   - queue `TTSChunk`
7. when playback actually starts, emit `tts.playback.started`
8. when the response stream is fully done, emit `assistant.response.completed`

This flow keeps tool calling inside the existing turn model rather than inventing a parallel conversation system.

---

## 8. Interaction with existing protocol

### 8.1 Interaction with `state-machine.md`

This document does **not** change the canonical session state set.

Important consequences:

- tool decision and tool execution both happen while the session is `thinking`
- `tool.call.*` events do not by themselves create a state transition
- `speaking` still begins only on `tts.playback.started`
- ordinary tool failure does not automatically force `error`

---

### 8.2 Interaction with `orchestrator-spec.md`

The orchestrator remains the authority for:

- turn ownership
- interrupt application
- audio mutual exclusion
- queue clearing

The tool loop adds one new responsibility boundary:

- orchestrator / runtime must ensure late tool results cannot reattach to a superseded turn

For v0.1, `orchestrator-spec.md` should later be refined to reference this document when describing `PrimaryReasoningTask`.

---

### 8.3 Interaction with `events.md`

`events.md` currently covers the MVP event core but not tool lifecycle families.

Therefore a later protocol patch must extend `events.md` and `events.py` with:

- tool lifecycle payload models
- tool lifecycle event models
- corresponding discriminated union additions

This document defines the semantics first; implementation comes later.

---

### 8.4 Interaction with future plugin and memory docs

This document intentionally does not define how tools are registered.

Future documents must build on it:

- `docs/plugins/plugin-spec.md`
  - how plugins expose tools
  - scope / permission boundaries
- `docs/memory/design.md`
  - whether memory read/write capabilities are exposed as tools

Those documents must not redefine the core request/result/cancellation semantics established here.

---

## 9. v0.1 restrictions

The following are explicitly out of scope for v0.1:

- parallel tool execution
- multiple tool calls in one reasoning step
- background tools with task polling
- mid-speech primary-response tool calls
- tool-specific UI protocols
- direct model exposure to privileged tools before permission spec exists

These may be added only by later document revision.

---

## 10. Validation expectations for future implementation tasks

Any later implementation task based on this document must include tests for at least:

- sequential multi-step tool reasoning within one turn
- tool timeout producing structured failure rather than silent hang
- interrupt cancelling the active tool wait
- late tool result being ignored for superseded turn progression
- tool failure remaining inside `thinking` unless escalated to session-blocking error
- primary audible playback beginning only after tool loop settlement in v0.1

---

## 11. Acceptance-oriented summary

This document is satisfied only if future implementation preserves all of the following:

- tool-aware reasoning is bounded by step count
- reasoner and executor are decoupled
- tool lifecycle is replayable through protocol events
- ordinary tool failure does not automatically become session error
- interrupted turns do not accept late tool results as valid observations
- no new session status is invented for tool waiting
- v0.1 keeps primary tool calling pre-speech and sequential
~~~
