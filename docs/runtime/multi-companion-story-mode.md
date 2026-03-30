# Multi-Companion Story Mode Technical Design

## Status

Proposed design for the desktop app line.

This document describes how Echo can support two or more companions
participating in the same story thread without breaking the existing runtime,
protocol, or single-session composition root.

This design sits below:

1. `docs/governance/ai-engineering-constitution.md`
2. `docs/protocol/events.md`
3. `docs/protocol/state-machine.md`
4. `docs/protocol/orchestrator-spec.md`

and above:

- `packages/runtime`
- `packages/orchestrator`
- the current desktop app surfaces in `apps/desktop-live2d`

It is intentionally an app-side orchestration design, not a runtime-core
redesign.

---

## Problem Statement

The current desktop line is optimized for one active companion session at a
time.

That is the correct shape for the current runtime core:

- runtime owns one session shell per `session_id`
- the desktop companion session service is a single-session composition root
- the current renderer chat panel is intentionally current-session scoped
- the protocol state machine should remain canonical and stable

However, the desired product mode is broader than independent parallel chats.

The target experience is a shared story space where:

- two or more companions can react to the same user action
- companions can talk to each other, not only to the user
- pacing can be slowed down or accelerated by product policy
- the user can inject setting facts, scene constraints, or manual direction
- world continuity can persist across many sessions
- future special CG generation can be triggered from high-value scene states

The gap is therefore not "how to make runtime multi-session". The gap is how
to build a higher-order director layer that coordinates multiple existing
single-session companions around one shared story thread.

---

## Goals

### Primary Goals

- support one shared story thread with multiple cast members
- preserve one `session_id` per companion session shell
- preserve canonical protocol semantics for each companion turn
- allow user-provided background, rules, and interventions
- make world state and relationship state first-class persisted artifacts
- support deterministic orchestration replay of high-level story decisions
- create a clean future hook for scene-card-driven CG generation

### Secondary Goals

- support quiet companions that observe but do not always speak
- support explicit pacing policy instead of uncontrolled round-robin chatter
- support resumable story sessions after app restart
- make evaluation possible for consistency, emotional continuity, and scene
  coherence

### Non-Goals

- redesigning the protocol state machine for multi-speaker semantics
- turning `DesktopCompanionSessionService` into a multi-session desktop manager
- merging all companions into one shared runtime session
- introducing hidden fallback behavior when cast state is incomplete
- implementing autonomous open-ended sandbox simulation in v1
- implementing CG generation itself in this phase
- implementing a full MMORPG-style world simulator

---

## Hard Constraints

The design must preserve the following repository constraints.

### Constitution Constraints

- do not guess undefined protocol behavior
- do not silently change architecture boundaries
- do not claim multi-companion support by faking it in UI only
- fail fast when required story artifacts are missing or invalid

### Runtime Constraints

- runtime remains one session shell per `session_id`
- runtime remains the owner of canonical per-session state application
- runtime does not absorb story scheduling policy
- runtime does not become a shared world-state manager

### Desktop Composition Constraints

- the current desktop companion session service stays a single-session
  composition root
- multi-companion coordination must live above that root
- current session-scoped renderer panels stay valid for each cast member

### Protocol Constraints

- each emitted event must still carry the correct `session_id`
- cross-cast coordination cannot bypass typed protocol events at session
  boundaries
- single-session invariants must remain true inside each cast session

---

## Design Summary

The proposed solution is a new app-side story orchestration layer with these
first-class concepts:

1. `StoryThread`
2. `CastSessionBinding`
3. `WorldState`
4. `RelationshipState`
5. `SceneCard`
6. `BeatCard`
7. `DirectorPlan`
8. `FactRecord`
9. `StageState`
10. `CastPresentationState`

The system does not ask the runtime core to understand "multi-character story
mode". Instead it composes multiple existing companion sessions and feeds them
curated context turn by turn.

At a high level:

1. the user interacts with a shared story thread
2. a director decides which cast member should act next
3. the selected companion receives a session-local prompt package derived from:
   - its persona
   - relevant memories
   - current scene card
   - world facts
   - relationship state
   - user intervention and safety rails
4. that companion generates one bounded turn through its own session pipeline
5. the app updates shared story artifacts from the result
6. the director decides whether another cast turn should happen immediately,
   wait, or require user input

This is a supervisor model above stable lower layers, not a protocol rewrite.

The core transaction rule is simple:

- provisional generation is not committed story truth
- only validated and revision-checked deltas become committed story truth
- only committed turns can appear in the shared visible projection

---

## Architectural Positioning

### Layering

The architecture should be split into five layers.

### Layer 0: Canonical Protocol and Runtime

Unchanged responsibilities:

