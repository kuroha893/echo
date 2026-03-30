# Echo AI Takeover Handoff (2026-03-21)

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

But only when the current task card explicitly permits it, and only for the
named adaptation subsystems. Read the exact rule in
[AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md) before using those mirrors.

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

There were also later follow-up fixes after those tasks:

- Chinese list/chunking behavior was improved
- OpenAI Responses `[DONE]`-without-`response.completed` handling was fixed
- expression reset and mouth application timing in Pixi were tightened
- final audio-fragment timeout handling in the desktop audio sink was fixed

This means the current repo should be treated as a **real evolving system**,
not as an untouched scaffold.

---

## Reported Task Status
The following task cards were reported as implemented in the prior development
session and should be treated as the recent baseline to verify against:

- [0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md](/C:/Users/123/Desktop/echo/docs/tasks/0083-adapt-open-yachiyo-realtime-streaming-playback-for-active-qwen-tts.md)
- [0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md](/C:/Users/123/Desktop/echo/docs/tasks/0084-adapt-airi-grapheme-safe-tts-chunking-and-sanitization.md)
- [0085-unify-audible-and-visible-assistant-output.md](/C:/Users/123/Desktop/echo/docs/tasks/0085-unify-audible-and-visible-assistant-output.md)
- [0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md](/C:/Users/123/Desktop/echo/docs/tasks/0086-adapt-open-yachiyo-playback-driven-lipsync-for-echo.md)
- [0087-adapt-open-yachiyo-face-mixer-and-airi-special-token-expression-queue.md](/C:/Users/123/Desktop/echo/docs/tasks/0087-adapt-open-yachiyo-face-mixer-and-airi-special-token-expression-queue.md)
- [0088-adapt-open-yachiyo-bounded-recent-context-replay.md](/C:/Users/123/Desktop/echo/docs/tasks/0088-adapt-open-yachiyo-bounded-recent-context-replay.md)

Newer authored future-facing task cards exist for:

- [0089-add-registered-cubism-model-library-and-config-v2-selector.md](/C:/Users/123/Desktop/echo/docs/tasks/0089-add-registered-cubism-model-library-and-config-v2-selector.md)
- [0090-add-procedural-positive-sway-without-motion-assets.md](/C:/Users/123/Desktop/echo/docs/tasks/0090-add-procedural-positive-sway-without-motion-assets.md)

Do **not** assume 0089/0090 are untouched. The repo already contains some
relevant assets such as:

- [model_library_registry.json](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models/model_library_registry.json)
- [open-yachiyo-kaguya-lite](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite)

So the next AI must inspect the current code and determine whether 0089 is:

- not started
- partially implemented
- or already significantly advanced

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
- [desktop_companion_session_service.py](/C:/Users/123/Desktop/echo/packages/runtime/desktop_companion_session_service.py)
- [openai_responses_provider.py](/C:/Users/123/Desktop/echo/packages/llm/openai_responses_provider.py)

What reportedly exists:

- visible transcript remains canonical
- TTS-facing text is sanitized/chunked separately
- quick reaction may be audible only when genuinely local-fast-backed
- `ACTION_FEEDBACK` can short-circuit locally
- audible local quick prefix can hand off to primary via assistant-prefill
- same-session recent context replay now exists for primary prompts
- `[DONE]`-terminated OpenAI Responses streams with accumulated text are now accepted instead of misclassified as malformed

### 3. Lipsync / Face Mixer / Renderer Composition
Primary files:

- [audio_lipsync_analyzer.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_lipsync_analyzer.mjs)
- [audio_lipsync_contracts.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_lipsync_contracts.mjs)
- [audio_playback_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/audio_playback_controller.mjs)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [expression_parser.py](/C:/Users/123/Desktop/echo/packages/orchestrator/expression_parser.py)

What reportedly exists:

- playback-driven mouth signal pipeline
- speaking-aware enhancement/smoothing
- quick-prefix to primary handoff continuity window
- face mixer
- non-visible delay/expression/motion cue queue
- Pixi-side `beforeModelUpdate` hook for stable mouth/face application
- expression clearing now uses real expression-manager reset semantics

### 4. Desktop Model Assets / Scene Loading
Primary files:

- [model_assets.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/bridge/model_assets.mjs)
- [scene_controller.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_controller.mjs)
- [scene_stdio_bridge.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/scene_stdio_bridge.mjs)
- [pixi_cubism_backend.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/shared/pixi_cubism_backend.mjs)
- [config_surface.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/config_surface.mjs)
- [control_plane_contracts.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/public/control_plane_contracts.mjs)
- [control_plane_server.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/control_plane_server.mjs)

What already matters here:

- model assets must remain under [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)
- absolute model paths are forbidden
- repo-relative model asset resolution is already enforced
- model manifests already surface supported states/expressions/motions

### 5. Tests / Self-Checks
Important verification files and areas:

