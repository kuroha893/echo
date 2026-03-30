// ---------------------------------------------------------------------------
// Story Mode Persistence — Phase 1
// File-based JSON persistence for story mode state.
// Follows the same pattern as avatar_model_selection_store.mjs.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import path from "node:path";

const STORY_MODE_DIR = "story-mode";
const STORY_STATE_FILE = "story-state.json";
const STORY_SLOTS_DIR = "slots";
const STORY_SLOT_FILE_PREFIX = "slot-";
const STORY_SLOT_FILE_SUFFIX = ".json";
const STORY_DEFAULT_SLOT_COUNT = 12;

function summarizeText(text, maxLength = 96) {
    if (typeof text !== "string") {
        return "";
    }
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}

function resolveFocusCastName(data, castMembers) {
    const focusCastId = data?.stage_state?.camera_focus;
    if (typeof focusCastId !== "string" || focusCastId.trim() === "") {
        return "";
    }
    const matched = castMembers.find((castMember) => castMember?.cast_member_id === focusCastId);
    return typeof matched?.display_name === "string" ? matched.display_name : "";
}

function resolveLatestEventPreview(data) {
    const timelineEvents = Array.isArray(data?.timeline_events) ? data.timeline_events : [];
    for (let index = timelineEvents.length - 1; index >= 0; index -= 1) {
        const event = timelineEvents[index];
        const preview = summarizeText(event?.text || "", 96);
        if (preview) {
            return preview;
        }
    }
    return "";
}

function resolveChapterSummary(data, latestEventPreview) {
    const narratorSummary = summarizeText(data?.narrator_state?.chapter_summary || "", 96);
    if (narratorSummary) {
        return narratorSummary;
    }
    const sceneGoal = summarizeText(data?.scene_card?.scene_goal || "", 96);
    if (sceneGoal) {
        return sceneGoal;
    }
    if (latestEventPreview) {
        return latestEventPreview;
    }
    return summarizeText(data?.thread?.title || "", 96);
}

