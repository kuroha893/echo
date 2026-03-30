import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadPersistedAvatarModelSelection,
  savePersistedAvatarModelSelection
} from "./avatar_model_selection_store.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function main() {
  const userDataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-avatar-model-selection-")
  );
  try {
    const defaultSelection = await loadPersistedAvatarModelSelection({
      userDataDirectory,
      workspaceRoot
    });
    assert.equal(defaultSelection.source, "default");
    assert.equal(defaultSelection.selected_model_key, "open-yachiyo-kaguya");

    const savedSelection = await savePersistedAvatarModelSelection({
      userDataDirectory,
      workspaceRoot,
      selectedModelKey: "open-yachiyo-kaguya-lite"
    });
    assert.equal(savedSelection.selected_model_key, "open-yachiyo-kaguya-lite");
    const persistedText = await fs.readFile(savedSelection.selection_file_path, "utf8");
    assert.match(persistedText, /"selected_model_key":\s*"open-yachiyo-kaguya-lite"/);
    assert.doesNotMatch(persistedText, /[A-Za-z]:\\/);
    assert.doesNotMatch(persistedText, /apps\/desktop-live2d\/assets\/models\//);

    const loadedPersistedSelection = await loadPersistedAvatarModelSelection({
      userDataDirectory,
      workspaceRoot
    });
    assert.equal(loadedPersistedSelection.source, "persisted");
    assert.equal(
      loadedPersistedSelection.model.resolved_model_json_path.startsWith(workspaceRoot),
      true
    );
    assert.equal(
      loadedPersistedSelection.model.repo_relative_model_json_path,
      "apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite/open_yachiyo_kaguya_lite.model3.json"
    );
  } finally {
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }

  process.stdout.write("desktop-live2d avatar model selection store self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
