# Reference Intake: open-yachiyo-desktop-audio-playback-lipsync

## Scope
- Study only the desktop-side audio playback and lip-sync related parts of
  `open-yachiyo` that are relevant to Echo's first runnable desktop demo.
- Focus on:
  - desktop-owned playback ownership
  - playback lifecycle and delivery split from TTS synthesis
  - realtime vs non-realtime desktop delivery choices
  - audio-driven mouth/lipsync ideas tied to real playback
- Exclude:
  - general runtime/tool orchestration outside playback coupling risks
  - generic chat-panel product behavior
  - direct reuse of event names, IPC names, or file layout

## What Was Studied
- `docs/reference/open-yachiyo-main/apps/runtime/tooling/adapters/voice.js`
- `docs/reference/open-yachiyo-main/docs/TTS_VOICE_CLONE_GUIDE.md`
- `docs/reference/open-yachiyo-main/docs/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
- `docs/reference/open-yachiyo-main/docs/modules/desktop-live2d/module-reference.md`
- Echo-local comparison inputs:
  - `docs/protocol/events.md`
  - `docs/protocol/orchestrator-spec.md`
  - `docs/tts/README.md`
  - `docs/tts/orchestrator-integration.md`
  - `docs/renderer/README.md`
  - `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
  - `docs/reference/approved/airi-pixi-live2d-scene.md`

## Potentially Reusable Ideas
- Let the desktop app own material playback truth once synthesized audio leaves
  `packages/tts`.
- Keep synthesis and playback as separate layers:
  - provider synthesis produces audio fragments
  - desktop delivery/playback consumes them
  - playback lifecycle is reported separately from synthesis success
- Model desktop playback lifecycle explicitly enough to distinguish:
  - accepted
  - started
  - finished
  - aborted
  - failed
- Keep realtime and non-realtime desktop playback as explicit delivery modes
  rather than one undocumented "play audio somehow" path.
- Treat prebuffer and idle timeout as desktop playback tuning, not as public TTS
  contract fields.
- Drive lip-sync from real desktop playback/audio analysis inside the app-side
  scene layer, not from a fake upstream `set_mouth_open` claim.
- Keep local-file playback or debug playback helpers strictly as smoke/dev aids,
  not as Echo's public demo contract.

## Reference-Only Ideas
- `open-yachiyo`'s `voice.requested` and `voice.job.*` event taxonomy is useful
  as proof that playback lifecycle needs explicit structure, but Echo should not
  inherit those names.
- Its runtime-side tool exposure around voice playback is product-specific and
  should not become Echo's package boundary.
- Its multi-window desktop shell proves that a character app can grow complex,
  but Echo's first runnable demo should stay single-session and narrower.

## Forbidden To Copy
- Event names such as:
  - `voice.requested`
  - `voice.job.*`
  - `voice.playback.electron`
- Desktop IPC names or bridge method names such as `desktop:voice:*`.
- The `voice.js` adapter structure as Echo implementation layout.
- The Python CLI/script calling pattern as Echo's core playback architecture.
- Any approach where the desktop app owns Echo turn progression, protocol
  semantics, or runtime state transitions.

## Compatibility With Echo
- aligned:
  - Echo already keeps TTS synthesis above provider adapters and below playback
  - Echo already has a desktop renderer bridge and app shell where playback can
    live
  - Echo's next runnable demo genuinely needs desktop-owned playback truth
  - app-side lip-sync driven by playback analysis fits Echo's deferred
    `set_mouth_open` policy
- conflicts:
  - Echo's public upstream contracts remain protocol `TTSChunk` and
    `RendererCommand`, not `open-yachiyo`'s event or tool names
  - Echo must keep playback sink ownership above `packages/tts`, not move
    speaker playback into the TTS package
  - Echo should not clone `open-yachiyo`'s runtime/tooling directory structure
  - Echo's first demo is intentionally single-session and narrower than
    `open-yachiyo`'s broader desktop shell

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs plus this note.
- The first runnable demo should add a concrete desktop audio sink above
  `packages/tts` and route synthesized fragments into the existing
  `desktop-live2d` bridge/app shell.
- Typed playback lifecycle reporting should come back from the desktop-owned
  playback layer instead of extending the current local reconciliation shell
  forever.
- Lip-sync should be implemented app-side, driven by real playback/audio
  analysis, and must not change Echo protocol semantics to pretend generic
  `set_mouth_open` support already exists.
