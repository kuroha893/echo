~~~md
# Echo Protocol Specification: Orchestrator

> Status: Draft v0.1  
> Scope: Dual-track async orchestration, audio mutex, streaming expression parsing, and turn-level coordination  
> Authority: This document is constrained by **《Echo AI 开发规范与工程宪法》**, and must remain consistent with:
>
> - `docs/protocol/events.md`
> - `docs/protocol/state-machine.md`
> - `docs/protocol/feedback-rules.md`
>
> This document is the source of truth for `packages/orchestrator/`.

---

## 1. Purpose

This document defines the **canonical orchestration model** for Echo.

Its goals are:

- define how the system runs **Local Drafter** and **Primary Reasoning** concurrently
- define how they communicate without hidden coupling
- define how streaming text becomes:
  - clean TTS text
  - renderer commands
- define how the orchestrator enforces **audio mutual exclusion**
- define how interruption, handoff, replacement, and queue clearing are resolved
- provide Python pseudo-code skeletons for the core async components

This document covers:

- turn lifecycle
- dual-track concurrency
- task ownership
- audio mutex semantics
- expression parser buffer semantics
- recommended async component boundaries

This document does **not** define:

- a specific LLM backend API
- a specific TTS engine API
- a specific renderer adapter API
- memory storage internals
- provider-specific streaming transport details

---

## 2. Mandatory corrections and additions

Before defining the orchestrator, two corrections are necessary.

---

### 2.1 Necessary correction: Drafter and Primary Reasoning must not directly coordinate each other

The user requirement correctly asks for:

- concurrent startup of Local Drafter and Primary Reasoning
- defined communication between them

However, the required correction is:

> **They must not directly coordinate each other by calling each other’s internals.**

Instead, both must communicate only through **orchestrator-owned coordination primitives**:

- immutable turn context
- async queues
- async events
- protocol events
- interrupt signals

This is mandatory.

Reason:

- prevents hidden coupling
- makes replay/debugging possible
- avoids AI-generated spaghetti dependencies
- preserves package boundaries

---

### 2.2 Necessary correction: precise audio control requires chunk-boundary playback signals

The previous protocol already defined:

- `tts.playback.started`
- `tts.playback.finished`

These are enough for the state machine, but **not enough** for precise handoff and cut decisions inside the orchestrator.

Therefore, this spec adds two orchestrator-critical playback lifecycle events:

- `tts.chunk.started`
- `tts.chunk.finished`

These are not optional if the runtime wants accurate chunk-boundary interruption.

They should be added to `events.py` in the next patch.

---

## 3. Core orchestration principles

The orchestrator must obey the following principles.

---

### 3.1 Reaction before reasoning
For each accepted user turn:

- fast path generates a **quick reaction**
- slow path generates the **primary response**

The fast path exists to preserve life-like responsiveness.  
The slow path exists to preserve answer quality.

---

### 3.2 Concurrency, not serial blocking
Once a valid `user.speech.end` is accepted:

- Local Drafter must start immediately
- Primary startup work must start immediately

The system must not wait for one before starting the other.

For the hybrid llm line, a bounded hidden local routing step may occur inside
primary startup, but it must:

- begin immediately
- remain independent from quick-reaction startup
- not serialize the whole turn behind the drafter

---

### 3.3 Single owner of turn progression
Only the **orchestrator** may decide:

- which stream currently owns audio
- whether to buffer, wait, replace, or cut
- when interruption is materially applied
- when to emit the corresponding control events

No backend adapter may make these decisions independently.

---

### 3.4 Text and expression must split before TTS
All drafter and primary text must pass through the **Expression Parser** before reaching TTS.

No raw stream may bypass it.

---

### 3.5 Audio must be mutually exclusive
At any moment, only one logical output stream may own audible playback.

There may be multiple queues and tasks, but not multiple simultaneous speaking owners.

---

### 3.6 Interruptions are first-class control flow
Interruptions are not UI hints.  
They are authoritative control messages that may:

- cancel tasks
- truncate queues
- replace output ownership
- change session state

---

## 4. Canonical orchestrator responsibilities

The orchestrator layer is responsible for:

1. accepting finalized user turns
2. creating turn-scoped coordination objects
3. starting dual-track tasks
4. collecting and routing outputs
5. invoking the expression parser
6. invoking the audio mutex
7. emitting control events
8. applying interrupts
9. reconciling end-of-turn completion

It is **not** responsible for:

- model inference internals
- raw audio device playback internals
- renderer transport internals

Those belong to adapters/services.

---

## 5. Turn model

---

### 5.1 Turn definition

A **turn** begins when the orchestrator accepts:

- `user.speech.end`

with a finalized utterance.

A turn ends when one of the following occurs:

- playback finishes cleanly and no continuation remains
- response completes without playback
- an interrupt replaces the turn and reconciliation completes
- reset clears the turn
- fatal error aborts the turn

---

### 5.2 Turn-scoped identifiers

Each accepted turn should allocate:

- `turn_id`
- `trace_id`
- `session_id`
- `quick_reaction_stream_id`
- `primary_response_stream_id`
- `primary_tts_stream_id`

These identifiers must remain stable for the entire lifetime of that turn.

---

### 5.3 Turn-scoped coordination primitives

Each turn must have orchestrator-owned coordination primitives:

