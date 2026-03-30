# Reference Intake: airi-speaking-motion

## Scope
- Study only AIRI's local Live2D speaking-motion and parameter-mixing approach.
- Focus on:
  - how speaking-adjacent motion is represented
  - where parameter updates are merged
  - whether AIRI relies on `focus(...)` for speech motion
  - what Echo can adapt without copying AIRI's app architecture
- Exclude:
  - Vue component architecture as an app-shell pattern
  - Tauri/browser shell wiring
  - non-Live2D stage systems

## What Was Studied
- `C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`
- `C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts`
- `C:/Users/123/Desktop/echo/docs/reference/airi-main/packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts`
- Echo-local comparison inputs:
  - `C:/Users/123/Desktop/echo/docs/protocol/events.md`
  - `C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md`
  - `C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs`

## Potentially Reusable Ideas
- AIRI keeps scene motion as parameter streams owned by the renderer layer, not
  as fake pointer input and not as transport-time hacks.
- AIRI wraps Live2D motion-manager updates with a small plugin pipeline, so
  different motion influences can contribute at one bounded model-update
  boundary.
- AIRI's beat-sync path writes model parameters such as `ParamAngleX`,
  `ParamAngleY`, and `ParamAngleZ` directly after smoothing toward target
  values, instead of moving an abstract "focus source" around every frame.
- AIRI treats `focusAt` as a separate concern from speaking-style motion. The
  focus prop can still call `model.focus(x, y)`, but that is not the core
  pattern to reuse for speech motion.
- The reusable Echo idea is:
  - create a renderer-owned body-motion lane
  - compute smooth target values for body/head/breath parameters
  - merge those targets alongside lipsync/expression at one deterministic update
    point

## Reference-Only Ideas
- AIRI's Vue refs, watchers, Pinia stores, and composables are useful for
  understanding layering, but Echo should not mirror that structure.
- AIRI's beat-sync controller is tied to AIRI's own stage runtime and should be
  treated as a motion-shaping example, not as code to transplant.
- AIRI's exact plugin names and file boundaries are reference-only. Echo should
  keep its own package boundaries and backend shape.

## Forbidden To Copy
- AIRI's Vue component structure, composable APIs, or store layout.
- AIRI's motion-manager implementation as a direct source transplant.
- AIRI's stage/runtime wiring, browser assumptions, or package-boundary
  decisions.
- Any direct copying of Live2D scene code into Echo core/runtime/protocol
  layers.

## Compatibility With Echo
- aligned:
  - Echo already has a renderer backend boundary where scene-local motion can
    live.
  - Echo can add a dedicated body-motion channel without changing protocol or
    host assembly.
  - AIRI's "parameter lanes merged at one update hook" fits Echo's
    renderer-owned presentation layer.
- conflicts:
  - Echo should not use `focusController` as its speaking-motion primitive when
    the desired effect is "body moves, head/eyes stay neutral".
  - Echo cannot adopt AIRI's Vue/store architecture as implementation shape.
  - Echo must keep speaking motion bounded to renderer presentation and not leak
    new protocol semantics.

## Final Verdict
`reusable`

## Implementer Guidance
- If Echo revisits speaking motion, the primary thing to borrow from AIRI is
  the architecture:
  - separate motion inputs by role
  - smooth them independently
  - write them together in one model-update boundary
- Do **not** reuse the recent "move a focus source around while speaking"
  direction for Echo's body-only sway target.
- A good Echo adaptation would be:
  - a renderer-local body-motion state
  - smooth U-shaped or burst target curves expressed directly in
    `ParamBodyAngleX/Y/Z` and optional supporting parameters
  - no head/eye drift unless explicitly desired by the task card
