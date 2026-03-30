# Task Card 0076

## Title
Fix active Live2D Cubism model-settings wiring regression

## Role
Implementer

## Goal
Repair the active desktop avatar model-loading path so the production avatar
loads a real Cubism model-settings JSON again instead of passing an Echo scene
manifest into `pixi-live2d-display`.

## Scope Clarification
This task is a narrow regression fix after task74.

It must:

- restore one valid active Cubism model-settings file for the production avatar
- keep the active app-owned asset root under `apps/desktop-live2d/assets/models`
- keep bridge path canonicalization coherent with the real model-settings file
- preserve fail-fast behavior when the active model asset is malformed or missing

It must not:

- redesign provider readiness or production-mode semantics
- redesign avatar framing, drag, resize, or window topology
- reintroduce `demo_scripted`, fallback shells, or degraded avatar placeholders
- redesign browser control-plane behavior

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- `docs/tasks/0074-canonicalize-live2d-production-asset-paths-and-remove-legacy-model-references.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md`
- active desktop avatar implementation files under:
  - `apps/desktop-live2d/assets/models/open-yachiyo-kaguya/*`
  - `apps/desktop-live2d/renderer/*`
  - `apps/desktop-live2d/shared/*`
  - `packages/renderer/desktop_live2d_bridge.py`

## Files To Create Or Modify
- `apps/desktop-live2d/assets/models/open-yachiyo-kaguya/*`
- `apps/desktop-live2d/renderer/dom_scene_host.mjs`
- `apps/desktop-live2d/renderer/avatar_window_runtime.mjs` only if required to keep initialize output coherent
- `apps/desktop-live2d/shared/pixi_cubism_backend.mjs` only if required to keep model-settings validation explicit
- `packages/renderer/desktop_live2d_bridge.py`
- targeted avatar self-check / bridge tests if required

Do not modify:

- `apps/desktop-live2d/python/provider_*`
- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- browser `apps/web-ui/*`

## Hard Requirements
1. The active production avatar must load a real Cubism model-settings JSON
   file, not an Echo scene manifest.
2. The canonical active model-settings file must live under:
   - `apps/desktop-live2d/assets/models/open-yachiyo-kaguya/`
3. If Echo still needs a separate scene manifest for its own metadata, that
   manifest must remain distinct from the Cubism `.model3.json`-style settings
   file and must not be passed into `pixi-live2d-display` as the model settings.
4. `DesktopLive2DDomSceneHost.boot()` must provide:
   - Echo scene metadata from the Echo-owned manifest if needed
   - `resolved_model_json_path` pointing to the real active Cubism model file
5. Python-side bridge initialization must compare against the same canonical
   real model-settings path representation.
6. Keep fail-fast semantics:
   - malformed or missing active model-settings files must throw
   - do not add shell fallback, placeholder scenes, or alternate model aliases
7. Do not point the active product path back into `docs/reference/*`.

## Explicitly Out Of Scope
- fixing provider readiness when API keys are missing
- adding cloud-provider health checks
- changing TTS behavior
- changing desktop chat copy
- adding new models or model-switching UI

## Validation Expectations
1. Add or update a targeted check proving the active model-settings file is a
   real Cubism settings document rather than an Echo scene manifest.
2. Re-run:
   - avatar window self-check
   - bridge path test(s)
   - the smallest desktop smoke that exercises avatar initialization
3. Explicitly state whether the app now reaches:
   - avatar runtime ready
   - successful Live2D model render initialization
4. If any retained synthetic self-check still uses fake model assets, report it
   clearly as test-only.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- starting Electron no longer fails avatar boot with `Unknown settings format`
- the active avatar path uses one canonical app-owned real Cubism model file
- the bridge initialize path matches that same canonical real model file
- no fallback or degraded avatar shell is reintroduced
