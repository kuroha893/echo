# Task Card 0042

## Title
Implement hybrid llm startup selection in `packages/orchestrator/turn_orchestrator.py`

## Role
Implementer

## Goal
Upgrade `TurnOrchestrator` from "quick reaction plus one primary llm path" to
the first real hybrid llm startup policy.

This task should make `TurnOrchestrator`:

- run hidden local `intent_routing`
- keep local `quick_reaction` independent
- choose between local and cloud `primary_response` profiles
- preserve all existing parser, audio-mutex, interrupt, protocol-event, and
  runtime-bridge semantics

without activating `primary_tool_reasoning` yet.

## Scope Clarification
This is the first orchestrator-side hybrid llm task.

It should consume the llm foundation from tasks 0040 and 0041, but it must
still remain:

- orchestrator-owned policy
- llm-service driven
- tool-free
- adapter-free

This task must not:

- redesign runtime
- activate tool-aware reasoning
- implement ambient standby loops
- implement screenshot multimodal input
- start TTS / renderer adapter work

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
- `docs/llm/routing-config.md`
- `docs/llm/error-handling.md`
- `docs/llm/demo-path.md`
- `docs/llm/hybrid-topology.md`
- `docs/llm/local-fast-path.md`
- `docs/llm/openai-compatible-local-provider.md`
- `docs/llm/hybrid-orchestrator-integration.md`
- `docs/llm/roadmap.md`
- the completed `packages/llm/*` implementation from tasks 0037 through 0041
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_audio_mutex.py`
- `tests/orchestrator/test_turn_orchestrator.py`

## Files To Create Or Modify
- `packages/orchestrator/audio_mutex.py`
- `packages/orchestrator/turn_orchestrator.py`
- `tests/orchestrator/test_turn_orchestrator.py`

If a narrowly scoped support edit is strictly required to preserve type
correctness, you may also modify:

- `tests/orchestrator/test_audio_mutex.py`

Do not modify runtime, protocol, TTS, renderer, STT, or app files in this
task.

## Hard Requirements
1. Extend `OrchestratorConfig` with explicit optional llm profile-key fields for the hybrid startup policy. At minimum it must be possible to distinguish:
   - hidden intent-routing profile
   - quick-reaction profile
   - local primary-response profile
   - cloud primary-response profile
2. Add orchestrator-local llm request assembly for `intent_routing` using typed `LLMService` surfaces from tasks 0040 and 0041.
3. Hidden routing must remain internal only. It must not emit user-visible text, protocol events, renderer commands, or TTS chunks.
4. Quick reaction must remain independent from hidden routing startup. The orchestrator must not wait for quick reaction before attempting the hidden routing decision.
5. Primary path selection must follow the documented first mapping:
   - `action_feedback` -> prefer local primary-response profile; if unavailable, fall back to cloud primary-response profile
   - `local_chat` -> prefer local primary-response profile; if unavailable, fall back to cloud primary-response profile
   - `cloud_primary` -> use cloud primary-response profile
   - `cloud_tool` -> explicitly degrade to cloud primary-response profile until tool-aware reasoning is implemented
6. If hidden routing fails, times out, or returns an unusable result, the safe fallback path is cloud primary-response when configured; otherwise fall back to the existing default primary-response route behavior.
7. Preserve the public primary llm route as `LLMRouteKind.PRIMARY_RESPONSE`. This task chooses profiles, not a new visible primary route kind.
8. Preserve all existing parser and audio-mutex behavior. Local primary-response output must still flow through the same `_consume_primary_chunks(...)` path and must not bypass `ExpressionParser`.
9. Preserve all existing protocol-event emission semantics on the primary and quick-reaction paths. Do not invent new protocol events for hidden routing in this task.
10. Preserve interrupt, playback-lifecycle, runtime-bridge, and outbox semantics already implemented in `TurnOrchestrator`.
11. Do not activate `primary_tool_reasoning` in this task. `cloud_tool` only maps to a safe cloud primary-response fallback.
12. Do not implement `ambient_presence` in this task.
13. Tests must use deterministic llm providers and explicit profile routing. No real network/provider transport assumptions are allowed.
14. Allowed and expected size: this should be a substantial orchestrator integration task, not a profile-key stub. A reasonable target is **700-1200 lines of non-test Python** across the allowed files.

## Explicitly Out Of Scope
- any runtime redesign
- any new protocol events or protocol schema changes
- tool-aware `primary_tool_reasoning`
- ambient standby generation
- screenshot multimodal handling
- TTS / renderer / STT adapter work
- app/demo shell code
- memory / plugin integration

## Validation Expectations
1. Add tests proving hidden routing can choose the local primary-response profile.
2. Add tests proving hidden routing can choose the cloud primary-response profile.
3. Add tests proving `cloud_tool` degrades explicitly to the cloud primary-response profile.
4. Add tests proving hidden routing failure or timeout falls back safely to the cloud primary path or existing default path.
5. Add tests proving quick reaction still proceeds independently and remains llm-backed.
6. Add tests proving primary output still preserves raw text and still flows through the existing parser/audio path.
7. Add tests proving no new protocol events are emitted for hidden routing and that the existing primary protocol-event order does not drift.
8. Re-run the orchestrator regression suite that covers turn handling, interrupt behavior, playback bridge behavior, and protocol-event outbox behavior.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `TurnOrchestrator` uses hidden routing to choose between local and cloud primary profiles
- quick reaction remains independent and low-latency
- all existing parser/audio/protocol/runtime bridge semantics remain intact
- `cloud_tool` is handled through an explicit temporary fallback rather than silent guesswork
- tests prove deterministic hybrid startup behavior without real network calls