async function removeFileIfExists(filePath) {
    try {
        await fs.rm(filePath);
        return true;
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function buildStoryDir(userDataDirectory) {
    if (typeof userDataDirectory !== "string" || userDataDirectory.trim() === "") {
        throw new Error("userDataDirectory must be a non-empty string");
    }
    return path.join(path.resolve(userDataDirectory), STORY_MODE_DIR);
}

function buildStateFilePath(userDataDirectory) {
    return path.join(buildStoryDir(userDataDirectory), STORY_STATE_FILE);
}

function normalizeSlotId(slotId) {
    if (slotId === null || slotId === undefined) {
        return null;
    }
    const normalized = Number(slotId);
    if (!Number.isInteger(normalized) || normalized <= 0) {
        throw new Error("slotId must be a positive integer");
    }
    return normalized;
}

function buildSlotDirectory(userDataDirectory) {
    return path.join(buildStoryDir(userDataDirectory), STORY_SLOTS_DIR);
}

function buildSlotFileName(slotId) {
    return `${STORY_SLOT_FILE_PREFIX}${String(slotId).padStart(2, "0")}${STORY_SLOT_FILE_SUFFIX}`;
}

function buildSlotFilePath(userDataDirectory, slotId) {
    return path.join(buildSlotDirectory(userDataDirectory), buildSlotFileName(slotId));
}

function buildSlotMetadata(slotId, data) {
    const castMembers = data?.cast_members && typeof data.cast_members === "object"
        ? Object.values(data.cast_members)
        : [];
    const latestEventPreview = resolveLatestEventPreview(data);
    const chapterSummary = resolveChapterSummary(data, latestEventPreview);
    return Object.freeze({
        slot_id: slotId,
        saved_at: new Date().toISOString(),
        thread_title: typeof data?.thread?.title === "string" ? data.thread.title : "",
        story_revision: Number.isInteger(data?.thread?.revision) ? data.thread.revision : 0,
        chapter_summary: chapterSummary,
        latest_event_preview: latestEventPreview,
        focus_cast_name: resolveFocusCastName(data, castMembers),
        cast_names: castMembers
            .map((castMember) => (typeof castMember?.display_name === "string" ? castMember.display_name : ""))
            .filter((name) => name.length > 0)
    });
}

function buildSlotEnvelope(slotId, data, slotTitle = null) {
    const metadata = buildSlotMetadata(slotId, data);
    return Object.freeze({
        slot_id: slotId,
        slot_title:
            typeof slotTitle === "string" && slotTitle.trim() !== ""
                ? slotTitle.trim()
                : metadata.thread_title || `存档 ${slotId}`,
        saved_at: metadata.saved_at,
        thread_title: metadata.thread_title,
        story_revision: metadata.story_revision,
        chapter_summary: metadata.chapter_summary,
        latest_event_preview: metadata.latest_event_preview,
        focus_cast_name: metadata.focus_cast_name,
        cast_names: metadata.cast_names,
        story_state: data
    });
}

function validateEnvelope(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("story-mode slot file must contain an object");
    }
    if (raw.story_state === null || typeof raw.story_state !== "object" || Array.isArray(raw.story_state)) {
        throw new Error("story-mode slot file must contain a story_state object");
    }
    return raw;
}

async function readJsonFileIfExists(filePath) {
    let rawText;
    try {
        rawText = await fs.readFile(filePath, "utf8");
    } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
    return JSON.parse(rawText);
}

async function loadSlotEnvelope({ userDataDirectory, slotId }) {
    const filePath = buildSlotFilePath(userDataDirectory, slotId);
    const parsed = await readJsonFileIfExists(filePath);
    if (!parsed) {
        if (slotId === 1) {
            const legacyState = await loadStoryState({ userDataDirectory });
            if (legacyState) {
                const metadata = buildSlotMetadata(slotId, legacyState);
                return Object.freeze({
                    slot_id: slotId,
                    slot_title: metadata.thread_title || "旧版单存档",
                    saved_at: metadata.saved_at,
                    thread_title: metadata.thread_title,
                    story_revision: metadata.story_revision,
                    chapter_summary: metadata.chapter_summary,
                    latest_event_preview: metadata.latest_event_preview,
                    focus_cast_name: metadata.focus_cast_name,
                    cast_names: metadata.cast_names,
                    story_state: legacyState,
                    file_path: buildStateFilePath(userDataDirectory),
                    legacy: true
                });
            }
        }
        return null;
    }
    const envelope = validateEnvelope(parsed);
    return Object.freeze({
        ...envelope,
        file_path: filePath,
        legacy: false
    });
}

export async function listStoryStateSlots({
    userDataDirectory,
    slotCount = STORY_DEFAULT_SLOT_COUNT
}) {
    const normalizedSlotCount = Number.isInteger(slotCount) && slotCount > 0
        ? slotCount
        : STORY_DEFAULT_SLOT_COUNT;
    const slots = [];
    for (let slotId = 1; slotId <= normalizedSlotCount; slotId += 1) {
        const envelope = await loadSlotEnvelope({ userDataDirectory, slotId });
        if (!envelope) {
            slots.push(
                Object.freeze({
                    slot_id: slotId,
                    exists: false,
                    slot_title: `存档 ${slotId}`,
                    saved_at: null,
                    thread_title: "",
                    story_revision: 0,
                    chapter_summary: "",
                    latest_event_preview: "",
                    focus_cast_name: "",
                    cast_names: [],
                    file_path: buildSlotFilePath(userDataDirectory, slotId),
                    legacy: false
                })
            );
            continue;
        }
        slots.push(
            Object.freeze({
                slot_id: slotId,
                exists: true,
                slot_title: envelope.slot_title,
                saved_at: envelope.saved_at,
                thread_title: envelope.thread_title,
                story_revision: envelope.story_revision,
                chapter_summary: typeof envelope.chapter_summary === "string" ? envelope.chapter_summary : "",
                latest_event_preview: typeof envelope.latest_event_preview === "string" ? envelope.latest_event_preview : "",
                focus_cast_name: typeof envelope.focus_cast_name === "string" ? envelope.focus_cast_name : "",
                cast_names: Array.isArray(envelope.cast_names) ? envelope.cast_names : [],
                file_path: envelope.file_path,
                legacy: envelope.legacy === true
            })
        );
    }
    return Object.freeze(slots);
}

/**
 * Save story mode state to disk.
 *
 * @param {object} params
 * @param {string} params.userDataDirectory - app.getPath("userData")
 * @param {object} params.data - serialized state from MultiCompanionStoryService.toJSON()
 * @returns {Promise<{ file_path: string }>}
 */
export async function persistStoryState({ userDataDirectory, data }) {
    const slotId = normalizeSlotId(arguments[0]?.slotId);
    const slotTitle = arguments[0]?.slotTitle || null;
    const filePath = slotId === null
        ? buildStateFilePath(userDataDirectory)
        : buildSlotFilePath(userDataDirectory, slotId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload = slotId === null ? data : buildSlotEnvelope(slotId, data, slotTitle);
    await fs.writeFile(
        filePath,
        JSON.stringify(payload, null, 2),
        "utf8"
    );
    return Object.freeze({ file_path: filePath, slot_id: slotId });
}

/**
 * Load story mode state from disk.
 *
 * @param {object} params
 * @param {string} params.userDataDirectory - app.getPath("userData")
 * @returns {Promise<object|null>} parsed state or null if not found
 */
export async function loadStoryState({ userDataDirectory }) {
    const slotId = normalizeSlotId(arguments[0]?.slotId);
    if (slotId !== null) {
        const envelope = await loadSlotEnvelope({ userDataDirectory, slotId });
        return envelope?.story_state || null;
    }

    const parsed = await readJsonFileIfExists(buildStateFilePath(userDataDirectory));
    if (parsed === null) {
        return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("story-mode state file must contain an object");
    }
    return parsed;
}

export async function archiveStoryStateSlot({ userDataDirectory, slotId }) {
    const normalizedSlotId = normalizeSlotId(slotId);
    const removedSlotFile = await removeFileIfExists(
        buildSlotFilePath(userDataDirectory, normalizedSlotId)
    );
    const removedLegacyFile = normalizedSlotId === 1
        ? await removeFileIfExists(buildStateFilePath(userDataDirectory))
        : false;
    return Object.freeze({
        slot_id: normalizedSlotId,
        deleted: removedSlotFile || removedLegacyFile
    });
}
