# Runtime Roadmap

## Purpose

This document defines the intended development order for `packages/runtime`.

It exists to keep runtime tasks small, cumulative, and aligned with the already
completed protocol, orchestrator, llm, tts, and renderer work.

---

## Current Completed Runtime Work

Completed and accepted:

1. [state_driver.py](/C:/Users/123/Desktop/echo/packages/runtime/state_driver.py)
2. [session_runtime.py](/C:/Users/123/Desktop/echo/packages/runtime/session_runtime.py)
3. [transition_context_tracker.py](/C:/Users/123/Desktop/echo/packages/runtime/transition_context_tracker.py)
4. bounded tracker integration inside [session_runtime.py](/C:/Users/123/Desktop/echo/packages/runtime/session_runtime.py)
5. bounded context-free ingest helper inside [session_runtime.py](/C:/Users/123/Desktop/echo/packages/runtime/session_runtime.py)
6. [runtime_registry.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_registry.py)
7. bounded multi-session routing by `session_id`
8. bounded registry-level session outbox peek/drain
9. bounded multi-session effect batch collection
10. [effect_forwarder.py](/C:/Users/123/Desktop/echo/packages/runtime/effect_forwarder.py)
11. bounded runtime-side effect forwarding shell
12. bounded session-local retained error context
13. bounded reset-driven retained-error clearing
14. [recovery_snapshot.py](/C:/Users/123/Desktop/echo/packages/runtime/recovery_snapshot.py)
15. bounded runtime recovery-inspection shell
16. [runtime_supervisor.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_supervisor.py)
17. bounded in-process runtime supervisor shell
18. [runtime_snapshot.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_snapshot.py)
19. bounded tracker/session/registry/supervisor snapshot export/import foundation
20. [runtime_replay.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_replay.py)
21. bounded in-process runtime replay shell
22. [runtime_persistence.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_persistence.py)
23. bounded local persistence backend / storage adapter shell
24. [runtime_service.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_service.py)
25. bounded bridge-ready runtime service shell
26. [runtime_bridge.py](/C:/Users/123/Desktop/echo/packages/runtime/runtime_bridge.py)
27. bounded transport-agnostic runtime bridge-runner shell
28. [orchestrator_bridge.py](/C:/Users/123/Desktop/echo/packages/runtime/orchestrator_bridge.py)
29. bounded concrete in-process orchestrator/runtime bridge shell with deterministic after-turn draining
30. [orchestrator_bridge_artifacts.py](/C:/Users/123/Desktop/echo/packages/runtime/orchestrator_bridge_artifacts.py)
31. bounded persisted bridge-artifact and replay-material shell above the turn-active bridge session
32. [orchestrator_bridge_service.py](/C:/Users/123/Desktop/echo/packages/runtime/orchestrator_bridge_service.py)
33. bounded local orchestrator/runtime bridge service shell above the live bridge session and bridge-artifact layer
34. [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
35. bounded single-session desktop companion composition root above stable llm/orchestrator/tts/renderer/runtime lines

These establish one explicit single-session composition root that should remain
stable while the UI line resets.

---

## Next Runtime Steps

### Phase 7: Desktop Companion Session Service

Status:

- completed by task54

Goal:

- create one explicit single-session composition root for the runnable desktop
  demo above the stable runtime, llm, orchestrator, tts, and renderer layers

See also:

- [desktop-companion-session-service.md](/C:/Users/123/Desktop/echo/docs/runtime/desktop-companion-session-service.md)

---

### Phase 8: Real Provider Desktop Host Assembly

Status:

- completed as backend-chain work by tasks57 through 65

Goal:

- replace the scripted desktop demo host with one explicit real-provider host
  assembly path without redesigning runtime core or protocol semantics

Required outputs:

- typed app-local provider/source settings model
- typed load/save/validate/readiness/enrollment host operations
- real `LLMService` assembly for local and cloud paths
- real `TTSService` assembly for the Qwen3 voice-clone path
- preserved explicit `demo_scripted` fallback for tests/self-check only

Note:

- the Electron full-console product route proven during tasks58 through 65 is
  now deprecated as product UI, but the single-session runtime composition root
  remains accepted

---

### Phase 9: Browser Console And Floating Desktop Suite Reset

Status:

- next runtime-adjacent mainline

Goal:

- keep `DesktopCompanionSessionService` as the single-session composition root
  while rebuilding product surfaces as:
  - browser web console
  - floating avatar window
  - floating chat window
  - floating bubble window

Required outputs:

- app-local browser control plane above the stable session service
- browser console state/readiness/transcript sync
- continued desktop-suite sync without changing protocol semantics

Non-goals:

- multi-session desktop manager
- standby/presence logic
- screenshot flow
- runtime-core redesign

---

## Explicitly Deferred Work

These are not the next runtime tasks:

- multi-session desktop shell management
- standby/presence scheduling
- screenshot and multimodal session flows
- plugin and memory runtime integration redesign
- deeper runtime-core refactors without a real product blocker
