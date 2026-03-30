const STATE_PRESET_MAP = Object.freeze({
  idle: Object.freeze({
    label: "Idle",
    accentColor: "#7ab5ff",
    silhouetteScale: 0.84,
    motionHint: null
  }),
  listening: Object.freeze({
    label: "Listening",
    accentColor: "#6ce0ff",
    silhouetteScale: 0.86,
    motionHint: null
  }),
  thinking: Object.freeze({
    label: "Thinking",
    accentColor: "#ffd166",
    silhouetteScale: 0.82,
    motionHint: "nod"
  }),
  speaking: Object.freeze({
    label: "Speaking",
    accentColor: "#ff8fab",
    silhouetteScale: 0.88,
    motionHint: null
  })
});

const EXPRESSION_PRESET_MAP = Object.freeze({
  smile: Object.freeze({
    label: "Smile",
    accentColor: "#ffe082",
    mood: "warm"
  }),
  thinking: Object.freeze({
    label: "Thinking",
    accentColor: "#cfd8dc",
    mood: "focused"
  }),
  angry: Object.freeze({
    label: "Angry",
    accentColor: "#ff8a80",
    mood: "sharp"
  })
});

const MOTION_PRESET_MAP = Object.freeze({
  nod: Object.freeze({
    label: "Nod",
    amplitude: 0.16,
    durationScale: 1.0
  }),
  shake_head: Object.freeze({
    label: "Shake Head",
    amplitude: 0.24,
    durationScale: 1.08
  })
});

export function resolveStatePreset(stateName) {
  return STATE_PRESET_MAP[stateName] || STATE_PRESET_MAP.idle;
}

export function resolveExpressionPreset(expressionName) {
  return EXPRESSION_PRESET_MAP[expressionName] || null;
}

export function resolveMotionPreset(motionName) {
  return MOTION_PRESET_MAP[motionName] || null;
}

export function buildVisualThemeFromStateAndExpression({
  stateName,
  expressionName
}) {
  const statePreset = resolveStatePreset(stateName);
  const expressionPreset = expressionName
    ? resolveExpressionPreset(expressionName)
    : null;
  return Object.freeze({
    state_label: statePreset.label,
    expression_label: expressionPreset?.label || null,
    accent_color: expressionPreset?.accentColor || statePreset.accentColor,
    silhouette_scale: statePreset.silhouetteScale
  });
}
