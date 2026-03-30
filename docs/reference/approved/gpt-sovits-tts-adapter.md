# Reference Intake: gpt-sovits-tts-adapter

## Scope
- Study only the parts of `GPT-SoVITS-main` that are relevant to Echo's planned
  `packages/tts` line.
- Focus on:
  - inference API shape
  - reference-audio and prompt-text conditioning
  - streaming audio response potential
  - speed / media-type controls
  - local service deployment shape
- Exclude:
  - training pipeline internals
  - WebUI architecture
  - dataset tooling
  - model internals
  - ASR / UVR / accompaniment tooling

## What Was Studied
- `docs/reference/GPT-SoVITS-main/README.md`
- `docs/reference/GPT-SoVITS-main/api_v2.py`
- `docs/reference/GPT-SoVITS-main/api.py`
- Echo-local comparison inputs:
  - `AGENTS.md`
  - `docs/governance/ai-engineering-constitution.md`
  - `docs/protocol/events.md`
  - `docs/protocol/orchestrator-spec.md`

## Potentially Reusable Ideas
- Treating GPT-SoVITS as an external local TTS backend service behind an
  Echo-owned provider adapter.
- Using typed voice identity that conceptually contains:
  - reference audio
  - prompt text
  - prompt language
  - optional auxiliary reference audio
- Supporting streaming audio output at the provider boundary and normalizing it
  into Echo-owned fragment models.
- Exposing explicit speed/media controls through a narrow typed config rather
  than hiding them in global state.
- Keeping local high-speed TTS as the first demo path.

## Reference-Only Ideas
- The exact HTTP endpoint and payload shape in `api_v2.py`.
- Legacy `api.py` behavior around default reference voice switching.
- Detailed generation knobs such as:
  - `top_k`
  - `top_p`
  - `temperature`
  - `fragment_interval`
  - `parallel_infer`
  - `sample_steps`
- Model-weight switching endpoints and WebUI launch flow.

## Forbidden To Copy
- Any direct reuse of GPT-SoVITS source structure or API implementation,
  including:
  - `api_v2.py`
  - `api.py`
  - `GPT_SoVITS/TTS_infer_pack/*`
  - WebUI or launcher code
- Any direct copying of request/response models, transport handlers, or global
  model-state management semantics into Echo.
- Any design move that embeds GPT-SoVITS training, dataset, ASR, or WebUI
  concerns into `packages/tts`.

## Compatibility With Echo
- aligned:
  - Echo needs a local TTS backend for the first demo and GPT-SoVITS is
    directly suitable as a local inference service.
  - Echo's `packages/tts` boundary can naturally treat GPT-SoVITS as an
    external provider behind an adapter.
  - GPT-SoVITS streaming output is compatible in spirit with Echo's need for
    chunked playback and lifecycle reconciliation.
  - Reference audio and prompt text fit Echo having an explicit typed
    voice-profile concept.
- conflicts:
  - GPT-SoVITS examples often rely on raw file paths and backend-specific HTTP
    payloads; Echo must not leak those directly above `packages/tts`.
  - GPT-SoVITS does not define Echo's playback lifecycle, interrupt safety, or
    audio ownership semantics; those remain Echo-owned.
  - GPT-SoVITS includes much more than TTS inference, but Echo's first TTS line
    must stay narrowly focused on synthesis and playback-facing adapter
    concerns.

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs and this note.
- Do not code directly from the external repository structure or source files.
- If Echo adopts GPT-SoVITS for the first TTS provider, treat it as:
  - an external local TTS inference service
  - reached through an Echo-owned provider adapter
  - configured through explicit typed config
- Do not import or mirror GPT-SoVITS internal Python modules into Echo.
- Before implementation, define Echo-local docs for:
  - TTS contracts
  - provider port and registry rules
  - voice-profile boundary
  - playback/chunking semantics
