# Task Card 0071

## Title
Remove deprecated UI assets and decontaminate entrypoints

## Role
Implementer

## Goal
Audit the current UI codebase for deprecated or prototype-era surfaces, then
remove only the truly unused or superseded UI assets while preserving the
accepted product paths:

- browser web console under `apps/web-ui`
- floating Electron `avatar`
- floating Electron `chat`
- floating Electron `bubble`

## Scope Clarification
This task is a UI contamination audit and cleanup task.

It must:

- identify which UI files are still part of the accepted product path
- identify which UI files are deprecated but still harmless
- identify which UI files are unused and should be deleted
- remove unused deprecated UI files and dead entrypoint references
- preserve the current accepted browser/Electron product surfaces

It must not:

- redesign any UI surface again
- rewrite browser chat/config/onboarding
- rewrite avatar/chat/bubble windows
- change protocol, runtime, orchestrator, renderer, or TTS semantics

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/renderer/README.md`
- `docs/renderer/architecture.md`
- `docs/renderer/roadmap.md`
- `docs/reference/approved/open-yachiyo-web-console-ui-fidelity.md`
- `docs/reference/approved/open-yachiyo-desktop-live2d-ui-fidelity.md`
- completed implementations from tasks66 through 70
- current UI code under:
  - `apps/web-ui/*`
  - `apps/desktop-live2d/electron/*`
  - `apps/desktop-live2d/renderer/*`
  - `apps/desktop-live2d/scripts/*`

## Files To Create Or Modify
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/renderer/*`
- `apps/desktop-live2d/scripts/*`
- `apps/web-ui/*` only if a deprecated UI dependency or stale smoke/self-check
  reference must be removed

You may delete deprecated UI files if and only if the task's audit proves they
are no longer part of the accepted product path.

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- `packages/renderer/*`
- `apps/desktop-live2d/python/*`

## Hard Requirements
1. Start with a concrete UI contamination audit before deleting anything.
2. The audit must classify current UI files into exactly these buckets:
   - active product path
   - deprecated but still referenced
   - dead / safe to remove
3. Use the accepted product topology as the source of truth:
   - browser web console in `apps/web-ui`
   - Electron `avatar`
   - Electron `chat`
   - Electron `bubble`
4. Remove only the files and entrypoint references that are proven dead or
   superseded.
5. Clean up stale imports, launch URLs, smoke references, self-check references,
   and helper references that still point at deprecated UI.
6. Preserve all currently correct new entrypoints and chains:
   - browser control plane
   - browser chat/config/onboarding
   - Electron avatar/chat/bubble suite
   - cross-surface sync verification
7. If a deprecated file is still indirectly required by an accepted path, do
   not delete it in this task; instead, keep it and clearly report the blocker.
8. Update any local docs or task status notes only if needed to reflect the
   final removed-vs-retained UI asset set.

## Explicitly Out Of Scope
- new UI redesign
- pixel polish
- browser control-plane contract changes
- Python host changes
- protocol/runtime/renderer semantics
- screenshot, standby/presence, or multi-session work

## Validation Expectations
1. Re-run all remaining relevant UI self-checks after cleanup.
2. Re-run browser smoke checks that validate:
   - control plane
   - chat surface
   - config/onboarding
3. Re-run desktop suite smoke/self-checks that validate:
   - suite routing
   - avatar
   - chat
   - bubble
   - browser/desktop sync
4. Clearly report which deprecated UI files were deleted, which were retained,
   and why.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

The Summary must begin with a concise audit result that lists:

- active product-path UI assets
- deleted deprecated UI assets
- retained deprecated UI assets that still need follow-up

## Acceptance Criteria
- a concrete UI contamination audit is performed first
- truly dead deprecated UI files are removed
- stale references to removed UI are also cleaned up
- accepted browser and Electron product paths still run
- no protocol or runtime-core behavior changes are introduced
