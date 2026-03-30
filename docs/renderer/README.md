# Renderer Development Docs

This directory is the development doc set for `packages/renderer` and Echo's
desktop-facing product surfaces.

Its purpose is to define Echo's renderer path now that the renderer subsystem
is already real. Echo already has a real renderer package, a real
desktop-live2d backend, a bounded bubble shell, a chat-window prototype, and an
app-side lipsync shell. The next UI milestone is therefore no longer "make
renderer exist" or "make the desktop demo runnable", but "reset the product
surfaces so Echo ships a browser web console plus a floating desktop suite".

These docs do not replace:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/events.md`
3. `docs/protocol/orchestrator-spec.md`
4. `docs/protocol/renderer-commands.md`

They explain how the renderer line should be built on top of those rules.

---

## Scope

`packages/renderer` owns:

- typed renderer-local dispatch and error contracts
- typed adapter capability/profile models
- renderer adapter registry and service facade
- normalization from protocol `RendererCommand` into renderer-local dispatch
- typed failure surfaces above concrete adapters

`apps/desktop-live2d` owns:

- Electron app shell and floating windows
- local bridge/session boundary
- PixiJS + Live2D scene runtime
- concrete full-body model loading and command execution
- app-side bubble window shell
- app-side floating chat window shell
- app-side audio-driven lipsync
- desktop window geometry and floating-window coordination

the browser console app owns:

- browser-served `chat`
- browser-served `config-v2`
- browser-served `onboarding`
- provider/settings UI
- readiness/debug UI

Neither layer owns:

- session state transitions
- audio ownership policy
- TTS synthesis
- screenshot capture policy
- runtime bridge semantics

---

## Current Status

Implemented and accepted backend-chain work:

- protocol `RendererCommand` and `renderer.command.issued` event boundary
- `packages/renderer` foundation and service shell
- real `TurnOrchestrator` renderer integration through `RendererService`
- `packages/renderer/desktop_live2d_bridge.py`
- `apps/desktop-live2d` app shell and bridge baseline
- deterministic scene controller for:
  - `set_state`
  - `set_expression`
  - `set_motion`
  - `clear_expression`
- app-side streaming bubble shell
- desktop-owned playback bridge above `packages/tts`
- single-session desktop companion session service
- desktop chat history panel prototype
- app-side audio-driven lipsync shell

Historically completed but no longer accepted as target product UI:

- Electron full console shell
- right-side embedded stage presentation
- Electron-owned `Chat / Services / Voice` product surface

Current renderer-adjacent UI mainline:

- treat tasks58 through 65 as backend-chain prototype work, not accepted
  product UI
- move provider/settings/chat/onboarding surfaces to a browser-served web
  console
- keep Electron focused on `avatar`, `chat`, and `bubble` floating windows
- rebuild all user-facing UI to high-fidelity open-yachiyo-class surfaces

Still deferred:

- generic upstream `set_mouth_open` support
- standby/presence scene automation
- screenshot overlay or in-app multimodal UX
- VTube Studio or other alternate renderer backends

---

## Document Map

- [architecture.md](/C:/Users/123/Desktop/echo/docs/renderer/architecture.md): package/app/scene layering and ownership
- [contracts.md](/C:/Users/123/Desktop/echo/docs/renderer/contracts.md): typed renderer-local request/result/failure model family
- [adapter-interface.md](/C:/Users/123/Desktop/echo/docs/renderer/adapter-interface.md): adapter port, registry, and capability rules
- [action-mapping.md](/C:/Users/123/Desktop/echo/docs/renderer/action-mapping.md): how protocol command types map into the first backend scene actions
- [orchestrator-integration.md](/C:/Users/123/Desktop/echo/docs/renderer/orchestrator-integration.md): the accepted `TurnOrchestrator` -> `RendererService` boundary
- [chat-history-panel.md](/C:/Users/123/Desktop/echo/docs/renderer/chat-history-panel.md): the first app-side current-session input/history surface
- [desktop-provider-settings.md](/C:/Users/123/Desktop/echo/docs/renderer/desktop-provider-settings.md): the provider/settings ownership boundary after the browser-console reset
- [demo-path.md](/C:/Users/123/Desktop/echo/docs/renderer/demo-path.md): the shortest path from today's renderer line to the corrected demo surfaces
- [roadmap.md](/C:/Users/123/Desktop/echo/docs/renderer/roadmap.md): phased renderer and renderer-adjacent task order
- [open-yachiyo-desktop-live2d-ui-fidelity.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md): approved direct-inspection note for desktop window UI fidelity
- [open-yachiyo-web-console-ui-fidelity.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md): approved direct-inspection note for browser console UI fidelity

---

## Renderer Invariants

All future renderer work should obey these invariants:

- protocol `RendererCommand` remains the upstream public command contract
- `packages/renderer` stays transport-agnostic at foundation level
- renderer failures are normalized before leaving `packages/renderer`
- renderer adapters must not mutate session/runtime state directly
- browser console and Electron shell concerns stay out of `packages/renderer`
- the first concrete backend targets a full-body standing character window
- `set_mouth_open` remains a real protocol command but an explicitly deferred
  backend capability until a later public renderer task lands

---

## Practical Handoff

The first visible renderer line is already real. The repo should now proceed in
this order:

1. governance update for UI direct-inspection and high-fidelity reproduction
2. browser-served web console aligned to open-yachiyo `apps/gateway/public`
3. Electron desktop suite aligned to open-yachiyo `apps/desktop-live2d`
4. synchronized browser console + avatar/chat/bubble product surfaces
5. later standby/presence and screenshot work

Renderer is no longer the missing subsystem. The next work is the product-surface
reset that lets the existing renderer backend collaborate with a browser
control surface, real providers, real device playback, and a corrected floating
desktop suite.
