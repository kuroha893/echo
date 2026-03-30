import {
  BUBBLE_ACTION,
  buildBubbleSnapshot,
  normalizeBubbleAppendInput,
  normalizeBubbleClearInput,
  normalizeBubbleReplaceInput
} from "./bubble_contracts.mjs";

export class BubbleStateManager {
  constructor({
    defaultSpeakerLabel = "Echo",
    maxBubbleTextChars = 4000
  } = {}) {
    this._defaultSpeakerLabel = defaultSpeakerLabel;
    this._maxBubbleTextChars = maxBubbleTextChars;
    this._state = {
      bubble_visible: false,
      bubble_text: "",
      speaker_label: defaultSpeakerLabel,
      is_streaming: false,
      segment_count: 0,
      last_action: BUBBLE_ACTION.CLEAR
    };
  }

  getSnapshot() {
    return buildBubbleSnapshot({
      bubbleVisible: this._state.bubble_visible,
      bubbleText: this._state.bubble_text,
      speakerLabel: this._state.speaker_label,
      isStreaming: this._state.is_streaming,
      segmentCount: this._state.segment_count,
      lastAction: this._state.last_action
    });
  }

  replace(rawInput) {
    const input = normalizeBubbleReplaceInput(rawInput);
    this._state = {
      bubble_visible: true,
      bubble_text: input.bubble_text.slice(0, this._maxBubbleTextChars),
      speaker_label: input.speaker_label,
      is_streaming: input.is_streaming,
      segment_count: 1,
      last_action: BUBBLE_ACTION.REPLACE
    };
    return this.getSnapshot();
  }

  append(rawInput) {
    const input = normalizeBubbleAppendInput(rawInput);
    const nextSpeakerLabel =
      input.speaker_label || this._state.speaker_label || this._defaultSpeakerLabel;
    const nextText = `${this._state.bubble_text}${input.text_fragment}`.slice(
      0,
      this._maxBubbleTextChars
    );
    this._state = {
      bubble_visible: true,
      bubble_text: nextText,
      speaker_label: nextSpeakerLabel,
      is_streaming: input.is_streaming,
      segment_count: this._state.segment_count + 1,
      last_action: BUBBLE_ACTION.APPEND
    };
    return this.getSnapshot();
  }

  clear(rawInput = {}) {
    normalizeBubbleClearInput(rawInput);
    this._state = {
      bubble_visible: false,
      bubble_text: "",
      speaker_label: this._defaultSpeakerLabel,
      is_streaming: false,
      segment_count: 0,
      last_action: BUBBLE_ACTION.CLEAR
    };
    return this.getSnapshot();
  }
}
