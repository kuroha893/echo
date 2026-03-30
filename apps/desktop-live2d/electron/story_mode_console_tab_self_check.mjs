// ---------------------------------------------------------------------------
// Story Mode Console Tab Self-Check
// Validates the renderer-side tab module can be imported, and the IPC
// CREATE_THREAD handler properly converts renderer-friendly input.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";

import { buildCastMember, CAST_ROLE_TYPE, STORY_THREAD_MODE } from "../shared/story_thread_contracts.mjs";
import { MultiCompanionStoryService } from "../shared/multi_companion_story_service.mjs";

// ── IPC handler cast member conversion ──────────────────────────────────────
// Simulate what the IPC handler does for renderer input -> service input.

function testRendererCastMemberConversion() {
    const rendererInput = [
        {
            display_name: "Alice",
            persona_profile_ref: "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/persona.md",
            model_profile_ref: "open-yachiyo-kaguya",
            voice_profile_ref: "voice.alice",
            subtitle_color: "#ff7b84",
            timeline_color: "#45212b",
            role_type: "protagonist"
        },
        {
            display_name: "Bob",
            persona_profile_ref: "apps/desktop-live2d/assets/models/七七の量贩私皮/persona.md",
            model_profile_ref: "七七の量贩私皮",
            voice_profile_ref: "voice.bob",
            subtitle_color: "#67c7ff",
            timeline_color: "#1b3446",
            role_type: "supporting"
        }
    ];

    const castMembers = rendererInput.map((raw) =>
        raw.cast_member_id
            ? raw
            : buildCastMember({
                displayName: raw.display_name || raw.displayName,
                personaProfileRef: raw.persona_profile_ref || raw.personaProfileRef,
                modelProfileRef: raw.model_profile_ref || raw.modelProfileRef || null,
                voiceProfileRef: raw.voice_profile_ref || raw.voiceProfileRef || null,
                subtitleColor: raw.subtitle_color || raw.subtitleColor || null,
                timelineColor: raw.timeline_color || raw.timelineColor || null,
                roleType: raw.role_type || raw.roleType
            })
    );

    assert.equal(castMembers.length, 2);
    assert.ok(castMembers[0].cast_member_id);
    assert.equal(castMembers[0].display_name, "Alice");
    assert.equal(castMembers[0].model_profile_ref, "open-yachiyo-kaguya");
    assert.equal(castMembers[0].voice_profile_ref, "voice.alice");
    assert.equal(castMembers[0].subtitle_color, "#ff7b84");
    assert.equal(castMembers[0].timeline_color, "#45212b");
    assert.equal(castMembers[0].role_type, "protagonist");
    assert.ok(castMembers[1].cast_member_id);
    assert.equal(castMembers[1].display_name, "Bob");
    assert.equal(castMembers[1].model_profile_ref, "七七の量贩私皮");
    assert.equal(castMembers[1].voice_profile_ref, "voice.bob");

    // Verify converted cast members can be used by the service
    const service = new MultiCompanionStoryService();
    const thread = service.createThread({
        title: "Console Tab Test",
        mode: STORY_THREAD_MODE.FREE_PLAY,
        castMembers,
        sceneCardInit: {
            sceneGoal: "Test scene",
            toneTagsList: [],
            discourseConstraints: []
        }
    });
    assert.equal(thread.cast_member_ids.length, 2);
    assert.equal(thread.cast_member_ids[0], castMembers[0].cast_member_id);
    assert.equal(thread.cast_member_ids[1], castMembers[1].cast_member_id);

    console.log("  renderer_cast_member_conversion: ok");
}

// ── Pre-built cast member passthrough ──────────────────────────────────────