- typed events
- canonical state transitions
- per-session runtime outbox
- session-local error handling
- deterministic per-session replay surfaces

### Layer 1: Existing Single-Companion Session Composition

Unchanged responsibilities:

- one desktop companion session service per active companion session
- one session-scoped renderer/chat/audio flow per companion
- model/provider/voice settings bound to that session

### Layer 2: New Multi-Companion Story Orchestration Layer

New responsibilities:

- story-thread lifecycle
- cast roster and per-cast bindings
- world-state lifecycle
- relationship-state lifecycle
- scene planning and pacing policy
- turn selection and interruption rules
- shared persistence and recovery coordination

### Layer 3: New Multi-Companion Desktop Shell

New responsibilities:

- story-mode UI surfaces
- active cast roster display
- scene state display
- user intervention controls
- per-cast focus switching
- shared transcript projection

### Layer 4: Future Asset and CG Hooks

Deferred responsibilities:

- scene-card export for CG generation
- unlock rules for special scenes
- image prompt pack generation
- later replay-to-asset tooling

---

## Core Domain Model

### Top-Level Entities

### `StoryThread`

The persistent root object for one shared narrative run.

Required fields:

- `thread_id`
- `title`
- `mode`
- `status`
- `created_at`
- `updated_at`
- `user_profile_ref`
- `world_state_id`
- `active_scene_id`
- `director_plan_id`
- `cast_member_ids[]`
- `last_user_turn_id`
- `revision`

Responsibilities:

- identify the shared narrative context
- point to the currently active scene
- define whether the thread is onboarding, free-play, chapter-driven, or event
  driven
- provide a stable persistence root for recovery and replay

### `CastMember`

The configuration object for one participant in the story.

Required fields:

- `cast_member_id`
- `display_name`
- `persona_profile_ref`
- `model_profile_ref`
- `voice_profile_ref`
- `renderer_profile_ref`
- `role_type`
- `default_visibility`
- `relationship_anchor_ids[]`
- `status`

Responsibilities:

- identify a character independently from any one runtime session
- preserve persona and expression settings across threads
- support future roster reuse across different story threads

### `CastSessionBinding`

The bridge object between a cast member and one active single-session runtime
composition root.

Required fields:

- `binding_id`
- `thread_id`
- `cast_member_id`
- `session_id`
- `service_instance_key`
- `window_target_ids[]`
- `activation_state`
- `last_turn_at`
- `last_observed_story_revision`
- `resume_payload_ref`

Responsibilities:

- attach one cast member to one concrete session shell
- keep session ownership explicit
- support activation, standby, suspension, and resume

### `WorldState`

The authoritative shared reality for the current story thread.

Required fields:

- `world_state_id`
- `world_bible_ref`
- `current_time_anchor`
- `current_location_id`
- `location_graph_ref`
- `environment_facts[]`
- `inventory_facts[]`
- `open_world_events[]`
- `global_constraints[]`
- `revision`

Responsibilities:

- store facts that are not owned by any one companion
- prevent drift between cast-specific memory summaries
- provide a stable basis for future scene art generation

### `RelationshipState`

The structured social state between actors.

Required fields:

- `relationship_state_id`
- `thread_id`
- `edge_set[]`
- `trust_scores`
- `affinity_scores`
- `conflict_flags[]`
- `promises[]`
- `stable_dimensions`
- `volatile_dimensions`
- `relationship_flags[]`
- `revision`

Responsibilities:

- track pairwise and group social dynamics explicitly
- avoid burying social continuity in raw transcript only
- support director reasoning about who should act next

Evolution rules:

- stable dimensions update slowly and preserve long-horizon relationship trend
- volatile dimensions react quickly to recent events and decay over time
- relationship flags only change through explicit qualifying events

Recommended split:

- stable dimensions: familiarity, baseline trust, attachment
- volatile dimensions: embarrassment, resentment, jealousy, comfort
- flags: unresolved_confession, recent_betrayal, mutual_secret,
  pending_promise

### `FactRecord`

The normalized fact object used by world, relationship, and memory retrieval
layers.

Required fields:

- `fact_id`
- `fact_type`
- `content`
- `provenance`
- `visibility_scope`
- `confidence`
- `revision_introduced`
- `revision_resolved`

Responsibilities:

- make knowledge visibility explicit instead of implicit in transcript
- support safe prompt assembly per cast member
- preserve provenance for debugging, validation, and replay

### `ProvenanceKind`

Minimum provenance categories:

- `user_authored`
- `director_authored`
- `cast_visible_committed_turn_derived`
- `system_inferred`

Rules:

- every `FactRecord.provenance` must declare one of these categories
- validator strictness may vary by provenance kind
- user-authored and committed-turn-derived facts should be preferred over
  system-inferred facts when conflicts appear

