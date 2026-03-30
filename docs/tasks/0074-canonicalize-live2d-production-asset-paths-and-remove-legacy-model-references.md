# Task Card 0074

## Title
Canonicalize Live2D production asset paths and remove legacy model references

## Role
Implementer

## Goal
Replace the remaining legacy/demo/reference-path model wiring with one canonical
app-owned production asset path for the active desktop avatar.

## Scope Clarification
This task is about model asset ownership and path consistency only.

It must:

- establish one canonical active model asset root under app-owned runtime
  assets
- stop active product code from pointing into `docs/reference/*`
- remove legacy `demo-fullbody` and equivalent stale model references from the
  active path

It must not:

- redesign avatar/window UI
- redesign provider assembly
- change protocol semantics

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md`
- `docs/tasks/0069-desktop-live2d-avatar-chat-bubble-suite-reset.md`
- `docs/tasks/0070-open-yachiyo-desktop-window-ui-fidelity-and-sync-verification.md`
- `docs/tasks/0071-remove-deprecated-ui-assets-and-decontaminate-entrypoints.md`
- completed implementations from tasks69 through 71

## Files To Create Or Modify
- `apps/desktop-live2d/assets/models/*`
- `apps/desktop-live2d/renderer/dom_scene_host.mjs`
- `apps/desktop-live2d/renderer/avatar_window_runtime.mjs`
- `apps/desktop-live2d/shared/pixi_cubism_backend.mjs`
- `packages/renderer/desktop_live2d_bridge.py`
- `apps/desktop-live2d/bridge/model_assets.mjs`
- related desktop self-check/smoke files if required

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- browser console files

## Hard Requirements
1. The active desktop avatar path must resolve its model from one canonical
   app-owned asset location under:
   - `apps/desktop-live2d/assets/models/...`
2. No active product-path desktop file may resolve its runtime model from
   `docs/reference/*`.
3. No active product-path desktop file may still refer to:
   - `demo-fullbody`
   - old `model3.json` demo references
   - superseded scene manifest paths
4. Python-side bridge initialization and Electron-side initialize responses
   must compare the same canonical asset path representation.
5. Keep the current open-yachiyo model content and UI fidelity direction, but
   make Echo own the runtime asset path cleanly.
6. Do not add fallback model aliases or multi-model selection semantics.

## Explicitly Out Of Scope
- changing avatar drag/resize behavior
- changing browser control plane
- changing provider readiness or mode semantics
- adding alternate models or model switchers

## Validation Expectations
1. Add/update targeted checks proving the active bridge initialize path and the
   renderer initialize response agree on the canonical app-owned asset path.
2. Re-run avatar runtime self-checks and desktop suite smoke.
3. Explicitly report any retained non-product test harnesses that still use
   synthetic/demo model paths.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- active avatar runtime no longer points into `docs/reference/*`
- active bridge and renderer use one canonical app-owned model asset path
- legacy `demo-fullbody` references are removed from the active product path
- no fallback model alias path remains in the active product path
