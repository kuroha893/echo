# Runtime Architecture

## Purpose

`packages/runtime` is the session-owned control layer that sits between:

- incoming typed protocol events
- canonical session state
- session-local runtime outboxes

It is not the orchestrator and it is not an adapter layer.

Its job is to ensure that the session progresses through the canonical protocol model without hidden state drift.

---

## Responsibilities

Runtime owns these concerns:

- one session shell per `session_id`
- current `SessionState`
- session-local `TransitionContext` facts
- event intake at the runtime boundary
- state application through `resolve_transition()`
- runtime-side outbox of emitted effects such as `session.state.changed`

Runtime must not absorb:

- quick-reaction vs primary scheduling
- audio ownership policy
- chunk handoff policy
- direct playback control
- renderer device APIs
- STT engine callbacks
- plugin tool execution logic

---

## Core Objects

The runtime package should converge on these core objects:

- `SessionState`
  - canonical session snapshot from `packages/protocol/events.py`
- `TransitionContext`
  - canonical guard snapshot from `packages/protocol/state_machine.py`
- `TransitionContextTracker`
  - runtime-local helper that derives `TransitionContext` from observable protocol events
- `StateDriver`
  - applies one event against one state/context pair
- `SessionRuntime`
  - session-owned shell that combines state, tracker, and runtime outbox

The current repo has already implemented:

- `state_driver.py`
- `session_runtime.py`
- `transition_context_tracker.py`
- bounded tracker ownership inside `SessionRuntime`
- bounded context-free ingest inside `SessionRuntime`
- `runtime_registry.py`
- bounded multi-session routing by `session_id`
- bounded registry-level session outbox peek/drain
- bounded multi-session effect batch collection
- `effect_forwarder.py`
- bounded runtime-side effect forwarding shell
- bounded session-local retained error context
- bounded reset-driven retained-error clearing
- `recovery_snapshot.py`
- bounded runtime recovery-inspection shell
- `runtime_snapshot.py`
- bounded tracker/session/registry/supervisor snapshot export/import foundation
- `runtime_supervisor.py`
- bounded in-process runtime supervisor shell
- `runtime_replay.py`
- bounded in-process runtime replay shell
- `runtime_persistence.py`
- bounded local persistence backend / storage adapter shell
- `runtime_service.py`
- bounded bridge-ready runtime service shell
- `runtime_bridge.py`
- bounded transport-agnostic runtime bridge-runner shell
- `orchestrator_bridge.py`
- bounded concrete in-process orchestrator/runtime bridge shell with deterministic after-turn draining
- `orchestrator_bridge.py`
- bounded turn-active incremental orchestrator/runtime bridge session shell
- `orchestrator_bridge_artifacts.py`
- bounded persisted bridge-artifact and replay-material shell above the turn-active bridge session
- `orchestrator_bridge_service.py`
- bounded local orchestrator/runtime bridge service shell above the live bridge session and bridge-artifact layer

The remaining runtime-specific work is now mostly outside the pure runtime core:

- later external bridges on top of the stable bridge stack
- blocker-driven fixes discovered while integrating `packages/llm`,
  `packages/tts`, or `packages/renderer`

---

## Control Flow

The intended runtime control flow is:

1. runtime receives one typed `ProtocolEvent`
2. runtime resolves the target `session_id`
3. session-local tracker updates its internal facts from that event
4. tracker builds a fresh `TransitionContext` from current `SessionState`
5. `state_driver.apply_event()` decides whether a transition exists
6. `SessionRuntime` updates current state
7. any emitted `session.state.changed` effect enters runtime outbox
8. outer layers may later forward that outbox to buses, logs, or adapters

This keeps:

- transition rules in protocol/state-machine land
- session ownership in runtime land
- scheduling policy in orchestrator land

---

## Session Ownership Rules

Every `SessionRuntime` instance is authoritative only for one `session_id`.

That means:

- incoming event `session_id` must match the runtime shell
- tracker state belongs to that session only
- outbox events belong to that session only

Cross-session routing belongs to a future runtime registry/router layer, not to the per-session shell itself.

---

## Outbox Model

Runtime outboxes are internal ordered effect buffers.

In v0.1 runtime core they should remain:

- in-memory
- typed
- deterministic
- explicitly drainable

They are not yet:

- a message bus
- a transport
- a persistence log

Those can be added later, but only after the local typed outbox semantics are stable.

---

## Boundaries With Other Packages

`packages/protocol`

- defines the typed contracts
- runtime may use but must not redefine them

`packages/orchestrator`

- produces protocol events and owns timing/scheduling policy
- runtime consumes resulting events but must not absorb orchestration strategy

`packages/stt`, `packages/tts`, `packages/renderer`

- eventually emit or consume protocol events through runtime-facing boundaries
- runtime core must remain implementation-agnostic until those adapter docs exist

---

## Current Package Shape

Current runtime code:

- [state_driver.py](/C:/Users/123/Desktop/echo/packages/runtime/state_driver.py)
- [session_runtime.py](/C:/Users/123/Desktop/echo/packages/runtime/session_runtime.py)
- [transition_context_tracker.py](/C:/Users/123/Desktop/echo/packages/runtime/transition_context_tracker.py)
- [runtime_registry.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_registry.py)
- [effect_forwarder.py](/C:/Users/123/Desktop/echo/packages/runtime/effect_forwarder.py)
- [recovery_snapshot.py](/C:/Users/123/Desktop/echo/packages/runtime/recovery_snapshot.py)
- [runtime_snapshot.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_snapshot.py)
- [runtime_supervisor.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_supervisor.py)
- [runtime_replay.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_replay.py)
- [runtime_persistence.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_persistence.py)
- [runtime_service.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_service.py)
- [runtime_bridge.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_bridge.py)
- [orchestrator_bridge.py](/C:/Users/123/Desktop/echo/packages/runtime/orchestrator_bridge.py)
- [orchestrator_bridge_service.py](/C:/Users/123/Desktop/echo/packages/runtime/orchestrator_bridge_service.py)

The next bounded design layer is documented in:

- [persistence-replay.md](/C:/Users/123/Desktop/echo/docs/runtime/persistence-replay.md)
- [replay-shell.md](/C:/Users/123/Desktop/echo/docs/runtime/replay-shell.md)
- [persistence-storage.md](/C:/Users/123/Desktop/echo/docs/runtime/persistence-storage.md)
- [bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-service.md)
- [bridge-runner.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-runner.md)
- [orchestrator-bridge.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge.md)
- [orchestrator-bridge-session.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-session.md)
- [orchestrator-bridge-artifacts.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-artifacts.md)
- [orchestrator-bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-service.md)

Current runtime docs complete the missing package design so future tasks can proceed in a documented order instead of inventing runtime structure task by task.

For the current repo phase, runtime should now be treated as a stable core
dependency and no longer the default mainline for large new architecture work.
