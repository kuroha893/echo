import fs from "node:fs/promises";
import path from "node:path";

import {
  resolveRegisteredModelSelection
} from "../bridge/model_assets.mjs";

const AVATAR_MODEL_SELECTION_FILE_NAME = "desktop-live2d-avatar-model.json";

function buildSelectionFilePath(userDataDirectory) {
  if (typeof userDataDirectory !== "string" || userDataDirectory.trim() === "") {
    throw new Error("userDataDirectory must be a non-empty string");
  }
  return path.join(
    path.resolve(userDataDirectory),
    AVATAR_MODEL_SELECTION_FILE_NAME
  );
}

async function readPersistedSelectionRecord(selectionFilePath) {
  let rawText;
  try {
    rawText = await fs.readFile(selectionFilePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = JSON.parse(rawText);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("desktop-live2d avatar model selection file must be an object");
  }
  if (
    typeof parsed.selected_model_key !== "string" ||
    parsed.selected_model_key.trim() === ""
  ) {
    throw new Error(
      "desktop-live2d avatar model selection file must declare selected_model_key"
    );
  }
  return Object.freeze({
    selected_model_key: parsed.selected_model_key.trim()
  });
}

export async function loadPersistedAvatarModelSelection({
  userDataDirectory,
  workspaceRoot
}) {
  const selectionFilePath = buildSelectionFilePath(userDataDirectory);
  const persistedRecord = await readPersistedSelectionRecord(selectionFilePath);
  const resolvedSelection = await resolveRegisteredModelSelection({
    workspaceRoot,
    modelKey: persistedRecord?.selected_model_key || null
  });
  return Object.freeze({
    selection_file_path: selectionFilePath,
    selected_model_key: resolvedSelection.model_key,
    source: persistedRecord ? "persisted" : "default",
    model: resolvedSelection
  });
}

export async function savePersistedAvatarModelSelection({
  userDataDirectory,
  workspaceRoot,
  selectedModelKey
}) {
  const resolvedSelection = await resolveRegisteredModelSelection({
    workspaceRoot,
    modelKey: selectedModelKey
  });
  const selectionFilePath = buildSelectionFilePath(userDataDirectory);
  await fs.mkdir(path.dirname(selectionFilePath), { recursive: true });
  await fs.writeFile(
    selectionFilePath,
    JSON.stringify(
      {
        selected_model_key: resolvedSelection.model_key
      },
      null,
      2
    ),
    "utf8"
  );
  return Object.freeze({
    selection_file_path: selectionFilePath,
    selected_model_key: resolvedSelection.model_key,
    model: resolvedSelection
  });
}
