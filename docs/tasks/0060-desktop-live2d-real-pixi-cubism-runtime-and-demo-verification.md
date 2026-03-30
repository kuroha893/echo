# Task Card 0060

## Title
Implement real Pixi/Cubism runtime landing and bounded end-to-end demo verification

## Role
Implementer

## Goal
Land the actual Pixi/Cubism runtime dependencies and make the desktop app
prefer the real renderer runtime in app mode, while preserving deterministic
fallback paths and adding bounded end-to-end demo verification.

## Scope Clarification
This task is the final step of the current real-provider desktop demo line.

It must:

- keep the Python/renderer/app boundaries intact
- keep repo-relative model asset rules intact
- preserve headless/shell fallback paths for offline checks

It must not:

- redesign renderer command semantics
- invent generic public `set_mouth_open` support
- mix in screenshot or standby/presence work

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/action-mapping.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md`
- `docs/reference/approved/airi-pixi-live2d-scene.md`
- completed implementations from tasks50 through 59

## Files To Create Or Modify
- `apps/desktop-live2d/package.json`
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/shared/*`
- `apps/desktop-live2d/scripts/*`

If strictly required to preserve already-approved typed desktop bridge or app
verification flows, you may also modify:

- `packages/renderer/desktop_live2d_bridge.py`
- `tests/renderer/test_desktop_live2d_bridge.py`

Do not modify:

- `packages/protocol/*`
- `packages/renderer/*` public foundation semantics
- `packages/orchestrator/*` playback or parser semantics

## Hard Requirements
1. Add the actual renderer dependencies needed for real Pixi/Cubism app-mode
   runtime.
2. Prefer the real Pixi/Cubism backend in app mode while preserving existing
   headless/shell fallbacks for tests and offline checks.
3. Continue enforcing repo-relative model asset loading only.
4. Keep public renderer-command semantics unchanged; `set_mouth_open` must stay
   unsupported at the public command level.
5. Add bounded end-to-end verification proving that saved provider settings can:
   - boot the desktop host
   - accept one user text turn
   - advance transcript, bubble, renderer activity, playback, and lipsync
6. Split verification into:
   - offline deterministic self-checks
   - opt-in Electron verification
   - opt-in live-provider verification when real credentials or local model
     endpoints are required
7. Do not introduce screenshot UI, standby/presence behavior, or multi-session
   shell logic.

## Explicitly Out Of Scope
- screenshot flow
- standby/presence behavior
- alternate renderer backends
- protocol redesign
- multi-session desktop shell

## Validation Expectations
1. Re-run and preserve existing scene, chat-panel, smoke, and lipsync
   self-checks.
2. Add bounded checks proving the real Pixi/Cubism backend is preferred in app
   mode when dependencies are present.
3. Add opt-in Electron verification for the presentable desktop demo path.
4. Keep offline deterministic verification viable when those dependencies or
   credentials are absent.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- app mode prefers a real Pixi/Cubism runtime when dependencies are installed
- deterministic fallback paths still exist for offline checks
- one bounded end-to-end demo verification path exists above the current desktop
  host, playback, and lipsync lines
- public protocol and renderer-command semantics remain unchanged
