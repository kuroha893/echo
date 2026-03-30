# Renderer Action Mapping

## Purpose

This document defines how protocol-level renderer commands should be interpreted
by the first renderer line.

It does **not** define parser grammar. Parser behavior remains owned by
`docs/protocol/orchestrator-spec.md`.

---

## Command Ownership

The parser/orchestrator line decides **when** a `RendererCommand` is emitted.
The renderer line decides **how** that typed command is executed by a concrete
backend.

The renderer backend must not invent hidden new command types.

---

## First Backend Mapping

### `set_state`

Meaning:

- set a named high-level scene state such as `thinking`, `listening`, or
  `speaking`

First backend behavior:

- route the state to a deterministic scene controller hook
- allow state-specific motion/expression presets if the backend defines them
- do not mutate protocol/session state

### `set_expression`

Meaning:

- apply a named expression such as `smile` or `thinking`

First backend behavior:

- map the expression name to one concrete expression application path
- if the named expression is unsupported, return a typed failure

### `set_motion`

Meaning:

- play one named motion or equivalent motion-group selection

First backend behavior:

- map the command into one concrete motion play request
- preserve deterministic error handling if the motion is missing

### `clear_expression`

Meaning:

- clear the currently active expression override

First backend behavior:

- remove expression override and return to baseline scene presentation

### `set_mouth_open`

Meaning:

- explicitly drive mouth-open state as a renderer command

First backend behavior:

- this command remains part of the protocol contract
- the first backend may explicitly reject it as unsupported until a later
  lip-sync task lands
- it must not be silently treated as implemented

---

## Command Support Matrix

| Command type | First backend expectation |
|---|---|
| `set_state` | supported |
| `set_expression` | supported |
| `set_motion` | supported |
| `clear_expression` | supported |
| `set_mouth_open` | explicitly deferred |

---

## Mapping Guardrails

- Do not convert unsupported commands into silent no-ops.
- Do not let renderer command execution drive session-state transitions.
- Do not bind protocol command names to backend-specific raw payloads at the
  caller boundary.
