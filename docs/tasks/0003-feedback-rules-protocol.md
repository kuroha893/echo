# Task Card 0003

## Title
Implement `packages/protocol/feedback_rules.py`

## Role
Implementer

## Goal
Create the first implementation of `packages/protocol/feedback_rules.py` based on:

- `docs/protocol/feedback-rules.md`

The implementation must cover the protocol-layer feedback rule schema, matching helpers, intensity bucketing, and prompt compilation skeleton defined in the spec, using **Python 3.10+ + Pydantic v2**.

This task is intentionally limited to the **protocol and pure compilation/matching layer**.
It does **not** include memory persistence, UI editing flows, runtime injection wiring, or orchestrator integration.

---

## Scope Clarification
This card is intentionally limited to what `docs/protocol/feedback-rules.md` already defines clearly:

- protocol models
- enums
- deterministic rule applicability
- intensity-to-bucket mapping
- structured compiled rule output
- prompt compiler helpers
- unit tests for validation, bucketing, matching, and compilation

This task does **not** authorize the implementer to:

- invent storage backends
- add database schema logic
- wire rules into runtime or memory
- redesign prompt architecture
- change any public protocol semantics outside the spec

The target is a clean, typed, testable `packages/protocol/feedback_rules.py` that matches the document's v0.1 semantics.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/state-machine.md`
- `docs/protocol/feedback-rules.md`
- `packages/protocol/events.py`
- `packages/protocol/state_machine.py`

If they already exist, you may also read:

- `packages/protocol/feedback_rules.py`
- `tests/protocol/test_feedback_rules.py`

Do **not** read `docs/protocol/orchestrator-spec.md` for this task.
Architecture sequencing and boundaries are already handled in this task card.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/protocol/feedback_rules.py`
- `tests/protocol/test_feedback_rules.py`

If a directory does not exist, you may create:

- `packages/protocol/`
- `tests/protocol/`

Do **not** create or modify any other files.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/protocol/state_machine.py`
- do not create `__init__.py`
- do not modify any docs
- do not create memory, runtime, renderer, prompts, or orchestrator files

---

## Required Scope
You must implement the following definitions from `docs/protocol/feedback-rules.md`.

### 1. Base model configuration
- `EchoProtocolModel`

### 2. Core enums
- `RuleScope`
- `RuleOrigin`
- `RuleLifecycleStatus`
- `IntensityBucket`

### 3. Core protocol models
- `FeedbackRule`
- `RuleActivationContext`
- `CompiledRuleDirective`

### 4. Matching helpers
- `intensity_to_bucket`
- `rule_matches_scope`
- `rule_matches_event_type`
- `rule_matches_tags`
- `is_rule_applicable`

### 5. Prompt compiler
- `PromptCompiler`

The compiler must include at least:

- `bucket_for_rule()`
- `compile_rule()`
- `compile_rules()`
- `build_prompt_tail()`

and the internal helper behavior needed to support:

- bucket-specific prompt fragments
- TTS hint compilation
- renderer intensity compilation
- deterministic sorting by specificity, priority, intensity, and update time

---

## Test Scope
Create `tests/protocol/test_feedback_rules.py` with minimum unit coverage for the scenarios required by `docs/protocol/feedback-rules.md`.

### 1. Validation tests
- `intensity < 0.0` fails
- `intensity > 1.0` fails
- plugin scope without `scope_target` fails
- non-plugin scope with `scope_target` fails
- naive datetimes fail

### 2. Bucket tests
- `0.0`, `0.1`, `0.29` -> `weak`
- `0.3`, `0.5`, `0.69` -> `medium`
- `0.7`, `0.9`, `1.0` -> `strong`

### 3. Matching tests
- global rule matches all scopes
- coding rule matches only coding scope
- plugin rule matches only exact `scope_target`
- disabled rule never matches
- archived rule never matches