- `interrupt_event: asyncio.Event`
- `drafter_done_event: asyncio.Event`
- `primary_done_event: asyncio.Event`
- `primary_first_chunk_ready_event: asyncio.Event`
- `quick_reaction_started_event: asyncio.Event`
- `quick_reaction_finished_event: asyncio.Event`
- `all_output_resolved_event: asyncio.Event`

And async queues:

- `primary_chunk_queue`
- `renderer_command_queue`
- `tts_request_queue`

These queues/events are the only legal coordination mechanism between dual-track tasks.

---

## 6. Dual-track async orchestration

This section defines the canonical dual-track flow.

---

## 6.1 Trigger condition

The dual-track process starts when the orchestrator accepts:

- `user.speech.end`

with:

- matching `session_id`
- finalized utterance
- valid state transition into `thinking`

---

## 6.2 Task topology

For each accepted turn, the orchestrator must create at least the following logical tasks:

1. `LocalDrafterTask`
2. `PrimaryReasoningTask`
3. `PrimaryChunkConsumerTask`
4. `RendererDispatchTask`
5. `TTSDispatchTask`

Depending on implementation, some may be merged, but the logical responsibilities must remain distinct.

---

## 6.2.1 Hybrid LLM startup policy

For the hybrid local/cloud llm line, the orchestrator may perform a bounded
hidden `intent_routing` step as part of primary startup.

Rules:

1. hidden routing is turn-internal and must not become user-visible text
2. hidden routing may start immediately after turn acceptance
3. local quick reaction must not wait for hidden routing to complete
4. primary path selection may use the hidden routing result to choose:
   - local lightweight `primary_response`
   - cloud-heavy `primary_response`
5. until `primary_tool_reasoning` is implemented, a `cloud_tool` routing result
   must degrade explicitly to the cloud `primary_response` path
6. if hidden routing fails or times out, the safe fallback path is the cloud
   `primary_response` route

This policy does not change any of the existing parser, audio-mutex,
interrupt, or protocol-event ownership rules.

---

## 6.3 Local Drafter path

Responsibilities:

- generate short low-latency reaction text
- allow hidden local routing to run independently of quick-reaction startup
- optionally emit initial emotion tags
- never own final answer semantics
- never block primary reasoning startup

Canonical flow:

1. receive finalized utterance context
2. produce `QuickReaction`
3. emit `assistant.quick_reaction.ready`
4. run quick reaction text through `ExpressionParser`
5. emit resulting renderer commands
6. produce `TTSChunk` objects for quick reaction
7. submit them to `AudioMutex` as **quick track**
8. mark `drafter_done_event`

Important constraints:

- quick reaction must be short
- quick reaction must default to `is_interruptible=True`
- quick reaction should avoid factual claims and long reasoning

---

## 6.4 Primary Reasoning path

Responsibilities:

- generate the main answer through the selected primary route
- stream chunks as they arrive
- support tool results and RAG integration
- remain interruptible

Canonical flow:

1. receive finalized utterance context
2. begin primary startup immediately
3. if hybrid routing is enabled:
   - obtain the bounded hidden routing decision
   - choose the primary path from that decision or fallback policy
4. for each raw streamed text chunk:
   - send chunk into `PrimaryChunkConsumerTask`
5. when stream completes:
   - emit `assistant.response.completed`
   - mark `primary_done_event`

Important constraints:

- Primary Reasoning must not directly issue TTS playback
- Primary Reasoning must not bypass expression parsing
- Primary Reasoning must not modify session state directly

---

## 6.5 Primary Chunk Consumer path

Responsibilities:

- receive raw primary chunks
- run them through `ExpressionParser`
- emit `assistant.response.chunk` for clean text chunks
- emit `renderer.command.issued` for expression/action tags
- convert clean text chunks into `TTSChunk`
- submit them to `AudioMutex` as **primary track**

This task is the bridge between streamed reasoning text and output subsystems.

---

## 6.5.1 TTS service dispatch boundary

Once `packages/tts` exists, the orchestrator's TTS dispatch path must:

1. keep using protocol `TTSChunk` as the upstream chunk contract
2. invoke Echo-owned `TTSService`, not provider adapters directly
3. receive ordered TTS-local audio fragments
4. forward those fragments to a playback-facing sink boundary owned above
   `packages/tts`

For the first bounded integration before a real playback device exists, the
orchestrator may use a local shell that reconciles playback lifecycle after
successful fragment sink delivery so that:

- `AudioMutex` state remains consistent
- turn resolution does not stall forever

This bounded integration is now the accepted orchestrator/TTS baseline.

That accepted baseline is now extended by:

- a concrete desktop playback bridge above `packages/tts`
- typed app-reported playback lifecycle consumed by the orchestrator/runtime
- app-side lipsync that stays outside protocol command semantics

However, it must not be mistaken for final playback-device truth. For the first
real-provider desktop demo:

- the desktop app should own material playback start/finish/abort truth
- the sink above `packages/tts` should bridge fragments to that desktop owner
- orchestrator/runtime should consume resulting typed playback lifecycle instead
  of extending the provisional local shell indefinitely
- the next work should improve real device output and provider-backed host
  assembly above this boundary rather than redesigning `AudioMutex` or protocol
  events

---

## 6.5.2 Renderer service dispatch boundary

Once `packages/renderer` exists, the orchestrator's renderer dispatch path
must:

