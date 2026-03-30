# Task Card 0090

## Title
Add bounded procedural positive-body sway for Echo's Live2D avatar without faking mouse input or requiring new motion assets

## Role
Implementer

## Goal
Add a small, controlled, programmatic body/head presentation motion so Echo's avatar feels more alive during positive or warmly spoken assistant replies, without:

- faking mouse input
- requiring new `.motion3.json` assets
- creating a second hidden animation system outside the current renderer composition path

The user-visible outcome should be simple:

- when Echo is speaking in a clearly warm/positive way, the avatar should show a subtle, pleasant micro-sway
- the movement should feel intentional and alive, not like broken physics
- if the selected model does not actually support the required programmatic parameters, Echo must be truthful about that and not silently invent fake behavior

## Scope Clarification
This task is only about **small procedural micro-motion**.

It includes:

- a subtle positive/friendly speaking sway
- bounded amplitude
- deterministic timing
- integration with the existing face/lipsync composition path
- truthful gating based on what the selected model can actually support

It does **not** include:

- full-body authored animation replacement
- fake pointer/mouse event synthesis
- large idle wobble
- a general emotion-state machine redesign
- new motion assets
- long-lived autonomous idle choreography

This task assumes the post-83/84/85/86/87 state already exists:

- realtime speech playback exists
- TTS-facing text sanitization exists
- audible quick-prefix handoff rules exist
- playback-driven lipsync exists
- face mixer and special-cue queue exist

## Problem in User Terms
The user has identified a very natural expectation:

- even without new art assets, Live2D models often feel more alive when they subtly lean, sway, or breathe
- users already see a related effect when pointer/focus tracking causes head or body orientation to react
- Echo should use that same principle for positive speaking, so the avatar does not remain visually rigid while sounding cheerful or engaged

In plain language:

- "if she sounds happy or warm, let her gently move a bit"
- "do not fake mouse movement"
- "do not turn this into random wobble"
- "do not pretend every model can do the same thing if its parameters are missing"

## Primary Reference Model
This task should treat **AIRI** as the primary behavior reference.

Why AIRI is the primary reference:

- it already uses parameter-driven, continuous Live2D control
- it already writes standard Cubism head/body/breath parameters directly
- it already has focus/idle plugins that prove programmatic scene motion does not require a `.motion3.json` asset for every small presentation behavior

This does **not** mean Echo should copy AIRI's component/store architecture. It means AIRI proves the *kind* of scene-layer control we should adapt.

## Supplementary Reference Model
This task should treat **open-yachiyo** as supplementary.

What open-yachiyo contributes here is not a ready-made sway feature; its value is the renderer discipline around:

- applying presentation parameters inside stable model-update timing
- keeping face/lipsync/emotion composition in one coherent mix path
- avoiding parameter fights between simultaneous presentation layers

In other words:

- AIRI is the better reference for "parameter-driven micro motion exists"
- open-yachiyo is the better reference for "blend it in one deterministic renderer composition path"

## How AIRI solves this
AIRI's local mirror shows direct, continuous writes to standard Live2D parameters, including body and breath, not just mouth-open.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui-live2d\src\components\scenes\live2d\Model.vue`

```typescript
coreModel.setParameterValueById('ParamAngleX', modelParameters.value.angleX)
coreModel.setParameterValueById('ParamAngleY', modelParameters.value.angleY)
coreModel.setParameterValueById('ParamAngleZ', modelParameters.value.angleZ)
...
coreModel.setParameterValueById('ParamBodyAngleX', modelParameters.value.bodyAngleX)
coreModel.setParameterValueById('ParamBodyAngleY', modelParameters.value.bodyAngleY)
coreModel.setParameterValueById('ParamBodyAngleZ', modelParameters.value.bodyAngleZ)
coreModel.setParameterValueById('ParamBreath', modelParameters.value.breath)
```

Why this matters:

- AIRI proves the scene layer can animate standard Cubism parameters directly
- it is not limited to authored motions
- body angle and breath can be driven programmatically

