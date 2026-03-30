# Task Card 0004

## Title
Implement `packages/orchestrator/expression_parser.py`

## Role
Implementer

## Goal
Create the first implementation of `packages/orchestrator/expression_parser.py` based on:

- `docs/protocol/orchestrator-spec.md`
- `docs/protocol/events.md`

The implementation must cover the v0.1 streaming expression parser that splits:

- audible clean text
- renderer-facing expression/action metadata

using **Python 3.10+ + Pydantic v2** for the typed result model.

This task is intentionally limited to the parser layer only.
It does **not** include the full orchestrator, audio mutex, async turn coordination, or playback lifecycle integration.

---

## Scope Clarification
This card implements only the self-contained parser portion defined in the orchestrator spec:

- parser state enum
- parsed result model
- stateful streaming parser
- tag buffering and drop policy
- renderer command generation for supported tags
- unit tests for streaming safety

This task does **not** authorize the implementer to:

- implement `AudioMutex`
- implement `TurnOrchestrator`
- implement async queue wiring
- modify protocol docs or protocol files
- invent new tag grammar beyond the documented v0.1 set

The target is a clean, testable parser module that can later be imported by the orchestrator without redesign.

---

## Allowed Context
You may read only the following files:

- `AGENTS.md`
- `docs/governance/ai-engineering-constitution.md`
- `docs/protocol/events.md`
- `docs/protocol/orchestrator-spec.md`
- `packages/protocol/events.py`

If they already exist, you may also read:

- `packages/orchestrator/expression_parser.py`
- `tests/orchestrator/test_expression_parser.py`

Do **not** read `docs/protocol/feedback-rules.md` for this task.
Do **not** read `docs/protocol/state-machine.md` unless you are blocked by a concrete missing type reference.

---

## Files To Create Or Modify
You may create or modify only:

- `packages/orchestrator/expression_parser.py`
- `tests/orchestrator/test_expression_parser.py`

If a directory does not exist, you may create:

- `packages/orchestrator/`
- `tests/orchestrator/`

Do **not** create or modify any other files.
In particular:

- do not modify `packages/protocol/events.py`
- do not modify `packages/protocol/state_machine.py`
- do not modify `packages/protocol/feedback_rules.py`
- do not create `__init__.py`
- do not modify docs
- do not create `audio_mutex.py`, `orchestrator.py`, or runtime files

---

## Required Scope
You must implement the following definitions from the `Expression Parser` section of `docs/protocol/orchestrator-spec.md`.

### 1. Base typed model
- `OrchestratorModel`

This base model is only for typed parser-layer models in this file.

### 2. Parser state enum
- `ParserState`

It must include exactly:

- `TEXT = "text"`
- `IN_SQUARE_TAG = "in_square_tag"`
- `IN_ANGLE_TAG = "in_angle_tag"`

### 3. Parsed output model
- `ParsedExpressionResult`

It must expose:

- `clean_text`
- `renderer_commands`

### 4. Streaming parser
- `ExpressionParser`

At minimum, implement:

- `__init__()`
- `feed()`
- `flush_text()`
- `end_of_stream()`
- `_drop_tag_buffer()`
- `_parse_square_tag()`
- `_parse_angle_tag()`

The parser must:

- maintain `state`
- maintain `text_buffer`
- maintain `tag_buffer`
- preserve correctness across chunk boundaries
- never leak tag text into `clean_text`
- output typed `RendererCommand` objects, not ad-hoc dicts

---

## Supported Grammar
Support only the v0.1 tag categories explicitly defined in the orchestrator spec.

### 1. Square-bracket emotion tags
Examples:

- `[Smile]`
- `[Thinking]`
- `[Angry]`

These must become renderer commands.

### 2. Angle-bracket action/tone tags
Examples:

- `<action=nod>`
- `<action=shake_head>`
- `<tone=soft>`

These must become renderer commands.

No broader grammar is authorized in this task.

---

## Behavioral Requirements
The parser must satisfy all of the following:

1. In `TEXT`, normal characters accumulate into `text_buffer`.
2. Encountering `[` must:
   - flush pending text
   - enter `IN_SQUARE_TAG`
   - begin `tag_buffer`
3. Encountering `<` must:
   - flush pending text
   - enter `IN_ANGLE_TAG`
   - begin `tag_buffer`
4. In an open tag state, characters must remain buffered until a closing delimiter is seen.
5. If a chunk ends before `]` or `>`:
   - preserve the partial tag buffer
   - emit no leaked markup text
6. If a tag closes and is valid:
   - emit the correct `RendererCommand`
   - emit no tag text into `clean_text`
7. If a tag closes and is invalid:
   - do not emit it to TTS
   - do not emit it as a renderer command
   - drop it safely
8. If an incomplete tag remains at end of stream:
   - discard it
   - flush only safe remaining text
9. Overlong tag buffers must fail closed by dropping the tag buffer safely.

---

## Test Scope
Create `tests/orchestrator/test_expression_parser.py` with minimum unit coverage for the parser scenarios required by `docs/protocol/orchestrator-spec.md`.

### 1. Tag separation tests
- `[Smile] hello` yields:
  - renderer command for expression
  - clean text ` hello`
- `<action=nod>` yields:
  - renderer command only
  - no spoken tag text
- `<tone=soft>hello` yields:
  - renderer command
  - clean text `hello`

### 2. Streaming boundary tests
- chunk 1: `[Smi`
- chunk 2: `le] hello`

must:

- emit nothing after chunk 1
- emit a renderer command plus clean text after chunk 2

### 3. Malformed tag tests
- invalid closed square tag is dropped and not spoken
- invalid closed angle tag is dropped and not spoken
- overlong tag buffer is dropped safely

### 4. End-of-stream tests
- incomplete square tag at end of stream is discarded
- incomplete angle tag at end of stream is discarded
- trailing normal text flushes correctly

---

## Hard Requirements
The implementation must satisfy all of the following:

1. Use strong typing and keep parser outputs typed.
2. `ParsedExpressionResult` must be a Pydantic v2 model with:
   - `extra="forbid"`
   - `frozen=True`
3. Use protocol types from `packages/protocol/events.py` where the spec already defines them:
   - `RendererCommand`
   - `RendererCommandType`
4. Do **not** return ad-hoc dict payloads.
5. Do **not** emit raw tag markup into `clean_text`.
6. Do **not** wait for full-sentence completion before emitting valid tags.
7. Do **not** invent extra parser states beyond what is needed for the documented v0.1 behavior.
8. Do **not** introduce new dependencies.
9. Do **not** add async behavior to this parser module.
10. Do **not** implement logging infrastructure just for parser warnings.
    For v0.1 in this task, "drop safely without leaking" is the required behavior.

---

## Explicitly Out Of Scope
The following are explicitly outside this task:

- `AudioMutex`
- playback ownership logic
- `TurnOrchestrator`
- async task spawning
- interrupt application flow
- `tts.chunk.started` / `tts.chunk.finished` event models
- runtime logging subsystem
- renderer adapter transport
- TTS queueing or playback

---

## Do Not
Do not do any of the following:

- do not modify protocol docs
- do not modify protocol Python modules
- do not implement full orchestrator control flow
- do not add dependencies
- do not install dependencies
- do not create `__init__.py`
- do not invent escaping rules for literal brackets
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
2. If `pydantic v2` is available locally, run `tests/orchestrator/test_expression_parser.py`
3. If `pydantic` is missing or test execution is blocked:
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

- `packages/orchestrator/expression_parser.py` exists
- `tests/orchestrator/test_expression_parser.py` exists
- implementation matches the v0.1 `Expression Parser` semantics in `docs/protocol/orchestrator-spec.md`
- streaming boundary handling is correct
- malformed tags do not leak into `clean_text`
- parser outputs typed `RendererCommand` objects
- no audio mutex, orchestrator, or runtime side effects were added
- no new parser grammar semantics were invented outside the spec
