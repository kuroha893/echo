# LLM Development Docs

This directory is the development doc set for `packages/llm`.

Its purpose is to define Echo's llm line as a hybrid local/cloud system before
the demo-facing adapter work begins, so later implementation can move quickly
without inventing routing, presence, or fast-path behavior task by task.

These docs do not replace:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/orchestrator-spec.md`
3. `docs/protocol/reasoning-tool-loop.md`
4. `docs/protocol/feedback-rules.md`

They explain how `packages/llm` should be built on top of those rules.

---

## Scope

`packages/llm` owns:

- llm-local request/response contracts
- provider-neutral generation ports
- route-aware provider selection for:
  - `intent_routing`
  - `quick_reaction`
  - `primary_response`
  - later `primary_tool_reasoning`
  - later `ambient_presence`
- normalized streaming text deltas
- normalized hidden routing decisions
- provider capability checks
- provider error normalization
- timeout / cancellation boundaries for model calls
- one local llm service facade above provider ports

`packages/llm` does not own:

- prompt/rule compilation logic
- session state transitions
- orchestrator scheduling policy
- tool execution
- expression parsing
- TTS / renderer behavior
- persistence / replay
- screenshot capture mechanics

---

## Current Status

Implemented and accepted:

- `packages/llm/models.py`
- `packages/llm/errors.py`
- `packages/llm/provider_ports.py`
- `packages/llm/registry.py`
- `packages/llm/service.py`
- `packages/llm/scripted_provider.py`
- `packages/llm/openai_responses_provider.py`
- `packages/llm/openai_compatible_local_provider.py`
- deterministic route-aware llm foundation with provider-neutral contracts
- llm-service integration inside `TurnOrchestrator` for:
  - `quick_reaction`
  - `primary_response`
- one concrete cloud-oriented provider family:
  - official OpenAI Responses API
- hybrid-route llm foundation with:
  - `intent_routing`
  - `ambient_presence`
  - `LLMIntentRouteDecision`
- one concrete local fast-path provider family:
  - local OpenAI-compatible provider adapter

Current llm mainline:

- hybrid orchestrator startup policy for the first responsive demo

Still deferred until after the hybrid llm line exists:

- tool-aware `primary_tool_reasoning`
- TTS adapter work
- renderer / Live2D / VTube adapter work
- STT adapter work

---

## Document Map

- [architecture.md](/C:/Users/123/Desktop/echo/docs/llm/architecture.md): package boundaries, object model, and hybrid stack placement
- [contracts.md](/C:/Users/123/Desktop/echo/docs/llm/contracts.md): llm-local request, response, routing, and error models
- [prompt-boundary.md](/C:/Users/123/Desktop/echo/docs/llm/prompt-boundary.md): what llm may consume from prompt assembly and what it must not absorb
- [provider-interface.md](/C:/Users/123/Desktop/echo/docs/llm/provider-interface.md): provider ports, registry rules, and cancellation semantics
- [streaming-and-routes.md](/C:/Users/123/Desktop/echo/docs/llm/streaming-and-routes.md): route-specific behavior for hidden routing, quick reaction, primary response, and later tool-aware reasoning
- [routing-config.md](/C:/Users/123/Desktop/echo/docs/llm/routing-config.md): model profile, provider binding, and hybrid route mapping rules
- [error-handling.md](/C:/Users/123/Desktop/echo/docs/llm/error-handling.md): llm-local failure classes and how they surface upstream
- [demo-path.md](/C:/Users/123/Desktop/echo/docs/llm/demo-path.md): the shortest llm path toward the first text-input responsive demo
- [openai-responses-provider.md](/C:/Users/123/Desktop/echo/docs/llm/openai-responses-provider.md): the first concrete cloud provider family already implemented
- [hybrid-topology.md](/C:/Users/123/Desktop/echo/docs/llm/hybrid-topology.md): the intended local-fast-path and cloud-heavy llm topology
- [local-fast-path.md](/C:/Users/123/Desktop/echo/docs/llm/local-fast-path.md): latency-oriented local-model responsibilities and fallback rules
- [openai-compatible-local-provider.md](/C:/Users/123/Desktop/echo/docs/llm/openai-compatible-local-provider.md): the planned local provider family for sglang-like backends
- [ambient-presence.md](/C:/Users/123/Desktop/echo/docs/llm/ambient-presence.md): standby and proactive presence behavior boundaries
- [multimodal-screenshot-input.md](/C:/Users/123/Desktop/echo/docs/llm/multimodal-screenshot-input.md): future user-triggered screenshot question boundary
- [hybrid-orchestrator-integration.md](/C:/Users/123/Desktop/echo/docs/llm/hybrid-orchestrator-integration.md): the intended orchestrator startup policy over the new hybrid llm routes
- [roadmap.md](/C:/Users/123/Desktop/echo/docs/llm/roadmap.md): phased task order for llm work

---

## LLM Invariants

All future llm work should obey these invariants:

- `packages/llm` is adapter-agnostic at foundation level
- route semantics belong to Echo, not to any single provider API
- raw model text is preserved until `ExpressionParser` decides what is text vs tag
- hidden routing output is normalized into Echo-owned contracts before leaving `packages/llm`
- provider failures are normalized before leaving `packages/llm`
- `packages/llm` never emits protocol events or mutates session state directly
- tool-aware model output must eventually feed `reasoning-tool-loop.md`, not bypass it
- screenshot input, when added later, must stay explicitly user-triggered rather than autonomous

---

## Practical Handoff

For the first responsive demo-oriented mainline, the repo should now proceed in
this order:

1. hybrid llm route expansion
2. local fast-path provider family
3. hybrid orchestrator/llm startup policy
4. TTS adapter line
5. renderer / Live2D line

The official OpenAI Responses provider is now the cloud/background path and the
local OpenAI-compatible provider is now the fast-path transport. The next llm
milestone is no longer provider transport. It is the orchestrator startup
policy that actually uses the hybrid route topology.