### `VisibilityScope`

Minimum visibility categories:

- `public_to_all_cast`
- `known_to_cast_subset`
- `known_to_user_only`
- `inferred_only_not_speakable`

Rules:

- `TurnAssembler` must filter fact retrieval by visibility scope
- inferable-but-not-speakable facts may guide director reasoning but must not
  be surfaced as explicit character knowledge
- secret leakage checks operate on fact visibility, not raw text heuristics

### `SceneCard`

The bounded planning artifact for the current scene.

Required fields:

- `scene_id`
- `thread_id`
- `scene_goal`
- `entry_conditions[]`
- `exit_conditions[]`
- `featured_cast_ids[]`
- `location_id`
- `tone_tags[]`
- `discourse_constraints[]`
- `commonsense_constraints[]`
- `user_constraints[]`
- `cg_candidate_score`
- `status`

Responsibilities:

- define what kind of interaction should happen now
- separate "what the scene should achieve" from raw model prompting
- serve as the future handoff boundary to CG selection/generation

### `BeatCard`

The short-horizon presentation beat used to drive desktop performance and body
language.

Required fields:

- `beat_id`
- `scene_id`
- `beat_type`
- `target_cast_ids[]`
- `presentation_goal`
- `timing_policy`
- `interruptibility`
- `expiration_revision`

Responsibilities:

- translate scene intent into short desktop-visible interaction beats
- coordinate pauses, glances, interruptions, approach/retreat, and emphasis
- bridge narrative planning with Live2D performance cues

### `DirectorPlan`

The current coordination plan for the next bounded set of turns.

Required fields:

- `director_plan_id`
- `thread_id`
- `scene_id`
- `turn_queue[]`
- `urgency_level`
- `interruptibility`
- `user_wait_policy`
- `replan_reason`
- `created_at`
- `expires_at`

Responsibilities:

- choose the next speaker or observer
- enforce pacing
- decide when to yield back to the user
- support explicit replanning after user intervention or world changes

### `StageState`

The global desktop-stage state for the current thread.

Required fields:

- `stage_state_id`
- `thread_id`
- `active_layout`
- `camera_focus`
- `available_slots[]`
- `scene_lighting`
- `bgm_cue`
- `current_beat_id`
- `revision`

Responsibilities:

- define the shared desktop presentation context above individual cast windows
- coordinate layout and emphasis across multiple visible companions
- provide a stable state root for future richer animation systems

### `CastPresentationState`

The per-cast desktop presentation state.

Required fields:

- `cast_member_id`
- `thread_id`
- `position`
- `scale`
- `z_index`
- `facing_target`
- `expression`
- `motion_queue[]`
- `visibility`
- `speech_bubble_state`
- `revision`

Responsibilities:

- bind story-mode decisions to Live2D-visible presentation state
- separate presentation transitions from narrative truth commits
- support later renderer-specific adaptation without polluting story state

### Revision Semantics

Story mode uses `StoryThread.revision` as the global commit clock.

Rules:

- every committed visible cast turn increments `StoryThread.revision` by 1
- compare-and-swap in `TurnCommitProtocol` always targets
  `StoryThread.revision`
- `WorldState.revision`, `RelationshipState.revision`, and `StageState.revision`
  record the latest `StoryThread.revision` that successfully changed that
  artifact
- `CastPresentationState.revision` records the latest committed story revision
  or beat revision that changed that cast's presentation state
- local revision fields are therefore derived commit markers, not independent
  clocks

Implications:

- there is one global story commit root
- local artifact revisions do not advance independently of the story commit root
- recovery and stale-turn detection must treat `StoryThread.revision` as the
  source of truth

---

## Memory Model

The multi-companion mode needs explicit tiering. Raw transcript alone is not
enough.

### Tier 1: Working Set

Short-lived, scene-local state used for immediate generation.

Contents:

- current scene card
- recent user intervention
- last N relevant turns
- current world deltas
- current relationship deltas
- speaker-local intent scratchpad

Properties:

- aggressively size-bounded
- recomputed often
- disposable

### Tier 2: Episodic Story Memory

Scene and event summaries for one thread.

Contents:

- resolved scene outcomes
- promises made
- betrayals or trust changes
- revealed secrets
- important location transitions
- user-authored rules added during play

Properties:

- append-oriented
- queryable by recency and salience
- shared across cast, with access controls where needed
- fact-backed when the recalled item affects visibility or future commitments

### Tier 3: Character Long-Term Memory

Character-specific durable memory that survives across threads when allowed by
product policy.

Contents:

- stable preferences
- long-term feelings toward user
- recurring social patterns
- durable worldview updates

Properties:

- slower write rate
- explicit promotion policy
- reversible or reviewable when required

### Tier 4: World Bible

Structured setting-level truth, not generated turn text.

Contents:

- locations
- faction facts
- hard rules of the setting
- object affordances
- chapter-level constraints

Properties:

- curated or heavily validated
- shared by all cast members
- must fail fast when contradictory

### Why This Split Exists

This split prevents three failure modes:

1. each companion inventing a different world truth
2. relationship continuity getting lost inside transcript noise
3. prompt growth becoming unbounded as the story gets longer

---

## Component Design

### New App-Side Services

### `MultiCompanionStoryService`

This should be the top-level app service for story mode.

Responsibilities:

- create and load `StoryThread`
- own the story-mode service graph
- coordinate recovery on app launch
- expose story-mode APIs to Electron and renderer layers

It should not:

- replace runtime internals
- directly apply protocol state transitions
- directly impersonate a companion session

### `CastRegistry`

Responsibilities:

- resolve cast member metadata
- map cast members to provider/model/voice/render profiles
- validate roster completeness before scene start

Fail-fast conditions:

- missing persona profile
- missing provider profile
- invalid voice mapping when voice is required

### `StoryWorldStore`

Responsibilities:

- load and persist `WorldState`
- validate world-bible revisions
- provide location graph lookups
- apply world deltas from resolved turns

### `RelationshipStore`

Responsibilities:

- load and persist social edges
- apply trust/affinity/conflict updates
- expose relationship features for director planning

### `StoryMemoryService`

Responsibilities:

- manage working set assembly
- retrieve episodic summaries
- promote durable memory when thresholds are met
- support cast-specific memory filtering
- filter facts by `VisibilityScope` before turn assembly

### `ScenePlanner`

Responsibilities:

- create initial scene cards from world state and thread mode
- propose next scene cards after exit conditions are met
- compute candidate CG score and notable beat tags
- emit short-horizon `BeatCard` candidates for presentation-level control

### `DirectorService`

Responsibilities:

- create and revise `DirectorPlan`
- choose the next speaker
- decide when a companion observes only
- decide when user input is required
- interrupt queued turns when a higher-priority event arrives
- approve or reject high-impact provisional deltas when policy requires
- emit a deterministic decision trace with feature scores and tie-break result

This is the key new product-control component.

### `TurnAssembler`

Responsibilities:

- build the exact prompt/input package for one cast turn
- merge scene card, world facts, relationship state, and selected memories
- enforce token and latency budgets
- produce a deterministic assembly report for debugging
- materialize the frozen input snapshot id used by commit and replay paths

### `StoryProjectionService`

Responsibilities:

- convert per-cast outputs into a shared transcript projection
- emit typed UI-friendly story events
- maintain story timeline views separate from raw per-session runtime logs
- publish only committed visible turns, never provisional generations

### `StoryRecoveryService`

Responsibilities:

- restore thread, scene, plan, and bindings after restart
- detect incomplete turns
- decide whether to replay, abort, or request manual resume

### `TurnCommitCoordinator`

Responsibilities:

- own the provisional-to-committed cast-turn pipeline
- extract structured deltas from provisional output
- run validation and compare-and-swap commit
- guarantee that shared projection happens only after commit success

---

## Session Strategy

### Why We Keep One Session Per Cast Member

One cast member should continue to own one active companion session shell.

Reasons:

- it matches the current runtime contract
- it preserves provider/model/voice individuality
- it avoids smearing persona state across companions
- it keeps existing replay and failure boundaries useful

The story mode therefore uses composition:

- one shared `StoryThread`
- many `CastSessionBinding`s
- many underlying single-session composition roots

This creates a clear ownership model:

- shared story truth lives above sessions
- per-cast generation state lives inside the cast session

### Turn Commit Protocol

Every visible `cast_turn` must follow the same six-step commit pipeline.

1. read a frozen input snapshot
2. generate provisional output
3. extract structured deltas from provisional output
4. validate deltas against current policy and revision state
5. commit with compare-and-swap from `story_revision` to `story_revision + 1`
6. project the committed result into the shared story view

Rules:

- provisional output is not user-visible shared truth
- validation runs before shared projection
- compare-and-swap failure invalidates the provisional turn
- stale turns must reassemble from a fresh snapshot rather than retrying blind
- world delta, relationship delta, and scene progress delta commit together or
  not at all

Commit artifacts for each turn should include:

- input snapshot id
- assembly report id
- provisional output id
- structured delta package id
- validation result
- committed revision id
- projection event ids

### Delta Algebra

Structured delta candidates must use explicit operation kinds rather than
ad-hoc payloads.

Minimum operation families:

