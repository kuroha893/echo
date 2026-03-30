import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "..", "assets", "models");
const REGISTRY_PATH = path.join(MODELS_DIR, "model_library_registry.json");

async function walkDir(dir) {
  let results = [];
  const list = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of list) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await walkDir(res));
    } else {
      results.push(res);
    }
  }
  return results;
}

async function registerModels() {
  console.log(`Scanning models directory: ${MODELS_DIR}`);
  let entries = [];
  try {
    entries = await fs.readdir(MODELS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read models directory: ${err.message}`);
    process.exit(1);
  }

  const modelDirs = entries.filter((entry) => entry.isDirectory());
  const registeredModels = [];

  for (const dirEntry of modelDirs) {
    const modelKey = dirEntry.name;
    const modelPath = path.join(MODELS_DIR, modelKey);
    const files = await fs.readdir(modelPath);

    // Find the .model3.json file
    const model3JsonFile = files.find((f) => f.endsWith(".model3.json"));
    if (!model3JsonFile) {
      console.log(`[Skip] No .model3.json found in ${modelKey}`);
      continue;
    }

    const model3JsonPath = path.join(modelPath, model3JsonFile);
    let modelData;
    try {
      modelData = JSON.parse(await fs.readFile(model3JsonPath, "utf-8"));
    } catch (err) {
      console.error(`[Error] Failed to parse ${model3JsonPath}:`, err.message);
      continue;
    }

    // Auto-discover missing expressions and motions
    const allFiles = await walkDir(modelPath);
    let modelModified = false;

    if (!modelData.FileReferences) {
      modelData.FileReferences = {};
      modelModified = true;
    }

    if (!modelData.FileReferences.Expressions) {
      modelData.FileReferences.Expressions = [];
      modelModified = true;
    }

    // Build a set of existing expressions to avoid duplicate injection
    const existingExpFiles = new Set(
      modelData.FileReferences.Expressions.map(e => e.File?.replace(/\\/g, '/'))
    );

    for (const f of allFiles) {
      if (f.endsWith('.exp3.json')) {
        const relativePath = path.relative(modelPath, f).replace(/\\/g, '/');
        if (!existingExpFiles.has(relativePath)) {
          const name = path.basename(f, '.exp3.json');
          modelData.FileReferences.Expressions.push({
            Name: name,
            File: relativePath
          });
          existingExpFiles.add(relativePath);
          modelModified = true;
        }
      }
    }

    if (!modelData.FileReferences.Motions) {
      modelData.FileReferences.Motions = {};
      modelModified = true;
    }

    const existingMotionFiles = new Set();
    for (const group of Object.values(modelData.FileReferences.Motions)) {
      if (Array.isArray(group)) {
        for (const m of group) {
          if (m.File) existingMotionFiles.add(m.File.replace(/\\/g, '/'));
        }
      }
    }

    let autoMotionsGroup = modelData.FileReferences.Motions["Auto"] || [];
    for (const f of allFiles) {
      if (f.endsWith('.motion3.json')) {
        const relativePath = path.relative(modelPath, f).replace(/\\/g, '/');
        if (!existingMotionFiles.has(relativePath)) {
          autoMotionsGroup.push({ File: relativePath });
          existingMotionFiles.add(relativePath);
          modelModified = true;
        }
      }
    }
    if (autoMotionsGroup.length > 0) {
      modelData.FileReferences.Motions["Auto"] = autoMotionsGroup;
    }

    if (modelModified) {
      await fs.writeFile(model3JsonPath, JSON.stringify(modelData, null, 2), "utf-8");
      console.log(`[Update] Auto-injected discovered expressions/motions into ${model3JsonFile}`);
    }

    // Extract updated expressions
    const rawExpressions = modelData.FileReferences.Expressions || [];
    const supportedExpressions = rawExpressions.map((exp) => exp.Name).filter(Boolean);

    // Extract individual motion names from all motion groups
    const rawMotions = modelData.FileReferences.Motions || {};
    const supportedMotions = [];
    for (const motions of Object.values(rawMotions)) {
      if (Array.isArray(motions)) {
        for (const m of motions) {
          if (m.File) {
            const motionName = path.basename(m.File, '.motion3.json');
            if (!supportedMotions.includes(motionName)) {
              supportedMotions.push(motionName);
            }
          }
        }
      }
    }

    const supportedStates = ["idle", "listening", "thinking", "speaking"];

    // Check if a scene_manifest already exists to preserve custom settings
    const manifestPath = path.join(modelPath, "scene_manifest.json");
    let manifest = {};
    if (files.includes("scene_manifest.json")) {
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
      } catch (err) {
        console.warn(`[Warn] Failed to parse existing manifest for ${modelKey}, creating new.`);
      }
    }

    // Construct or update manifest
    manifest.model_key = modelKey;
    manifest.display_name = manifest.display_name || modelKey.replace(/-/g, " ");
    manifest.model_settings_file_name = model3JsonFile;
    manifest.model_settings_repo_relative_path = `apps/desktop-live2d/assets/models/${modelKey}/${model3JsonFile}`;
    manifest.presentation_mode = manifest.presentation_mode || "full_body";
    manifest.window_surface = manifest.window_surface || "character_window";
    manifest.viewport_fit = manifest.viewport_fit || {
      mode: "full_body",
      anchor: "bottom_center",
      scale_hint: 0.84
    };
    manifest.supported_states = supportedStates;
    manifest.supported_expressions = supportedExpressions;
    manifest.supported_motions = supportedMotions;

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`[Registered] ${modelKey} (Expressions: ${supportedExpressions.length}, Motions: ${supportedMotions.length})`);

    registeredModels.push({
      model_key: modelKey,
      scene_manifest_repo_relative_path: `apps/desktop-live2d/assets/models/${modelKey}/scene_manifest.json`
    });
  }

  // Update registry
  let registry = {};
  if (registeredModels.length > 0) {
    try {
      registry = JSON.parse(await fs.readFile(REGISTRY_PATH, "utf-8"));
    } catch (err) {
      // ignore
    }

    // Keep default model if it still exists, otherwise use the first one
    if (!registry.default_model_key || !registeredModels.some((m) => m.model_key === registry.default_model_key)) {
      registry.default_model_key = registeredModels[0].model_key;
    }
    registry.models = registeredModels;

    await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
    console.log(`\nSuccessfully registered ${registeredModels.length} models to model_library_registry.json`);
    console.log(`Default model: ${registry.default_model_key}`);
  } else {
    console.warn("\nNo valid models found to register.");
  }
}

registerModels().catch((err) => {
  console.error("Fatal error during registration:", err);
  process.exit(1);
});
