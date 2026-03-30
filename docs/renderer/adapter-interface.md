# Renderer Adapter Interface

## Purpose

This document defines the adapter-facing boundary for `packages/renderer`.

The goal is to let Echo support multiple renderer backends later while keeping
all renderer callers on one typed service surface.

---

## Core Rule

`TurnOrchestrator` and any later bridge/service code must call
`RendererService`, not concrete adapters directly.

Concrete adapters must sit behind:

- a renderer adapter port
- a typed registry
- a typed service facade

---

## Required Adapter Responsibilities

A renderer adapter must be able to:

1. declare its identity and capabilities
2. accept a typed resolved renderer request
3. return a typed dispatch result or typed failure

It must not:

- mutate runtime/session state
- emit protocol events by itself
- reinterpret command semantics in a backend-specific undocumented way

---

## Registry Responsibilities

The renderer registry should own:

- adapter registration
- adapter key resolution
- adapter profile resolution
- capability validation before dispatch

If a profile or adapter mismatch occurs, the failure should happen before the
concrete backend is called.

---

## Service Responsibilities

`RendererService` should own:

- command normalization from protocol `RendererCommand`
- profile override handling
- registry-based resolution
- typed failure normalization

It should not own:

- orchestrator queue policy
- Electron lifecycle
- model asset discovery

---

## Concrete Backend Boundary

For the first concrete backend, the renderer adapter bridge will sit between:

- Python `packages/renderer`
- Electron `apps/desktop-live2d`

That bridge may use a local RPC or IPC transport, but transport details must
not leak above the adapter boundary.