- `add_fact`
- `update_fact`
- `resolve_fact`
- `set_flag`
- `clear_flag`
- `adjust_dimension`
- `append_promise`
- `resolve_promise`
- `advance_scene_exit_condition`
- `set_stage_focus`
- `enqueue_presentation_action`

Per-operation requirements:

- each operation declares a target artifact type
- each operation declares the minimum required fields
- each operation declares its validator
- each operation declares conflict handling rules

Examples:

- `add_fact`: requires fact payload, provenance, visibility scope
- `adjust_dimension`: requires target edge, dimension name, signed delta,
  clamp policy
- `set_flag`: requires flag name, target relationship or thread scope,
  activation reason
- `enqueue_presentation_action`: requires action kind, target cast, beat or
  story revision anchor

The `TurnCommitCoordinator` should validate delta candidates by operation kind
before attempting compare-and-swap commit.

### Deterministic Orchestration Replay

This design targets deterministic orchestration replay, not guaranteed
deterministic semantic replay.

Replayable artifacts:

- input snapshot id
- director decision trace
- selected memory item ids
- assembly report
- validation result
- committed deltas
- projection events

Only conditionally replayable artifacts:

- exact generated text
- exact emotional wording
- exact narration phrasing

Generation replay is attempted only when provider, model version, sampling
config, and tool outputs are fixed and reproducible.

---

## Turn Scheduling and Pacing

The central product challenge is not generation. It is pacing.

Uncontrolled multi-agent chatter will quickly degrade into:

- latency spikes
- repetitive banter
- user exclusion
- story drift

The scheduler must therefore be explicit.

### Turn Types

Define four turn types.

### `user_turn`

- explicit user input
- highest authority for immediate story direction

### `cast_turn`

- one companion speaks or acts visibly
- goes through the full per-session generation path

### `observer_turn`

- one or more companions update internal state without visible speech
- allows social continuity without filling the screen with extra dialogue

Phase 1 policy:

- observer turns are deterministic state-only updates
- observer turns do not call the language model
- observer turns must not create new secrets, promises, conflicts, or world
  facts
- observer turns may update recency, salience, attention target,
  reaction-eligibility, and bounded low-impact relationship drift

### `director_turn`

- no companion speaks
- the system replans the scene, updates pacing, or requests user confirmation

### Scheduling Rules

### Rule 1: Default to User-Centered Cadence

After one visible cast turn, the system should usually yield unless the current
scene card explicitly allows short chained reactions.

### Rule 2: Chain Length Must Be Bounded

The director plan should enforce a maximum number of autonomous visible turns
before requiring user input or a director checkpoint.

### Rule 3: Not Every Aware Companion Speaks

Companions can observe, update relationship state, and remain silent.

In phase 1, observer updates must remain explainable and deterministic.

### Rule 4: Interruptions Are First-Class

Queued cast turns must be invalidated when:

- the user intervenes
- the world state changes materially
- a hidden assumption becomes invalid
- a conflict or safety policy triggers a replan

### Rule 5: Speaker Selection Is Utility-Based

Next speaker selection should consider:

- scene relevance
- relationship tension
- recency of last visible turn
- current emotional momentum
- explicit user cue
- whether a character is better handled as observer only

Phase 1 deterministic heuristic:

- compute a weighted score per eligible cast member
- select the highest score above the minimum action threshold
- if no score crosses the threshold, yield to user or emit a director turn

Recommended initial score terms:

- `scene_relevance_weight * scene_relevance`
- `relationship_tension_weight * relationship_tension`
- `user_cue_weight * explicit_user_cue_match`
- `recency_penalty_weight * recent_visible_turn_penalty`
- `latency_penalty_weight * predicted_latency_cost`
- `presentation_focus_bonus * current_stage_focus_match`

Phase 1 tie-break order:

1. explicit user cue match
2. higher scene relevance
3. longer time since last visible turn
4. lower predicted latency
5. stable cast-member id ordering for determinism

This heuristic should be implemented as explicit weighted rules, not hidden
prompt-only behavior.

### Rule 6: Latency Budget Is a Product Rule

If the assembled chain of turns exceeds the latency budget, the director should:

- shorten the chain
- drop low-value observer work
- request user continuation instead of over-running silently

---

## Prompt and Input Assembly

The design should avoid a monolithic mega-prompt.

Each cast turn should be assembled from bounded sections.

### Input Package Sections

### Section 1: Session Persona Base

- character identity
- speech style
- provider/model-specific system rules

### Section 2: Story Thread Context

- current thread summary
- current chapter or mode
- latest user intent

### Section 3: Scene Card

- scene goal
- discourse constraints
- commonsense constraints
- do-not-break facts

### Section 4: World Facts

- current location
- active environment facts
- important object or faction state

### Section 5: Relationship Slice

