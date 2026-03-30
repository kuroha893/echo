# Task Card 0089

## Title
Add a registered Cubism model library and a Config v2 avatar-model selector for Echo desktop-live2d

## Role
Implementer

## Goal
Turn Echo's current repo-owned Live2D loading into a real, user-facing model library feature:

- users can switch among supported desktop avatar models inside `Config v2`
- the selected model is stored by a stable machine-independent identifier, not a hardcoded filesystem path
- supported models are organized under one tidy repo-owned library root
- Echo truthfully preserves per-model motion/expression capability differences instead of pretending all models are identical

This task is specifically about registered Cubism models that Echo ships or curates inside the repo. It is not about "import any random Live2D package from anywhere on disk".

The support target is intentionally narrow and must stay narrow:

- support only Cubism packages centered on `*.model3.json`
- support only the common related files in that package family:
  - `*.exp3.json`
  - `*.motion3.json`
  - `*.cdi3.json`
  - `*.cmo3.json`
  - `*.moc3.json`
  - `*.model3.json`
  - `*.physics3.json`
- ignore other odd, legacy, or nonstandard Live2D package shapes

If a package falls outside that boundary, reject it explicitly.

## Scope Clarification
This task covers:

- formalizing a clean app-owned Cubism model library under one root
- formalizing a registry/index for which models are selectable
- exposing the current model choice in `Config v2`
- loading a selected model by `model_key` or equivalent stable identifier
- truthfully surfacing per-model supported motions/expressions

This task does **not** cover:

- arbitrary model import from user-chosen absolute paths
- drag-and-drop model uploads
- `.zip` import, `.vrm`, `.pmd`, `.pmx`, URL loading, IndexedDB storage, or any other broader AIRI-style model ingestion scope
- legacy `*.model.json` support
- new motion authoring
- new expression authoring
- procedurally animated body sway
- protocol redesign

## Problem in User Terms
The user wants Echo to feel like a proper avatar host rather than a developer demo:

- there should be one neat place where supported Live2D models live
- switching the avatar should happen inside the control plane, not by editing files or typing paths
- model switching should work on any machine where Echo is checked out
- if one model has many preset motions and another has very few, Echo should tell the truth and adapt cleanly instead of breaking or lying

In plain language:

- "let me choose my avatar inside Echo"
- "do not make me paste a Windows path"
- "do not assume every model has the same motions"
- "keep the model files organized and elegant"

## Primary Reference Model
This task should treat **AIRI** as the primary product/UX reference for the selector experience and for the idea that model capabilities should be discovered and surfaced rather than guessed.

However, Echo must **not** copy AIRI's broad import story. AIRI supports:

- `.zip`
- `.vrm`
- URL loading
- IndexedDB-backed persistence

Echo must not widen scope into those behaviors here.

For this task, AIRI is useful for:

- "there is a real model picker in settings"
- "the picker highlights the current choice"
- "the runtime can enumerate available motions"
- "motion names can be mapped into higher-level semantic labels"

## Supplementary Reference Model
This task should treat **open-yachiyo** as supplementary only. The local mirror does **not** provide as complete an end-user model-selector feature as AIRI.

What open-yachiyo usefully reinforces here is narrower:

- full-body desktop avatar assumptions
- repo-owned model asset discipline
- the general idea that the desktop character shell should consume known local assets rather than arbitrary user-entered paths

In other words:

- use AIRI as the product reference for "model switching exists and is usable"
- use Echo's existing `model_assets.mjs` plus open-yachiyo's renderer note as discipline for "repo-owned desktop avatar assets must stay bounded"

## How AIRI solves this
AIRI has a real user-facing model picker and runtime model switching flow.

Useful UI example:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenarios\settings\model-settings\index.vue`

```vue
async function handleModelPick(selectedModel: DisplayModel | undefined) {
  stageModelSelected.value = selectedModel?.id ?? ''
  await settingsStore.updateStageModel()

  if (selectedModel?.format === DisplayModelFormat.Live2dZip)
    useLive2d().shouldUpdateView()
}
```

Why this matters:

- the selected model is a stable model identifier, not a raw path string
- settings own the selected model
- the view reload is explicit

AIRI also has an actual selector dialog:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenarios\dialogs\model-selector\model-selector.vue`

```vue
<ModelSelectorDialog v-model:show="modelSelectorOpen" :selected-model="currentSelectedDisplayModel" @pick="handleModelPick">
  <Button variant="secondary">
    Select Model
  </Button>
</ModelSelectorDialog>
```

And AIRI enumerates model motions at runtime:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui-live2d\src\components\scenes\live2d\Model.vue`

```typescript
availableMotions.value = Object
  .entries(motionManager.definitions)
  .flatMap(([motionName, definition]) => (definition?.map((motion: any, index: number) => ({
    motionName,
    motionIndex: index,
    fileName: motion.File,
  })) || []))
  .filter(Boolean)
