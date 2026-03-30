# Renderer Contracts

## Purpose

This document defines the typed contract surface that `packages/renderer`
should own above any concrete desktop backend.

The upstream input remains protocol `RendererCommand`.
The downstream output becomes renderer-local dispatch results or typed failures.

---

## Required Model Families

The first renderer foundation should define, at minimum, typed models for:

- renderer adapter descriptor
- renderer adapter capabilities
- renderer adapter profile
- resolved renderer dispatch request
- renderer dispatch result
- renderer adapter failure

These models must be Echo-owned and must not leak desktop transport payloads.

---

## Upstream Boundary

`packages/renderer` should accept protocol `RendererCommand` as its public
command input.

It may derive renderer-local request objects from that command, but it must not
invent a second ad-hoc public command schema above the package boundary.

---

## Required Dispatch Information

At dispatch time, Echo needs enough typed information to know:

- which command is being executed
- which adapter/profile should handle it
- whether the adapter claims support for that command type
- whether the dispatch completed, was rejected as unsupported, or failed

The first foundation should therefore carry:

- adapter key
- optional adapter profile key
- command identity
- command type
- typed success/failure outcome

---

## Failure Shape

Renderer failures should be normalized into Echo-owned typed failures, not raw:

- IPC exceptions
- JSON payloads
- Electron errors
- Pixi/Live2D errors

Minimum failure classes should distinguish:

- unsupported command
- invalid profile or adapter resolution
- adapter unavailable
- timeout or no result
- internal adapter/runtime error

---

## Capability Semantics

Capabilities should be explicit.

If a concrete adapter does not support one of the protocol command types, it
must say so via capability surface and/or typed failure.

The first desktop backend should explicitly support:

- `set_state`
- `set_expression`
- `set_motion`
- `clear_expression`

The first desktop backend may explicitly reject:

- `set_mouth_open`

---

## Strong-Typing Rules

Renderer-local models should follow the same general standards as other Echo
core packages:

- frozen models
- `extra="forbid"`
- explicit enums where a closed set exists
- deterministic serialization shape

No ad-hoc dict payloads should cross `packages/orchestrator` ->
`packages/renderer` or `packages/renderer` -> concrete adapter boundaries.