- relevant social edges
- unresolved tension
- visible facts and secrets this cast member is allowed to know

### Section 6: Memory Retrieval

- top episodic recalls
- cast-specific durable memory
- unresolved commitments
- filtered fact records with visibility and provenance intact

### Section 7: Turn Contract

- whether to speak, act, or stay concise
- output style constraints
- interruption expectations
- optional scene-card tagging fields for downstream evaluation

### Structured Turn Output Contract

Every visible cast generation should produce a structured output envelope in
addition to free text.

Minimum fields:

- `spoken_text`
- `narration_text_optional`
- `intent_tag`
- `emotion_tag`
- `relationship_delta_candidates[]`
- `world_delta_candidates[]`
- `beat_tags[]`
- `cg_signal_tags[]`

Rules:

- shared projection consumes the structured envelope plus visible text
- validators operate on delta candidates before commit
- delta candidate arrays should use the explicit operation kinds from
  `Delta Algebra`
- free-form parsing should be a migration bridge only, not the target steady
  state

### Assembly Principles

- each section is independently inspectable
- every included memory item should have a reason code
- missing critical artifacts should hard-fail the turn assembly
- token budgets should be enforced before model invocation, not after
- fact visibility filtering must happen before any prompt section is assembled

---

## Shared Story Projection

The UI and persistence layers need a shared transcript that is not identical to
any one companion's raw session transcript.

That means the system should maintain two parallel views.

### Per-Cast Session View

Used for:

- raw generation debugging
- provider-specific replay
- session-local recovery

### Shared Story View

Used for:

- user-facing transcript
- scene playback
- relationship and world updates
- future scene-card and CG workflows

Each visible story event should record:

- source cast member
- source session id
- source story revision
- visibility scope
- whether it was spoken, narrated, or inferred
- committed turn id
- input snapshot id
- projection idempotency key

Projection rules:

- shared projection events must carry a stable idempotency key
- recovery must reject duplicate projection of the same committed turn
- shared projection is append-only at the event layer, with dedup based on the
  idempotency key

This separation prevents the current session-scoped runtime transcript from
becoming overloaded with product-only concepts.

---

## Persistence and Recovery

Story mode requires persistence above existing runtime persistence.

### Persisted Artifacts

At minimum, the app should persist:

- `StoryThread`
- current `SceneCard`
- current `DirectorPlan`
- `WorldState`
- `RelationshipState`
- `StageState`
- `CastPresentationState`
- cast roster and bindings
- story projection timeline
- recovery markers for in-flight turns
- turn commit artifacts

### Recovery Algorithm

On app launch:

1. load thread root and revision
2. validate all cast bindings
3. restore world and relationship snapshots
4. inspect each bound session for in-flight work
5. decide one of:
   - safe resume
   - force abort and replan
   - require user confirmation
6. rebuild the director plan if the previous plan expired or became invalid

Recovery must also verify projection idempotency before re-emitting any shared
story event derived from previously committed turns.

### Resume Payload

Each cast binding should optionally persist a bounded resume payload:

- last assembled turn contract
- last seen scene revision
- pending interruption markers
- pending observer work

Any in-flight provisional output must remain provisional after restart. It must
never be projected into the shared visible transcript without revalidation and
successful commit.

### World Write Policy

World-state writes should be classified by impact.

Low-impact changes:

- can auto-commit after validator success
- examples: local prop placement, low-stakes movement, temporary pose context

Medium-impact changes:

- require validator success and policy approval
- examples: entering a newly relevant area, accepting a task, adding a usable
  location affordance

High-impact changes:

- enter a pending state by default
- require explicit director approval and may require user confirmation
- examples: world-rule change, identity reveal, role death, irreversible
  relationship rupture

This creates a future path toward suspend/resume behavior without requiring the
runtime core to invent process-level agent scheduling semantics.

---

## UI and Desktop Shell Design

The current desktop UI is session-centric. Story mode needs a thread-centric
shell above it.

### New Story-Mode UI Concepts

### Story Thread Surface

Shows:

- active thread title
- active scene card summary
- world location
- current speaking cast member
- pace mode
- current beat and stage focus

### Cast Roster Surface

Shows:

- all cast members in the thread
- active / observing / paused status
- relationship hints
- manual focus or pin controls
- presentation status

### Shared Transcript Surface

Shows:

- user input
- visible cast turns
- optional narrator/system beats
- scene transitions

### Intervention Surface

Allows the user to inject:

- background facts
- scene direction
- relationship corrections
- pacing commands
- hard prohibitions

### Per-Cast Detail Surface

Used for inspection, not primary flow.

Shows:

- raw session transcript
- provider/model status
- current memory slice
- recent turn assembly report
- current presentation state