1. keep using protocol `RendererCommand` as the upstream command contract
2. invoke Echo-owned `RendererService`, not concrete renderer adapters directly
3. preserve the existing `renderer.command.issued` protocol-event boundary
4. surface renderer dispatch failure explicitly instead of silently dropping
   commands

For the first bounded renderer integration before a concrete desktop backend
exists, the orchestrator may use a local renderer service seam that resolves
profiles and dispatches into a deterministic scripted adapter.

This bounded integration is now the accepted orchestrator/renderer baseline,
and the first concrete desktop-live2d backend exists behind
`packages/renderer`.

The next desktop-demo work should therefore stay above this boundary instead of
changing renderer-command semantics. App-side bubble, panel, and lipsync shells
now exist behind this boundary; the next work should focus on real-provider
desktop demo wiring and real Pixi/Cubism landing above it.

This accepted baseline must not:

- invent new renderer command semantics
- let renderer dispatch drive session transitions directly
- replace interrupt or queue ownership with adapter-owned logic

---

## 6.6 Canonical communication pattern

Dual-track tasks must communicate through these channels only:

- protocol events
- async queues
- async events
- turn context snapshot

Forbidden:

- Drafter calling Primary Reasoner methods directly
- Primary Reasoner polling Drafter internal state directly
- TTS adapter owning interruption policy
- renderer adapter owning turn advancement

---

## 7. Canonical dual-track timeline

This is the required baseline timeline.

### Step 1
`user.speech.end` accepted

### Step 2
State transitions to `thinking`

### Step 3
Orchestrator creates turn context and spawns:

- drafter task
- primary reasoning task
- chunk consumer task(s)

### Step 4
Drafter path produces quick reaction first, if available

### Step 5
Quick reaction enters expression parsing, then renderer/TTS pipeline

### Step 6
Primary reasoning begins streaming text independently

### Step 7
Primary chunks are parsed and buffered/submitted to the audio mutex

### Step 8
Audio mutex decides:

- play immediately
- wait for quick reaction to finish
- cut quick reaction after current chunk
- replace current owner

### Step 9
When all primary output is resolved and playback completes, turn returns toward `idle` unless interrupted or reset

---

## 8. Audio Mutex specification

The audio mutex is the canonical owner of audible playback arbitration.

---

### 8.1 Purpose

The audio mutex exists to guarantee:

- no overlapping speech streams
- deterministic quick-to-primary handoff
- correct interrupt handling
- chunk-accurate truncation

---

### 8.2 Audio owner model

At any time, the audio mutex has exactly one logical owner:

- `none`
- `quick_reaction`
- `primary_response`

Optional future extension:

- `system_override`

This owner state is internal orchestrator control state, not a public session state.

---

### 8.3 Audio mutex responsibilities

It must decide:

- whether a stream may start playback now
- whether a stream must buffer
- whether current playback may continue until chunk boundary
- whether queued chunks must be dropped
- whether current owner may be replaced
- when handoff is considered complete

---

### 8.4 Required playback knowledge

The mutex must have access to the following playback facts:

- current owner
- active stream id
- active chunk index
- whether playback is currently active
- whether current chunk is interruptible
- whether pending chunks remain
- whether crossfade is supported
- whether a higher-priority replacement is waiting

Without this information, precise arbitration is invalid.

---

### 8.5 Required audio lifecycle events

The TTS/playback subsystem must emit at least:

- `tts.playback.started`
- `tts.chunk.started`
- `tts.chunk.finished`
- `tts.playback.finished`

These events are the canonical source of truth for playback progress.

---

### 8.6 Handoff policies

The mutex must support these logical policies:

#### `wait_until_finished`
Primary waits until quick reaction playback fully finishes.

Use when:

- quick reaction is extremely short
- no urgent replacement is needed

#### `cut_after_chunk`
Allow current chunk to finish, then stop remaining quick reaction chunks and hand off to primary.

Use when:

- quick reaction is interruptible
- overlap must be avoided
- current chunk is already underway

#### `replace_immediately`
Stop current owner immediately and hand off.

Use when:

- urgent interrupt
- critical control utterance
- explicit user stop/barge-in

#### `crossfade`
Optional for future support.  
If the playback engine supports it, quick reaction may be faded out while primary fades in.

For v0.1, this is optional and must not be assumed available.

---

### 8.7 Default v0.1 handoff behavior

Required default behavior:

1. If no active owner:
   - new stream starts immediately

2. If owner is `quick_reaction` and primary first chunk arrives:
   - if quick reaction has no active playback: primary starts immediately
   - if quick reaction is active and current chunk is interruptible:
     - wait until current chunk finishes
     - then switch to primary
   - if quick reaction is active and current chunk is not interruptible:
     - wait up to configured threshold for next safe boundary
     - if threshold expires and replacement is allowed, perform replace

3. If owner is `primary_response`:
   - additional primary chunks extend the same stream
   - quick reaction must not reclaim ownership

This default policy is mandatory.

---

### 8.8 Necessary configuration knobs

These values must be configurable:

- `quick_reaction_max_wait_ms`
- `allow_crossfade`
- `interrupt_replace_timeout_ms`
- `default_chunk_interruptibility`

These are runtime policy knobs, not protocol schema fields.

---

### 8.9 Determining whether Drafter audio has finished

The canonical source of truth is **not** “the drafter task ended”.

It is one of:

- `tts.playback.finished` for the quick reaction stream
- or, if chunk-level accounting is enabled:
  - all quick reaction chunks have emitted `tts.chunk.finished`
  - and no pending quick reaction chunks remain

