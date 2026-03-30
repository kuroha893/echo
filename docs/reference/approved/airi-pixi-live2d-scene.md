# Reference Intake: airi-pixi-live2d-scene

## Scope
- Study only the Pixi + Live2D scene-layer parts of `AIRI` that are relevant
  to Echo's first concrete renderer backend.
- Focus on:
  - scene/component layering
  - Pixi canvas ownership
  - Live2D model loading and viewport fitting
  - scene-local controls such as focus, idle/blink toggles, and mouth-open as
    future extensions
- Exclude:
  - Vue application structure
  - store/composable architecture
  - Tauri/native desktop shell
  - non-Live2D stage features such as VRM and broader UI systems

## What Was Studied
- `docs/reference/airi-main/packages/stage-ui-live2d/src/components/scenes/Live2D.vue`
- `docs/reference/airi-main/packages/stage-ui-live2d/src/components/scenes/live2d/Canvas.vue`
- `docs/reference/airi-main/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`
- Echo-local comparison inputs:
  - `docs/protocol/events.md`
  - `docs/protocol/orchestrator-spec.md`
  - `docs/tts/orchestrator-integration.md`

## Potentially Reusable Ideas
- Treating the scene runtime as a subsystem distinct from the desktop shell:
  - canvas/bootstrap layer
  - model controller layer
  - future higher-level scene controls
- Using Pixi application ownership at the canvas layer and keeping model logic
  out of the bootstrap container.
- Making full-body model positioning and scaling viewport-aware rather than
  hard-coding one absolute pose.
- Keeping model loading and model replacement bounded and stateful, with clear
  mounted/loading concepts.
- Reserving scene-local controls like:
  - focus target
  - idle animation enablement
  - auto blink enablement
  - mouth-open input
  as inputs to the scene layer rather than mixing them into transport logic.

## Reference-Only Ideas
- AIRI's Vue component hierarchy is useful as an example of separation of
  concerns, but Echo should not mirror it literally because Echo's first
  concrete renderer backend is an Electron desktop app, not a Vue package.
- The Pinia stores, composables, and theme/shadow features are interesting but
  are not needed for Echo's first backend acceptance criteria.
- AIRI's mouse tracking and mouth-open controls are good later references for
  idle/presence and lip-sync work, but they must not be claimed as implemented
  in Echo's first backend.

## Forbidden To Copy
- AIRI's Vue file structure, component names, store layout, or composable API.
- AIRI's Tauri- or browser-specific integration assumptions.
- AIRI's package structure as Echo app structure.
- Any direct copying of scene logic, motion plugins, or UI styling into Echo.

## Compatibility With Echo
- aligned:
  - Echo needs a real scene subsystem, not a thin "draw one model" helper
  - Pixi + Live2D scene layering is compatible with Echo's renderer goals
  - full-body model presentation fits Echo's first visible demo target
  - explicit scene-local inputs align with future idle/blink/focus/lipsync work
- conflicts:
  - Echo's upstream boundary is typed `RendererCommand`, not UI component props
  - Echo's first concrete app shell is Electron-driven and should stay separate
    from scene runtime concerns
  - Echo cannot adopt AIRI's Vue/store architecture as its desktop shell

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs plus this note.
- Treat AIRI as the primary renderer reference for the Pixi/canvas/model scene
  layer only.
- The first concrete Echo scene controller may reasonably borrow these ideas at
  a conceptual level:
  - dedicated canvas bootstrap
  - dedicated model controller
  - viewport-based full-body scaling/positioning
- Do not copy AIRI's component/store structure or browser-first integration
  patterns.
