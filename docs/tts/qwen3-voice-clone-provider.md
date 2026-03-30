# Qwen3 Voice-Clone Provider

## Purpose

This document defines the first concrete provider family for Echo's TTS line.

For the first audible demo, `packages/tts` should add one commercial
voice-clone-capable adapter above the TTS-local contracts. The concrete first
family is a Qwen3 TTS VC / realtime-style external backend.

This is a first-demo provider choice, not a permanent exclusivity decision for
the repository.

---

## Why This Family Is First

The first concrete TTS provider should optimize for:

- the shortest path to a convincing audible demo
- lower implementation complexity than a full local TTS stack
- believable custom voice support through provider-managed voice cloning
- a path toward lower-latency streaming or realtime transport later

Qwen3 TTS VC is the best first fit because it already suggests:

- provider-managed voice ids for cloned voices
- separate standard and realtime model / voice tracks
- a commercial API path that is easier to stand up than GPT-SoVITS
- compatibility with Echo's local-fast-LLM design, where local quick reaction
  text can arrive first and TTS remains downstream

Current state after task44:

- Echo already has a conservative Qwen3 provider shell for synthesis
- local reference-audio enrollment was added in task45
- opt-in real-network verification was added in task46
- orchestrator integration is still the next step

Current active DashScope alignment after task78:

- system voice synthesis:
  - `POST {base_url}/services/aigc/multimodal-generation/generation`
  - body shape aligned to `dashscope.MultiModalConversation.call(...)`
  - active default model: `qwen3-tts-flash`
  - active default system voice: `Cherry`
- voice enrollment / customization:
  - `POST {base_url}/services/audio/tts/customization`
  - body shape aligned to `model="qwen-voice-enrollment"` with
    `input.action="create"` and a `data:` URI reference audio payload
- cloned-voice synthesis:
  - `POST {base_url}/services/aigc/multimodal-generation/generation`
  - active cloned model: `qwen3-tts-vc-2026-01-22`
  - `voice` must be the enrolled provider-managed voice id returned by the
    customization response

---

## Repository Boundary

The provider adapter belongs in `packages/tts`.

It must stay below:

- `packages/orchestrator`
- `packages/runtime`

and above:

- raw HTTP transport details
- provider-specific response decoding
- provider-specific error surfaces

It must not absorb:

- expression parsing
- audio mutex policy
- playback device ownership
- session-state mutation
- protocol-event emission

---

## Approved Reference

The approved external reference note for this provider family is:

- [open-yachiyo-qwen3-tts-vc.md](/C:/Users/123/Desktop/echo/docs/reference/approved/open-yachiyo-qwen3-tts-vc.md)