```

And it maps model-specific motion names into higher-level semantic buckets:

Source:
`C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui-live2d\src\components\scenes\live2d\Model.vue`

```typescript
availableMotions.value.forEach((motion) => {
  if (motion.motionName in Emotion) {
    motionMap.value[motion.fileName] = motion.motionName
  }
  else {
    motionMap.value[motion.fileName] = EmotionNeutralMotionName
  }
})
```

Why this matters:

- AIRI does **not** assume every model has identical authored motions
- it discovers what is present
- it builds a semantic map on top

That exact broad AIRI architecture must not be transplanted into Echo, but the product behavior is the right reference.

## How open-yachiyo solves this
open-yachiyo is **not** the main reference for a model picker. The local mirror does not show a comparably complete "switch among many models from settings" feature.

Its value here is more architectural:

- desktop avatar rendering is treated as a repo-owned shell
- full-body presentation is the default assumption
- model assets are local and curated, not arbitrary user-entered file paths

That is aligned with Echo's current safety posture and should be preserved.

For this task, open-yachiyo should remain supplementary, not the model-switching template.

## Existing Echo Behavior That Matters
Echo already has the most important machine-independent asset rule in place:

Source:
`C:\Users\123\Desktop\echo\apps\desktop-live2d\bridge\model_assets.mjs`

```javascript
export const MODEL_ASSET_PREFIX = "apps/desktop-live2d/assets/models/";
...
if (!normalized.startsWith(MODEL_ASSET_PREFIX)) {
  throw new DesktopLive2DBridgeProtocolError({
    bridgeCommand: "initialize",
    errorCode: BRIDGE_ERROR_CODE.INVALID_MODEL_ASSET,
    message: "model asset path must stay under apps/desktop-live2d/assets/models/",
    retryable: false
  });
}
```

And Echo already normalizes repo-owned model metadata into app-facing manifest truth:

Source:
`C:\Users\123\Desktop\echo\apps\desktop-live2d\bridge\model_assets.mjs`

```javascript
return {
  model_key: modelAsset.model_key,
  display_name: manifest.display_name || modelAsset.display_name,
  ...
  supported_states: ensureArrayOfStrings(...),
  supported_expressions: ensureArrayOfStrings(...),
  supported_motions: ensureArrayOfStrings(...),
  repo_relative_model_json_path: resolvedAsset.repo_relative_model_json_path,
  resolved_model_json_path: resolvedAsset.resolved_model_json_path
};
```

This is the right Echo-native base. The task should extend it into a formal registered model library feature, not replace it with AIRI's file-import model.

## What Echo should adopt
Echo should adopt the following concrete pattern:

1. one app-owned model library root:
   - `apps/desktop-live2d/assets/models/`
2. one dedicated subdirectory per model:
   - `apps/desktop-live2d/assets/models/<model_key>/`
3. one app-owned library registry/index:
   - for example `model_library_registry.json`
4. one selected model identifier in control-plane/app-local state:
   - `model_key`
5. one runtime load path that resolves:
   - `model_key -> registry entry -> repo-relative *.model3.json`

The model directory layout should stay tidy and human-readable. A reasonable shape is:

```text
apps/desktop-live2d/assets/models/
  model_library_registry.json
  demo-fullbody/
    scene_manifest.json
    model3.json
    ...
  open-yachiyo-kaguya/
    scene_manifest.json
    open_yachiyo_kaguya.model3.json
    ...
