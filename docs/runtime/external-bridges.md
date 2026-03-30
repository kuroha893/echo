# Runtime External Bridges

## Purpose

This document defines the future bridge layer between the runtime core and external systems.

It exists because runtime now has an in-process supervisor shell, but later phases will need controlled bridges to:

- event buses
- adapter callbacks
- service boundaries
- operator or tooling surfaces

Those bridges should be planned now.

The first bounded bridge-facing steps were intentionally not real bus adapters.
They were:

1. a bridge-ready runtime service shell above the already-completed runtime foundations
2. a transport-agnostic bridge-runner shell above that service façade
3. a concrete in-process orchestrator/runtime bridge shell above that runner
4. a turn-active incremental orchestrator/runtime bridge session shell above that concrete bridge
5. a persisted bridge-artifact and replay-material shell above that live bridge session
6. a local orchestrator/runtime bridge service shell above the live bridge session and bridge-artifact layer

All six steps are now implemented inside the repo.

---

## Position In The Stack

The external-bridge layer sits above:

- `RuntimeSupervisor`
- `RuntimeRegistry`
- `RuntimeEffectForwarder`

and below any future:

- STT/TTS/renderer adapter implementations
- event bus or transport adapters
- external monitoring/supervision tooling

Its job is narrow:

- normalize external ingress into typed `ProtocolEvent`
- consume typed runtime outputs without mutating runtime internals directly

The first concrete layer below that future bridge family is documented in:

- [bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-service.md)
- [bridge-runner.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-runner.md)
- [orchestrator-bridge.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge.md)
- [orchestrator-bridge-session.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-session.md)
- [orchestrator-bridge-artifacts.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-artifacts.md)
- [orchestrator-bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-service.md)

---

## Core Boundary Rules

All external bridges must obey these rules:

- runtime ingress accepts only typed `ProtocolEvent`
- runtime effect egress consumes only typed runtime-local or protocol-local objects
- no bridge may bypass `RuntimeSupervisor` once the supervisor shell exists
- no bridge may mutate `SessionRuntime`, `RuntimeRegistry`, or tracker internals directly

This keeps runtime ownership boundaries intact even when external systems are added later.

---

## Ingress Rule

External sources such as:

- adapter callbacks
- transport frames
- bus messages

must normalize into typed protocol events before entering the runtime core.

That normalized event should then enter through the supervisor-owned entrypoint rather than by manually calling lower-level runtime pieces out of order.

---

## Egress Rule

External sinks such as:

- event buses
- logs
- adapters
- tooling consumers

must receive already-typed runtime outputs.

Bridge code may transform them into transport-specific envelopes, but must not redefine runtime meaning or strip required typing inside the runtime core.

---

## Non-Goals

This document does not define:

- a specific bus technology
- adapter SDK details
- concrete transport schemas
- auth/network policy
- cross-process deployment topology

Those belong to later adapter or infrastructure docs.

---

## Completed Bridge Stack

Before real bus or adapter integrations begin, Echo needed:

### 1. A bridge-ready runtime service shell that:

- accepts typed ingress envelopes around `ProtocolEvent`
- delegates live processing to `RuntimeSupervisor`
- delegates replay to `RuntimeReplayer`
- delegates save/load behavior to the local runtime persistence store
- emits typed egress envelopes without mutating runtime internals directly

### 2. A bridge-runner shell that:

- owns transport-agnostic ingress source / egress sink ports
- pulls ingress batches from a source
- delegates them to the runtime service shell
- pushes egress envelopes to a sink
- can optionally persist ingress/replay material through the local persistence shell

### 3. A concrete in-process orchestrator/runtime bridge shell that:

- accepts typed protocol events emitted by `TurnOrchestrator`
- buffers them in-order without redefining protocol meaning
- routes them into the runtime bridge-runner shell
- records typed runtime egress without inventing a bus or network transport
- keeps orchestration semantics owned by `packages/orchestrator` and state/event-flow semantics owned by `packages/runtime`

### 4. A turn-active incremental orchestrator/runtime bridge session shell that:

- drains typed protocol events while `TurnOrchestrator.handle_user_turn(...)` is still active
- preserves exact orchestrator emission order during live runtime ingestion
- records ordered runtime egress as the turn progresses rather than only after the turn completes
- surfaces typed partial-drain failure state without inventing rollback or a real transport
- remains fully in-process and adapter-agnostic

### 5. A persisted bridge-artifact and replay-material shell that:

- persists typed turn-success and turn-failure results from the live bridge session
- preserves ordered protocol events, drained prefixes, undrained tails, typed runtime egress, and final or partial runtime snapshots
- exposes deterministic local JSON codec and local filesystem save/load boundaries
- can derive replay-ready ingress material from persisted turn artifacts without inventing a bus or redefining runtime semantics
- remains fully in-process, local, and transport-agnostic

### 6. A local orchestrator/runtime bridge service shell that:

- owns one explicit live-turn entrypoint above `OrchestratorRuntimeBridgeSession`
- can persist success and failure artifacts through the bridge-artifact layer
- can derive replay material from saved artifacts and route replay back through the existing runtime bridge runner
- returns typed result and typed failure surfaces with explicit saved-artifact paths when persistence is enabled
- remains local, in-process, and transport-agnostic rather than becoming a bus or network API

Those shells are now part of the Echo core.
They are still not bus adapters, network transports, or device integrations.

---

## Why This Exists Early

Writing this boundary down now prevents two common mistakes later:

- adapters bypassing the supervisor and mutating runtime internals directly
- bus integration being treated as if it were the runtime core itself

The runtime core should stay small and typed.
External bridge code should stay outside that core.

From this point onward, the default repo mainline should prioritize llm/tts/renderer
and return to concrete transport work only when those higher lines need it.
