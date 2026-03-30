# LLM Roadmap

## Purpose

This document defines the intended development order for `packages/llm`.

It exists to keep llm work cumulative, demo-oriented, and aligned with the
already completed protocol/orchestrator/runtime core.

---

## Phase 0: Documentation And Boundaries

Completed by this doc set:

- package boundary definition
- llm-local contracts
- prompt boundary definition
- provider port and registry planning
- route-specific streaming rules
- error-handling rules

---

## Phase 1: LLM Foundation

Goal:

- create the first real `packages/llm` package without choosing a concrete
  network transport yet

Required outputs:

- llm-local request/response models
- provider port
- provider registry
- llm service shell
- deterministic scripted provider for tests

Status:

- completed

---

## Phase 2: Orchestrator Integration

Goal:

- replace `TurnOrchestrator` placeholders with `LLMService` seams

Required outputs:

- injected llm service seam
- preserved protocol event semantics
- preserved parser/audio-mutex path
- no provider logic inside orchestrator

Status:

- completed

---

## Phase 3: First Concrete Cloud Provider

Goal:

- implement one real cloud-oriented provider adapter on top of the stable llm
  contracts

Chosen provider family:

- official OpenAI Responses API

Status:

- completed

---

## Phase 4: Hybrid Local-Fast-Path Contracts

Goal:

- expand the llm foundation from "cloud primary plus optional quick reaction"
  into a real hybrid local/cloud topology

Required outputs:

- `intent_routing` route
- `ambient_presence` route
- normalized hidden routing decision contracts
- registry/service support for hybrid route kinds
- scripted-provider coverage for the new route family

Status:

- completed

---

## Phase 5: First Local Fast-Path Provider

Goal:

- implement one local OpenAI-compatible provider family for low-latency local
  generation

Planned first approved backend reference:

- `docs/reference/approved/sglang-local-fast-path.md`

Required outputs:

- typed local provider config
- OpenAI-compatible request/response mapping
- hidden routing support
- quick-reaction support
- optional local primary-response support
- deterministic fake transport tests

Status:

- completed

---

## Phase 6: Hybrid Orchestrator Integration

Goal:

- let `TurnOrchestrator` start local hidden routing and local quick reaction
  before or alongside the cloud-heavy path

Required outputs:

- typed local/cloud startup policy
- local routing result consumption
- preserved interrupt/parser/audio semantics
- no provider logic moved into orchestrator internals

Status:

- next active phase

---

## Phase 7: Ambient Presence

Goal:

- add bounded standby generation for proactive presence

Required outputs:

- low-priority local-first generation path
- cooldown-aware caller policy hooks
- no-op-safe failure behavior

---

## Phase 8: Screenshot Multimodal Input

Goal:

- extend llm contracts for explicit user-triggered screenshot questions

Required outputs:

- multimodal request-side contracts
- screenshot attachment boundary
- no autonomous screen-capture semantics

---

## Explicitly Deferred

These are not first-line llm tasks:

- full tool-aware reasoning implementation
- prompt compiler implementation
- memory retrieval
- plugin routing
- provider hot reload
- multi-provider balancing or retry orchestration

Those can come later once the first responsive demo path is real.