```

Each registered model should have:

- a stable `model_key`
- a display name
- one canonical repo-relative `*.model3.json` path
- one app-owned scene manifest beside the model package or inside the same model directory
- truthful supported state / expression / motion declarations

## What Echo must not copy directly
- Do not transplant AIRI's file-import, URL-import, IndexedDB, or store architecture.
- Do not copy AIRI's runtime component structure into Echo app/runtime boundaries.
- Do not add a raw text box for user-entered filesystem paths.
- Do not persist `C:\...` or any absolute path as the selected model.
- Do not pretend all models have the same motion/expression coverage.
- Do not widen support to legacy or odd Live2D formats outside the narrow Cubism `model3` family listed in this card.

## Concrete implementation boundaries inside Echo

### A. Formalize one clean model-library root
All supported models must live under:

- [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)

Do not scatter model assets across unrelated folders.

### B. Introduce one explicit library registry
Add one app-owned registry/index file under the model library root, such as:

- [model_library_registry.json](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models/model_library_registry.json)

The exact filename may differ, but it must be:

- repo-owned
- machine-independent
- human-readable
- the single source of truth for which models are selectable in `Config v2`

### C. Supported package boundary is narrow
Only support Cubism packages centered on `*.model3.json` plus the common family:

- `*.exp3.json`
- `*.motion3.json`
- `*.cdi3.json`
- `*.cmo3.json`
- `*.moc3.json`
- `*.model3.json`
- `*.physics3.json`

Do not expand this task into universal model import.

### D. Selected model must be represented by `model_key`, not path
The selected avatar model in config/control-plane state must be stored as a stable logical identifier such as `model_key`.

The runtime may derive an absolute path internally at load time, but:

- that absolute path must never be the user-facing choice
- that absolute path must never be persisted as the selected model
- the saved selection must work on another machine that checks out the repo

### E. Config v2 must expose a real selector
Add a dedicated avatar/model section in `Config v2` that:

- lists registered selectable models
- shows the current model
- shows useful metadata:
  - display name
  - presentation mode
  - supported expressions
  - supported motions
- lets the user save/apply the model cleanly

This should feel like a product feature, not a developer debug control.

### F. Capability truth must remain per-model
When one model has fewer motions or expressions than another:

- Echo must expose only that model's real supported set
- scene validation must keep rejecting unsupported motions/expressions
- the UI must not imply false capability symmetry

### G. Keep existing asset safety posture
Any new registry/indexing and selection path must preserve the current safety rules from `model_assets.mjs`:

- repo-owned assets only
- no absolute paths
- no `..`
- no escaping the model-library root

### H. Direct-reference boundary for this task
This task may use AIRI local source only in this limited way:

- **UI-surface reference only** for model-picker presentation patterns
- allowed local AIRI UI paths:
  - `C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenarios\dialogs\model-selector\model-selector.vue`
  - `C:\Users\123\Desktop\echo\docs\reference\airi-main\packages\stage-ui\src\components\scenarios\settings\model-settings\index.vue`

That direct reference is allowed only for:

- selector UI structure
- selection affordance
- presentation-level interaction

It is **not** permission to copy:

- AIRI's file-import architecture
- AIRI's broader display-model store
- AIRI's runtime/package boundaries

For non-UI logic in this task, rely on:

- Echo local code
- [airi-pixi-live2d-scene.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-pixi-live2d-scene.md)
- [open-yachiyo-desktop-live2d-renderer.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md)

## Allowed Context
- [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
- [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
- [airi-pixi-live2d-scene.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-pixi-live2d-scene.md)
- [open-yachiyo-desktop-live2d-renderer.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md)
- [model_assets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/bridge/model_assets.mjs)
- [scene_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_controller.mjs)
- [scene_stdio_bridge.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_stdio_bridge.mjs)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [config_surface.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/config_surface.mjs)
- [control_plane_contracts.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/control_plane_contracts.mjs)
- [control_plane_server.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/control_plane_server.mjs)
- [main.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/electron/main.mjs)
- existing model assets under:
  - [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)
- AIRI UI reference files listed in section `H` above, for UI surface only

## Files To Create Or Modify
- one new app-owned model-library registry file under:
  - [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)
- existing or new app-owned per-model scene manifests under:
  - [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)
- [model_assets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/bridge/model_assets.mjs)
- [config_surface.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/config_surface.mjs)
- [control_plane_contracts.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/control_plane_contracts.mjs)
- [control_plane_server.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/control_plane_server.mjs)
- [main.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/electron/main.mjs)
- any explicit app-local desktop config file that persists the selected `model_key`
- relevant tests/self-checks under:
  - [apps/desktop-live2d/renderer](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer)
  - [apps/web-ui](/C:/Users/123/Desktop/echo/apps/web-ui)
  - [tests](/C:/Users/123/Desktop/echo/tests)

## Hard Requirements
1. Only support registered repo-owned Cubism `*.model3.json` package families and the listed common adjacent file types.
2. Do not support arbitrary user-entered absolute model paths.
3. The selected avatar model must persist by a machine-independent identifier such as `model_key`.
4. All supported models must live under one clean library root:
   [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)
5. `Config v2` must expose a real model selector for registered models.
6. Runtime loading must fail fast if the selected model escapes the library root or violates the supported Cubism contract.
7. Model-specific motion/expression capability truth must remain per-model.
8. Do not modify public protocol semantics in [packages/protocol](/C:/Users/123/Desktop/echo/packages/protocol).
9. Do not introduce fallback/degraded import modes.

## Out Of Scope
- arbitrary filesystem import UI
- drag-and-drop model-package import
- URL import
- IndexedDB-backed model storage
- `.zip`, `.vrm`, `.pmx`, `.pmd`, or other non-target formats
- legacy `*.model.json`
- motion authoring / expression authoring
- procedural body sway
- long-term avatar asset management beyond the registered local library

## Validation Expectations
1. Add tests/self-checks proving registered models can be enumerated from the library registry.
2. Add tests proving selection persists by `model_key` or equivalent stable identifier, not by absolute path.
3. Add tests proving `Config v2` can load, display, and save the selected model.
4. Add tests proving unsupported package shapes are rejected explicitly.
5. Add tests proving two different registered models may expose different supported motions/expressions without breaking scene validation.
6. Add tests proving a repo checkout on another machine still resolves the selected model through repo-relative model assets.
7. Add a UI self-check showing the model selector panel appears in `Config v2` and reflects the current selection.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- The user can switch among registered repo-owned Cubism Live2D models inside `Config v2`.
- The selected model is stored by a stable machine-independent identifier, not by a pasted absolute path.
- All supported models live under one tidy library root beneath [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models).
- A model with many motions and a model with very few both work truthfully, and Echo does not imply equal capability where it does not exist.
- Unsupported or out-of-scope Live2D package shapes are rejected explicitly.
