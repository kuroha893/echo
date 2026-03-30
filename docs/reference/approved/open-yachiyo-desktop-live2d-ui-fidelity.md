# Reference Intake: open-yachiyo-desktop-live2d-ui-fidelity

## Scope
- Study only the Electron desktop UI surfaces under:
  - `docs/reference/open-yachiyo-main/apps/desktop-live2d`
- Focus on:
  - avatar window presentation
  - floating chat window presentation
  - bubble window presentation
  - window geometry, transparency, and relative positioning
  - renderer-facing UI structure and resize/edit-mode presentation
- Exclude:
  - preload, IPC, and host semantics
  - runtime or bridge ownership
  - protocol/tool contracts
  - provider/runtime orchestration logic

## What Was Studied
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/desktopSuite.js`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/index.html`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bootstrap.js`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/chat.html`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/chat.js`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bubble.html`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/bubble.js`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/layout.js`
- `docs/reference/open-yachiyo-main/apps/desktop-live2d/renderer/resizeMode.js`
- related renderer-side UI helpers under the same directory

## Potentially Reusable Ideas
- Transparent, frameless, always-on-top avatar window as the primary desktop
  character surface.
- Separate floating chat and bubble windows coordinated relative to the avatar
  bounds.
- Compact glassmorphism chat panel and dark translucent bubble presentation.
- Explicit window-size defaults, minimum bounds, and relative placement ratios
  as UI fidelity targets.
- Renderer-side resize/edit-mode visual language for later tuning surfaces.
- Tight integration of playback-facing visual feedback and app-side lipsync on
  the avatar surface.

## Reference-Only Ideas
- open-yachiyo's desktop window choreography is a strong UI reference for Echo,
  but Echo must keep its own app-local router, bridge ownership, and host
  boundary above the desktop suite.
- Its renderer-side helper split is useful for UI layering and behavior review,
  but file/module structure should not override Echo's local implementation
  organization unless a task explicitly chooses to do so for Echo-local reasons.

## Forbidden To Copy
- Preload APIs, IPC channel names, bridge method names, or host-process
  contracts.
- Runtime/session/tool orchestration, permission handling, or service assembly
  logic.
- Any protocol/event semantics or state-machine behavior.
- Any assumption that the desktop suite should own Echo runtime progression.

## Compatibility With Echo
- aligned:
  - Echo's corrected desktop topology is avatar + chat + bubble floating
    windows.
  - Echo benefits from reproducing the window geometry, transparency, and UI
    behavior at high fidelity.
  - App-side lipsync, bubble, and floating chat are compatible with Echo's
    current desktop-live2d direction.
- conflicts:
  - Echo must not inherit open-yachiyo IPC or host architecture as-is.
  - Echo must not let renderer UI redefine core runtime, orchestrator, or
    protocol boundaries.
  - Echo still treats desktop windows as single-session surfaces above the
    existing desktop companion session service.

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs and this note.
- Under Echo's UI fidelity exception, implementers may directly inspect the
  local reference source in:
  - `docs/reference/open-yachiyo-main/apps/desktop-live2d`
- Direct inspection is allowed only for UI-surface reproduction:
  - window style and geometry
  - transparent/floating behavior
  - chat and bubble layout
  - avatar presentation
  - animation, positioning, and resize/edit-mode parameters
- Do not transplant preload/IPC/host/runtime/protocol logic from the reference
  source.
