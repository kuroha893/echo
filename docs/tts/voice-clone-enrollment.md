# Voice Clone Enrollment

## Purpose

This document defines how Echo should support local reference audio upload for
commercial voice-clone providers without collapsing enrollment and synthesis
into one path.

---

## Core Rule

Local reference audio upload should be modeled as **voice enrollment**, not as
"every synthesis request may upload a local file".

The intended flow is:

1. caller prepares a local reference audio file
2. caller invokes a typed enrollment boundary in `packages/tts`
3. provider uploads or registers the reference audio with the backend
4. provider returns provider-managed voice ids
5. Echo stores or reuses those ids through `TTSVoiceProfile`
6. normal synthesis continues to use provider-managed voice ids

This keeps synthesis fast and predictable after enrollment succeeds.

---

## Why This Separation Matters

If Echo mixes local file upload directly into ordinary synthesis calls, several
things get worse:

- latency becomes harder to predict
- repeated speech requests may re-upload the same reference audio
- provider-managed voice ids never become first-class reusable assets
- testability becomes worse because synthesis and enrollment failures are
  entangled

By separating enrollment:

- custom voice remains supported
- ordinary synthesis stays small and fast
- provider-managed voice ids become the stable cross-turn contract

---

## Proposed Typed Boundary

The first enrollment-capable TTS line should add:

- `TTSVoiceEnrollmentRequest`
- `TTSVoiceEnrollmentResult`
- provider capability flags for enrollment support
- one service-level enrollment helper

The enrollment result should return or derive a fully typed `TTSVoiceProfile`
instead of making callers assemble raw provider ids manually.

---

## Qwen3 Family Implication

For the Qwen3 voice-clone provider family, this means:

- local reference audio upload should happen through an explicit Echo-owned
  enrollment boundary
- provider-managed `voice_id` and optional `realtime_voice_id` should come back
  as typed output
- later synthesis should prefer those ids over re-uploading local audio

---

## Out Of Scope

This document does not require:

- voice library UI
- persistent voice-profile storage format
- automatic bulk voice management
- local-provider enrollment for GPT-SoVITS

Those can come later once the first enrollment path is stable.