- [tests/orchestrator](/C:/Users/123/Desktop/echo/tests/orchestrator)
- [tests/runtime](/C:/Users/123/Desktop/echo/tests/runtime)
- [tests/tts](/C:/Users/123/Desktop/echo/tests/tts)
- [tests/llm](/C:/Users/123/Desktop/echo/tests/llm)
- [renderer self-checks](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer)

Particularly important self-check names you may want to rerun when touching avatar/speech behavior:

- [device_audio_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/device_audio_self_check.mjs)
- [lipsync_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/lipsync_self_check.mjs)
- [pixi_runtime_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/pixi_runtime_self_check.mjs)
- [chat_surface_self_check.mjs](/C:/Users/123/Desktop/echo/apps/web-ui/chat_surface_self_check.mjs)
- [chat_window_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/chat_window_self_check.mjs)
- [bubble_window_self_check.mjs](/C:/Users/123/Desktop/echo/apps/desktop-live2d/renderer/bubble_window_self_check.mjs)

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

3. **Expressiveness still depends on model assets**
   - face blend and lipsync are much stronger now
   - but large, rich body motions still depend on model resources

4. **Local-fast advantage is conditional**
   - the best audible quick-prefix flow depends on a genuine local-fast model
   - cloud-backed quick reaction should not be treated as equivalent

5. **Model-library / model-switching work is still a likely next frontier**
   - see [0089-add-registered-cubism-model-library-and-config-v2-selector.md](/C:/Users/123/Desktop/echo/docs/tasks/0089-add-registered-cubism-model-library-and-config-v2-selector.md)

6. **Procedural asset-free positive micro-motion is still a likely next frontier**
   - see [0090-add-procedural-positive-sway-without-motion-assets.md](/C:/Users/123/Desktop/echo/docs/tasks/0090-add-procedural-positive-sway-without-motion-assets.md)

---

## Approved Local Reference Material
These are the most relevant approved notes and local mirrors for current work:

### AIRI
- [airi-pixi-live2d-scene.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-pixi-live2d-scene.md)
- [airi-speaking-motion.md](/C:/Users/123/Desktop/echo/docs/reference/approved/airi-speaking-motion.md)
- local mirror:
  - [airi-main](/C:/Users/123/Desktop/echo/docs/reference/airi-main)

Use AIRI primarily for:

- model-picker UX
- runtime motion discovery
- parameter-driven scene motion
- standard Cubism parameter control

### open-yachiyo
- [open-yachiyo-qwen3-tts-vc.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-qwen3-tts-vc.md)
- [open-yachiyo-desktop-audio-playback-lipsync.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-audio-playback-lipsync.md)
- [open-yachiyo-desktop-live2d-renderer.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-desktop-live2d-renderer.md)
- [open-yachiyo-runtime.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-runtime.md)
- local mirror:
  - [open-yachiyo-main](/C:/Users/123/Desktop/echo/docs/reference/open-yachiyo-main)

Use open-yachiyo primarily for:

- realtime desktop audio playback patterns
- lipsync discipline
- face-mixer discipline
- desktop renderer shell assumptions
- bounded same-session context assembly

### Other
- [sglang-local-fast-path.md](/C:/Users/123/Desktop/echo/docs/reference/approved/sglang-local-fast-path.md)

---

## Model-Support Boundary For Upcoming Work
If the next AI works on avatar model switching, the intended support boundary is:

- only Cubism models centered on `*.model3.json`
- only these common related file types need to be considered:
  - `*.exp3.json`
  - `*.motion3.json`
  - `*.cdi3.json`
  - `*.cmo3.json`
  - `*.moc3.json`
  - `*.model3.json`
  - `*.physics3.json`

Do **not** expand the task into:

- `.zip` import
- `.vrm`
- `.pmx`
- `.pmd`
- arbitrary user-selected absolute filesystem paths

Also do **not** hardcode absolute model paths. Echo may run on a different
machine.

The intended tidy model root is:

- [apps/desktop-live2d/assets/models](/C:/Users/123/Desktop/echo/apps/desktop-live2d/assets/models)

---

## Recommended First Steps For The New AI
If you are the new AI taking over:

1. Read [AGENTS.md](/C:/Users/123/Desktop/echo/AGENTS.md) and [ai-engineering-constitution.md](/C:/Users/123/Desktop/echo/docs/governance/ai-engineering-constitution.md).
2. Read the current task card you intend to execute.
3. Read only the minimum relevant protocol docs.
4. Inspect the current implementation files directly before trusting this handoff.
5. Rerun the nearest tests/self-checks before and after changes.
6. Prefer small, isolated changes.
7. Do not add fallback/degraded behavior unless the task explicitly requires it.

If you are asked to debug rather than build:

1. identify the current task card or latest relevant task card
2. inspect changed files
3. rerun the closest unit tests/self-checks first
4. only then decide whether the bug is:
   - a regression
   - an uncovered edge case
   - or a missing task-card requirement

