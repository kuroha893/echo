# Echo AI Takeover Handoff (2026-03-22)

## Purpose
This document is for a new AI engineer taking over Echo with **zero prior
thread context**.

It gives:

- the minimum project identity and rules
- the current implementation state that has been reported in prior work
- the local source-of-truth files to read first
- the approved local reference material for AIRI and open-yachiyo
- the next likely tasks
- a ready-to-paste takeover prompt

This document is a **handoff aid**, not a replacement for verification. The new
AI must still inspect the local code and docs before claiming anything is
implemented.

---

## Project Identity
Echo is an open-source low-latency Agent Runtime for real-time companion
experiences.

The repository is **runtime-first**, not app-first.

Core priorities from [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md):

1. protocol correctness
2. deterministic state transitions
3. low-latency orchestration
4. interrupt safety
5. expression/memory/plugin extensibility

Default engineering attitude:

- fail fast
- do not add fallback/degraded mode unless explicitly required
- do not invent missing behavior
- do not redesign architecture unless the task explicitly requires it

---

## Mandatory Rules To Read First
Before doing anything substantial, read these in order:

1. [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md)
2. [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md)
3. the current task card under [docs/tasks](/C:/Users/123/Desktop/echo/docs/tasks)
4. the relevant protocol docs:
   - [events.md](/C:/Users/123/Desktop/echo/docs/protocol/events.md)
   - [state-machine.md](/C:/Users/123/Desktop/echo/docs/protocol/state-machine.md)
   - [feedback-rules.md](/C:/Users/123/Desktop/echo/docs/protocol/feedback-rules.md)
   - [orchestrator-spec.md](/C:/Users/123/Desktop/echo/docs/protocol/orchestrator-spec.md)

Important governance constraints:

- do not directly implement Echo core logic from external repositories
- do not change public protocol semantics without updating protocol docs
- do not move logic across package boundaries without explicit approval
- do not claim implementation unless it is verifiable

There is a **narrow local mirrored-source adaptation exception** for:

- [open-yachiyo-main](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main)
- [airi-main](/C:/Users/123/Desktop/echo/docs/reference/airi-main)

Before developing any new features, please first check the open-yachiyo and airi source code to see if the required functionality has already been implemented. Reference their effective implementation methods to avoid unnecessary trial and error.

---

## Current High-Level State
The project is no longer a raw prototype. A substantial speech/avatar/session
stack has already been built.

The most important reported completions are:

- realtime cloned-voice streaming playback for active Qwen TTS
- TTS-only sanitization and chunking
- conditional audible quick-reaction handoff with local-fast gating
- playback-driven lipsync
- face mixer plus non-visible stage cue queue
- same-session bounded recent-context replay
- **Dynamic LLM Expression/Motion Prompt Injection**: The Orchestrator now automatically reads the active Live2D model's `supported_expressions` and `supported_motions` and dynamically injects them into the LLM system prompt, instructing the LLM to actively output `[smile]` and `<action=Greet>` tags to drive character acting.
- **Model Auto-Registration Flow**: A script (`register-models.mjs`) now automatically scans new 3rd-party models, repairs missing references inside `.model3.json`, and generates `scene_manifest.json` making model importing nearly plug-and-play.
- **System Tray Mouse Tracking Toggle**: Mouse tracking (eye tracking) can be seamlessly toggled on/off natively from the OS system tray.
- **Speaking Sway Refinement**: The amplitude of the procedural speaking sway motion has been tuned for naturalness.

This means the current repo should be treated as a **real evolving system**,
not as an untouched scaffold.

---

## Reported Task Status
The following task cards were reported as implemented and should be treated as the recent baseline to verify against:

- [0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md](/C:/Users/123/Desktop/echo/docs/tasks/0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md)
- [0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md](/C:/Users/123/Desktop/echo/docs/tasks/0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md)
- [0085-unify-audible-and-visible-assistant-output.md](/C:/Users/123/Desktop/echo/docs/tasks/0085-unify-audible-and-visible-assistant-output.md)
- [0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md](/C:/Users/123/Desktop/echo/docs/tasks/0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md)
- [0087-adapt-open-yachiyo-face-mixer-and-airi-special-token-expression-queue.md](/C:/Users/123/Desktop/echo/docs/tasks/0087-adapt-open-yachiyo-face-mixer-and-airi-special-token-expression-queue.md)
- [0088-adapt-open-yachiyo-bounded-recent-context-replay.md](/C:/Users/123/Desktop/echo/docs/tasks/0088-adapt-open-yachiyo-bounded-recent-context-replay.md)
- [0089-add-registered-cubism-model-library-and-config-v2-selector.md](/C:/Users/123/Desktop/echo/docs/tasks/0089-add-registered-cubism-model-library-and-config-v2-selector.md) (Registration script and manifest tracking implemented)
- [0090-add-procedural-positive-sway-without-motion-assets.md](/C:/Users/123/Desktop/echo/docs/tasks/0090-add-procedural-positive-sway-without-motion-assets.md) (Amplitudes tuned)