This is mandatory.

Task completion and playback completion must not be conflated.

---

### 8.10 Interrupt application rules

When a higher-priority event requires interruption, the audio mutex must coordinate:

1. stop accepting low-priority chunks for immediate playback
2. mark pending chunks for truncation
3. wait for safe cut boundary if policy requires it
4. emit or cause emission of `system.interrupt.applied` when material effects are complete enough

Interrupt is not considered applied merely because a signal was requested.

---

## 9. Expression Parser specification

The expression parser is the canonical streaming splitter between:

- audible text
- expression/action metadata

---

### 9.1 Purpose

It prevents:

- raw emotion tags from reaching TTS
- delayed renderer updates until sentence end
- malformed split tags leaking into speech

---

### 9.2 Supported tag categories in v0.1

Required support:

- square-bracket emotion tags
  - `[Smile]`
  - `[Thinking]`
  - `[Angry]`

- angle-bracket action/tone tags
  - `<action=nod>`
  - `<action=shake_head>`
  - `<tone=soft>`

The grammar is intentionally narrow in v0.1.

---

### 9.3 Required output channels

The parser must emit two logical outputs:

1. `clean_text`
2. `renderer_commands`

No tag text may be emitted into `clean_text`.

---

### 9.4 Streaming parser requirement

The parser must work in **streaming** mode.

It must accept partial chunks and preserve correctness across chunk boundaries.

---

### 9.5 Required parser states

A minimal finite-state design must include:

- `TEXT`
- `IN_SQUARE_TAG`
- `IN_ANGLE_TAG`

Optional future states may exist, but this minimum is required.

---

### 9.6 Buffer mechanism

The parser must maintain:

- `text_buffer`
- `tag_buffer`
- `state`

Canonical behavior:

#### In `TEXT`
- ordinary text goes to `text_buffer`
- `[` starts a potential square tag:
  - flush current text buffer
  - enter `IN_SQUARE_TAG`
  - start `tag_buffer` with `[`
- `<` starts a potential angle tag:
  - flush current text buffer
  - enter `IN_ANGLE_TAG`
  - start `tag_buffer` with `<`

#### In `IN_SQUARE_TAG`
- append characters to `tag_buffer`
- if `]` appears:
  - validate tag
  - emit renderer command if valid
  - clear `tag_buffer`
  - return to `TEXT`
- if chunk ends before `]`:
  - preserve buffer
  - emit nothing to TTS

#### In `IN_ANGLE_TAG`
- append characters to `tag_buffer`
- if `>` appears:
  - validate tag
  - emit renderer command if valid
  - clear `tag_buffer`
  - return to `TEXT`
- if chunk ends before `>`:
  - preserve buffer
  - emit nothing to TTS

This buffering behavior is mandatory.

---

### 9.7 Broken tag example

Input stream:

- chunk 1: `[Smi`
- chunk 2: `le] 你好`

Required behavior:

- after chunk 1:
  - emit no tag
  - emit no leaked text `[Smi`
- after chunk 2:
  - parse `[Smile]`
  - emit renderer command
  - emit clean text ` 你好`

This exact class of bug must be prevented.

---

### 9.8 Malformed tag policy

If a buffered tag is closed but invalid:

- do not send it to TTS
- do not convert it into renderer output
- drop it and log a parser warning

This is the safest v0.1 policy.

Reason:

Echo prioritizes not leaking markup into speech.

A future RFC may introduce an escaping syntax for literal brackets.

---

### 9.9 End-of-stream flush rule

When the source stream ends:

- if parser state is `TEXT`, flush remaining text to TTS
- if parser state is still inside an unclosed tag:
  - discard buffered tag fragment
  - emit parser warning
  - do not speak it

This rule is mandatory.

---

## 10. Orchestrator control events

In addition to prior docs, the orchestrator depends on these control/lifecycle events.

### Required additions
- `tts.chunk.started`
- `tts.chunk.finished`
- `assistant.response.completed`
- `system.interrupt.applied`

### Recommended additions
- `assistant.quick_reaction.suppressed`
- `assistant.primary.buffered`

The recommended events are not required for v0.1 correctness, but improve observability.

---

## 11. Turn completion rules

A turn is considered fully resolved only when all of the following are true:

- `drafter_done_event` is set or quick reaction was explicitly suppressed
- `primary_done_event` is set
- no active playback remains for the current turn
- no pending TTS chunks remain for the current turn
- no unresolved interrupt barrier remains

Only then may the orchestrator conclude the turn and allow the session to settle back to `idle` if the state machine agrees.

---

## 12. Failure and cancellation rules

### 12.1 Drafter failure
If the drafter fails:

- the turn must continue
- primary reasoning must remain active
- error should be logged
- quick reaction may be absent

Drafter failure must not kill the full turn.

---

### 12.2 Primary reasoning failure
If primary reasoning fails:

- if quick reaction already played, the session must still reconcile cleanly
- an error event may be raised depending on severity
- partial primary output must not leave the audio mutex in an inconsistent state

---

### 12.3 Parser failure
Expression parser failure must default to:

- fail closed for tags
- preserve safe clean text where possible
- never leak malformed tags to TTS

---

### 12.4 TTS/playback failure
If playback fails after stream ownership is granted:

- the mutex must release or reconcile ownership
- the state machine may enter `error` if the failure is session-blocking

---

