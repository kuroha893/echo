# Task Card 0070

## Title
Implement high-fidelity desktop window UI recreation and cross-surface sync verification

## Role
Implementer

## Goal
Rebuild the `avatar`, `chat`, and `bubble` Electron windows as high-fidelity
recreations of the open-yachiyo desktop-live2d UI surfaces, and verify that
they stay synchronized with the browser console through Echo's single-session
control plane.

## Scope Clarification
This task is desktop-surface fidelity and verification work.

It must:

- recreate the floating desktop windows at high fidelity
- align window size, transparency, spacing, and interaction parameters closely
  to the approved reference source
- verify cross-surface sync between browser chat and floating windows

It must not:

- redesign protocol or runtime semantics
- add screenshot UI
- add standby/presence behavior
- add multi-session shell

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md`
- `docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md`
- completed implementations from tasks53 through 69
- local reference source under:
  - `docs/reference/open-yachiyo-main/apps/desktop-live2d`
  - `docs/reference/open-yachiyo-main/apps/gateway/public`

## Files To Create Or Modify
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/scripts/*`
- related browser-console verification assets under `apps/web-ui/*`

If strictly required for desktop-surface sync snapshots, you may also modify:

- `apps/desktop-live2d/shared/*`

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*`
- `apps/desktop-live2d/python/*` semantics

## Hard Requirements
1. Recreate the `avatar`, `chat`, and `bubble` windows at high fidelity.
2. Directly inspect the approved local reference source under:
   - `docs/reference/open-yachiyo-main/apps/desktop-live2d`
3. Reproduce at high fidelity:
   - window dimensions
   - transparency and frameless behavior
   - floating positioning and relative offsets
   - bubble visual language and animation parameters
   - chat panel density and interaction feel
   - avatar-stage presentation and playback/lipsync-facing UI state
4. Keep Echo-local runtime/host/bridge semantics unchanged.
5. Add cross-surface verification proving:
   - browser chat -> floating chat transcript sync
   - floating chat -> browser chat transcript sync
   - assistant output reaches browser chat, floating chat, and bubble
   - playback/lipsync activity remains avatar-local

## Explicitly Out Of Scope
- screenshot flow
- standby/presence automation
- multi-session shell
- protocol redesign

## Validation Expectations
1. Preserve or replace existing self-checks with desktop-suite-aware checks.
2. Add one browser-plus-desktop smoke path proving a single turn updates all
   active surfaces.
3. Clearly report any environment-gated Electron verification that still
   requires opt-in launch or installed frontend dependencies.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- `avatar`, `chat`, and `bubble` are high-fidelity UI recreations
- browser and Electron surfaces stay in sync for one single-session turn
- playback and lipsync remain correct and avatar-local
- no protocol or runtime-core redesign is introduced
