# Renderer Orchestrator Integration

## Purpose

This document defines the accepted way `TurnOrchestrator` integrates with
`packages/renderer`.

The original goal was to replace `_send_renderer_command(...)` no-op behavior
with real `RendererService` dispatch while preserving existing parser,
interrupt, and protocol-event semantics. That integration is now complete and
serves as the baseline for later desktop-demo wiring.

---

## Accepted Baseline

`TurnOrchestrator` now:

1. keeps protocol `RendererCommand` as the upstream command contract
2. preserves the `renderer.command.issued` protocol-event boundary
3. resolves optional quick/primary renderer profile bindings internally
4. dispatches through Echo-owned `RendererService`
5. surfaces renderer dispatch failure explicitly

This means renderer command execution is no longer a placeholder path.

---

## Ownership Rules

`packages/renderer` owns:

- command normalization
- adapter/profile resolution
- adapter capability checks
- typed dispatch failure normalization

`packages/orchestrator` still owns:

- when renderer commands are produced
- queueing and interrupt policy
- turn progression
- protocol-event emission

---

## What Comes Next

The next desktop-demo tasks should stay above this boundary.

They should build:

- desktop-owned playback
- a session-level composition root
- app-side history/input UI
- later app-side lip-sync

They should not:

- redesign renderer command semantics
- move renderer adapter logic back into orchestrator
- let renderer dispatch drive session transitions directly

---

## Still Deferred

The accepted orchestrator/renderer integration still does not imply:

- generic `set_mouth_open` support
- renderer-driven state transitions
- desktop chat-panel ownership inside orchestrator

Those belong to later desktop demo tasks.
