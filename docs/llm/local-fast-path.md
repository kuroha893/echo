# Local Fast Path

## Purpose

This document defines the local fast-path responsibilities inside Echo's llm
line.

The local fast path exists to minimize visible dead time while slower reasoning
is still running.

---

## Intended Responsibilities

The local fast path is the preferred home for:

- hidden `intent_routing`
- visible `quick_reaction`
- optional lightweight local `primary_response`
- later local-first `ambient_presence`

It is not the first intended home for:

- heavy reasoning
- tool-aware reasoning
- multi-step agent action

Those remain cloud-heavy by default.

---

## Performance Intent

The local fast path should optimize for:

- low startup overhead
- short turn latency
- stable small outputs
- deterministic or near-deterministic routing behavior

It should not optimize first for:

- maximal answer quality
- very long context windows
- tool sophistication
- rich multimodal reasoning

---

## Output Types By Route

### `intent_routing`

Expected output:

- one structured hidden routing decision

### `quick_reaction`

Expected output:

- one short visible response
- possibly no-op

### `primary_response`

Expected output:

- short local chat answer when the turn is cheap enough

### `ambient_presence`

Expected output:

- short proactive line
- or no-op

---

## Fallback Rules

If the local fast path is unavailable:

- `intent_routing` may degrade to a safe cloud-primary fallback
- `quick_reaction` may degrade to silence
- local lightweight primary may degrade to cloud primary
- ambient presence should degrade to no-op

The local fast path must not be a single point of permanent session failure.

---

## Provider Family Guidance

The local fast path should use:

- one Echo-owned local provider family
- one explicit base URL / model / timeout config
- one external backend process or service

It must not:

- embed backend internals
- import backend-specific schedulers or parsers
- redefine Echo's route semantics around backend quirks

The first approved backend reference is:

- [sglang-local-fast-path.md](/C:/Users/123/Desktop/echo/docs/reference/approved/sglang-local-fast-path.md)

Additional local backends such as vLLM remain possible later, but they require
their own approved reference note before implementation.

---

## Current Boundary

This document intentionally does not define:

- local backend installation instructions
- launcher process supervision
- GPU scheduling policy
- exact route-to-model thresholds

Those belong to later provider and outer-shell tasks.

Current status:

- the local fast-path provider family now exists in `packages/llm`
- hidden routing and ambient route contracts now exist
- orchestrator startup policy still does not consume them yet
