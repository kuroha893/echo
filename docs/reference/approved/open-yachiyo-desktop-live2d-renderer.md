# Reference Intake: open-yachiyo-desktop-live2d-renderer

## Scope
- Study only the `desktop-live2d` renderer-related parts of `open-yachiyo`
  that are relevant to Echo's first concrete renderer backend.
- Focus on:
  - Electron main/preload/renderer split
  - local loopback RPC and IPC bridge structure
  - full-body desktop character window assumptions
  - bounded renderer command dispatch and action-queue ideas
- Exclude:
  - runtime/tooling internals except where they reveal coupling risks
  - TTS implementation details
  - chat/bubble product features except where they reveal shell layering
  - direct reuse of app directory structure

## What Was Studied
- `docs/reference/open-yachiyo-main/docs/DESKTOP_LIVE2D_CONSTRUCTION_PLAN.md`
- `docs/reference/open-yachiyo-main/docs/modules/desktop-live2d/module-reference.md`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bootstrap.js`
- Echo-local comparison inputs:
  - `docs/protocol/events.md`
  - `docs/protocol/orchestrator-spec.md`
  - `docs/tts/README.md`
  - `docs/tts/orchestrator-integration.md`

## Potentially Reusable Ideas
- Treating the desktop Live2D renderer as a separate app shell, not as logic
  embedded inside core runtime packages.
- Keeping three desktop-facing layers explicit:
  - Electron app shell and window lifecycle
  - local RPC/IPC bridge
  - renderer-side scene controller
- Using a loopback-only, bounded local RPC surface between Python-side logic
  and the desktop app instead of sharing memory objects directly.
- Enforcing repo-owned relative model asset paths instead of allowing arbitrary
  runtime absolute-path model loading.
- Modeling full-body Live2D rendering as the default first visible character
  target, not as a head-only avatar widget.
- Reserving a renderer-side action queue / execution boundary so motion and
  expression control stay deterministic once a concrete app shell exists.

## Reference-Only Ideas
- `open-yachiyo`'s chat panel and bubble shell are useful proof that a desktop
  character app often needs multiple windows and UI layers, but Echo should not
  let those features distort the first renderer backend task.
- The existing JSON-RPC method set and tool exposure plan are helpful as
  examples of desktop control surfaces, but Echo should define its renderer
  methods from local protocol `RendererCommand` semantics instead.
- `open-yachiyo`'s lip-sync and mouth-tuner work is a useful later reference,
  but not part of Echo's first renderer backend because `set_mouth_open`
  remains deferred.

## Forbidden To Copy
- The `open-yachiyo` runtime/tooling structure or adapter directory layout.
- Its JSON-RPC method names, runtime event names, or tool names as Echo
  surface area.
- Its fixed project-specific model path assumptions as Echo runtime behavior.
- Its JavaScript file layout, preload API names, or window orchestration code
  as implementation templates.
- Any approach that lets the desktop app own Echo runtime session progression,
  turn resolution, or protocol semantics.

## Compatibility With Echo
- aligned:
  - Echo also needs a strict split between Python core and a future desktop app
  - a local RPC/IPC bridge is compatible with Echo's package boundaries
  - full-body Live2D rendering is aligned with the first visible demo goal
  - deterministic motion/expression dispatch is compatible with Echo's typed
    renderer-command model
- conflicts:
  - Echo's canonical upstream contract is protocol `RendererCommand`, not
    app-specific RPC methods
  - Echo must keep renderer logic behind `packages/renderer` before any
    desktop-specific shell
  - Echo cannot inherit `open-yachiyo` runtime events, tool contracts, or app
    topology as-is
  - bubble/chat UI belongs after the first backend, not inside the first
    desktop shell acceptance boundary

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs plus this note.
- The first concrete renderer backend may reasonably adopt:
  - Electron app shell
  - local loopback RPC/IPC bridge
  - full-body desktop character window
- Do not copy `open-yachiyo` method names, file layout, runtime coupling, or
  tool contracts.
- Treat `open-yachiyo` as the primary reference for desktop shell and bridge
  concerns only, not for the Pixi scene layer itself.
