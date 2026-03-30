# Task Card 0061

## Title
Stabilize `demo_scripted` desktop host mode with unmatched-turn fallback

## Role
Implementer

## Goal
Make the desktop host's `demo_scripted` mode complete a bounded turn for
arbitrary simple text input instead of failing with route-level scripted-plan
errors such as unmatched `quick_reaction` requests.

## Scope Clarification
This task is limited to the desktop host assembly and demo-scripted provider
configuration path.

It must:

- preserve `demo_scripted` as an offline deterministic demo mode
- keep existing real-provider stack behavior unchanged
- stop quick-reaction and primary-response route misses from surfacing as chat
  UI failures

It must not:

- redesign `packages/llm/*`
- redesign `packages/tts/*`
- change orchestrator semantics
- change desktop window topology

## Allowed Context
- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/orchestrator-spec.md`
- `docs/runtime/desktop-companion-session-service.md`
- `docs/tasks/0057-desktop-provider-source-config-and-real-host-assembly.md`
- completed implementations from tasks54 through 60
- `apps/desktop-live2d/python/*`

## Files To Create Or Modify
- `apps/desktop-live2d/python/provider_host_assembly.py`
- `apps/desktop-live2d/python/companion_service_host.py`
- related Python test files under `tests/runtime/` if required

If strictly required to preserve the existing desktop host boundary, you may
also modify:

- `apps/desktop-live2d/python/provider_settings.py`

Do not modify:

- `packages/protocol/*`
- `packages/llm/*` provider semantics
- `packages/tts/*` provider semantics
- `packages/orchestrator/*`
- `apps/desktop-live2d/electron/*`
- `apps/desktop-live2d/renderer/*`

## Hard Requirements
1. `demo_scripted` must stop failing on unmatched `quick_reaction` or
   `primary_response` route requests.
2. Add a bounded fallback path so arbitrary simple user text still yields:
   - a short safe quick reaction
   - a short deterministic primary reply
3. The fallback path must stay inside desktop host assembly or scripted desktop
   host setup; do not push this policy into shared llm foundation code.
4. Existing explicit scripted plans must continue to work when they match.
5. Real-provider stack assembly and readiness reporting must remain unchanged.
6. No protocol, renderer-command, or TTS contract changes.

## Explicitly Out Of Scope
- changing desktop UI behavior
- adding richer scripted personas
- changing real-provider validation rules
- three-window desktop suite work

## Validation Expectations
1. Add Python tests proving that:
   - unmatched `demo_scripted` quick-reaction input no longer raises a route
     miss
   - unmatched `demo_scripted` primary input still completes the turn
   - existing scripted-plan hits still behave as before
2. Re-run desktop companion session service tests affected by host assembly.
3. Clearly report whether real-provider host tests were not re-run.

## Output Format
1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

## Acceptance Criteria
- arbitrary simple text input completes in `demo_scripted`
- route-level scripted-plan misses no longer leak into the chat UI
- real-provider stack behavior remains intact