### Stage and Presentation State

Story mode must expose a presentation control plane in addition to transcript
state.

The minimum visible state model is:

- `StageState` for shared layout, focus, lighting, and beat context
- `CastPresentationState` for each character's desktop presence
- `BeatCard` for short interaction beats that drive body language and timing

`SceneCard` remains the narrative unit.

`BeatCard` becomes the short-horizon performance unit.

### Windowing Strategy

Phase 1 should avoid a fully independent window per cast member by default.

Recommended starting point:

- one primary story window
- existing avatar windows remain optional per focused cast member
- per-cast detail can be docked or switched, not always visible

This keeps the product legible before proving the scheduling model.

---

## IPC and App Boundary Design

This feature needs a clear app-side contract, especially in Electron.

### Suggested New Boundary Families

### Story Thread Commands

- create thread
- load thread
- add cast member
- remove cast member
- change pace mode
- apply user intervention
- advance scene

### Story Projection Events

- scene started
- cast turn committed
- observer update applied
- relationship state changed
- world state changed
- stage state changed
- beat committed
- director replanned

### Presentation Execution Events

Story mode also needs a renderer-facing execution contract above raw
projection events.

Minimum execution event families:

- `look_at`
- `approach`
- `retreat`
- `pause`
- `interrupt`
- `set_expression`
- `play_motion`
- `focus_shift`

Rules:

- these events are emitted from committed `BeatCard` and presentation deltas,
  not directly from provisional text
- renderer adapters may translate them into concrete Live2D motions and window
  choreography
- execution events should reference the committed story revision or beat
  revision that authorized them

This keeps story planning and renderer execution decoupled while still giving
`apps/desktop-live2d` a concrete integration contract.

### Inspection Endpoints

- get current scene card
- get current director plan
- get current director decision trace
- get cast binding list
- get relationship snapshot
- get world snapshot
- get stage state
- get cast presentation state
- get last turn assembly report

These should remain app-level contracts and not be pushed into the canonical
runtime protocol unless a later task explicitly requires protocol evolution.

---

## Failure Model

The constitution requires fail-fast behavior. Story mode therefore must reject
partial invalidity instead of masking it.

### Hard Failures

The current scene should stop and surface an explicit error when:

- a cast member lacks a valid session binding
- a required persona/model/voice profile is missing
- world-state revision is contradictory
- relationship snapshot cannot be applied cleanly
- a visible turn is generated against a stale scene revision
- a queued turn references a no-longer-valid constraint set
- a provisional turn fails compare-and-swap commit
- a visible projection is attempted before commit success
- a fact retrieval request violates `VisibilityScope`

### Soft Interruptions

The current plan should replan, not crash, when:

- the user adds a new scene direction
- latency budget is exceeded before model dispatch
- a low-priority observer update becomes stale
- the current scene reaches an exit condition early

### Invariant Checks

The app should add explicit checks for:

- one active visible speaker at a time in story mode
- no committed cast turn against stale story revision
- all shared projection events trace back to one cast session or director action
- relationship deltas are revision-checked before commit
- world deltas are applied atomically with the story revision bump
- all committed visible turns have a frozen input snapshot id
- no provisional output is visible in shared projection
- presentation-state commits reference an existing committed story revision or
  beat revision

---

## Evaluation Strategy

This feature will fail if it is judged only by "it talks a lot".

The evaluation set should include at least five dimensions.

### 1. Character Consistency

Questions:

- does each cast member still sound like themselves
- do persona traits remain stable across long scenes

### 2. Relationship Continuity

Questions:

- do trust, tension, and alliances evolve coherently
- are promises and betrayals remembered later

### 3. Scene Coherence

Questions:

- does the dialogue advance the active scene goal
- do location and world facts remain consistent

### 4. User Agency Preservation

Questions:

- can the user redirect the scene without fighting the system
- does the system yield often enough for user participation

### 5. Emotional Fidelity

Questions:

- do emotionally intense scenes carry believable reactions
- does the tone match the scene card and relationship state

The repo should eventually add lightweight scripted checks plus manual eval
rubrics for these dimensions.

### Adversarial Eval Tracks

The baseline eval set should include explicit failure-oriented scenarios.

Secret leakage test:

- verify that a cast member does not speak or act on facts outside its
  visibility scope

Stale plan test:

- verify that queued turns from an invalidated `DirectorPlan` cannot commit
  after user redirection

Long-term promise test:

- verify that a promise made in an earlier scene still constrains later turn
  selection and response content

---

## Research-Derived Design Choices

This design intentionally incorporates several research-backed corrections.

### World State Must Be Explicit

The design introduces a `WorldState` plus world bible and location graph
because long-running multi-character interactions become unstable if the setting
exists only in transcript summaries.

