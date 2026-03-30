# Reference Intake: open-yachiyo-runtime

## Scope
- Study only the runtime-related parts of `open-yachiyo` that are relevant to Echo's current runtime line.
- Focus on event flow, state handling, context building, and session-side runtime boundaries.
- Exclude renderer, desktop UI, persona, skills, and other non-runtime subsystems except where they reveal runtime coupling risks.

## What Was Studied
- `docs/reference/open-yachiyo-main/apps/runtime/loop/README.md`
- `docs/reference/open-yachiyo-main/apps/runtime/loop/stateMachine.js`
- `docs/reference/open-yachiyo-main/apps/runtime/session/contextBuilder.js`
- `docs/reference/open-yachiyo-main/apps/runtime/bus/eventBus.js`
- Echo-local comparison inputs:
  - `docs/protocol/events.md`
  - `docs/protocol/state-machine.md`
  - `docs/runtime/README.md`
  - `docs/runtime/architecture.md`
  - `docs/runtime/session-runtime.md`
  - `docs/runtime/state-driver.md`
  - `docs/runtime/transition-context-tracker.md`

## Potentially Reusable Ideas
- Keeping runtime boundaries explicit between:
  - event intake
  - session context assembly
  - state handling
  - tool-loop or external waiting logic
- Using a small context builder to turn session-local facts into bounded prompt/runtime context instead of spreading that logic everywhere.
- Treating event waiting and event publishing as first-class runtime concerns when a later Echo task reaches event-routing or bus integration.
- Preserving narrow runtime helpers instead of forcing every capability into one giant session object.

## Reference-Only Ideas
- `RuntimeEventBus` patterns from `eventBus.js`
  - useful as a conceptual reminder that runtime effects may later need ordered publish/subscribe and timeout-based waiting
  - not suitable to copy directly because Echo is intentionally building protocol-first typed outboxes before any bus abstraction
- `contextBuilder.js`
  - useful as a reminder that recent session context should be bounded and normalized
  - not directly aligned with Echo's current `TransitionContextTracker`, which tracks state-machine guard facts rather than prompt message history
- `ToolLoopRunner` note in `apps/runtime/loop/README.md`
  - useful as a high-level example that runtime may need a structured loop around tool calls
  - belongs to a later Echo subsystem after protocolized tool-loop design is complete

## Forbidden To Copy
- The `open-yachiyo` runtime directory structure as-is.
- Its coarse `RuntimeStateMachine` in `stateMachine.js`, which uses generic states like `IDLE`, `RUNNING`, `DONE`, `ERROR`, `ABORTED` and does not match Echo's canonical session states or transition semantics.
- Any direct event-bus-first architecture that bypasses Echo's typed `ProtocolEvent`, `SessionState`, `TransitionContext`, and canonical state driver.
- Any implementation approach that mixes session management, bus transport, tool execution, and broader app runtime concerns into one shared runtime layer.

## Compatibility With Echo
- aligned:
  - runtime should stay explicit about ownership boundaries
  - session-local context construction is a real runtime concern
  - later runtime layers may benefit from ordered event forwarding and waiting boundaries
- conflicts:
  - Echo is protocol-first and state-machine-first; `open-yachiyo` runtime is broader and more application-runtime-oriented
  - Echo separates `packages/runtime` from `packages/orchestrator`, while `open-yachiyo` runtime mixes loop, bus, tooling, session, and orchestrator-adjacent responsibilities
  - Echo's canonical states and transition guards are already specified in local protocol docs and must not be replaced by `open-yachiyo`'s simpler runtime state model
  - Echo currently requires typed local outboxes and bounded session shells before bus integration, while `open-yachiyo` already centers a generic runtime event bus

## Final Verdict
`reference-only`

## Implementer Guidance
- Use Echo local docs plus this note.
- Do not code directly from the `open-yachiyo` repository structure or source files.
- If a future Echo task reaches runtime bus integration, tool-loop execution, or session context assembly beyond guard tracking, this note may be cited for high-level comparison only.
- Echo implementers must continue to treat local protocol docs as the source of truth for:
  - event semantics
  - state-machine transitions
  - runtime package boundaries