---

## Key Subsystems And Entry Points

### 1. TTS / Streaming Playback
Primary files:

- [qwen3_voice_clone_provider.py](/C:/Users/123/Desktop/echo/packages/tts/qwen3_voice_clone_provider.py)
- [audio_playback_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_playback_controller.mjs)
- [dom_audio_playback_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/dom_audio_playback_backend.mjs)
- [headless_audio_playback_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/headless_audio_playback_backend.mjs)
- [desktop_live2d_audio_sink.py](/C:/Users/123/Desktop/echo/packages/orchestrator/desktop_live2d_audio_sink.py)

What reportedly exists:

- active cloned-voice path uses SSE realtime fragments
- active audio format is constrained to PCM S16LE / 24kHz / mono
- playback starts after prebuffer, not only on final fragment
- final-fragment timeout handling in the Python audio sink was later fixed

### 2. Orchestrator / Quick Reaction / TTS Text Shaping
Primary files:

- [turn_orchestrator.py](/C:/Users/123/Desktop/echo/packages/orchestrator/turn_orchestrator.py)
- [expression_parser.py](/C:/Users/123/Desktop/echo/packages/orchestrator/expression_parser.py)
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- [provider_host_assembly.py](/C:/Users/123/Desktop/echo/apps/desktop-live2d/python/provider_host_assembly.py)

What reportedly exists:

- system prompts dynamically inject the active model's `supported_expressions` and `supported_motions` to aggressively encourage LLM acting tags.
- `expression_parser.py` safely decodes arbitrary `[tag]` expressions and case-preserved `<action=Value>` motions driven by the LLM.
- visible transcript remains canonical
- TTS-facing text is sanitized/chunked separately
- same-session recent context replay now exists for primary prompts

### 3. Lipsync / Face Mixer / Renderer Composition
Primary files:

- [audio_lipsync_analyzer.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_lipsync_analyzer.mjs)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)

What reportedly exists:

- playback-driven mouth signal pipeline
- speaking-aware enhancement/smoothing with properly tuned procedural sway amplitudes.
- face mixer and non-visible delay/expression/motion cue queue

### 4. Desktop Model Assets / Scene Loading
Primary files:

- [model_assets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/bridge/model_assets.mjs)
- [scripts/register-models.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/scripts/register-models.mjs)
- [scene_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_controller.mjs)

What already matters here:

- **Model Registration Script**: Run `node apps/desktop-live2d/scripts/register-models.mjs` to auto-inject missing expressions/motions into new `model3.json` files and create unified `scene_manifest.json` wrappers.
- model assets must remain under `apps/desktop-live2d/assets/models`
- absolute model paths are forbidden, repo-relative model asset resolution is enforced.

### 5. UI and Electron Main Process
- **Mouse Tracking IPC**: `preload.mjs`, `main.mjs`, and `avatar_window_runtime.mjs` are wired to toggle Live2D mouse/eye tracking via the system tray.

---

## Known Remaining Gaps
These are the important capability gaps still believed to remain:

1. **No true long-term memory**
   - current replay is same-session, bounded, short-term context only
   - there is no confirmed durable cross-session companion memory loop in the
     active path

2. **Prosody/naturalness is improved but still heuristic**
   - TTS chunking is much better than before
   - but it is still bounded heuristic logic, not a full linguistic/prosody system

3. **Local-fast advantage is conditional**
   - the best audible quick-prefix flow depends on a genuine local-fast model
   - cloud-backed quick reaction should not be treated as equivalent

---

## Approved Local Reference Material
These are the most relevant approved notes and local mirrors for current work:

### AIRI
- [airi-pixi-live2d-scene.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-pixi-live2d-scene.md)
- [airi-speaking-motion.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-speaking-motion.md)
- local mirror:
  - [airi-main](/C:/Users/123/Desktop/echo/docs/reference/airi-main)

### open-yachiyo
- [open-yachiyo-qwen3-tts-vc.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-qwen3-tts-vc.md)
- [open-yachiyo-desktop-audio-playback-lipsync.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md)
- [open-yachiyo-desktop-live2d-renderer.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md)
- local mirror:
  - [open-yachiyo-main](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main)

---

## Model-Support Boundary For Upcoming Work
If the next AI works on avatar model switching, the intended support boundary is:

- only Cubism models centered on `*.model3.json`
- only these common related file types need to be considered:
  - `*.exp3.json`, `*.motion3.json`, `*.cdi3.json`, `*.cmo3.json`, `*.moc3.json`, `*.model3.json`, `*.physics3.json`

Do **not** expand the task into `.zip` import, `.vrm`, `.pmx`, `.pmd`, or arbitrary absolute paths. Models must stay under `apps/desktop-live2d/assets/models`.

---
