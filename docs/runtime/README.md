# Runtime Development Docs

This directory is the development doc set for `packages/runtime`.

Its purpose is to make the runtime line of work explicit before more runtime
implementation tasks continue. These docs do not replace the protocol
documents. They sit below:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/events.md`
3. `docs/protocol/state-machine.md`
4. `docs/protocol/orchestrator-spec.md`

and explain how the runtime package should be built on top of those rules.

---

## Scope

`packages/runtime` owns:

- session lifecycle
- session-owned state containers
- protocol event intake at the runtime boundary
- canonical state application
- session-local guard context tracking
- runtime-local outbox forwarding boundaries
- later session-level composition roots that wire stable subsystems together

`packages/runtime` does not own:

- orchestration strategy
- audio mutex policy
- expression parsing
- STT / TTS / renderer adapter internals
- memory algorithms
- plugin business logic
- browser-console page design
- floating desktop-window choreography

Those boundaries come from the constitution and are restated here so runtime
tasks stay narrow.

---

## Current Status

Implemented and accepted:

- `packages/runtime/state_driver.py`
- `packages/runtime/session_runtime.py`
- `packages/runtime/transition_context_tracker.py`
- bounded tracker ownership inside `SessionRuntime`
- bounded context-free ingest inside `SessionRuntime`
- `packages/runtime/runtime_registry.py`
- bounded multi-session routing by `session_id`
- bounded registry-level session outbox peek/drain
- bounded multi-session effect batch collection
- `packages/runtime/effect_forwarder.py`
- bounded runtime-side effect forwarding shell
- bounded session-local retained error context
- bounded reset-driven retained-error clearing
- `packages/runtime/recovery_snapshot.py`
- bounded runtime recovery-inspection shell
- `packages/runtime/runtime_supervisor.py`
- bounded in-process runtime supervisor shell
- `packages/runtime/runtime_snapshot.py`
- bounded tracker/session/registry/supervisor snapshot export/import foundation
- `packages/runtime/runtime_replay.py`
- bounded in-process runtime replay shell
- `packages/runtime/runtime_persistence.py`
- bounded local persistence backend / storage adapter shell
- `packages/runtime/runtime_service.py`
- bounded bridge-ready runtime service shell
- `packages/runtime/runtime_bridge.py`
- bounded transport-agnostic runtime bridge-runner shell
- `packages/runtime/orchestrator_bridge.py`
- bounded concrete in-process orchestrator/runtime bridge shell with
  deterministic after-turn draining
- `packages/runtime/orchestrator_bridge_artifacts.py`
- bounded persisted bridge-artifact and replay-material shell above the
  turn-active bridge session
- `packages/runtime/orchestrator_bridge_service.py`
- bounded local orchestrator/runtime bridge service shell above the live bridge
  session and bridge-artifact layer
- `packages/runtime/desktop_companion_session_service.py`
- bounded single-session desktop companion composition root above the stable
  llm/orchestrator/tts/renderer/runtime lines

Still deferred outside the current runtime core:

- multi-session desktop shell management
- standby/presence scheduling
- screenshot and multimodal session flows

Next runtime-adjacent mainline:

- keep the desktop companion session service as the single-session composition
  root while the UI line resets to:
  - browser-served web console
  - floating avatar window
  - floating chat window
  - floating bubble window

---

## Document Map

- [architecture.md](/C:/Users/123/Desktop/echo/docs/runtime/architecture.md): package boundaries, object model, and runtime control flow
- [event-routing.md](/C:/Users/123/Desktop/echo/docs/runtime/event-routing.md): how runtime should accept protocol events and forward resulting effects
- [effect-forwarding.md](/C:/Users/123/Desktop/echo/docs/runtime/effect-forwarding.md): bounded forwarding of runtime effect batches without flattening them into a global stream
- [reset-recovery.md](/C:/Users/123/Desktop/echo/docs/runtime/reset-recovery.md): session-local retained error context and reset-driven recovery boundaries
- [recovery-inspection.md](/C:/Users/123/Desktop/echo/docs/runtime/recovery-inspection.md): typed inspection of retained error context at session and registry levels
- [supervisor-shell.md](/C:/Users/123/Desktop/echo/docs/runtime/supervisor-shell.md): the first in-process runtime outer shell that composes registry, forwarding, and recovery inspection
- [persistence-replay.md](/C:/Users/123/Desktop/echo/docs/runtime/persistence-replay.md): typed snapshot export/import and later replay boundaries for the runtime core
- [replay-shell.md](/C:/Users/123/Desktop/echo/docs/runtime/replay-shell.md): the in-process replay layer built on top of the supervisor and snapshot foundation
- [persistence-storage.md](/C:/Users/123/Desktop/echo/docs/runtime/persistence-storage.md): versioned snapshot/log envelopes, codecs, and local storage-shell boundaries above the replay foundation
- [bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-service.md): the first bridge-ready runtime service shell above supervisor, replay, and local persistence
- [bridge-runner.md](/C:/Users/123/Desktop/echo/docs/runtime/bridge-runner.md): transport-agnostic source/sink ports and the first runtime bridge-runner shell above the runtime service facade
- [orchestrator-bridge.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge.md): the first concrete in-process bridge between the orchestrator protocol outbox and the runtime bridge-runner shell
- [orchestrator-bridge-session.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-session.md): the turn-active incremental bridge session layer above the first concrete orchestrator/runtime bridge
- [orchestrator-bridge-artifacts.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-artifacts.md): persisted result/failure artifacts and replay-material helpers above the turn-active bridge session
- [orchestrator-bridge-service.md](/C:/Users/123/Desktop/echo/docs/runtime/orchestrator-bridge-service.md): the first local service facade above the live bridge session and bridge-artifact layer
- [desktop-companion-session-service.md](/C:/Users/123/Desktop/echo/docs/runtime/desktop-companion-session-service.md): the single-session composition root that remains valid through the UI reset
- [multi-companion-story-mode.md](/C:/Users/123/Desktop/echo/docs/runtime/multi-companion-story-mode.md): app-side story-thread orchestration above the stable single-session runtime and desktop companion service stack
- [external-bridges.md](/C:/Users/123/Desktop/echo/docs/runtime/external-bridges.md): future bridge boundaries between the runtime core and buses/adapters/tooling
- [state-driver.md](/C:/Users/123/Desktop/echo/docs/runtime/state-driver.md): contract for `packages/runtime/state_driver.py`
- [session-runtime.md](/C:/Users/123/Desktop/echo/docs/runtime/session-runtime.md): contract for `packages/runtime/session_runtime.py`
- [transition-context-tracker.md](/C:/Users/123/Desktop/echo/docs/runtime/transition-context-tracker.md): contract for the runtime tracker layer
- [roadmap.md](/C:/Users/123/Desktop/echo/docs/runtime/roadmap.md): phased development order for runtime work

---

## Runtime Invariants

The runtime docs assume all future runtime work obeys these invariants:

- runtime consumes and emits typed `ProtocolEvent` objects only
- session state changes happen only through the dedicated state-application path
- `session.state.changed` is an effect, not an input trigger
- session-local guard facts must come from observable protocol events, not
  hidden guesses
- runtime outboxes must be ordered and replay-friendly
- runtime core must remain adapter-agnostic

---

## Priority Handoff

Runtime core is no longer the primary repo bottleneck.

The next runtime-adjacent work should be:

1. keep the single-session composition root stable
2. support the browser web console control plane above that root
3. support the corrected `avatar + chat + bubble` desktop suite above that root
4. avoid pulling UI layout or provider form concerns into runtime core

Further runtime work should now be:

- blocker-driven
- bug-fix driven
- or explicitly required by the browser-console plus floating-suite product
  reset
