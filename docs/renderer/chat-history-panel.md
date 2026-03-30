# Chat History Panel

## Purpose

This document defines the first real desktop input/history UI that sits on top
of the already-real `desktop-live2d` backend.

The bubble overlay is useful for lightweight live feedback, but the runnable
demo also needs a stable current-session history and text input surface.

---

## Scope

The first panel is intentionally narrow:

- one current-session history list
- one input box
- one send action
- basic user/assistant message rendering
- app-side state only

It is not:

- a multi-session desktop shell
- a config-heavy product shell
- a screenshot UI

---

## Ownership

`packages/runtime` companion-session services own:

- session-level turn execution
- transcript/bubble update decisions
- app-input intake boundary

`apps/desktop-live2d` owns:

- panel rendering
- panel-local view state
- bounded input interactions
- keeping panel and bubble overlay visually coherent

---

## Panel And Bubble Relationship

The first desktop chat panel must not replace the bubble overlay.

Instead:

- the panel becomes the main input/history surface
- the bubble remains the lightweight live layer near the character

This keeps the runnable demo readable without overloading the renderer package
with UI product scope.

---

## Behavior Rules

- panel state is current-session only
- input submit must go through the typed desktop companion session boundary
- assistant and user messages must stay in sync with the current session's
  transcript
- bubble updates may mirror active assistant output, but bubble state is not
  the history source of truth

---

## Explicitly Deferred

The first panel does not include:

- multi-session switching
- screenshot attachments
- standby/presence UI
- tool-call inspector UI
- rich message cards