AIRI also exposes scene-local focus/motion behavior through explicit scene inputs rather than pretending the user physically moved the cursor.

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui-live2d\src\components\scenes\live2d\Model.vue`

```typescript
const beatSync = createBeatSyncController({
  baseAngles: () => ({
    x: modelParameters.value.angleX,
    y: modelParameters.value.angleY,
    z: modelParameters.value.angleZ,
  }),
  initialStyle: 'sway-sine',
})
```

And:

```typescript
motionManagerUpdate.register(useMotionUpdatePluginIdleFocus(), 'post')
```

Why this matters:

- AIRI is not using fake OS pointer events as a backdoor
- it has renderer/scene-owned presentation signals
- a mild positive speaking sway in Echo should follow that same principle

## How open-yachiyo solves this
open-yachiyo's local renderer mirror is valuable because it shows how to keep multiple facial/speech presentation layers from fighting each other, and how to apply them in a stable model-update hook.

Source:
`C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\bootstrap.js`

```javascript
internalModel.on('beforeModelUpdate', handler);
...
internalModel.off('beforeModelUpdate', handler);
```

And:

```javascript
const finalMouthForm = clamp(
  resolvedMouthForm + faceBlend.mouthForm * emotionMouthWeight,
  -1,
  1
);
coreModel.setParameterValueById('ParamMouthOpenY', resolvedMouthOpen);
coreModel.setParameterValueById('ParamMouthForm', finalMouthForm);
```

Why this matters:

- open-yachiyo demonstrates the right *timing* and *mixing discipline*
- Echo's procedural sway must not live in a detached timer that fights lipsync or expression updates
- it should be blended inside the same renderer-owned composite path

## Existing Echo Behavior That Matters
Echo already has a renderer-owned composition point and a procedural motion foothold.

Source:
`C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\pixi_cubism_backend.mjs`

```javascript
function setModelRotation(model, rotation) {
  if (typeof model?.rotation === "number") {
    model.rotation = rotation;
  }
}
```

Echo also already applies composite face pose in the model update hook:

Source:
`C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\pixi_cubism_backend.mjs`

```javascript
this._modelUpdateHookCallback = () => {
  this.#applyCompositeFacePose();
};
eventTarget.on("beforeModelUpdate", this._modelUpdateHookCallback);
```

Why this matters:

- the architecture already has a clean renderer-owned place to extend presentation behavior
- the right direction is to add bounded sway into this composition path
- the wrong direction is to fake mouse events or bolt on a drifting side timer

## What Echo should adopt
Echo should adopt a **bounded renderer-owned positive-sway layer** with these properties:

1. it activates only for a narrow, explicit class of states:
   - warm/positive speaking
   - smile-like positive expression contexts
2. it is deterministic:
   - bounded amplitude
   - bounded frequency
   - clean settle-back to neutral
3. it is truthful:
   - only uses model parameters that are explicitly verified for the selected model
   - does not silently fake unsupported model capabilities
4. it composes with the existing renderer path:
   - lipsync still owns mouth openness
   - face mixer still owns facial blend
   - sway adds a small body/head presentation offset inside the same composite timing boundary

## What Echo must not copy directly
- Do not synthesize fake pointer events or fake cursor coordinates.
- Do not copy AIRI's Vue/store/composable architecture.
- Do not copy open-yachiyo's runtime/app topology.
- Do not create a hidden second animation path outside Echo's current renderer composition path.
- Do not claim procedural sway is equivalent to rich authored motion assets.
- Do not silently introduce a transform fallback that hides missing model capability truth.

## Concrete implementation boundaries inside Echo

### A. No fake mouse-follow emulation
The implementation must not:

- dispatch synthetic `mousemove` / `pointermove`
- route positive emotion through Electron pointer plumbing
- pretend the user physically moved the cursor

The motion must come from renderer-owned state, not input spoofing.

### B. Narrow first version: positive/friendly speaking only
The first version must stay intentionally small:

- positive/friendly speaking
- smile-like expression context
- bounded settle-back to neutral

Do not widen this task into:

- anger shake
- sadness droop
- listening head tracking
- autonomous idle choreography

### C. Preferred motion path: verified standard Cubism parameters
Prefer a parameter-driven sway that uses standard Cubism parameters only when they are actually verified for the selected registered model, such as:

- `ParamBodyAngleX`
- `ParamAngleX`
- `ParamBreath`

The implementation must not guess that every model has these parameters.

It should use one of these truthful sources:

- per-model capability truth already available from the registered model library / manifest system
- a verified runtime parameter-presence check at model load time

### D. No silent unsupported-model degradation
If the selected model does not actually support the required parameter path for this feature, the implementation must be explicit.

Allowed outcomes:

- the selected model is marked as not supporting procedural positive sway
- the control/state layer does not activate the feature for that model
- tests/self-checks make this truth visible

Not allowed:

- pretending the feature exists for every model
- silently substituting an unapproved fake behavior path

### E. Integrate into the existing renderer composition timing
The sway layer must be evaluated inside the existing renderer-owned composite path, not as an unsynchronized external loop.

The correct home is the same family of logic that currently owns:

- face blend
- mouth/jaw pose
- model-update hook timing

This is where open-yachiyo's discipline matters most.

### F. Respect authored motions when present
If a real authored motion is currently playing:

- the procedural sway must remain bounded and secondary
- it must not visibly fight or overwrite the authored motion
- authored motion should remain the dominant presentation signal

### G. No protocol or control-plane expansion
Do not turn this into:

- a new public protocol event
- a new control-plane settings surface
- a new emotion-state machine redesign

Keep the change inside the current renderer/backend boundary unless a local Echo spec explicitly requires more.

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [airi-pixi-live2d-scene.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-pixi-live2d-scene.md)
- [open-yachiyo-desktop-live2d-renderer.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [scene_presets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/scene_presets.mjs)
- [scene_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_controller.mjs)
- [pixi_runtime_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/pixi_runtime_self_check.mjs)
- [lipsync_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/lipsync_self_check.mjs)
- reference-only evidence already quoted above from:
  - `C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui-live2d\src\components\scenes\live2d\Model.vue`
  - `C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main\apps\desktop-live2d\renderer\bootstrap.js`

## Files To Create Or Modify
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- optionally, if strictly necessary:
  - [scene_presets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/scene_presets.mjs)
  - a local renderer self-check under [apps/desktop-live2d/renderer](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer)
- relevant tests/self-checks under:
  - [apps/desktop-live2d/renderer](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer)
  - [tests](/C:/Users/123/Desktop/echo/tests)

## Hard Requirements
1. Add a bounded procedural sway layer for positive/friendly assistant speaking.
2. Do not fake mouse/pointer input.
3. Do not require new `.motion3.json` assets for the baseline feature.
4. Keep the sway inside the existing renderer-owned composition path.
5. Do not break existing lipsync or face-mixer behavior.
6. Do not let procedural sway overpower or visibly fight an authored motion.
7. Use only model parameters or presentation paths that are explicitly verified for the selected model.
8. Do not silently pretend unsupported models have this capability.
9. Do not modify public protocol semantics.
10. Do not introduce fallback/degraded mode behavior.

## Out Of Scope
- fake mouse-follow feature emulation
- full-body authored-motion replacement
- new motion asset creation
- long-lived autonomous idle animation system
- model-library switching
- new memory/emotion protocol semantics
- cross-session affect state

## Validation Expectations
1. Add self-checks showing positive/friendly speaking now produces visible but small body/head micro-motion.
2. Add checks proving lipsync still works during sway.
3. Add checks proving the sway settles back to neutral when the positive speaking context ends.
4. Add checks proving the implementation does not depend on pointer events.
5. Add checks proving a currently playing authored motion is not broken or overpowered by the sway layer.
6. Add checks proving unsupported models are reported truthfully rather than silently faked.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- During positive/friendly assistant replies, the avatar shows a subtle, pleasant, bounded micro-sway instead of remaining completely rigid.
- The implementation does not fake mouse input.
- The implementation does not require new motion assets.
- Lipsync and face-mixer behavior remain intact.
- If a selected model lacks the verified capability path for this feature, Echo remains truthful about that instead of silently inventing fake support.
- The result feels like a small enhancement to liveliness, not a distracting wobble or broken physics effect.
