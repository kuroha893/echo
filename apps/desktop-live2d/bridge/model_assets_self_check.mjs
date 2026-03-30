import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildModelAssetRefFromLibrarySelection,
  loadModelManifest,
  loadRegisteredModelLibrary,
  resolveRegisteredModelSelection
} from "./model_assets.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function main() {
  const library = await loadRegisteredModelLibrary({ workspaceRoot });
  assert.equal(library.default_model_key, "open-yachiyo-kaguya");
  assert.equal(library.models.length, 2);

  const fullModel = library.models.find(
    (model) => model.model_key === "open-yachiyo-kaguya"
  );
  const liteModel = library.models.find(
    (model) => model.model_key === "open-yachiyo-kaguya-lite"
  );
  assert.ok(fullModel);
  assert.ok(liteModel);
  assert.notDeepEqual(
    fullModel.supported_expressions,
    liteModel.supported_expressions
  );
  assert.notDeepEqual(fullModel.supported_motions, liteModel.supported_motions);

  const selectedLiteModel = await resolveRegisteredModelSelection({
    workspaceRoot,
    modelKey: "open-yachiyo-kaguya-lite"
  });
  assert.equal(selectedLiteModel.model_key, "open-yachiyo-kaguya-lite");
  const liteModelAsset = buildModelAssetRefFromLibrarySelection(selectedLiteModel);
  assert.equal(
    liteModelAsset.repo_relative_model_json_path,
    "apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite/open_yachiyo_kaguya_lite.model3.json"
  );
  const liteManifest = await loadModelManifest({
    workspaceRoot,
    modelAsset: liteModelAsset
  });
  assert.deepEqual(liteManifest.supported_expressions, ["smile"]);
  assert.deepEqual(liteManifest.supported_motions, ["nod"]);

  const invalidWorkspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "echo-model-assets-self-check-")
  );
  try {
    const invalidModelsRoot = path.join(
      invalidWorkspaceRoot,
      "apps",
      "desktop-live2d",
      "assets",
      "models"
    );
    const invalidModelDirectory = path.join(invalidModelsRoot, "broken-model");
    await fs.mkdir(invalidModelDirectory, { recursive: true });
    await fs.writeFile(
      path.join(invalidModelsRoot, "model_library_registry.json"),
      JSON.stringify(
        {
          default_model_key: "broken-model",
          models: [
            {
              model_key: "broken-model",
              scene_manifest_repo_relative_path:
                "apps/desktop-live2d/assets/models/broken-model/scene_manifest.json"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(
      path.join(invalidModelDirectory, "scene_manifest.json"),
      JSON.stringify(
        {
          model_key: "broken-model",
          display_name: "Broken Model",
          model_settings_file_name: "broken.model.json",
          model_settings_repo_relative_path:
            "apps/desktop-live2d/assets/models/broken-model/broken.model.json",
          presentation_mode: "full_body",
          window_surface: "character_window",
          viewport_fit: {
            mode: "full_body",
            anchor: "bottom_center",
            scale_hint: 0.84
          },
          supported_states: ["idle"],
          supported_expressions: ["smile"],
          supported_motions: ["nod"]
        },
        null,
        2
      ),
      "utf8"
    );
    await assert.rejects(
      async () => {
        await loadRegisteredModelLibrary({
          workspaceRoot: invalidWorkspaceRoot
        });
      },
      /model_settings_file_name must point to a \*\.model3\.json file/i
    );
  } finally {
    await fs.rm(invalidWorkspaceRoot, { recursive: true, force: true });
  }

  process.stdout.write("desktop-live2d model assets self-check passed\n");
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
