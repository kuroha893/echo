# TTS Development Docs

This directory is the development doc set for `packages/tts`.

Its purpose is to define Echo's TTS line now that the TTS subsystem is already
real. Echo already has a typed TTS package, a concrete commercial provider, a
voice-enrollment path, provider verification shell, and real orchestrator
integration. The next UI milestone is therefore no longer "make TTS real", but
"keep `packages/tts` stable while the browser console plus floating desktop
suite are rebuilt around it".

These docs do not replace:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/events.md`
3. `docs/protocol/orchestrator-spec.md`
4. `docs/protocol/feedback-rules.md`

They explain how `packages/tts` should be built on top of those rules.

---

## Scope

`packages/tts` owns:

- typed TTS-local request/response contracts
- voice-profile selection and validation
- provider-neutral TTS ports
- TTS provider registry and service facade
- synthesis request normalization from protocol `TTSChunk`
- provider error normalization
- playback-facing audio-fragment streaming boundaries

`packages/tts` does not own:

- expression parsing
- audio ownership policy
- session state transitions
- renderer behavior
- screenshot capture
- memory/plugin logic
- speaker playback
- lip-sync analysis
- browser-console layout or desktop-window UI

---

## Current Status

Implemented and accepted:

- `packages/tts` foundation and service shell
- Qwen3 voice-clone commercial provider shell
- voice-clone enrollment and local reference-audio upload shell
- opt-in live provider verification shell
- real orchestrator TTS integration through `TTSService`

Current demo-oriented TTS mainline:

- keep `packages/tts` stable as the synthesis layer
- keep using the Qwen3 voice-clone provider family through app-local host
  settings and voice enrollment flows
- keep real device playback and app-side lipsync above `packages/tts`
- let the browser console own settings, voice, and onboarding UI while
  floating desktop windows remain playback/character surfaces

Still deferred:

- advanced voice library management beyond the first single-session voice page
- stronger local-provider alternatives such as GPT-SoVITS
- STT work

---

## Document Map

- [architecture.md](/C:/Users/123/Desktop/echo/docs/tts/architecture.md): package boundaries, object model, and stack placement
- [contracts.md](/C:/Users/123/Desktop/echo/docs/tts/contracts.md): TTS-local request, fragment, and error models
- [provider-interface.md](/C:/Users/123/Desktop/echo/docs/tts/provider-interface.md): provider ports, registry rules, and streaming semantics
- [voice-profile-boundary.md](/C:/Users/123/Desktop/echo/docs/tts/voice-profile-boundary.md): typed voice identity and reference-audio boundary
- [voice-clone-enrollment.md](/C:/Users/123/Desktop/echo/docs/tts/voice-clone-enrollment.md): how local reference audio becomes provider-managed cloned voices
- [playback-and-chunking.md](/C:/Users/123/Desktop/echo/docs/tts/playback-and-chunking.md): how protocol `TTSChunk` enters synthesis and exits as audio fragments
- [desktop-playback-bridge.md](/C:/Users/123/Desktop/echo/docs/tts/desktop-playback-bridge.md): the playback path above `packages/tts`
- [error-handling.md](/C:/Users/123/Desktop/echo/docs/tts/error-handling.md): TTS-local failure classes and caller ownership rules
- [provider-verification.md](/C:/Users/123/Desktop/echo/docs/tts/provider-verification.md): opt-in real-network verification and smoke-test rules
- [orchestrator-integration.md](/C:/Users/123/Desktop/echo/docs/tts/orchestrator-integration.md): the accepted `TurnOrchestrator` -> `TTSService` boundary and its desktop-playback step
- [demo-path.md](/C:/Users/123/Desktop/echo/docs/tts/demo-path.md): the shortest TTS path toward the corrected presentable demo
- [qwen3-voice-clone-provider.md](/C:/Users/123/Desktop/echo/docs/tts/qwen3-voice-clone-provider.md): the first concrete TTS provider family chosen for the first demo path
- [gpt-sovits-provider.md](/C:/Users/123/Desktop/echo/docs/tts/gpt-sovits-provider.md): a later local-provider alternative when stronger local voice ownership matters more than first-demo speed
- [roadmap.md](/C:/Users/123/Desktop/echo/docs/tts/roadmap.md): phased task order for TTS work

---

## TTS Invariants

All future TTS work should obey these invariants:

- `packages/tts` is adapter-agnostic at foundation level
- protocol `TTSChunk` remains the upstream public chunk contract
- audio ownership stays with `AudioMutex` and orchestrator, not the TTS package
- provider failures are normalized before leaving `packages/tts`
- `packages/tts` never mutates session state directly
- provider transport details must not leak above the TTS package boundary
- real playback remains above `packages/tts`

---

## Practical Handoff

For the next presentable desktop demo milestone, the repo should now proceed in
this order:

1. keep the TTS synthesis layer as-is
2. wire real Qwen3 provider settings and voice enrollment into the browser
   console and app-local host
3. keep real device playback in the floating desktop suite
4. preserve app-side lipsync on top of that real playback path
5. later add stronger local-provider alternatives such as GPT-SoVITS

The first provider family chosen in this doc set remains a commercial
voice-clone-capable API, concretely Qwen3 TTS VC / realtime-style service as an
external backend. That choice still optimizes for runnable-demo speed while
leaving room for later local alternatives when user-owned voice control becomes
the higher priority.
