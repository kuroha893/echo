# LLM Demo Path

## Purpose

This document defines the shortest llm path from the current Echo core to the
first runnable responsive demo.

The target demo is:

- user types input
- Echo reacts quickly instead of idling visibly
- Echo generates a fuller answer
- later TTS speaks it
- later renderer reacts to it

STT is intentionally not required for the first demo.

---

## Minimum LLM Requirements For That Demo

The first responsive demo needs:

1. one hidden local `intent_routing` path that really works
2. one local quick-reaction path
3. one typed llm service boundary that `TurnOrchestrator` can call
4. one concrete cloud provider adapter for real text generation
5. one concrete local fast-path provider family
6. one hybrid orchestrator startup policy that actually uses those paths

It does not require before first responsive demo:

- tool-aware reasoning
- memory integration
- plugin integration
- multi-provider fallback
- provider hot reload
- screenshot multimodal input

---

## Why Primary Response Alone Is No Longer Enough

The old demo path could treat `primary_response` as the only gating capability.

That is no longer sufficient for the desired companion behavior because the
agent must avoid visibly idling while heavier reasoning is still running.

Therefore the first responsive demo must include:

- hidden local intent routing
- local quick reaction
- cloud-backed primary response

Even if the first version of hidden routing stays conservative, the architecture
must treat it as a first-class part of the path.

---

## Integration Points

The llm integration points already visible in `TurnOrchestrator` are:

- `_generate_quick_reaction(...)`
- `_stream_primary_response(...)`

Those seams are now implemented through `LLMService`.

The next llm blocker for the first responsive demo is no longer service shape or
provider transport. It is the orchestrator startup policy that consumes the new
hybrid llm routes.

---

## Current Provider Status

Already implemented:

- official OpenAI Responses API
- local OpenAI-compatible fast-path provider family

This is now the cloud/background path for:

- heavier `primary_response`
- later cloud-heavy reasoning

The first approved backend reference for the local family is:

- `docs/reference/approved/sglang-local-fast-path.md`

---

## Demo-Oriented LLM Order

The shortest llm path toward the first responsive demo is now:

1. hybrid llm route foundation
2. local OpenAI-compatible provider family
3. hybrid orchestrator startup policy
4. TTS line
5. renderer / Live2D line

This sequence keeps the agent's "alive while thinking" behavior on the critical
path rather than treating it as polish.
