# Renderer Demo Path

## Purpose

This document defines the shortest path from today's renderer line to a
presentable real-provider desktop companion demo.

---

## Current Situation

Echo now has:

- real renderer foundation
- real orchestrator renderer integration
- real desktop-live2d app shell and bridge
- real scene controller for state/expression/motion
- real app-side bubble shell
- real desktop-owned playback bridge
- real single-session desktop companion session service
- real desktop chat history panel prototype
- real app-side audio-driven lipsync shell

So the renderer subsystem is no longer the missing piece.

What is still missing for a presentable desktop demo is:

- real provider-backed desktop host assembly as the stable default path
- a browser-served web console instead of the deprecated Electron console path
- corrected avatar/chat/bubble floating desktop surfaces
- synchronized end-to-end demo verification

---

## Shortest Path

The shortest post-task65 path is:

1. update governance to allow high-fidelity UI reproduction from approved local
   reference source
2. replace the Electron console path with a browser-served web console
3. keep Electron focused on `avatar`, `chat`, and `bubble`
4. align all four surfaces to open-yachiyo-class UI fidelity
5. preserve real device playback and real Pixi/Cubism work inside the corrected
   desktop suite

This sequence is intentionally product-surface reset first.

---

## Why UI Reset Comes Before More Polish

The current desktop backend already proves the app can:

- drive renderer commands
- settle playback and lipsync shells
- coordinate chat, bubble, and session state at a prototype level

The next credibility blockers are now twofold:

- the desktop host still needs real-provider-backed assembly to be the default
  product path
- the current Electron full-console UI direction has been rejected and must be
  replaced by a browser console plus a corrected floating desktop suite

Until those two issues are resolved together, the app remains a backend-capable
engineering demo rather than the intended desktop companion product surface.

---

## Deferred Features

The corrected desktop demo still defers:

- multi-session desktop shell
- standby/presence automation
- screenshot input flow
- alternate renderer backends