---

## Ready-To-Paste Takeover Prompt
Use the prompt below for another AI session:

```text
You are taking over Project Echo at:
C:\Users\123\Desktop\echo

You have no prior thread context. Before doing anything else:

1. Read:
   - C:\Users\123\Desktop\echo\AGENTS.md
   - C:\Users\123\Desktop\echo\docs\governance\ai-engineering-constitution.md
2. Then read the current task card I ask you to work on.
3. Then read only the minimum relevant protocol docs:
   - C:\Users\123\Desktop\echo\docs\protocol\events.md
   - C:\Users\123\Desktop\echo\docs\protocol\state-machine.md
   - C:\Users\123\Desktop\echo\docs\protocol\feedback-rules.md
   - C:\Users\123\Desktop\echo\docs\protocol\orchestrator-spec.md

Project constraints you must follow:

- fail fast, do not add fallback/degraded paths unless explicitly required
- do not invent behavior that is not defined in local docs/task cards
- do not change public protocol semantics without updating protocol docs
- do not redesign architecture unless the task explicitly requires it
- do not directly copy external repo core logic

Important current background you must independently verify from local code before claiming anything:

- task cards 0083-0088 were previously reported complete:
  - realtime cloned-voice streaming playback
  - TTS-only sanitization/chunking
  - conditional audible quick-reaction handoff
  - playback-driven lipsync
  - face mixer + special cue queue
  - same-session bounded recent-context replay
- later fixes reportedly landed for:
  - Chinese chunking
  - OpenAI Responses [DONE] completion handling
  - Pixi mouth/expression update timing
  - desktop audio-sink final-fragment timeout handling

Primary files to inspect when relevant:

- TTS / playback:
  - C:\Users\123\Desktop\echo\packages\tts\qwen3_voice_clone_provider.py
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\audio_playback_controller.mjs
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\dom_audio_playback_backend.mjs
  - C:\Users\123\Desktop\echo\packages\orchestrator\desktop_live2d_audio_sink.py
- Orchestrator / quick reaction / replay:
  - C:\Users\123\Desktop\echo\packages\orchestrator\turn_orchestrator.py
  - C:\Users\123\Desktop\echo\packages\runtime\desktop_companion_session_service.py
  - C:\Users\123\Desktop\echo\packages\llm\openai_responses_provider.py
- Renderer / lipsync / face:
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\audio_lipsync_analyzer.mjs
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\shared\pixi_cubism_backend.mjs
  - C:\Users\123\Desktop\echo\packages\orchestrator\expression_parser.py
- Model assets / scene loading:
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\bridge\model_assets.mjs
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\renderer\scene_controller.mjs
  - C:\Users\123\Desktop\echo\apps\web-ui\public\config_surface.mjs
  - C:\Users\123\Desktop\echo\apps\web-ui\public\control_plane_contracts.mjs
  - C:\Users\123\Desktop\echo\apps\web-ui\control_plane_server.mjs

Important approved local references:

- AIRI:
  - C:\Users\123\Desktop\echo\docs\reference\approved\airi-pixi-live2d-scene.md
  - C:\Users\123\Desktop\echo\docs\reference\approved\airi-speaking-motion.md
  - C:\Users\123\Desktop\echo\docs\reference\airi-main
- open-yachiyo:
  - C:\Users\123\Desktop\echo\docs\reference\approved\open-yachiyo-qwen3-tts-vc.md
  - C:\Users\123\Desktop\echo\docs\reference\approved\open-yachiyo-desktop-audio-playback-lipsync.md
  - C:\Users\123\Desktop\echo\docs\reference\approved\open-yachiyo-desktop-live2d-renderer.md
  - C:\Users\123\Desktop\echo\docs\reference\approved\open-yachiyo-runtime.md
  - C:\Users\123\Desktop\echo\docs\reference\open-yachiyo-main

If you work on avatar model switching, keep the support boundary narrow:

- only support Cubism model3-family packages with:
  - *.exp3.json
  - *.motion3.json
  - *.cdi3.json
  - *.cmo3.json
  - *.moc3.json
  - *.model3.json
  - *.physics3.json
- do not support arbitrary absolute-path imports
- keep models under:
  - C:\Users\123\Desktop\echo\apps\desktop-live2d\assets\models

Expected working style:

- first state your role: Architect / Implementer / Auditor
- state what files you will inspect
- state what files you will change
- state what you will not change
- then proceed

At the end of the task, output:

1. Summary of what was done
2. Files changed
3. Key design decisions
4. Risks / limitations
5. Validation or tests run
6. What was intentionally not changed

Do not trust this prompt blindly. Verify the current repo state before making claims.
```

---

## Final Reminder
This handoff should make the next AI faster and less hallucination-prone, but
it does not replace:

- reading local source of truth
- verifying the current repo state
- rerunning local tests/self-checks

If the next AI finds the repo has drifted beyond this handoff, local code and
task cards win.
