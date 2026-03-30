# Task Card 0075

## Title
Audit and purge active-path hardcoded demo literals, canned returns, and non-production stubs

## Role
Implementer

## Goal
Perform one explicit audit of the active browser and desktop product path, then
remove hardcoded demo literals, canned return values, and non-production stubs
that remain after the single-mode and canonical-asset work.

## Scope Clarification
This task is a post-0072/0074 cleanup and audit task.

It must:

- audit the active product path
- classify findings as active / retained-test-only / dead
- remove non-production hardcoded literals and canned values from the active
  path

It must not:

- redesign architecture
- delete low-level self-check harnesses that are still explicitly test-only
- rewrite protocol or runtime semantics

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/tasks/0072-retire-demo-scripted-and-collapse-to-single-production-mode.md`
- `docs/tasks/0073-remove-mode-selection-ui-and-demo-scripted-surface-traces.md`
- `docs/tasks/0074-canonicalize-live2d-production-asset-paths-and-remove-legacy-model-references.md`
- completed implementations from tasks66 through 74

## Files To Create Or Modify
- active product-path files under:
  - `apps/web-ui/**`
  - `apps/desktop-live2d/**`
  - `packages/renderer/**`
- any audit note or task-completion summary file strictly required by the task

Do not modify:

- `packages/protocol/*`
- `packages/runtime/*`
- `packages/orchestrator/*`
- non-UI provider implementation semantics in `packages/llm/*` or `packages/tts/*`

## Hard Requirements
1. Audit the active product path and explicitly bucket each hardcoded/demo item
   as:
   - active-path blocker
   - retained test-only harness
   - dead removable residue
2. Remove active-path hardcoded demo literals such as:
   - canned assistant demo replies
   - forced “turn completed” style product-visible debug strings if still
     present in active UI
   - demo labels/tooltips/copy
   - stale hardcoded asset aliases
3. Remove active-path non-production stubs that exist only to satisfy prior
   demo acceptance and are no longer needed once cloud primary + TTS are the
   only production path.
4. Keep explicit self-check fixtures allowed only if:
   - they are not on the product path
   - they are clearly test-only
5. Report every retained test-only hardcoded fixture instead of silently
   leaving it ambiguous.

## Explicitly Out Of Scope
- adding new product features
- changing model/window interaction design
- changing provider contracts
- changing orchestrator behavior

## Validation Expectations
1. Re-run the affected desktop/browser self-checks and smokes after the purge.
2. Include the audit buckets in the implementation summary.
3. Clearly list any retained hardcoded test fixtures and why they remain.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- active product path no longer contains obvious demo-scripted literals or
  canned return stubs
- retained hardcoded values are limited to explicit non-product test harnesses
- the implementation report includes an audit bucket for every retained item
