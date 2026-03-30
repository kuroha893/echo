# Runtime Bridge Service Shell

## Purpose

This document defines the first bridge-ready runtime service shell for Echo.

It exists because the runtime core now has:

- a supervisor-owned live processing entrypoint
- a replay shell
- a local persistence/storage shell

but it still lacks one coherent façade that external bridges can stand on without bypassing runtime ownership rules.

The first bridge step should therefore be:

- one typed runtime service shell

not a direct event-bus adapter or device integration.

---

## Position In The Stack

The bridge service shell sits above:

- `RuntimeSupervisor`
- `RuntimeReplayer`
- `LocalFilesystemRuntimeStore`

and below any future:

- event-bus adapters
- STT/TTS/renderer adapters
- operator tooling surfaces
- remote control surfaces

Its job is narrow:

- accept typed ingress envelopes
- delegate live processing/replay/save-load to the current runtime foundations
- produce typed egress envelopes suitable for later bridges

---

## Why A Service Shell Comes Next

At this point the runtime core already has most of its internal building blocks:

- live processing
- multi-session routing
- effect forwarding
- recovery inspection
- snapshot export/import
- replay
- local persistence

What it does **not** have is one explicit service façade that external systems can call without learning all of those layers separately.

If we skip this step and go straight to bus or adapter integration, those integrations will be tempted to:

- talk to supervisor directly in some places
- talk to replayer directly in some places
- talk to the persistence store directly in some places

That would scatter ownership and make later adapter work harder to audit.

---

## Core Boundary Rules

The bridge service shell must obey these rules:

- all live ingress still resolves to typed `ProtocolEvent`
- all live event processing still goes through `RuntimeSupervisor`
- all replay still goes through `RuntimeReplayer`
- all snapshot/log save-load still goes through the local persistence store
- the service shell must not mutate registry/session internals directly
- the service shell must remain bus-agnostic and adapter-agnostic

This keeps the service shell as a façade, not a second runtime implementation.

---

## Ingress Surface

The first service shell should define typed ingress envelopes rather than raw dict payloads.

Recommended layers:

### Single ingress envelope

One typed model containing at minimum:

- envelope format version
- received-at timestamp
- source label
- one typed `ProtocolEvent`

### Ingress batch

One typed model containing at minimum:

- envelope format version
- ordered ingress envelopes

The batch order is caller-owned and must be preserved exactly.

---

## Egress Surface

The first service shell should define typed egress envelopes for the outputs of live processing and replay.

Recommended layers:

### Live process egress

One typed model containing at minimum:

- emitted-at timestamp
- touched `session_id`
- one `RuntimeProcessResult`

### Replay egress

One typed model containing at minimum:

- emitted-at timestamp
- one `RuntimeReplayResult`

### Recovery inspection egress

One typed model containing at minimum:

- emitted-at timestamp
- one or more `SessionRecoverySnapshot` values

These are still runtime-local typed views.
They are not yet transport-specific payloads.

---

## Service Responsibilities

The first bridge-ready runtime service shell should support these categories of operations:

### 1. Live processing

- process one ingress envelope
- process one ingress batch in caller-provided order

### 2. Recovery inspection

- inspect one session
- inspect all sessions in stable order

### 3. Persistence delegation

- save current runtime snapshot
- load runtime snapshot into a fresh runtime shell
- save replay log or replay bundle
- load replay-ready persisted material

### 4. Replay delegation

- replay one ingress batch
- replay one persisted replay log
- replay one persisted persistence bundle

The shell should remain explicit and typed in all four categories.

---

## Persistence Relation

The service shell should not replace the persistence store.

Instead:

- it should own or be injected with one `LocalFilesystemRuntimeStore`
- it may offer convenience methods above that store
- it must keep file/path behavior explicit

This allows later bridges or tools to work through one surface without bypassing the underlying storage boundary.

---

## Failure Semantics

The first bridge-ready service shell should stay conservative.

That means:

- live batch processing stops on the first failure
- replay surfaces existing halt-on-failure semantics
- persistence failures surface clearly and do not imply silent partial recovery
- malformed ingress envelopes fail clearly and early

This keeps the façade aligned with the existing runtime philosophy.

---

## Non-Goals

This document does not define:

- a specific event bus
- websocket/http APIs
- renderer or TTS adapters
- STT callbacks
- background daemons
- multi-process coordination
- authentication

Those belong later.

---

## Recommended First Task Shape

The first bridge-service task should be a larger bundled task that:

- creates one dedicated runtime service module
- defines typed ingress/egress envelope models
- defines deterministic JSON codec helpers for those envelopes
- composes supervisor, replayer, and local persistence store in one façade
- supports live batch processing, replay delegation, and save/load delegation
- verifies envelope ordering, halt-on-failure semantics, and persistence/replay round-trips with tests

This task should be somewhat larger than the recent runtime tasks because it is the first runtime-facing façade that composes:

- live processing
- replay
- persistence
- recovery inspection
