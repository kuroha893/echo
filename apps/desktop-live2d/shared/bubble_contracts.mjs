export const BUBBLE_ACTION = Object.freeze({
  REPLACE: "replace",
  APPEND: "append",
  CLEAR: "clear"
});

export class BubbleContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BubbleContractError";
    this.details = Object.freeze({ ...details });
  }
}

function ensureNonEmptyString(value, label, maxLength = 4000) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BubbleContractError(`${label} must be a non-empty string`, {
      label
    });
  }
  if (value.length > maxLength) {
    throw new BubbleContractError(
      `${label} must not exceed ${maxLength} characters`,
      {
        label
      }
    );
  }
  return value;
}

export function normalizeBubbleReplaceInput(rawInput) {
  return Object.freeze({
    bubble_text: ensureNonEmptyString(rawInput.bubble_text, "bubble_text", 4000),
    speaker_label: ensureNonEmptyString(
      rawInput.speaker_label ?? "Echo",
      "speaker_label",
      64
    ),
    is_streaming: Boolean(rawInput.is_streaming)
  });
}

export function normalizeBubbleAppendInput(rawInput) {
  return Object.freeze({
    text_fragment: ensureNonEmptyString(rawInput.text_fragment, "text_fragment", 2000),
    speaker_label:
      rawInput.speaker_label === null || rawInput.speaker_label === undefined
        ? null
        : ensureNonEmptyString(rawInput.speaker_label, "speaker_label", 64),
    is_streaming: Boolean(rawInput.is_streaming)
  });
}

export function normalizeBubbleClearInput(rawInput) {
  return Object.freeze({
    reason: ensureNonEmptyString(rawInput.reason ?? "bubble cleared", "reason", 512)
  });
}

export function buildBubbleSnapshot({
  bubbleVisible,
  bubbleText,
  speakerLabel,
  isStreaming,
  segmentCount,
  lastAction
}) {
  return Object.freeze({
    bubble_visible: bubbleVisible,
    bubble_text: bubbleText,
    speaker_label: speakerLabel,
    is_streaming: isStreaming,
    segment_count: segmentCount,
    last_action: lastAction
  });
}
