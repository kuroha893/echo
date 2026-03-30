# Echo Protocol Specification: Renderer Commands

> Status: Draft v0.1  
> Scope: Canonical semantics for protocol `RendererCommand` payloads and their
> downstream execution expectations  
> Authority: This document must remain consistent with:
>
> - `docs/protocol/events.md`
> - `docs/protocol/orchestrator-spec.md`
>
> This document is the source of truth for renderer-command behavior above any
> concrete adapter or desktop app shell.

---

## 1. Purpose

This document defines the canonical meaning of protocol `RendererCommand`.

Its goals are:

- keep renderer command semantics stable across packages
- separate command meaning from concrete backend transport
- let orchestrator, renderer service, and concrete adapters agree on what each
  command type means
- prevent silent capability drift

This document does **not** define:

- a concrete renderer adapter API
- a concrete Electron or Web UI transport
- bubble/chat UI behavior
- lip-sync algorithm details

---

## 2. Canonical Command Types

The closed enum is defined in `docs/protocol/events.md`:

- `set_state`
- `set_expression`
- `set_motion`
- `set_mouth_open`
- `clear_expression`

This set is locked for the current protocol surface.

---

## 3. Field Semantics

`RendererCommand` carries:

- `command_id`
- `command_type`
- `target`
- `value`
- `intensity`
- `duration_ms`
- `is_interruptible`

### 3.1 `target`

`target` identifies the renderer-side control domain.

Typical examples:

- `state`
- `expression`
- `motion`
- `mouth`

Concrete adapters may map targets internally, but they must not reinterpret the
command type based on undocumented target names.

### 3.2 `value`

`value` is the primary command payload.

Typical shapes:

- state name for `set_state`
- expression name for `set_expression`
- motion name or key for `set_motion`
- numeric mouth-open value for `set_mouth_open`

The protocol contract keeps `value` generic because backend vocabularies are
not globally closed, but meaning must remain consistent with `command_type`.

### 3.3 `intensity`

`intensity` is an optional scalar hint.

It may be used by adapters for:

- expression strength
- motion emphasis
- scene blending hints

If unsupported, adapters may ignore intensity without reinterpreting the rest
of the command.

### 3.4 `duration_ms`

`duration_ms` is an optional duration hint.

It may be used for:

- temporary state holds
- time-bounded overrides
- motion scheduling hints

Concrete adapters are not required to implement identical timing behavior, but
they must not silently reinterpret duration as another semantic field.

### 3.5 `is_interruptible`

`is_interruptible` indicates whether downstream renderer work may be truncated
or replaced during interrupt handling.

Renderer adapters must not independently redefine interrupt policy; they may
only use this field as a hint under orchestrator-owned control flow.

---

## 4. Command-Type Semantics

### 4.1 `set_state`

Meaning:

- set a named high-level scene state such as `thinking`, `listening`, or
  `speaking`

This command must not:

- mutate session state
- imply playback ownership

### 4.2 `set_expression`

Meaning:

- apply a named expression override

Typical values:

- `smile`
- `thinking`
- `angry`

### 4.3 `set_motion`

Meaning:

- play or trigger a named motion

Typical values:

- `nod`
- `shake_head`

Motion-group/index details belong below the protocol boundary.

### 4.4 `set_mouth_open`

Meaning:

- explicitly set mouth-open state on the renderer

This command remains part of the canonical protocol even if a concrete backend
does not yet support it.

### 4.5 `clear_expression`

Meaning:

- clear the active expression override and return to baseline expression state

---

## 5. First Backend Support Rules

The first concrete desktop-live2d backend is allowed to support only:

- `set_state`
- `set_expression`
- `set_motion`
- `clear_expression`

It must explicitly reject or mark unsupported:

- `set_mouth_open`

It must not pretend that mouth-open support exists before the later lip-sync
line is implemented.

---

## 6. Downstream Execution Rules

- `renderer.command.issued` remains the protocol event boundary for accepted
  downstream renderer commands.
- Concrete adapters must not invent new protocol command types.
- Unsupported command types must surface explicitly.
- Renderer command execution must not directly cause state-machine transitions.

---

## 7. Examples

### Example: expression command

- `command_type="set_expression"`
- `target="expression"`
- `value="smile"`

### Example: motion command

- `command_type="set_motion"`
- `target="motion"`
- `value="nod"`

### Example: deferred mouth-open command

- `command_type="set_mouth_open"`
- `target="mouth"`
- `value=0.45`

This command is protocol-valid even if the first backend returns unsupported.