### Director and Actor Roles Must Be Separated

The design separates `DirectorService` from cast generation because plot
progression and per-character expression are different optimization problems.

### Memory Must Be Tiered

The design separates working memory, episodic memory, long-term character
memory, and world bible state because each has a different write frequency,
query pattern, and failure cost.

### Scene Card Must Be Structured

The design separates discourse constraints from commonsense constraints because
"what should be said" and "what must remain physically/socially coherent" are
not the same control axis.

### Emotion Quality Cannot Be Solved By Prompt Growth Alone

If emotional fidelity proves weak, the expected next step is better character
data and evaluation, not unlimited prompt stacking.

---

## Implementation Plan

### Phase 1: Story Skeleton

Deliver:

- thread root persistence
- cast roster and bindings
- minimal `SceneCard`
- minimal `DirectorPlan`
- simple director with bounded one-speaker selection
- shared transcript projection
- restart recovery
- deterministic state-only observer updates only if needed for recency and
  attention bookkeeping

Explicit exclusions:

- autonomous multi-turn chain longer than one visible reaction
- rich world-state delta validation
- rich relationship-state evolution rules
- model-driven observer turns
- CG hooks beyond placeholder artifact fields

Success criteria:

- user can create one thread with two cast members
- one cast speaks at a time through existing single-session paths
- stale turns are invalidated before projection
- shared transcript and recovery work after restart

### Phase 2: Scene Planning and Pacing

Deliver:

- world state shell
- relationship state shell
- scene card lifecycle
- bounded autonomous short reaction chain
- observer turns
- user intervention commands
- director replanning rules

Success criteria:

- the system can run a short multi-cast scene without immediate drift
- user interventions invalidate stale plans correctly

### Phase 3: Memory and Social Depth

Deliver:

- episodic memory retrieval
- durable relationship updates
- world-state delta validation
- fact visibility model and leakage checks
- emotion and relationship evaluation tracks

Success criteria:

- later scenes remember unresolved tension and prior promises
- relationship changes are visible in future turn selection

### Phase 4: Asset Hooks and Advanced Recovery

Deliver:

- scene-card export for CG candidate scenes
- resume payload refinement
- better inspection tooling
- richer replay of story-level decisions

Success criteria:

- high-value scenes produce stable structured artifacts for downstream visual
  workflows

---

## Recommended Initial Code Placement

The first implementation should stay above runtime and avoid package-boundary
confusion.

Recommended app-side modules:

- `apps/desktop-live2d/shared/story_thread_contracts.mjs`
- `apps/desktop-live2d/shared/story_projection_contracts.mjs`
- `apps/desktop-live2d/shared/story_fact_contracts.mjs`
- `apps/desktop-live2d/shared/story_world_store.mjs`
- `apps/desktop-live2d/shared/relationship_store.mjs`
- `apps/desktop-live2d/shared/story_memory_service.mjs`
- `apps/desktop-live2d/shared/director_service.mjs`
- `apps/desktop-live2d/shared/scene_planner.mjs`
- `apps/desktop-live2d/shared/turn_commit_coordinator.mjs`
- `apps/desktop-live2d/shared/turn_assembler.mjs`
- `apps/desktop-live2d/shared/stage_state_store.mjs`
- `apps/desktop-live2d/shared/multi_companion_story_service.mjs`

Electron-side boundary additions should remain thin.

Recommended Electron modules:

- `apps/desktop-live2d/electron/story_mode_ipc.mjs`
- `apps/desktop-live2d/electron/story_mode_window_controller.mjs`

This placement keeps the feature where it belongs: in the desktop app line,
above stable runtime contracts.

---

## Open Questions

These questions should be resolved before broad implementation.

1. Should one thread allow heterogeneous providers/models across cast members
   in phase 1, or should the first version require one provider family?
2. After phase 1 deterministic observer turns, which observer updates justify
  model invocation without harming debuggability?
3. Should world-state writes be user-confirmed for some high-impact categories?
4. How much of relationship state should be explicit sliders versus inferred
   structured deltas?
5. Should special CG triggers be director-authored, heuristic, or hybrid?

---

## Final Recommendation

Echo should implement multi-companion story mode as a thread-centric desktop
supervisor above the existing single-session runtime and companion service
stack.

The core move is not to make the lower layers "more magical". The core move is
to add explicit shared artifacts that the current product does not yet have:

- thread
- scene
- director plan
- world state
- relationship state
- fact visibility model
- stage state
- beat cards
- shared story projection

If those artifacts are introduced first, the current runtime and session model
remain valid and reusable.

If those artifacts are skipped and the product attempts direct multi-agent free
chat on top of raw transcripts alone, drift and pacing collapse are the likely
outcome.