function testPreBuiltCastMemberPassthrough() {
    const alice = buildCastMember({
        displayName: "Alice",
        personaProfileRef: "persona/alice",
        modelProfileRef: "open-yachiyo-kaguya",
        voiceProfileRef: "voice.alice",
        subtitleColor: "#ff7b84",
        timelineColor: "#45212b",
        roleType: CAST_ROLE_TYPE.PROTAGONIST
    });
    const bob = buildCastMember({
        displayName: "Bob",
        personaProfileRef: "persona/bob",
        modelProfileRef: "七七の量贩私皮",
        voiceProfileRef: "voice.bob",
        subtitleColor: "#67c7ff",
        timelineColor: "#1b3446",
        roleType: CAST_ROLE_TYPE.SUPPORTING
    });

    // When cast_member_id is already present, the handler passes through
    const castMembers = [alice, bob].map((raw) =>
        raw.cast_member_id
            ? raw
            : buildCastMember({
                displayName: raw.display_name,
                personaProfileRef: raw.persona_profile_ref,
                roleType: raw.role_type
            })
    );

    assert.equal(castMembers[0], alice);
    assert.equal(castMembers[1], bob);

    console.log("  pre_built_cast_member_passthrough: ok");
}

// ── Console tab module import ─────────────────────────────────────────────

async function testConsoleTabModuleImport() {
    const mod = await import("../renderer/story_mode_console_tab.mjs");
    assert.equal(typeof mod.createStoryModeTabState, "function");
    assert.equal(typeof mod.captureTimelineScrollState, "function");
    assert.equal(typeof mod.restoreTimelineScrollState, "function");
    assert.equal(typeof mod.restoreTimelineScrollStateDeferred, "function");
    assert.equal(typeof mod.getRenderableTimelineEvents, "function");
    console.log("  console_tab_module_import: ok");
}

async function testTimelineRenderingKeepsFullHistory() {
    const mod = await import("../renderer/story_mode_console_tab.mjs");
    const timeline = Array.from({ length: 43 }, (_value, index) => ({
        event_kind: "cast_spoken",
        text: `entry-${index + 1}`,
        story_revision: index + 1,
        cast_member_id: `cast-${index + 1}`
    }));
    const renderable = mod.getRenderableTimelineEvents(timeline);
    assert.equal(renderable.length, 43);
    assert.equal(renderable[0].text, "entry-1");
    assert.equal(renderable[42].text, "entry-43");
    console.log("  timeline_rendering_keeps_full_history: ok");
}

async function testTimelineScrollStateHelpers() {
    const mod = await import("../renderer/story_mode_console_tab.mjs");

    const preservedTimeline = {
        scrollTop: 120,
        scrollHeight: 640,
        clientHeight: 220
    };
    const preservedState = mod.captureTimelineScrollState(preservedTimeline);
    assert.deepEqual(preservedState, {
        scrollTop: 120,
        wasNearBottom: false
    });

    const rerenderedTimeline = {
        scrollTop: 0,
        scrollHeight: 860,
        clientHeight: 220
    };
    mod.restoreTimelineScrollState(rerenderedTimeline, preservedState);
    assert.equal(rerenderedTimeline.scrollTop, 120);

    const bottomTimeline = {
        scrollTop: 420,
        scrollHeight: 640,
        clientHeight: 220
    };
    const bottomState = mod.captureTimelineScrollState(bottomTimeline);
    assert.deepEqual(bottomState, {
        scrollTop: 420,
        wasNearBottom: true
    });

    const expandedTimeline = {
        scrollTop: 0,
        scrollHeight: 920,
        clientHeight: 220
    };
    mod.restoreTimelineScrollState(expandedTimeline, bottomState);
    assert.equal(expandedTimeline.scrollTop, 700);

    console.log("  timeline_scroll_state_helpers: ok");
}

// ── Run all ────────────────────────────────────────────────────────────────

async function run() {
    testRendererCastMemberConversion();
    testPreBuiltCastMemberPassthrough();
    await testConsoleTabModuleImport();
    await testTimelineScrollStateHelpers();
    await testTimelineRenderingKeepsFullHistory();
    console.log("story_mode_console_tab_self_check: ok");
}

run();
