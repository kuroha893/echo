const PROTOCOL_SQUARE_TAG_RE = /\[[^\[\]\s\r\n]{1,32}\]/g;
const PROTOCOL_INLINE_COMMAND_TAG_RE = /<\s*(?:action|tone)\s*=\s*[^>\r\n]{1,64}\s*>/gi;
const PROTOCOL_BLOCK_TAG_RE = /<\/?\s*(?:voice|subtitle)\s*>/gi;
const NARRATOR_UPDATE_NOTES_RE = /<update_notes>[\s\S]*$/i;
const NARRATOR_PROTOCOL_LINE_RE = /^(?:TARGETS\s*:|\*\*(?:时间|地点|在场|出场|Time|Location|Present|Attendees)\*\*\s*[：:]|(?:时间|地点|在场|出场|Time|Location|Present|Attendees)\s*[：:])/i;
const NARRATOR_ATTENDEE_LINE_RE = /^[-*]\s*[^:\n]{0,40}[：:].*$/;

export function sanitizeStoryVisibleText(text) {
    if (typeof text !== "string") {
        throw new Error("text must be a string");
    }
    let cleaned = text.replace(PROTOCOL_BLOCK_TAG_RE, "");
    cleaned = cleaned.replace(PROTOCOL_INLINE_COMMAND_TAG_RE, "");
    cleaned = cleaned.replace(PROTOCOL_SQUARE_TAG_RE, "");
    cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
    cleaned = cleaned.replace(/ *\n+ */g, "\n");
    cleaned = cleaned.replace(/\s+([,.;:!?，。！？；：、])/g, "$1");
    return cleaned.trim();
}

export function sanitizeStoryNarratorVisibleText(text) {
    const cleaned = sanitizeStoryVisibleText(text);
    const withoutUpdateNotes = cleaned.replace(NARRATOR_UPDATE_NOTES_RE, "").trim();
    if (!withoutUpdateNotes) {
        return "";
    }

    const visibleLines = [];
    let sawNarrativeLine = false;
    for (const rawLine of withoutUpdateNotes.split("\n")) {
        const line = rawLine.trim();
        if (!line) {
            if (sawNarrativeLine && visibleLines[visibleLines.length - 1] !== "") {
                visibleLines.push("");
            }
            continue;
        }
        if (NARRATOR_PROTOCOL_LINE_RE.test(line)) {
            continue;
        }
        if (!sawNarrativeLine && NARRATOR_ATTENDEE_LINE_RE.test(line)) {
            continue;
        }
        sawNarrativeLine = true;
        visibleLines.push(line);
    }

    return visibleLines.join("\n").trim();
}