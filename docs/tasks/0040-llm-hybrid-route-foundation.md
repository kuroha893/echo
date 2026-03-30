# Task Card 0040

## Title
Expand `packages/llm` into the hybrid-route foundation

## Role
Implementer

## Goal
Extend the existing llm foundation so Echo's llm layer formally supports the
hybrid local/cloud route model documented in `docs/llm/`.

This task should make `packages/llm` understand:

- hidden `intent_routing`
- visible `quick_reaction`
- `primary_response`
- reserved `primary_tool_reasoning`
- later `ambient_presence`

without yet implementing a new concrete local provider family.

## Scope Clarification
This is a foundation-expansion task, not a transport task.

It should update the existing llm contracts, service, registry, scripted
provider, and current concrete provider surfaces so the repository can support
the hybrid topology cleanly before the first local fast-path backend is added.

It must not:

- redesign orchestrator startup policy
- add a new concrete local provider transport
- add screenshot multimodal payloads
- activate tool-aware reasoning

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/reasoning-tool-loop.md`
- `docs/llm/README.md`
- `docs/llm/architecture.md`
- `docs/llm/contracts.md`
- `docs/llm/provider-interface.md`
- `docs/llm/streaming-and-routes.md`
- `docs/llm/routing-config.md`
- `docs/llm/error-handling.md`
- `docs/llm/demo-path.md`
- `docs/llm/openai-responses-provider.md`
- `docs/llm/hybrid-topology.md`
- `docs/llm/local-fast-path.md`
- `docs/llm/openai-compatible-local-provider.md`
- `docs/llm/ambient-presence.md`
- `docs/llm/multimodal-screenshot-input.md`
- `docs/llm/roadmap.md`
- the completed `packages/llm/*` implementation from tasks 0037 and 0039
- the completed `packages/orchestrator/turn_orchestrator.py` integration from task 0038

## Files To Create Or Modify
- `packages/llm/models.py`
- `packages/llm/provider_ports.py`
- `packages/llm/registry.py`
- `packages/llm/service.py`
- `packages/llm/scripted_provider.py`
- `packages/llm/openai_responses_provider.py`
- `tests/llm/test_models.py`
- `tests/llm/test_registry.py`
- `tests/llm/test_service.py`
- `tests/llm/test_openai_responses_provider.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/llm/errors.py`

Do not modify orchestrator, runtime, protocol, TTS, renderer, or STT files in
this task.

## Hard Requirements
1. Expand the locked `LLMRouteKind` enum to exactly:
   - `intent_routing`
   - `quick_reaction`
   - `primary_response`
   - `primary_tool_reasoning`
   - `ambient_presence`
2. Add a locked `LLMIntentDecisionKind` enum with exactly:
   - `action_feedback`
   - `local_chat`
   - `cloud_primary`
   - `cloud_tool`
3. Add a typed hidden routing output model `LLMIntentRouteDecision` that matches the llm docs and remains llm-local, not protocol-level.
4. Keep all llm-local models in Pydantic v2 style with `extra="forbid"` and immutable semantics where appropriate.
5. Extend provider capability and route-allowance surfaces so providers can explicitly declare whether they support:
   - `intent_routing`
   - `ambient_presence`
   - structured hidden routing output
6. Extend `LLMProviderRegistry` and route/profile resolution so the new route kinds are first-class and are rejected clearly if unbound or unsupported.
7. Extend `LLMService` so it exposes:
   - route-driven handling for `intent_routing`
   - route-driven handling for `ambient_presence`
   - at least one convenience method for hidden intent routing
   - at least one convenience method for ambient presence generation
8. Hidden routing must not be modeled as raw ad hoc text above the public `packages/llm` boundary. The service must surface a typed `LLMIntentRouteDecision`.
9. Preserve raw text exactly for all visible text routes. Do not strip expression tags or normalize visible text beyond transport-decoding needs.
10. Update `scripted_provider.py` so deterministic local tests can cover:
    - hidden routing decisions
    - quick reaction
    - primary response streaming
    - ambient presence one-shot behavior
11. Update the current `OpenAIResponsesProvider` so it remains correct under the expanded route model. It must explicitly reject unsupported new routes rather than silently mis-handle them.
12. Do not redesign the existing llm foundation around provider-specific route semantics. The new hybrid routes remain Echo-owned.
13. Do not introduce multimodal request payloads in this task. Screenshot support remains planning-only.
14. Allowed and expected size: write a substantial foundation expansion, not a small enum patch. A reasonable target is **900-1500 lines of non-test Python** across the allowed `packages/llm` files.

## Explicitly Out Of Scope
- any new concrete local provider transport
- orchestrator hybrid startup policy
- runtime redesign
- prompt compiler implementation
- tool execution implementation
- TTS / renderer / STT code
- screenshot capture or multimodal input implementation
- app/demo shell code

## Validation Expectations
1. Add tests for the expanded route enums and hidden decision model validation.
2. Add tests proving registry/profile resolution works for the new route kinds and fails clearly on unknown or unsupported bindings.
3. Add tests proving `LLMService` can surface typed hidden routing decisions and ambient presence generation through the scripted provider.
4. Add tests proving the new hybrid routes do not regress raw-text preservation on visible text routes.
5. Add tests proving the current `OpenAIResponsesProvider` explicitly rejects unsupported new routes with typed llm-local failures.
6. Run the llm test suite covering the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/llm` formally supports the hybrid route model in its public typed foundation
- hidden intent routing is represented through a typed llm-local decision surface
- ambient presence is represented as a first-class route even if no concrete local backend exists yet
- the existing cloud provider remains correct and explicitly rejects unsupported hybrid routes
- the scripted provider and llm tests cover the new route family deterministically