## 13. Copyable Python pseudo-code skeleton for `packages/orchestrator/`

> This is protocol-oriented pseudo-code skeleton, not finalized production code.  
> It is intentionally structured so that AI coding assistants can implement the real modules without inventing a different orchestration model.

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import AsyncIterator
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from packages.protocol.events import (
    EventPriority,
    InterruptSignal,
    InterruptionPolicy,
    QuickReaction,
    RendererCommand,
    RendererCommandType,
    ResponseTextChunk,
    SessionStatus,
    TTSChunk,
)


# ============================================================
# Base config / shared models
# ============================================================

class OrchestratorModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


class AudioOwner(str, Enum):
    NONE = "none"
    QUICK_REACTION = "quick_reaction"
    PRIMARY_RESPONSE = "primary_response"


class ParserState(str, Enum):
    TEXT = "text"
    IN_SQUARE_TAG = "in_square_tag"
    IN_ANGLE_TAG = "in_angle_tag"


class OrchestratorConfig(OrchestratorModel):
    quick_reaction_max_wait_ms: int = Field(default=220, ge=0, le=5000)
    interrupt_replace_timeout_ms: int = Field(default=120, ge=0, le=5000)
    allow_crossfade: bool = False
    parser_max_tag_buffer_chars: int = Field(default=128, ge=8, le=4096)
    max_pending_primary_chunks: int = Field(default=64, ge=1, le=4096)


class TurnContext(OrchestratorModel):
    turn_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    trace_id: UUID

    utterance_text: str = Field(min_length=1)

    quick_reaction_stream_id: UUID = Field(default_factory=uuid4)
    primary_response_stream_id: UUID = Field(default_factory=uuid4)
    primary_tts_stream_id: UUID = Field(default_factory=uuid4)


# ============================================================
# Expression parser
# ============================================================

class ParsedExpressionResult(OrchestratorModel):
    clean_text: str = ""
    renderer_commands: list[RendererCommand] = Field(default_factory=list)


class ExpressionParser:
    def __init__(self, max_tag_buffer_chars: int = 128) -> None:
        self.state = ParserState.TEXT
        self.text_buffer: list[str] = []
        self.tag_buffer: list[str] = []
        self.max_tag_buffer_chars = max_tag_buffer_chars

    def feed(self, text: str) -> ParsedExpressionResult:
        clean_parts: list[str] = []
        commands: list[RendererCommand] = []

        for ch in text:
            if self.state == ParserState.TEXT:
                if ch == "[":
                    if self.text_buffer:
                        clean_parts.append("".join(self.text_buffer))
                        self.text_buffer.clear()
                    self.state = ParserState.IN_SQUARE_TAG
                    self.tag_buffer = ["["]
                elif ch == "<":
                    if self.text_buffer:
                        clean_parts.append("".join(self.text_buffer))
                        self.text_buffer.clear()
                    self.state = ParserState.IN_ANGLE_TAG
                    self.tag_buffer = ["<"]
                else:
                    self.text_buffer.append(ch)

            elif self.state == ParserState.IN_SQUARE_TAG:
                self.tag_buffer.append(ch)
                if len(self.tag_buffer) > self.max_tag_buffer_chars:
                    self._drop_tag_buffer()
                    continue
                if ch == "]":
                    cmd = self._parse_square_tag("".join(self.tag_buffer))
                    if cmd is not None:
                        commands.append(cmd)
                    self.tag_buffer.clear()
                    self.state = ParserState.TEXT

            elif self.state == ParserState.IN_ANGLE_TAG:
                self.tag_buffer.append(ch)
                if len(self.tag_buffer) > self.max_tag_buffer_chars:
                    self._drop_tag_buffer()
                    continue
                if ch == ">":
                    cmd = self._parse_angle_tag("".join(self.tag_buffer))
                    if cmd is not None:
                        commands.append(cmd)
                    self.tag_buffer.clear()
                    self.state = ParserState.TEXT

        return ParsedExpressionResult(
            clean_text="".join(clean_parts),
            renderer_commands=commands,
        )

    def flush_text(self) -> str:
        if not self.text_buffer:
            return ""
        data = "".join(self.text_buffer)
        self.text_buffer.clear()
        return data

    def end_of_stream(self) -> ParsedExpressionResult:
        """
        Flush remaining text. If a tag is still incomplete, discard it.
        """
        commands: list[RendererCommand] = []

        if self.state != ParserState.TEXT:
            self._drop_tag_buffer()

        tail_text = self.flush_text()
        return ParsedExpressionResult(
            clean_text=tail_text,
            renderer_commands=commands,
        )

    def _drop_tag_buffer(self) -> None:
        # Discard malformed/incomplete tag and reset state.
        self.tag_buffer.clear()
        self.state = ParserState.TEXT

    def _parse_square_tag(self, token: str) -> RendererCommand | None:
        # Expected: [Smile], [Thinking], [Angry]
        if not (token.startswith("[") and token.endswith("]")):
            return None

        name = token[1:-1].strip().lower()
        if not name:
            return None

        return RendererCommand(
            command_type=RendererCommandType.SET_EXPRESSION,
            target="expression",
            value=name,
            intensity=1.0,
            is_interruptible=True,
        )

    def _parse_angle_tag(self, token: str) -> RendererCommand | None:
        # Expected: <action=nod>, <tone=soft>
        if not (token.startswith("<") and token.endswith(">")):
            return None

        body = token[1:-1].strip()
        if "=" not in body:
            return None

        key, value = body.split("=", 1)
        key = key.strip().lower()
        value = value.strip().lower()

        if key == "action":
            return RendererCommand(
                command_type=RendererCommandType.SET_MOTION,
                target="motion",
                value=value,
                intensity=1.0,
                is_interruptible=True,
            )
        if key == "tone":
            # Tone is routed to renderer as expression/state hint here.
            return RendererCommand(
                command_type=RendererCommandType.SET_EXPRESSION,
                target="tone",
                value=value,
                intensity=1.0,
                is_interruptible=True,
            )
        return None


