# Task Card 0038

## Title
Integrate `LLMService` into `packages/orchestrator/turn_orchestrator.py`

## Role
Implementer

## Goal
Replace the current llm placeholder seams inside `TurnOrchestrator` with a real
typed dependency on `LLMService`, so the orchestrator can drive:

- primary-response streaming through `packages/llm`
- optional quick-reaction generation through `packages/llm`

without changing existing protocol, parser, audio-mutex, or runtime-bridge
semantics.

## Scope Clarification
This is the first real orchestrator/llm integration slice.

It should make `TurnOrchestrator` consume the llm foundation from task 0037, but
it must not yet introduce:

- tool-aware reasoning execution
- concrete provider transport code
- runtime redesign
- TTS / renderer adapters

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/reasoning-tool-loop.md`
- `docs/protocol/events.md`
- `docs/llm/README.md`
- `docs/llm/architecture.md`
- `docs/llm/contracts.md`
- `docs/llm/provider-interface.md`
- `docs/llm/streaming-and-routes.md`
- `docs/llm/error-handling.md`
- `docs/llm/demo-path.md`
- `docs/llm/roadmap.md`
- `packages/orchestrator/turn_orchestrator.py`
- the completed `packages/llm/*` implementation from task 0037

## Files To Create Or Modify
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`
- `packages/llm/service.py`
- `tests/llm/test_service.py`

## Hard Requirements
1. Add a typed `LLMService` seam to `TurnOrchestrator` construction and storage.
2. Replace `_stream_primary_response(...)` placeholder behavior with real delegation to `LLMService` on the `primary_response` route.
3. The primary path must preserve raw streamed text exactly as received from `LLMService`; it must not strip tags or bypass the existing parser path.
4. Replace `_generate_quick_reaction(...)` placeholder behavior with llm-service delegation on the `quick_reaction` route when the service is configured.
5. If no quick-reaction result is available, the quick path may safely produce `None`; do not fabricate fallback text inside `TurnOrchestrator`.
6. If primary llm generation is requested but no llm service is configured, fail clearly and explicitly; do not keep the old hardcoded placeholder stream alive.
7. Preserve all existing protocol-event emission semantics in `turn_orchestrator.py`.
8. Preserve existing `ExpressionParser`, `AudioMutex`, interrupt shell, playback bridge, and runtime-bridge seams exactly as they are.
9. Do not add tool-aware reasoning behavior in this task. `primary_tool_reasoning` remains reserved.
10. Do not move prompt compilation into `TurnOrchestrator`. Use small caller-owned or orchestrator-local prompt assembly only as required by the current llm docs.
11. Tests must use the deterministic scripted provider from task 0037; no network/provider transport assumptions are allowed.
12. Allowed and expected size: this should be a substantial integration task, not a seam stub. A reasonable target is **900-1400 lines of non-test Python** across the allowed files.

## Explicitly Out Of Scope
- concrete provider transport implementation
- runtime bridge redesign
- tool call runtime integration
- TTS / renderer / STT adapters
- app/demo shell code
- memory / plugin integration

## Validation Expectations
1. Add tests proving the primary path now streams through `LLMService`.
2. Add tests proving quick reaction can use `LLMService` when available and stay absent when not produced.
3. Add tests proving orchestrator still emits the same protocol events/order on the primary path.
4. Add tests proving provider failure surfaces clearly and does not silently fall back to the old placeholder logic.
5. Re-run the orchestrator regression suite that covers current turn, interrupt, playback, and bridge behavior.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `TurnOrchestrator` no longer relies on the old primary-response placeholder stream
- `TurnOrchestrator` can consume `LLMService` for primary response generation
- quick reaction may also route through `LLMService` without changing existing output semantics
- no protocol or runtime boundary was bypassed
- tests cover the new llm-backed orchestrator flow using the scripted provider
