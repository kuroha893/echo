# LLM Architecture

## Purpose

`packages/llm` is the provider-adapter layer that sits between:

- Echo-owned turn routes and prompt materials
- concrete local or cloud model provider transports

It is not the orchestrator and it is not the prompt compiler.

Its job is to turn Echo-owned generation requests into normalized model output
without leaking provider-specific transport details into:

- `packages/orchestrator`
- `packages/runtime`
- later `packages/tts`
- later `packages/renderer`

---

## Responsibilities

LLM owns these concerns:

- route-aware generation entrypoints
- provider-neutral request models
- provider-neutral streaming delta models
- normalized hidden routing decisions
- provider registry and route selection
- provider capability checks
- provider error normalization
- timeout / cancellation boundaries for model calls
- a single llm-local service facade for callers

LLM must not absorb:

- turn scheduling
- audio handoff policy
- state transitions
- prompt/rule retrieval
- feedback-rule intensity compilation
- expression parsing
- tool execution or tool lifecycle events
- TTS or renderer adapters
- screenshot capture mechanics

---

## Position In The Stack

The intended stack is:

1. caller assembles prompt materials and route choice
2. caller invokes `packages/llm`
3. `packages/llm` selects a provider/profile
4. provider emits normalized llm-local output
5. caller decides what to do with that output

For Echo v0.1, the main callers are expected to be:

- `TurnOrchestrator` hidden intent routing
- `TurnOrchestrator` quick-reaction generation
- `TurnOrchestrator` primary response streaming
- later ambient presence generation
- later tool-aware primary reasoning

Current status:

- the llm foundation layer is implemented
- `TurnOrchestrator` already calls into `LLMService` for quick reaction and
  primary response generation
- the official OpenAI Responses provider now exists as the first cloud-heavy
  provider family
- the next missing layer is the local fast path

---

## Core Objects

The llm package should converge on these core objects:

- `LLMRouteKind`
- `LLMMessage`
- `LLMRequestContext`
- `LLMGenerationConfig`
- `LLMConversationInput`
- `LLMTextDelta`
- `LLMCompletion`
- `LLMIntentRouteDecision`
- `LLMProviderError`
- `LLMProviderPort`
- `LLMProviderRegistry`
- `LLMService`

---

## Hybrid Topology

Echo's intended llm topology is:

1. a local hidden routing decision
2. a local visible quick reaction
3. a local or cloud primary response depending on turn class
4. a later cloud-heavy tool-aware reasoning path
5. a later local-first ambient presence path

The local model exists to keep the agent visibly alive while the heavier path
is still running.

The cloud model exists to handle:

- stronger open-ended response quality
- deeper reasoning
- later tool-aware action loops

`packages/llm` owns the provider-neutral route layer for that topology. It does
not own the turn startup policy that decides when those routes are invoked.

---

## Route Model

The llm architecture should recognize five Echo-owned route kinds.

### `intent_routing`

Hidden local decision route.

Typical constraints:

- one-shot structured output
- strict short timeout
- not user-visible by itself
- used to classify a turn into one of Echo's allowed fast-path or cloud paths

### `quick_reaction`

Short, low-latency visible filler.

Typical constraints:

- one-shot or very short output
- short timeout
- low commitment
- local-first by default

### `primary_response`

Primary answer generation.

Typical constraints:

- ordered text deltas when streaming
- preserved raw text
- may include expression tags that are still parser-owned later
- may use either a local lightweight profile or a cloud profile

### `primary_tool_reasoning`

Reserved route for later tool-aware reasoning.

Important:

- this route must remain subordinate to `docs/protocol/reasoning-tool-loop.md`
- `packages/llm` may normalize model output for this route
- `packages/llm` must not own tool execution semantics
- this route is expected to stay cloud-heavy in early versions

### `ambient_presence`

Later proactive standby route.

Typical constraints:

- low-priority
- local-first
- optionally no-op
- bounded by cooldown and anti-interruption rules at higher layers

---

## Dependency Direction

The intended dependency direction is:

- `packages/orchestrator` may depend on `packages/llm`
- `packages/llm` may depend on `packages/protocol` only where protocol types are
  the correct external boundary
- `packages/llm` must not depend on:
  - `packages/runtime`
  - `packages/tts`
  - `packages/renderer`

This keeps model transport logic from absorbing turn progression or playback
ownership.

---

## First Responsive Demo Boundary

For the first responsive text-input demo, the llm architecture needs to
guarantee:

- one hidden local routing path
- one local quick-reaction path
- one typed primary-response generation path
- one cloud provider path that really works
- deterministic scripted providers for tests and local integration

It does not require before first responsive demo:

- ambient presence in production flow
- screenshot multimodal input
- full tool-aware reasoning
- memory injection
- plugin catalogs
- provider hot reload
- multi-provider fallback chains

Those are later layers.

---

## Concrete Provider Families

Implemented:

- official OpenAI Responses API

Planned next:

- one local OpenAI-compatible provider family

The first approved backend reference for that local family is:

- `docs/reference/approved/sglang-local-fast-path.md`

This does not prevent later addition of:

- other provider families
- other OpenAI-compatible backends
- later multimodal local adapters