### 4. Compiler tests
- weak intensity yields weak bucket output
- medium intensity yields medium bucket output
- strong intensity yields strong bucket output
- compiled output contains LLM + TTS + renderer channels
- sort order prefers more specific scope over global
- sort order prefers higher priority over lower priority

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use **Pydantic v2** strictly.
2. All protocol models in this file must set:
   - `extra="forbid"`
   - `frozen=True`
3. All datetime fields must be timezone-aware and normalized to UTC.
4. Enum values must match `docs/protocol/feedback-rules.md` exactly.
5. `FeedbackRule.intensity` must be validated in `[0.0, 1.0]`.
6. If `scope == plugin`, `scope_target` is required.
7. If `scope != plugin`, `scope_target` must be `None`.
8. Rule applicability must remain deterministic and pure.
9. Matching must happen before compilation.
10. Compiler output must remain structured and include all three channels:
   - LLM prompt fragment
   - TTS style hint
   - renderer intensity hint
11. Do **not** inject raw numeric `intensity` into the prompt as an uninterpreted float.
12. Do **not** collapse compiler output into a single unstructured string object.
13. Do **not** introduce new dependencies.
14. Do **not** encode memory storage, database behavior, or UI behavior in protocol models.

---

## Important Implementation Note
The semantic contract in `docs/protocol/feedback-rules.md` is authoritative.

However, the exact natural-language wording shown in the copyable skeleton examples is **not** the main acceptance target.
If local file encoding makes some example prompt strings unclear, you may use **semantically equivalent, readable strings** for:

- weak / medium / strong prompt prefixes
- prompt tail wrapper text

You must still preserve the required semantics:

- weak / medium / strong distinction
- tail-injection intent
- multi-channel compiled output
- structured deterministic behavior

Do **not** use encoding uncertainty as a reason to invent new semantics.

---

## Explicitly Out Of Scope
The following are explicitly outside this task:

- memory persistence implementation
- database schema or migration logic
- runtime rule retrieval
- rule extraction from natural language
- UI editing or admin tools
- prompt provider adapters
- wiring compiled rules into actual LLM calls
- wiring TTS hints into actual TTS backends
- wiring renderer intensity into actual renderer adapters

---

## Do Not
Do not do any of the following:

- do not modify any protocol docs
- do not modify `packages/protocol/events.py`
- do not modify `packages/protocol/state_machine.py`
- do not implement memory storage
- do not implement runtime/orchestrator integration
- do not add dependencies
- do not install dependencies
- do not invent plugin matching beyond exact match
- do not store compiled prompt text as if it were the canonical rule record
- do not claim tests passed unless you actually ran them

---

## Execution Protocol
Before coding, follow `AGENTS.md`:

1. State that your role is `Implementer`
2. State which files you will inspect
3. State which files you will modify
4. State which files you will not modify
5. If information is missing, say exactly what is missing instead of guessing

---

## Validation Expectations
After implementation, do as much validation as the environment allows:

1. Run at least Python syntax-level validation
2. If `pydantic v2` is available locally, run `tests/protocol/test_feedback_rules.py`
3. If `pydantic` is missing or test execution is otherwise blocked:
   - do not install dependencies
   - do not fake test results
   - clearly report which validations did not run and why

---

## Output Format
The implementer must report in exactly this format:

1. Summary
2. Files changed
3. Key implementation notes
4. Risks / limitations
5. Validation status
6. What was intentionally not changed

---

## Acceptance Criteria
This task is complete only if all of the following are true:

- `packages/protocol/feedback_rules.py` exists
- `tests/protocol/test_feedback_rules.py` exists
- implementation matches `docs/protocol/feedback-rules.md` semantics
- strong typing and Pydantic v2 style are preserved
- applicability logic is deterministic
- plugin scope handling is correct
- intensity bucketing is correct
- compiler emits structured multi-channel output
- no out-of-scope runtime/memory/orchestrator behavior was added
- no new protocol semantics were invented outside the spec