# ============================================================
# Audio mutex
# ============================================================

@dataclass
class PlaybackSnapshot:
    owner: AudioOwner = AudioOwner.NONE
    stream_id: UUID | None = None
    chunk_index: int | None = None
    playback_active: bool = False
    current_chunk_interruptible: bool = True
    pending_chunks: int = 0


class AudioMutex:
    """
    Single authority for audible playback ownership.
    """
    def __init__(self, config: OrchestratorConfig) -> None:
        self.config = config
        self._lock = asyncio.Lock()
        self._playback_changed = asyncio.Condition()
        self._snapshot = PlaybackSnapshot()

    async def claim_for_quick_reaction(
        self,
        stream_id: UUID,
        chunks: list[TTSChunk],
    ) -> bool:
        async with self._lock:
            if self._snapshot.owner == AudioOwner.NONE:
                self._snapshot.owner = AudioOwner.QUICK_REACTION
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks = len(chunks)
                return True
            return False

    async def submit_primary_chunk(
        self,
        stream_id: UUID,
        chunk: TTSChunk,
    ) -> str:
        """
        Returns one of:
        - 'play_now'
        - 'buffer'
        - 'replace_after_chunk'
        - 'replace_immediately'
        """
        async with self._lock:
            if self._snapshot.owner == AudioOwner.NONE:
                self._snapshot.owner = AudioOwner.PRIMARY_RESPONSE
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks += 1
                return "play_now"

            if self._snapshot.owner == AudioOwner.PRIMARY_RESPONSE:
                self._snapshot.pending_chunks += 1
                return "play_now"

            # quick reaction currently owns playback
            if not self._snapshot.playback_active:
                self._snapshot.owner = AudioOwner.PRIMARY_RESPONSE
                self._snapshot.stream_id = stream_id
                self._snapshot.pending_chunks += 1
                return "play_now"

            if self._snapshot.current_chunk_interruptible:
                return "replace_after_chunk"

            return "buffer"

    async def notify_chunk_started(
        self,
        owner: AudioOwner,
        stream_id: UUID,
        chunk_index: int,
        is_interruptible: bool,
    ) -> None:
        async with self._playback_changed:
            self._snapshot.owner = owner
            self._snapshot.stream_id = stream_id
            self._snapshot.chunk_index = chunk_index
            self._snapshot.playback_active = True
            self._snapshot.current_chunk_interruptible = is_interruptible
            self._playback_changed.notify_all()

    async def notify_chunk_finished(
        self,
        stream_id: UUID,
    ) -> None:
        async with self._playback_changed:
            if self._snapshot.stream_id == stream_id and self._snapshot.pending_chunks > 0:
                self._snapshot.pending_chunks -= 1
            self._snapshot.current_chunk_interruptible = True
            self._playback_changed.notify_all()

    async def notify_playback_finished(
        self,
        stream_id: UUID,
    ) -> None:
        async with self._playback_changed:
            if self._snapshot.stream_id == stream_id:
                self._snapshot.owner = AudioOwner.NONE
                self._snapshot.stream_id = None
                self._snapshot.chunk_index = None
                self._snapshot.playback_active = False
                self._snapshot.pending_chunks = 0
                self._snapshot.current_chunk_interruptible = True
            self._playback_changed.notify_all()

    async def wait_for_safe_handoff(self, timeout_ms: int) -> bool:
        """
        Wait for a safe chunk boundary / playback release.
        Returns True if it is safe to hand off.
        """
        timeout_sec = timeout_ms / 1000.0
        try:
            async with self._playback_changed:
                await asyncio.wait_for(
                    self._playback_changed.wait_for(
                        lambda: (
                            not self._snapshot.playback_active
                            or self._snapshot.current_chunk_interruptible
                        )
                    ),
                    timeout=timeout_sec,
                )
            return True
        except asyncio.TimeoutError:
            return False

    async def force_replace(self) -> InterruptSignal:
        """
        The orchestrator will route this to downstream playback control.
        """
        async with self._lock:
            return InterruptSignal(
                reason="audio mutex forced owner replacement",
                policy=InterruptionPolicy.REPLACE,
                target_tts_stream_id=self._snapshot.stream_id,
                clear_pending_tts=True,
                clear_pending_renderer=False,
            )


# ============================================================
# Orchestrator
# ============================================================

