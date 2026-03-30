# Task Card 0037

## Title
Implement `packages/llm` foundation and service shell

## Role
Implementer

## Goal
Create the first real `packages/llm` package with typed llm-local contracts,
provider ports, provider registry, a caller-facing llm service shell, and a
deterministic scripted provider for tests.

## Scope Clarification
This task is the llm foundation layer.

It should make `packages/llm` real and usable by later orchestrator work, but
it must still remain:

- provider-agnostic
- network-free
- transport-free
- demo-oriented

This task must not guess any concrete provider API.

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/reasoning-tool-loop.md`
- `docs/protocol/feedback-rules.md`
- `docs/llm/README.md`
- `docs/llm/architecture.md`
- `docs/llm/contracts.md`
- `docs/llm/prompt-boundary.md`
- `docs/llm/provider-interface.md`
- `docs/llm/streaming-and-routes.md`
- `docs/llm/routing-config.md`
- `docs/llm/error-handling.md`
- `docs/llm/demo-path.md`
- `docs/llm/roadmap.md`
- `packages/orchestrator/turn_orchestrator.py`

## Files To Create Or Modify
- `packages/llm/models.py`
- `packages/llm/errors.py`
- `packages/llm/provider_ports.py`
- `packages/llm/registry.py`
- `packages/llm/service.py`
- `packages/llm/scripted_provider.py`
- `tests/llm/test_models.py`
- `tests/llm/test_registry.py`
- `tests/llm/test_service.py`

## Hard Requirements
1. Implement the llm-local typed model family in Pydantic v2 style with `extra="forbid"` and immutable semantics where appropriate.
2. Lock route kinds to exactly:
   - `quick_reaction`
   - `primary_response`
   - `primary_tool_reasoning`
3. Implement typed request-side contracts at minimum for:
   - message role
   - message
   - request context
   - generation config
   - conversation input
4. Implement typed output-side contracts at minimum for:
   - text delta
   - completion summary
   - usage snapshot
   - reserved tool-call intent model
5. Implement a normalized typed llm failure model and provider error code enum that matches the llm docs.
6. Implement one unified provider port that supports:
   - one-shot generation
   - streaming generation
   - capability inspection
7. Implement a typed provider registry that resolves route/profile/provider explicitly and rejects unknown bindings clearly.
8. Implement a caller-facing `LLMService` above the registry/provider port that exposes at least:
   - generic route-driven entrypoints
   - one convenience surface for quick reaction generation
   - one convenience surface for primary response streaming
9. Streaming text must preserve raw text exactly and must not strip expression tags that belong to `ExpressionParser`.
10. Add a deterministic scripted provider for tests and local development. It must not use network I/O or provider-specific transport logic.
11. Do not emit protocol events from `packages/llm`.
12. Do not mutate orchestrator or runtime state from `packages/llm`.
13. Do not absorb prompt compilation into this task. `packages/llm` may consume already-assembled instruction strings and ordered messages only.
14. Allowed and expected size: write a substantial implementation, not a stub. A reasonable target is **900-1500 lines of non-test Python** across the allowed `packages/llm` files.

## Explicitly Out Of Scope
- any concrete HTTP/WebSocket/OpenAI/OpenAI-compatible provider transport
- environment-variable loading or YAML config format
- prompt compiler implementation
- tool execution implementation
- orchestrator integration
- runtime integration
- TTS / renderer / STT code

## Validation Expectations
1. Add tests for model validation and locked enums.
2. Add tests for registry resolution and failure on unknown routes/providers/profiles.
3. Add tests for `LLMService` one-shot and streaming delegation.
4. Add tests proving raw streamed text is preserved exactly.
5. Add tests for scripted provider deterministic behavior.
6. Run the new llm test files plus any minimal dependent regression tests required by the touched files.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `packages/llm` exists as a real package area with typed contracts, provider ports, registry, service, and scripted provider
- no concrete provider transport assumptions were introduced
- the llm service can serve a quick-reaction route and a primary-response route through the scripted provider
- failures are normalized to typed llm-local surfaces
- tests prove deterministic behavior and preserve raw streamed text
