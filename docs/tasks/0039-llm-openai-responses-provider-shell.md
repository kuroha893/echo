# Task Card 0039

## Title
Implement the first concrete OpenAI Responses provider shell in `packages/llm`

## Role
Implementer

## Goal
Add the first real network-capable llm provider adapter on top of the already
implemented llm foundation, using the official OpenAI Responses API as Echo's
first demo-oriented provider family.

This task should make `packages/llm` capable of serving:

- `quick_reaction` through one-shot generation
- `primary_response` through streaming generation

without changing Echo-owned route semantics or leaking raw provider transport
details above the llm package boundary.

## Scope Clarification
This is the first concrete provider task.

It should add one real provider transport family to `packages/llm`, but it must
still remain:

- llm-local
- provider-family specific, not provider-global
- text-only
- adapter-agnostic above the provider port
- free of TTS / renderer / runtime redesign

This task must not redesign the llm foundation from task 0037 or the
orchestrator integration from task 0038.

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
- `docs/llm/error-handling.md`
- `docs/llm/demo-path.md`
- `docs/llm/openai-responses-provider.md`
- `docs/llm/roadmap.md`
- the completed `packages/llm/*` implementation from task 0037
- the completed `packages/orchestrator/turn_orchestrator.py` integration from task 0038

## Files To Create Or Modify
- `packages/llm/openai_responses_provider.py`
- `packages/llm/errors.py`
- `packages/llm/service.py`
- `tests/llm/test_openai_responses_provider.py`
- `tests/llm/test_service.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `packages/llm/models.py`
- `packages/llm/provider_ports.py`

Do not modify orchestrator or runtime files in this task.

## Hard Requirements
1. Implement one concrete provider adapter that satisfies the existing `LLMProviderPort` and targets the official OpenAI Responses API family.
2. Keep the adapter text-only. Do not implement images, audio, structured tool execution, or provider-side memory in this task.
3. Add typed provider-local config at minimum for:
   - provider key identity
   - base URL
   - API key
   - request timeout
   - optional organization/project-like header fields only if the chosen transport needs them
4. Do not load environment variables inside the provider adapter. All config must remain explicit and constructor-injected.
5. Do not add a third-party HTTP dependency unless the repository already carries it and the existing task context explicitly justifies it. Prefer stdlib transport or a narrow injected transport seam.
6. Implement a provider-local raw transport seam or helper layer so tests can run without real network calls.
7. Implement request encoding from `LLMConversationInput` into official Responses request payloads for:
   - one-shot `quick_reaction`
   - streaming `primary_response`
8. Preserve ordered messages and explicit instruction fields when encoding requests. Do not move prompt compilation into this provider.
9. Implement one-shot decoding that returns a valid typed `LLMCompletion`.
10. Implement streaming decoding that yields:
    - ordered `LLMTextDelta`
    - exactly one terminal `LLMCompletion`
11. Raw output text must be preserved exactly. Do not strip expression tags, normalize markdown, or rewrite whitespace beyond what is required for transport decoding.
12. Implement typed error mapping from raw transport/provider failures into the existing llm-local error surface. Handle at minimum:
    - authentication failures
    - rate limiting
    - timeout
    - cancellation
    - malformed provider payloads
    - unsupported route/capability mismatches
13. The provider adapter must not emit protocol events or mutate orchestrator/runtime state.
14. The provider adapter must be usable through the existing `LLMProviderRegistry` and `LLMService` without redesigning those layers.
15. Update `tests/llm/test_service.py` as needed to prove the new provider can be used through the service/registry path, not only in isolation.
16. Tests must not hit the real network. Use fake raw responses, fake streamed event sequences, or a fake transport double.
17. Allowed and expected size: write a substantial concrete adapter, not a stub. A reasonable target is **900-1500 lines of non-test Python** across the allowed `packages/llm` files.

## Explicitly Out Of Scope
- OpenAI SDK integration if it adds a new dependency not already present
- environment-variable loading
- YAML or TOML config loading
- tool-aware `primary_tool_reasoning`
- prompt compiler implementation
- orchestrator/runtime redesign
- TTS / renderer / STT code
- app/demo shell code
- multi-provider fallback or retry orchestration

## Validation Expectations
1. Add provider-focused tests for typed config validation and constructor behavior.
2. Add tests proving one-shot quick-reaction generation works through fake transport payloads.
3. Add tests proving streaming primary-response generation yields ordered deltas and exactly one terminal completion.
4. Add tests proving raw streamed text is preserved exactly, including expression-tag-like text.
5. Add tests for malformed streamed payloads and duplicate/missing terminal completion failure.
6. Add tests for authentication/rate-limit/timeout/cancellation error mapping.
7. Add at least one `LLMService` integration test that routes through the registry into the new provider adapter.
8. Run the llm provider tests plus the existing llm service/registry regression tests that cover the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/llm` contains one real OpenAI Responses provider adapter
- the adapter supports one-shot quick reaction and streaming primary response
- llm-local text preservation and typed failure normalization remain intact
- the adapter is testable without real network I/O
- the adapter can be exercised through the existing registry/service boundary
