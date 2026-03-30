# AGENTS.md

不要做无谓的防御性编程/兜底代码（fallback），而是let it crash，fail fast。

## Project Identity
Echo is an open-source low-latency Agent Runtime for real-time companion experiences.

This repository is runtime-first, not app-first.
Core priorities:
1. protocol correctness
2. deterministic state transitions
3. low-latency orchestration
4. interrupt safety
5. expression/memory/plugin extensibility

---

## Source of Truth
When instructions conflict, follow this order:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/*.md`
3. the current task card
4. existing code
5. README / comments

Do not invent behavior that is not defined in the above sources.

---

## Non-Negotiable Rules
- Do not guess missing files, APIs, fields, or behavior.
- Do not change architecture unless the task explicitly requires it.
- Do not silently introduce new dependencies.
- Do not modify public protocol semantics without updating protocol docs.
- Do not claim something is implemented unless it is actually implemented and verifiable.
- Do not pass ad-hoc dict payloads across core package boundaries.
- Do not bypass the state machine, orchestrator, or protocol layer.
- Prefer fail-fast behavior over fallback, placeholder, shell, or silent
  degradation paths.
- If a required UI/runtime dependency, model asset, or control-plane contract is
  missing or invalid, surface an explicit error and stop instead of continuing
  in a degraded mode.



### Local Mirrored-Source Adaptation Exception
Echo also permits one narrow direct-inspection exception for proven local
reference mirrors under `docs/reference/*`.

This exception exists to reduce hallucination when Echo is intentionally
adapting already-validated solutions, but it is not a general permission to
translate external code into Echo.

Direct inspection and local quotation are allowed.

2. the mirrored source is local under:
   - `docs/reference/open-yachiyo-main`
   - `docs/reference/airi-main`






## Repository Guidance
Core packages must respect package boundaries:

- `packages/protocol`: typed contracts only
- `packages/runtime`: lifecycle/session/event flow entrypoints
- `packages/orchestrator`: scheduling, interruption, handoff, queue coordination
- `packages/stt`: VAD/STT adapters
- `packages/tts`: chunking, TTS adapters, playback queue
- `packages/memory`: memory/rule retrieval and write strategies
- `packages/renderer`: renderer abstraction and adapters
- `packages/plugin-sdk`: plugin hooks and manifests

Do not move logic across these boundaries without explicit approval.

---

## Core Documents
Always check the relevant protocol documents before implementing:

- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/protocol/feedback-rules.md`
- `docs/protocol/orchestrator-spec.md`

If a behavior is not defined there, do not invent it.

---

## Validation Expectations
For any non-trivial change:
- preserve strong typing
- preserve Pydantic v2 style in protocol code
- preserve explicit enums
- preserve interruptibility fields on chunk models
- preserve UTC-aware datetimes
- preserve deterministic transition rules

When relevant, propose tests or validations.



