# Task Card 0041

## Title
Implement the first local OpenAI-compatible fast-path provider in `packages/llm`

## Role
Implementer

## Goal
Add the first concrete local fast-path provider family on top of Echo's llm
foundation, using an OpenAI-compatible HTTP interface suitable for backends such
as sglang.

This task should make `packages/llm` capable of serving:

- hidden `intent_routing`
- visible `quick_reaction`
- optional local lightweight `primary_response`
- optional one-shot `ambient_presence`

through one Echo-owned provider adapter without leaking backend transport
details above `packages/llm`.

## Scope Clarification
This is the first local fast-path provider task.

It should add one real local provider transport family to `packages/llm`, but
it must still remain:

- llm-local
- provider-family specific, not backend-global
- adapter-agnostic above the provider port
- free of orchestrator/runtime redesign
- free of TTS / renderer / STT work

This task must not:

- import or mirror backend internal Python modules
- redesign the existing OpenAI Responses cloud provider
- redefine Echo's route semantics around backend quirks

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
- `docs/llm/hybrid-topology.md`
- `docs/llm/local-fast-path.md`
- `docs/llm/openai-compatible-local-provider.md`
- `docs/llm/ambient-presence.md`
- `docs/llm/roadmap.md`
- `docs/reference/approved/sglang-local-fast-path.md`
- the completed `packages/llm/*` implementation from tasks 0037, 0039, and 0040

## Files To Create Or Modify
- `packages/llm/openai_compatible_local_provider.py`
- `packages/llm/service.py`
- `packages/llm/registry.py`
- `tests/llm/test_openai_compatible_local_provider.py`
- `tests/llm/test_service.py`
- `tests/llm/test_registry.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/llm/models.py`
- `packages/llm/provider_ports.py`
- `packages/llm/errors.py`

Do not modify orchestrator, runtime, protocol, TTS, renderer, or STT files in
this task.

## Hard Requirements
1. Implement one concrete local provider adapter that satisfies the existing `LLMProviderPort` and targets an OpenAI-compatible local HTTP interface.
2. The adapter must be Echo-owned and backend-agnostic at the family level. It may use the approved sglang note as reference, but it must not copy backend internal modules, request managers, schedulers, or parser logic.
3. Add typed provider-local config at minimum for:
   - provider key identity
   - base URL
   - model name
   - request timeout
   - any narrow auth/header config that is strictly required by the local OpenAI-compatible seam
4. Do not load environment variables inside the provider adapter. All config must remain explicit and constructor-injected.
5. Do not add a third-party HTTP dependency unless the repository already carries it and the task context explicitly justifies it. Prefer stdlib transport or a narrow injected transport seam.
6. Implement a provider-local raw transport seam or helper layer so tests can run without real network calls.
7. Implement request encoding from `LLMConversationInput` into the chosen local OpenAI-compatible request family for:
   - one-shot hidden `intent_routing`
   - one-shot `quick_reaction`
   - optional local lightweight `primary_response`
   - one-shot `ambient_presence`
8. The provider must normalize hidden routing output into the typed `LLMIntentRouteDecision` surface. Do not leak raw backend schema above the provider boundary.
9. If the chosen local family supports local primary streaming, you may implement streaming `primary_response`; if not, you must explicitly reject unsupported local streaming paths with typed llm-local failures. Do not silently fake streaming.
10. Preserve ordered messages and explicit instruction fields when encoding requests. Do not move prompt compilation into this provider.
11. Preserve raw visible text exactly. Do not strip expression tags or rewrite whitespace beyond what is required for transport decoding.
12. Implement typed error mapping from raw transport/provider failures into the existing llm-local error surface. Handle at minimum:
    - malformed provider payloads
    - timeout
    - cancellation
    - connection/provider unavailable
    - unsupported capability mismatches
13. The adapter must not emit protocol events or mutate orchestrator/runtime state.
14. The adapter must be usable through the existing `LLMProviderRegistry` and `LLMService` without redesigning those layers.
15. Update the service/registry tests as needed to prove the new provider can serve hybrid routes through the existing llm foundation, not only in isolation.
16. Tests must not hit the real network. Use fake raw responses, fake streamed event sequences, or a fake transport double.
17. Allowed and expected size: write a substantial concrete adapter, not a thin compatibility wrapper. A reasonable target is **1000-1700 lines of non-test Python** across the allowed `packages/llm` files.

## Explicitly Out Of Scope
- direct code reuse from `docs/reference/sglang-main`
- vLLM-specific implementation work without a separate approved reference note
- orchestrator hybrid startup policy
- tool-aware `primary_tool_reasoning`
- screenshot multimodal input
- prompt compiler implementation
- runtime redesign
- TTS / renderer / STT code
- app/demo shell code
- multi-provider fallback or retry orchestration

## Validation Expectations
1. Add provider-focused tests for typed config validation and constructor behavior.
2. Add tests proving hidden `intent_routing` generation returns a valid typed `LLMIntentRouteDecision`.
3. Add tests proving one-shot `quick_reaction` generation works through fake transport payloads.
4. Add tests for local lightweight `primary_response` support or explicit typed rejection if streaming is not supported.
5. Add tests for `ambient_presence` generation through the same provider family.
6. Add tests proving raw visible text is preserved exactly, including expression-tag-like text.
7. Add tests for malformed payloads, timeout/cancellation, and unsupported route/capability mapping.
8. Add at least one `LLMService` integration test that routes through the registry into the new provider adapter.
9. Run the llm provider tests plus the existing llm service/registry/model regression tests that cover the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/llm` contains one real local OpenAI-compatible provider family
- the provider supports hidden routing and quick reaction through typed Echo-owned surfaces
- the provider can be exercised through the existing registry/service boundary
- no backend internal modules or backend-specific architecture were copied into Echo
- tests prove deterministic behavior without real network I/O
