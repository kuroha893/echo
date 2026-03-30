# Runtime Persistence And Replay

## Purpose

This document defines the runtime-side persistence and replay boundary for Echo.

It exists because the runtime core now has:

- session-owned state
- tracker-owned guard facts
- retained error context
- pending runtime outboxes
- an in-process supervisor shell

but it still lacks a typed way to export and restore that runtime state without reaching for a real database or message bus too early.

The first persistence step was therefore:

- typed snapshot export/import inside the runtime core

That snapshot foundation now exists locally.

Later replay and real storage backends should build on top of that foundation.

---

## Position In The Stack

The persistence/replay layer sits above:

- `TransitionContextTracker`
- `SessionRuntime`
- `RuntimeRegistry`
- `RuntimeSupervisor`

and below any future:

- file/database persistence backends
- event-log replay services
- crash recovery tooling
- operator/debugging surfaces

Its job is narrow:

- describe what runtime state must be snapshot-capable
- define the first bounded export/import foundation
- defer real storage and replay policy until later

---

## Why Snapshot Export Comes First

Replay-safe persistence needs more than `SessionState`.

To reconstruct a live session faithfully, runtime must preserve at least:

- current `SessionState`
- tracker-owned guard facts
- retained blocking error context
- pending runtime outbox effects

That means the first useful persistence step is not:

- a database adapter
- a file format
- a replay daemon

It is:

- a typed runtime-local snapshot foundation

Without that foundation, any later persistence backend would be guessing what runtime state actually matters.

---

## Required Snapshot Layers

The runtime persistence design should converge on three layers of typed snapshot:

### 1. Tracker snapshot

One runtime-local snapshot for `TransitionContextTracker`, containing the observable facts needed to rebuild future `TransitionContext` values.

At minimum this includes:

- active user-input flag
- finalized-utterance flag
- active TTS playback flag
- active reasoning flag
- pending interrupt flag
- current stream identifiers
- pending TTS counts by stream

### 2. Session snapshot

One runtime-local snapshot for one `SessionRuntime`, containing at minimum:

- current `SessionState`
- tracker snapshot
- retained blocking error context
- pending runtime outbox effects

### 3. Registry snapshot

One runtime-local snapshot for the full `RuntimeRegistry`, containing all registered session snapshots in a stable deterministic order.

This order is an enumeration rule only.
It must not be described as a cross-session time order.

---

## Snapshot Export/Import Contract

The first bounded persistence task implemented:

- snapshot export
- snapshot import / reconstruction

inside the runtime core.

Implemented shape:

- tracker can build and restore its own snapshot
- `SessionRuntime` can build and restore a session snapshot
- `RuntimeRegistry` can build and restore a registry snapshot
- `RuntimeSupervisor` may delegate top-level build/restore around the registry snapshot

This is still in-memory runtime logic.
It is not yet a file format or external storage API.

---

## Current Status

The runtime core now has:

- tracker/session/registry snapshot export
- tracker/session/registry snapshot reconstruction
- supervisor-level snapshot delegation
- in-process replay through the supervisor-owned entrypoint

That means the next persistence/replay task should no longer be another snapshot helper or the first replay shell.
The next useful bounded step is the persistence storage shell that uses these foundations.

---

## Replay Contract

True replay should come later than snapshot export/import.

When replay is added, it should build on:

- a known-good snapshot foundation
- the existing typed event ingress path
- the existing supervisor/registry/session ownership rules

Replay must not bypass:

- session ownership validation
- tracker updates
- canonical state application
- runtime outbox semantics

That means future replay should re-enter runtime through a controlled path, not by mutating internal fields ad hoc.

---

## Next Bounded Persistence Step

The next useful persistence task should implement a storage shell that:

- defines versioned typed envelopes for runtime snapshots and replay-ready event logs
- defines a deterministic JSON codec for those envelopes
- defines a local storage adapter boundary for saving/loading those envelopes
- can restore a `RuntimeSupervisor` or `RuntimeReplayer` from stored material without bypassing current runtime ownership rules

This should remain:

- typed
- deterministic
- supervisor/replayer-owned
- stdlib-only in its first implementation

It should still not introduce:

- networked persistence services
- event buses
- adapter integration
- async workers

---

## Outbox Persistence Rule

The runtime outbox is part of runtime state.

Therefore the persistence design must explicitly preserve:

- pending `SessionStateChangedEvent` values that have not yet been drained/forwarded

Snapshot export/import must not silently discard them.

This is important because later forwarding and replay semantics depend on whether an effect was still pending at snapshot time.

---

## Recovery Snapshot Relation

Recovery inspection and persistence are related but distinct.

Persistence must preserve the retained blocking error context that recovery inspection already exposes, but it must not redefine recovery semantics.

That means:

- recovery snapshots remain inspection views
- persistence snapshots remain reconstruction views

The first persistence task may reuse the same retained error event object, but it should not collapse the two concepts into one type.

---

## Non-Goals

This document does not define:

- a concrete database backend
- a file format
- compression/encryption
- event-log retention policy
- replay scheduling
- operator tooling
- cross-process locking

Those belong to later runtime or infrastructure docs.

---

## Recommended Next Task Shape

The next useful persistence/replay step should be a larger bundled task that:

- introduces one dedicated persistence/storage module
- defines versioned runtime snapshot and replay-log envelopes
- defines deterministic JSON encode/decode helpers
- defines one local storage shell with save/load helpers
- wires that storage shell into the supervisor/replayer layer with typed delegation
- verifies snapshot/log round-trips and restore-from-storage behavior

This should be larger than the recent shell tasks because storage is the first runtime layer that needs to compose:

- snapshot foundation
- replay foundation
- supervisor ownership
- deterministic serialization rules
