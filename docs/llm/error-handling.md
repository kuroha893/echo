# LLM Error Handling

## Purpose

This document defines how llm failures should surface without letting
`packages/llm` take over runtime or orchestrator ownership.

---

## Core Principle

`packages/llm` may classify and normalize provider failure.

`packages/llm` must not decide:

- session state transitions
- interrupt application
- playback replacement
- user-visible fallback phrasing

Those remain caller-owned decisions.

---

## Failure Classes

The llm line should distinguish at least:

- validation/configuration failure
- authentication failure
- provider unavailable / network failure
- rate limiting
- timeout
- cancelled request
- malformed provider response
- unsupported capability

All of them should be normalized to `LLMProviderError`.

---

## Retry Rules

The llm layer may expose whether an error is retryable.

It must not automatically implement:

- hidden retries
- backoff loops
- model failover chains

Those are higher-level policy choices and should remain explicit.

---

## Cancellation Rules

If the caller cancels:

- a streaming request must stop yielding further deltas
- a one-shot request must surface a typed cancelled failure
- late provider-side transport cleanup remains adapter-owned

The llm package must not let cancelled raw provider output leak into active
orchestrator flow.

---

## Logging / Debugging Rules

LLM failures should preserve enough metadata for debugging, such as:

- provider key
- profile key
- raw error type
- optional status code

But provider-specific payload blobs must not become the public llm boundary.

---

## Hybrid Local/Cloud Rules

For the hybrid line:

- `intent_routing` failure or timeout must not leave the turn permanently stalled
- `quick_reaction` failure may still result in visible silence
- `ambient_presence` failure should degrade to no-op
- local fast-path failure by itself should not be treated as session-blocking
- cloud primary failure should surface clearly rather than fabricating an answer

The llm layer still must not choose the actual fallback response policy.

That remains caller-owned.

---

## Responsive Demo Rule

For the first responsive demo path:

- local hidden routing may fail closed into a safe primary path
- local quick reaction may remain absent if its llm route fails
- cloud primary failure should halt the current primary generation clearly
- no llm path should silently fabricate an assistant answer

This keeps demo failures honest and debuggable.
