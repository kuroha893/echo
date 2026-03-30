# Reference Intake: open-yachiyo-qwen3-tts-vc

## Scope
- Study only the TTS-related parts of `open-yachiyo` that are relevant to
  Echo's first audible demo path.
- Focus on provider configuration, voice-clone provider boundaries, policy
  checks, idempotency/cancellation, and realtime-vs-non-realtime path
  selection.
- Exclude renderer internals, desktop UI structure, generic runtime loop
  design, and non-TTS provider management except where they reveal coupling
  risks.

## What Was Studied
- `docs/reference/open-yachiyo-main/apps/runtime/tooling/adapters/voice.js`
- `docs/reference/open-yachiyo-main/scripts/qwen_voice_reply.py`
- `docs/reference/open-yachiyo-main/docs/PROVIDER_CONFIGURATION_GUIDE.md`
- `docs/reference/open-yachiyo-main/docs/TTS_VOICE_CLONE_GUIDE.md`
- `docs/reference/open-yachiyo-main/config/tools.yaml`
- Echo-local comparison inputs:
  - `docs/protocol/events.md`
  - `docs/protocol/orchestrator-spec.md`
  - `docs/tts/README.md`
  - `docs/tts/architecture.md`
  - `docs/tts/provider-interface.md`
  - `docs/tts/voice-profile-boundary.md`
  - `docs/tts/playback-and-chunking.md`

## Potentially Reusable Ideas
- Treating a commercial voice-clone TTS backend as an external provider
  service, not as internal application logic.
- Keeping provider configuration explicit:
  - base URL
  - API key indirection
  - standard model id
  - realtime model id
  - standard voice id
  - realtime voice id
- Separating three concerns that should not collapse into one layer:
  - synthesis policy checks
  - provider transport / decoding
  - playback / desktop delivery
- Using idempotency and active-job replacement as first-class TTS concerns when
  a later Echo task reaches playback cancellation and deduplication.
- Recognizing that "voice clone" does not have to mean local inference; a
  provider-managed cloned voice id can still satisfy user-custom voice goals
  for a first demo.
- Reserving a realtime provider path separately from the baseline non-streaming
  path, instead of forcing both into one undocumented transport behavior.

## Reference-Only Ideas
- `voice.js` policy evaluation around:
  - content filtering
  - rate limiting
  - model/voice compatibility
  These are good reminders for later Echo policy work, but Echo should not
  copy the exact rules or tool wiring before local protocol docs define them.
- The dual path split of:
  - `electron_native`
  - `runtime_legacy`
  This is conceptually useful, but Echo should express equivalent choices
  through its own orchestrator / renderer / playback documents, not by copying
  open-yachiyo's runtime-vs-desktop topology.
- The Python CLI wrapper in `qwen_voice_reply.py`
  is a reference-only example of how one project chose to call DashScope. Echo
  should not inherit that script-first structure.

## Forbidden To Copy
- `open-yachiyo`'s `voice.js` adapter structure as-is.
- The tool-first execution model where TTS is primarily exposed as
  `voice.tts_aliyun_vc`.
- Its runtime event topic names such as:
  - `voice.requested`
  - `voice.job.*`
  - `voice.playback.electron`
- The Python CLI script and its concrete DashScope SDK usage.
- Any assumption that Echo should hard-wire desktop playback path selection
  inside the TTS package.

## Compatibility With Echo
- aligned:
  - a commercial voice-clone API is compatible with Echo's first audible demo
  - provider-managed voice ids fit Echo's typed voice-profile boundary
  - baseline TTS transport and realtime transport should be modeled
    separately
  - playback and rendering ownership should stay above the provider layer
- conflicts:
  - Echo's `packages/tts` must stay provider-neutral at foundation level,
    while open-yachiyo is already heavily shaped around one provider family
  - Echo uses protocol `TTSChunk` as the upstream contract; open-yachiyo uses
    tool-facing request payloads
  - Echo should not couple TTS directly to desktop path selection or generic
    runtime tool policies
  - Echo's event and state semantics are owned by local protocol docs, not by
    open-yachiyo's runtime events

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs plus this note.
- A first commercial provider for Echo may reasonably choose a DashScope
  Qwen3-TTS-VC style family before any heavier local stack such as GPT-SoVITS.
- Model Echo's voice profile so it can represent:
  - provider-managed voice ids
  - optional realtime voice ids
  - optional future reference-audio material
  without leaking provider request payloads above `packages/tts`.
- Do not copy `open-yachiyo`'s tool layer, event names, desktop bridge, or
  Python CLI layout into Echo.
