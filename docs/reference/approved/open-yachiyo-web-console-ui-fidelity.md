# Reference Intake: open-yachiyo-web-console-ui-fidelity

## Scope
- Study only the browser-served web console UI under:
  - `docs/reference/open-yachiyo-main/apps/gateway/public`
- Focus on:
  - `chat`
  - `config-v2`
  - `onboarding`
  - shared style tokens, layout proportions, and interaction parameters
- Exclude:
  - gateway backend architecture
  - API route design
  - runtime/tool/permission logic
  - host/session composition semantics

## What Was Studied
- `docs/reference/open-yachiyo-main/apps/gateway/public/system.css`
- `docs/reference/open-yachiyo-main/apps/gateway/public/chat.css`
- `docs/reference/open-yachiyo-main/apps/gateway/public/chat.js`
- `docs/reference/open-yachiyo-main/apps/gateway/public/config-v2.css`
- `docs/reference/open-yachiyo-main/apps/gateway/public/config-v2.html`
- `docs/reference/open-yachiyo-main/apps/gateway/public/config-v2.js`
- `docs/reference/open-yachiyo-main/apps/gateway/public/onboarding.css`
- `docs/reference/open-yachiyo-main/apps/gateway/public/onboarding.html`
- `docs/reference/open-yachiyo-main/apps/gateway/public/onboarding.js`

## Potentially Reusable Ideas
- Dark glassmorphism baseline with strong blue/pink accent gradients.
- Shared CSS token system for background, panel, border, shadow, and text.
- High-density chat layout with left session rail, top status bar, and compact
  composer.
- Config-v2 split layout with an editor-oriented main area and an auxiliary
  assistant/config side panel.
- Onboarding step-card flow with centered container, progress pills, and
  compact multi-column form sections.
- Fine-grained interaction parameters such as hover lift, focus rings, blur,
  and streaming text reveal.

## Reference-Only Ideas
- open-yachiyo's exact session/product concepts, debug tooling scope, and
  gateway route naming are useful shape references but must not become Echo's
  backend contract.
- Its page names and UI hierarchy are appropriate as first-class visual targets
  for Echo's browser console, but only as browser UI surfaces above Echo's own
  app-local control plane.

## Forbidden To Copy
- Gateway/backend route structure, route names, SSE event naming, or request
  payload semantics.
- Runtime, provider, tool, or permission logic embedded in the reference JS.
- Any product scope that would imply multi-session or account-system semantics
  not explicitly accepted in Echo docs.
- Any non-UI architecture decision that conflicts with Echo package boundaries
  or the desktop companion session service boundary.

## Compatibility With Echo
- aligned:
  - Echo needs a browser-served web console rather than an Electron full
    console window.
  - Echo can benefit from a high-fidelity recreation of the chat, config-v2,
    and onboarding surfaces.
  - A browser console above a local app-owned HTTP + SSE control plane is
    compatible with Echo's single-session runtime-first architecture.
- conflicts:
  - Echo must not inherit open-yachiyo gateway backend semantics.
  - Echo must not let browser UI redefine protocol, runtime, or host behavior.
  - Echo must keep single-session scope unless a later task explicitly changes
    that product boundary.

## Final Verdict
`reusable`

## Implementer Guidance
- Use Echo local docs and this note.
- Under Echo's UI fidelity exception, implementers may directly inspect the
  local reference source in:
  - `docs/reference/open-yachiyo-main/apps/gateway/public`
- Direct inspection is allowed only for UI-surface reproduction:
  - style tokens
  - layout
  - DOM structure
  - page composition
  - animation and interaction parameters
  - window/browser presentation details
- Do not transplant gateway/backend semantics, runtime logic, host assembly, or
  protocol/event design from the reference source.