class TurnOrchestrator:
    def __init__(
        self,
        config: OrchestratorConfig,
        audio_mutex: AudioMutex,
    ) -> None:
        self.config = config
        self.audio_mutex = audio_mutex

    async def handle_user_turn(
        self,
        ctx: TurnContext,
    ) -> None:
        """
        Entry point after user.speech.end has been accepted and the
        state machine has entered THINKING.
        """
        interrupt_event = asyncio.Event()
        drafter_done_event = asyncio.Event()
        primary_done_event = asyncio.Event()
        primary_first_chunk_ready_event = asyncio.Event()
        quick_reaction_finished_event = asyncio.Event()

        primary_chunk_queue: asyncio.Queue[str | None] = asyncio.Queue(
            maxsize=self.config.max_pending_primary_chunks
        )
        renderer_command_queue: asyncio.Queue[RendererCommand] = asyncio.Queue()
        tts_request_queue: asyncio.Queue[TTSChunk] = asyncio.Queue()

        drafter_task = asyncio.create_task(
            self._run_local_drafter(
                ctx=ctx,
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                drafter_done_event=drafter_done_event,
                quick_reaction_finished_event=quick_reaction_finished_event,
            )
        )

        primary_task = asyncio.create_task(
            self._run_primary_reasoning(
                ctx=ctx,
                interrupt_event=interrupt_event,
                primary_chunk_queue=primary_chunk_queue,
                primary_done_event=primary_done_event,
            )
        )

        primary_consumer_task = asyncio.create_task(
            self._consume_primary_chunks(
                ctx=ctx,
                interrupt_event=interrupt_event,
                primary_chunk_queue=primary_chunk_queue,
                renderer_command_queue=renderer_command_queue,
                tts_request_queue=tts_request_queue,
                primary_first_chunk_ready_event=primary_first_chunk_ready_event,
            )
        )

        renderer_task = asyncio.create_task(
            self._dispatch_renderer_commands(
                interrupt_event=interrupt_event,
                renderer_command_queue=renderer_command_queue,
            )
        )

        tts_task = asyncio.create_task(
            self._dispatch_tts_chunks(
                ctx=ctx,
                interrupt_event=interrupt_event,
                tts_request_queue=tts_request_queue,
            )
        )

        try:
            await asyncio.gather(
                drafter_task,
                primary_task,
                primary_consumer_task,
            )
        finally:
            # Renderer/TTS dispatch loops should be reconciled by higher-level shutdown rules.
            renderer_task.cancel()
            tts_task.cancel()

    async def _run_local_drafter(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        drafter_done_event: asyncio.Event,
        quick_reaction_finished_event: asyncio.Event,
    ) -> None:
        parser = ExpressionParser(self.config.parser_max_tag_buffer_chars)

        try:
            quick = await self._generate_quick_reaction(ctx)
            if quick is None:
                return

            parsed = parser.feed(quick.text)
            if parsed.clean_text:
                claimed = await self.audio_mutex.claim_for_quick_reaction(
                    stream_id=ctx.quick_reaction_stream_id,
                    chunks=[
                        TTSChunk(
                            tts_stream_id=ctx.quick_reaction_stream_id,
                            chunk_index=0,
                            text=parsed.clean_text,
                            emotion_tags=quick.emotion_tags,
                            is_interruptible=quick.is_interruptible,
                        )
                    ],
                )
                if claimed:
                    await tts_request_queue.put(
                        TTSChunk(
                            tts_stream_id=ctx.quick_reaction_stream_id,
                            chunk_index=0,
                            text=parsed.clean_text,
                            emotion_tags=quick.emotion_tags,
                            is_interruptible=quick.is_interruptible,
                        )
                    )

            for cmd in parsed.renderer_commands:
                await renderer_command_queue.put(cmd)

            tail = parser.end_of_stream()
            if tail.clean_text:
                await tts_request_queue.put(
                    TTSChunk(
                        tts_stream_id=ctx.quick_reaction_stream_id,
                        chunk_index=1,
                        text=tail.clean_text,
                        is_interruptible=True,
                    )
                )
            for cmd in tail.renderer_commands:
                await renderer_command_queue.put(cmd)

        finally:
            drafter_done_event.set()
            # In real implementation, this should be driven by playback events,
            # not task completion alone.
            quick_reaction_finished_event.set()

    async def _run_primary_reasoning(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        primary_chunk_queue: asyncio.Queue[str | None],
        primary_done_event: asyncio.Event,
    ) -> None:
        try:
            async for raw_chunk in self._stream_primary_response(ctx):
                if interrupt_event.is_set():
                    break
                await primary_chunk_queue.put(raw_chunk)
        finally:
            await primary_chunk_queue.put(None)
            primary_done_event.set()

    async def _consume_primary_chunks(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        primary_chunk_queue: asyncio.Queue[str | None],
        renderer_command_queue: asyncio.Queue[RendererCommand],
        tts_request_queue: asyncio.Queue[TTSChunk],
        primary_first_chunk_ready_event: asyncio.Event,
    ) -> None:
        parser = ExpressionParser(self.config.parser_max_tag_buffer_chars)
        chunk_index = 0
        first_chunk_seen = False

        while True:
            item = await primary_chunk_queue.get()
            if item is None:
                break
            if interrupt_event.is_set():
                continue

            parsed = parser.feed(item)

            for cmd in parsed.renderer_commands:
                await renderer_command_queue.put(cmd)

            if parsed.clean_text:
                if not first_chunk_seen:
                    primary_first_chunk_ready_event.set()
                    first_chunk_seen = True

                tts_chunk = TTSChunk(
                    tts_stream_id=ctx.primary_tts_stream_id,
                    chunk_index=chunk_index,
                    text=parsed.clean_text,
                    is_interruptible=True,
                )
                chunk_index += 1

                decision = await self.audio_mutex.submit_primary_chunk(
                    stream_id=ctx.primary_tts_stream_id,
                    chunk=tts_chunk,
                )

                if decision == "play_now":
                    await tts_request_queue.put(tts_chunk)

                elif decision == "replace_after_chunk":
                    ok = await self.audio_mutex.wait_for_safe_handoff(
                        self.config.quick_reaction_max_wait_ms
                    )
                    if not ok:
                        signal = await self.audio_mutex.force_replace()
                        await self._apply_interrupt_signal(signal)
                    await tts_request_queue.put(tts_chunk)

                elif decision == "buffer":
                    ok = await self.audio_mutex.wait_for_safe_handoff(
                        self.config.interrupt_replace_timeout_ms
                    )
                    if not ok:
                        signal = await self.audio_mutex.force_replace()
                        await self._apply_interrupt_signal(signal)
                    await tts_request_queue.put(tts_chunk)

            # else: parsed chunk contained only tags

        tail = parser.end_of_stream()
        for cmd in tail.renderer_commands:
            await renderer_command_queue.put(cmd)

        if tail.clean_text and not interrupt_event.is_set():
            final_chunk = TTSChunk(
                tts_stream_id=ctx.primary_tts_stream_id,
                chunk_index=chunk_index,
                text=tail.clean_text,
                is_interruptible=True,
            )
            await tts_request_queue.put(final_chunk)

    async def _dispatch_renderer_commands(
        self,
        interrupt_event: asyncio.Event,
        renderer_command_queue: asyncio.Queue[RendererCommand],
    ) -> None:
        while not interrupt_event.is_set():
            cmd = await renderer_command_queue.get()
            await self._send_renderer_command(cmd)

    async def _dispatch_tts_chunks(
        self,
        ctx: TurnContext,
        interrupt_event: asyncio.Event,
        tts_request_queue: asyncio.Queue[TTSChunk],
    ) -> None:
        while not interrupt_event.is_set():
            chunk = await tts_request_queue.get()
            await self._send_tts_chunk(ctx, chunk)

    async def _apply_interrupt_signal(
        self,
        signal: InterruptSignal,
    ) -> None:
        """
        In real implementation, this method should:
        - emit system.interrupt.signal
        - instruct playback subsystem to clear/replace streams
        - wait until material effects are applied
        - emit system.interrupt.applied
        """
        return

    async def _generate_quick_reaction(
        self,
        ctx: TurnContext,
    ) -> QuickReaction | None:
        # Placeholder implementation.
        return QuickReaction(
            text="[Thinking] 等下，我看看。",
            is_interruptible=True,
        )

    async def _stream_primary_response(
        self,
        ctx: TurnContext,
    ) -> AsyncIterator[str]:
        # Placeholder implementation.
        for chunk in ["[Thinking] ", "这个报错看起来像空指针。", "<action=nod> 先检查对象初始化。"]:
            yield chunk
            await asyncio.sleep(0)

    async def _send_renderer_command(
        self,
        cmd: RendererCommand,
    ) -> None:
        # Adapter boundary placeholder.
        return

    async def _send_tts_chunk(
        self,
        ctx: TurnContext,
        chunk: TTSChunk,
    ) -> None:
        # Adapter boundary placeholder.
        return
