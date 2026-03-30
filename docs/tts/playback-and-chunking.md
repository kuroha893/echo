# Playback And Chunking

## Purpose

This document defines how protocol `TTSChunk` should enter `packages/tts` and
how synthesized audio should leave it.

---

## Upstream Boundary

`packages/tts` should accept protocol `TTSChunk` as the upstream text chunk
unit.

That means `packages/tts` must not invent a second competing text-chunk
contract for callers above the package boundary.

---

## Downstream Boundary

`packages/tts` should return normalized `TTSAudioFragment` values.

This keeps provider transport and media framing out of:

- `packages/orchestrator`
- `packages/runtime`
- later app/device shells

---

## Streaming Rule

If a provider supports streaming synthesis:

- fragment order must be stable
- `fragment_index` must start at `0`
- exactly one terminal fragment must mark `is_final=True`

If a provider only supports one-shot audio:

- the adapter may still normalize that output into one final fragment

---

## Playback Ownership Rule

`packages/tts` does not decide:

- when audio starts playback
- when audio finishes playback
- whether a chunk may interrupt another chunk

Those remain orchestrator/runtime/device-layer decisions.
