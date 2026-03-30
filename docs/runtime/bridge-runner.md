# Runtime Bridge Runner Shell

## Purpose

This document defines the first transport-agnostic bridge-runner shell for Echo.

That layer is now implemented in:

- `packages/runtime/runtime_bridge.py`

It exists because the runtime core now has:

- a bridge-ready `RuntimeService` façade
- live processing
- replay
- local persistence
- recovery inspection

but it still lacks one bounded runner layer that can:

- pull ingress batches from a source boundary
- hand them to the runtime service façade
- emit typed egress envelopes to a sink boundary
- persist relevant runtime artifacts without binding to a real transport

That step is now complete.

This document remains the source of truth for the implemented runner layer and
for later higher-level bridge work built on top of it.

---

## Position In The Stack

The bridge-runner shell sits above:

- `RuntimeService`

and below any future:

- event-bus adapters
- websocket/http bridges
- STT/TTS/renderer adapters
- operator tooling daemons

Its job is narrow:

- mediate between a source/sink pair and the runtime service façade
- preserve typed boundaries
- keep transport details outside the runtime core

---

## Why This Layer Exists

If we stop at `RuntimeService`, later integrations still need to decide on their own:

- how to fetch ingress work
- how to surface live egress
- how to persist ingress batches or replay artifacts
- how to handle halt-on-failure in a bridge-like context

That would make each later bridge solve the same coordination problem differently.

The bridge-runner shell exists to centralize that coordination while still staying:

- transport-agnostic
- adapter-agnostic
- runtime-owned

---

## Core Boundary Rules

The bridge-runner shell must obey these rules:

- ingress source output must decode into typed `RuntimeIngressEnvelope` or `RuntimeIngressBatch`
- all live processing must still delegate to `RuntimeService`
- all replay must still delegate to `RuntimeService`
- all persistence save/load must still delegate to `RuntimeService`
- sink emission must operate on already-typed runtime service egress objects
- the runner must not mutate runtime internals directly

For the first bounded runner shell, live emission order should be explicit and deterministic:

1. emit ordered per-envelope live process egress
2. emit one batch summary/result object
3. emit one optional recovery inspection envelope

Replay emission should remain narrower:

1. emit one replay egress envelope
2. emit one optional recovery inspection envelope

This keeps the runner as coordination glue rather than a second runtime implementation.

---

## Port Model

The first runner shell should define explicit typed port boundaries.

Recommended shape:

### Ingress source port

A source boundary that can provide:

- one ingress envelope
- one ingress batch

The source may be sync or async in a later phase, but the first runner task should stay in-process and deterministic.

### Egress sink port

A sink boundary that can accept:

- one process egress envelope
- one process batch result
- one replay egress envelope
- one recovery inspection envelope

### Persistence policy boundary

A small typed policy layer that controls whether the runner:

- persists incoming batches before live processing
- persists replay bundles before replay
- persists replay logs before replay
- persists final runtime snapshots after successful work

This policy should remain explicit, not hidden.

The first runner shell should also preserve a typed artifact report surface so the caller can tell:

- whether an ingress-derived replay log was saved
- whether an ingress-derived bundle was saved
- whether a final runtime snapshot was saved
- which concrete local paths were produced

---

## Runner Responsibilities

The first bridge-runner shell should support these operation groups:

### 1. Live ingress execution

- fetch one ingress envelope from a source
- fetch one ingress batch from a source
- process through `RuntimeService`
- emit typed live egress through a sink

### 2. Replay execution

- replay one ingress batch through `RuntimeService`
- replay one persisted log or bundle through `RuntimeService`
- emit typed replay egress through a sink

### 3. Persistence coordination

- optionally persist ingress batches before execution
- optionally persist replay bundles/logs before replay
- optionally persist runtime snapshots after successful execution
- preserve typed artifact-path reporting for any persistence side effects

### 4. Recovery inspection routing

- collect typed recovery inspection from `RuntimeService`
- emit it through a sink when the selected runner path calls for it

---

## Failure Semantics

The first bridge-runner shell should stay conservative.

That means:

- if live batch processing halts, the runner surfaces the existing typed batch failure
- if replay halts, the runner surfaces the existing typed replay failure
- if sink emission fails, the runner does not invent rollback over already-completed runtime state
- if persistence save/load fails, the runner surfaces the failure clearly and stops the current path

This keeps the runner aligned with the runtime core's existing non-transactional philosophy.

---

## Persistence Relation

The runner should not replace the persistence shell.

Instead:

- it should own or be injected with one `RuntimeService`
- persistence actions should call the service's save/load helpers
- replay of persisted material should call the service's replay helpers

This keeps persistence ownership centralized below the runner.

---

## Non-Goals

This document does not define:

- a concrete event bus
- HTTP or websocket APIs
- STT callbacks
- TTS/renderer adapters
- authentication
- multi-process orchestration
- async worker pools

Those belong later.

---

## Recommended First Task Shape

The first bridge-runner task should be a larger bundled task that:

- creates one dedicated runtime runner module
- defines typed source/sink port protocols
- defines runner-local execution result/failure models
- defines runner-local typed persistence-artifact reporting
- composes runtime service, source/sink ports, and explicit persistence policy
- supports live batch execution, replay execution, and recovery-inspection emission
- verifies sink ordering, halt-on-failure behavior, and persistence coordination with tests

This task should be somewhat larger than the recent runtime tasks because it is the first coordination layer that composes:

- runtime service
- live processing
- replay
- persistence
- sink/source boundaries
