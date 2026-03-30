# Task Card 0080

## Title
Replace browser voice-enrollment path input with drag-and-drop audio upload

## Role
Implementer

## Goal
Remove the current `reference_audio_path` text-input workflow from the active
browser `config v2` voice-enrollment surface and replace it with a bounded
drag-and-drop audio upload flow that lets the browser hand an audio file to the
app-local control plane without asking the user to type a local filesystem path.

## Scope Clarification
This task is a bounded browser/control-plane UX improvement for the active voice
enrollment path.

It must:

- replace the browser `reference_audio_path` text input with a drag-and-drop
  audio file workflow
- keep the active enrollment flow inside `config v2`
- keep the Python-side enrollment request bounded and fail-fast
- avoid protocol/package redesign by materializing a real local temp file before
  calling the existing enrollment operation

It must not:

- redesign provider semantics
- redesign Qwen TTS synthesis/enrollment contracts beyond the smallest app-local
  browser upload adjustment required for the new UX
- add cloud storage, remote uploads, or background asset management
- add demo/fallback audio behavior

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0078-align-qwen-tts-provider-with-current-dashscope-api.md`
- `docs/tasks/0079-remove-onboarding-and-merge-voice-enrollment-into-config-v2.md`
- active browser/control-plane files under:
  - `apps/web-ui/public/config-v2.html`
  - `apps/web-ui/public/config-v2.css`
  - `apps/web-ui/public/config_surface.mjs`
  - `apps/web-ui/public/control_plane_contracts.mjs`
  - `apps/web-ui/control_plane_server.mjs`
- active desktop launch/control-plane wiring only if strictly required for an
  app-owned temp upload directory:
  - `apps/desktop-live2d/electron/main.mjs`
- Python-side enrollment request model only if strictly required:
  - `apps/desktop-live2d/python/provider_settings.py`
- related browser self-check/smoke files

## Files To Create Or Modify
- `apps/web-ui/public/config-v2.html`
- `apps/web-ui/public/config-v2.css`
- `apps/web-ui/public/config_surface.mjs`
- `apps/web-ui/public/control_plane_contracts.mjs`
- `apps/web-ui/control_plane_server.mjs`
- `apps/web-ui/config_surface_self_check.mjs`
- `apps/web-ui/config_onboarding_smoke.mjs`
- `apps/web-ui/control_plane_self_check.mjs` only if required
- `apps/desktop-live2d/electron/main.mjs` only if required to provide an
  app-owned upload/temp directory to the control plane
- `apps/desktop-live2d/python/provider_settings.py` only if strictly required

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/llm/*`
- `packages/tts/*`
- desktop renderer/window UI files outside the control-plane plumbing needed for
  upload storage

## Hard Requirements
1. The active `config v2` voice-enrollment UI must no longer ask the user to
   type a filesystem path like `C:\\path\\to\\voice.wav`.
2. The active UI must support dragging an audio file onto a visible drop target
   in `config v2`.
3. The browser/upload path must reject non-audio files and fail fast with a
   clear user-visible error.
4. The browser/control-plane boundary may introduce a small app-local upload
   contract, but it must stay bounded to the browser control plane and must not
   change `packages/protocol/*`.
5. The implementation must materialize an app-owned local temp file before the
   existing enrollment operation is invoked, so the downstream Python/provider
   flow still receives a real local file path rather than a browser-only file
   handle.
6. Any temp upload file location must be app-owned and non-reference-only. Do
   not write uploaded samples into `docs/reference/*`.
7. Do not silently fall back to the old path-input flow.
8. Do not add fake uploads, canned success, or placeholder enrollment results.
9. Keep fail-fast behavior: if upload persistence or enrollment handoff fails,
   surface the real error and stop.
10. If a temporary compatibility path field must remain internally, it must not
    remain visible on the active product UI.

## Preferred Design Direction
Use the smallest bounded design that keeps core contracts stable:

1. Browser `config v2` drag-and-drop UI accepts an audio file.
2. Browser sends the file to the app-local control plane using a bounded
   browser-only payload shape.
3. The control plane writes the file into an app-owned temp/upload directory.
4. The control plane then invokes the existing enrollment operation with a real
   local `reference_audio_path`.

This is preferred over redesigning the Python enrollment request shape to carry
raw browser file bytes across package boundaries.

## Explicitly Out Of Scope
- redesigning the entire `config v2` page
- changing TTS synthesis behavior
- changing provider readiness semantics
- changing the desktop avatar/chat/bubble product topology
- adding progress bars, background upload queues, or media library features

## Validation Expectations
1. Browser self-checks must prove:
   - `config v2` renders a drag-and-drop audio upload target for voice
     enrollment
   - the old visible `reference_audio_path` text input is gone from the active
     UI
   - non-audio upload rejection is covered
2. Browser smoke must cover:
   - selecting or dropping a bounded test audio sample
   - invoking the active voice-enrollment path through the control plane
   - surfacing enrollment success or real failure without fallback
3. If a temp upload directory is introduced, report:
   - where it lives
   - whether cleanup is immediate, bounded, or deferred
4. Re-run the affected browser self-checks/smokes and any touched control-plane
   checks.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- users can complete voice enrollment from `config v2` by dragging an audio
  file instead of typing a local path
- the active browser UI no longer exposes a visible path-entry enrollment flow
- the browser/control-plane upload path remains bounded and app-local
- downstream enrollment still receives a real local file path
- no new fallback/demo behavior is introduced
