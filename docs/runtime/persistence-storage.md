# Runtime Persistence Storage Shell

## Purpose

This document defines the first persistence backend / storage adapter shell for the Echo runtime core.

It exists because the runtime core now has:

- snapshot export/import across tracker/session/registry/supervisor
- a supervisor-owned replay shell

but it still lacks a bounded way to:

- serialize runtime snapshots deterministically
- serialize replay-ready event logs deterministically
- store and reload those artifacts through a local storage boundary

The first storage step should therefore be:

- a versioned, typed, local persistence shell

not a network service or distributed persistence layer.

---

## Position In The Stack

The persistence storage shell sits above:

- `RuntimeSupervisor`
- `RuntimeReplayer`
- `RuntimeRegistrySnapshot`
- replay step/run state

and below any future:

- database adapters
- remote persistence services
- replay orchestration workers
- operator tooling

Its job is narrow:

- define runtime-local persisted envelopes
- define deterministic encode/decode rules
- define a local storage boundary and first stdlib-backed implementation

---

## Core Boundary Rules

The persistence storage shell must obey these rules:

- persisted snapshot state must be derived from typed runtime snapshots, not ad-hoc dicts
- persisted replay logs must preserve caller-owned event order exactly
- snapshot storage and replay-log storage must stay versioned
- storage helpers must not mutate runtime internals directly
- restore paths must re-enter through `RuntimeSupervisor.from_snapshot()` or `RuntimeReplayer.from_snapshot()`
- storage helpers must remain adapter-agnostic and transport-agnostic

This keeps persistence aligned with runtime ownership instead of becoming a second hidden state model.

---

## Persisted Layers

The first storage shell should converge on three persisted layers.

### 1. Snapshot envelope

One typed persisted envelope for a `RuntimeRegistrySnapshot`, containing at minimum:

- persistence format version
- created-at timestamp
- stored runtime snapshot

This is the persisted form of runtime state.

### 2. Replay event log

One typed persisted log for an ordered sequence of `ProtocolEvent` values, containing at minimum:

- persistence format version
- ordered typed event records

Each stored event record should preserve:

- sequence index
- the typed `ProtocolEvent`

This is the persisted form of replay input order.

### 3. Persistence bundle

One typed bundle that can carry both:

- one snapshot envelope
- one replay event log

This allows one local persistence save/load unit without collapsing snapshot and log semantics into the same type.

---

## Codec Rules

The first storage shell should define one deterministic JSON codec.

Requirements:

- UTF-8 JSON only in the first implementation
- explicit format version field in persisted envelopes
- deterministic ordering where the underlying runtime snapshot/log already defines a stable order
- restore paths must rebuild typed runtime-local models, not untyped dicts

The codec layer should support at minimum:

- encode/decode snapshot envelope
- encode/decode replay event log
- encode/decode persistence bundle

It should not yet define:

- compression
- encryption
- alternate wire formats
- schema migration beyond strict version rejection

---

## Local Storage Boundary

The first storage shell should define a local storage adapter boundary that can:

- save one snapshot envelope
- load one snapshot envelope
- save one replay event log
- load one replay event log
- save one persistence bundle
- load one persistence bundle

The first implementation may be stdlib-backed local filesystem storage.

If a filesystem-backed implementation is used, it should keep:

- deterministic file naming
- explicit overwrite behavior
- explicit missing-file failure behavior

It should not introduce:

- file watching
- background sync
- remote APIs
- locking beyond what is necessary for a simple local bounded shell

---

## Supervisor And Replayer Relation

The storage shell should not replace supervisor or replay ownership.

Instead:

- `RuntimeSupervisor` remains authoritative for live runtime state
- `RuntimeReplayer` remains authoritative for replay execution
- persistence storage helpers should delegate restoration to those existing runtime entrypoints

Recommended high-level relations:

- supervisor can build a persisted snapshot envelope from its current runtime snapshot
- replayer can be restored from a stored snapshot envelope or persistence bundle
- replay logs can be fed into the existing replay shell after decode

This avoids inventing a third runtime execution path.

---

## Failure Semantics

The first storage shell should stay conservative.

That means:

- reject unsupported format versions clearly
- reject malformed stored content clearly
- reject missing required snapshot/log sections clearly
- do not partially restore a runtime object from invalid persisted data

This keeps storage behavior aligned with the runtime's current conservative design style.

---

## Non-Goals

This document does not define:

- remote databases
- object stores
- network protocols
- event-log streaming services
- replay scheduling
- operator dashboards
- retention/compaction policy
- distributed locking

Those belong later.

---

## Recommended First Task Shape

The first persistence storage task should be a larger bundled task that:

- creates one dedicated runtime persistence module
- defines typed persisted snapshot/log/bundle models
- defines deterministic JSON codec helpers
- defines one local stdlib-backed storage shell
- adds supervisor/replayer delegation helpers around that storage shell
- verifies round-trip save/load and restore/replay behavior with tests

This task should be larger than the recent shell tasks because storage is the first runtime layer that meaningfully composes:

- snapshot foundation
- replay foundation
- deterministic serialization
- restore delegation back into runtime entrypoints