~~~

------

## 14. Non-negotiable implementation rules

Any AI coding assistant implementing `packages/orchestrator/` must obey all of the following:

- do **not** serialize drafter and primary into a blocking pipeline
- do **not** let drafter and primary call each other directly
- do **not** let TTS adapter decide replacement policy on its own
- do **not** bypass the expression parser
- do **not** infer playback completion from task completion
- do **not** allow malformed tags to leak into TTS
- do **not** allow simultaneous quick and primary playback
- do **not** mark interrupt as applied before material playback effects are actually reconciled
- do **not** let renderer commands drive state transitions directly

------

## 15. Suggested tests

The following tests are mandatory for acceptance.

### 15.1 Dual-track tests

- `user.speech.end` spawns drafter and primary tasks concurrently
- primary task begins even if drafter is slow
- drafter failure does not kill primary turn
- primary failure does not deadlock orchestrator

### 15.2 Audio mutex tests

- quick reaction owns audio when idle
- primary chunk arriving during quick playback waits or replaces according to policy
- no overlapping playback ownership occurs
- chunk-boundary handoff works correctly
- forced replace clears prior ownership deterministically

### 15.3 Expression parser tests

- `[Smile] hello` yields tag + `hello`
- `[Smi` + `le] hello` yields tag + `hello`
- malformed tag is not spoken
- `<action=nod>` yields renderer command only
- end-of-stream incomplete tag is discarded

### 15.4 Interrupt tests

- speaking + user barge-in triggers interrupt flow
- interrupt cancels/clears pending output
- `system.interrupt.applied` is only emitted after material reconciliation
- state machine resolves `interrupted` only after barrier event

------

## 16. Acceptance checklist

This document is considered implemented correctly only if:

-  dual-track orchestration is concurrent, not serial
-  drafter and primary communicate only through orchestrator-owned primitives
-  audio mutex is the sole authority for audible playback ownership
-  quick-to-primary handoff is deterministic
-  playback completion is based on playback lifecycle, not task completion
-  expression parser buffers incomplete tags across chunk boundaries
-  malformed tags never leak into TTS
-  interruption flow is authoritative and replayable
-  the Python skeleton can be mapped cleanly into `packages/orchestrator/`

