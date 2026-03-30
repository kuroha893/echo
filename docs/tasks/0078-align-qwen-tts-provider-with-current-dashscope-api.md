# Task Card 0078

## Title
Align active Qwen TTS provider with the current DashScope production API contract

## Role
Implementer

## Goal
Fix the active production TTS path so Echo's Qwen TTS provider aligns to the
current official DashScope contracts and can successfully support **both**
production synthesis modes:

- system voice synthesis
- cloned-voice synthesis backed by official voice enrollment/customization

instead of sending a provider-rejected payload.

## Scope Clarification
This task is a narrow active-production provider-alignment fix.

It must:

- distinguish the current official DashScope paths for:
  - system voice synthesis
  - voice enrollment / customization
  - cloned-voice synthesis
- align Echo's active production synthesis support to the real official
  contracts for both synthesis modes
- align active voice enrollment to the corresponding official contract
- keep the production provider settings surface coherent with the corrected
  contract(s)

It must not:

- redesign TTS package boundaries
- redesign voice enrollment architecture
- redesign browser or desktop layout
- modify protocol semantics
- add demo/stub/fallback TTS behavior

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tts/README.md`
- `docs/tts/qwen3-voice-clone-provider.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- completed implementations/reports from tasks72 through 77
- user-provided official DashScope example for system-voice synthesis via
  `dashscope.MultiModalConversation.call(...)`
- user-provided official DashScope example for voice enrollment via:
  - `POST /api/v1/services/audio/tts/customization`
  - `model="qwen-voice-enrollment"`
  - `target_model="qwen3-tts-vc-2026-01-22"`
- user-provided official DashScope example for cloned-voice synthesis via
  `dashscope.MultiModalConversation.call(...)` with the enrolled `voice`
- active implementation files under:
  - `packages/tts/qwen3_voice_clone_provider.py`
  - `packages/tts/models.py`
  - `packages/tts/errors.py`
  - `apps/desktop-live2d/python/provider_settings.py`
  - `apps/web-ui/public/config_surface.mjs`
  - `apps/web-ui/public/provider_settings_helpers.mjs`

## Files To Create Or Modify
- `packages/tts/qwen3_voice_clone_provider.py`
- `apps/desktop-live2d/python/provider_settings.py`
- `apps/web-ui/public/config_surface.mjs` only if required to keep field labels/defaults coherent
- `apps/web-ui/public/provider_settings_helpers.mjs` only if required to keep field labels/defaults coherent
- targeted tests under `tests/` for the Qwen provider and active settings defaults
- `docs/tts/qwen3-voice-clone-provider.md` if required to document the corrected active contract

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/llm/*`
- Live2D avatar/window rendering files

## Hard Requirements
1. The implementation must explicitly separate the official DashScope contract
   buckets below, rather than continuing to treat them as one invented hybrid
   payload:
   - system voice synthesis
   - voice enrollment / customization
   - cloned-voice synthesis
2. The active production TTS line must support **both** of these synthesis
   contracts after the fix:
   - system voice synthesis
   - cloned-voice synthesis
3. System voice synthesis must target the official DashScope contract for
   standard/system voices and build the exact request URL/body shape required
   by that contract.
4. Cloned-voice synthesis must target the official DashScope contract for
   cloned/customized voices and must not continue to use a custom
   `/v1/audio/speech` payload shape.
5. Active product-path voice enrollment/customization must target the official
   customization contract rather than a fabricated Echo-local enrollment
   payload.
6. The implementation must not preserve misleading semantics where the class is
   named/structured as "voice clone" but actually sends a non-official hybrid
   request shape.
7. The active request URL construction must match the corrected official
   contract(s).
8. The active request JSON body must match the corrected official contract(s).
9. Provider defaults in active settings must be updated to values that are
   valid for the corrected contracts, including:
   - a valid system-voice-capable model
   - a valid default system voice
   - a valid cloned-voice target model where cloning is enabled
10. The task must explicitly preserve both production capabilities in the
    active path:
   - a user can synthesize with a system voice without enrollment
   - a user can synthesize with an enrolled/cloned voice after enrollment
11. If some currently exposed fields no longer map to the real contract, they
   must either:
   - be cleanly ignored and documented as inactive, or
   - be removed from the active settings surface if that can be done within this
     bounded task without redesigning layout
12. The implementation must not silently accept incompatible values such as:
   - a base URL for one DashScope contract family while posting to a different
     path family
   - a system-voice model name on a cloned-voice payload path
   - a cloned-voice-only model without a valid enrolled voice identifier
13. The production settings and runtime path must make the system-vs-cloned
    distinction explicit enough that the provider can resolve the correct
    contract deterministically at synthesis time.
14. Keep fail-fast behavior:
   - malformed or rejected TTS requests must surface as explicit provider
     errors
   - do not add canned audio, silent fallback, or fake success
15. Do not change protocol semantics or cross-package ownership boundaries.

## Explicitly Out Of Scope
- implementing a second alternate TTS provider family
- redesigning voice cloning UX
- adding realtime websocket/audio streaming support if the chosen official
  contract is still standard HTTP or SDK-style streaming only
- changing cloud primary LLM behavior
- changing local-fast-LLM behavior

## Validation Expectations
1. Add/update targeted tests proving:
   - the provider builds the corrected request URL for system voice synthesis
   - the provider builds the corrected request payload for system voice
     synthesis
   - the provider builds the corrected request URL for cloned-voice synthesis
   - the provider builds the corrected request payload for cloned-voice
     synthesis
   - the provider builds the corrected enrollment/customization URL and payload
   - a representative successful DashScope-style synthesis response is decoded
     correctly
   - a representative successful enrollment/customization response is decoded
     correctly
   - a representative rejected-payload response surfaces as a provider error
2. Re-run touched TTS/provider tests.
3. Re-run the smallest production-path validation that exercises one desktop
   text turn through:
   - cloud primary LLM
   - Qwen TTS
4. Explicitly state:
   - which official DashScope contract is used for system voice synthesis
   - which official DashScope contract is used for voice enrollment
   - which official DashScope contract is used for cloned-voice synthesis
5. The implementation report must clearly state what concrete `voice`
   identifier source is expected by the cloned-voice synthesis path:
   - preconfigured enrolled voice id
   - enrollment result persisted into settings

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- a production text turn no longer fails with `Qwen3 voice-clone provider rejected the request payload`
- the active provider payload/endpoint match the corrected official DashScope
  contracts for:
  - system voice synthesis
  - voice enrollment
  - cloned-voice synthesis
- active settings defaults no longer direct users toward an incompatible TTS
  configuration
- the implementation report explicitly distinguishes:
  - system voice synthesis
  - voice enrollment
  - cloned-voice synthesis
- both user-facing production capabilities are usable:
  - system voice without enrollment
  - cloned voice after enrollment
- no fallback audio or demo TTS behavior is reintroduced
