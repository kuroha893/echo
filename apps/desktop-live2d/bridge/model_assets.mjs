import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  BRIDGE_ERROR_CODE,
  DesktopLive2DBridgeProtocolError
} from "./protocol.mjs";

export const MODEL_ASSET_PREFIX = "apps/desktop-live2d/assets/models/";
export const MODEL_LIBRARY_REGISTRY_REPO_RELATIVE_PATH =
  `${MODEL_ASSET_PREFIX}model_library_registry.json`;
export const DEFAULT_WORKSPACE_ROOT =
  process.env.ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT ||
  path.resolve(import.meta.dirname, "..", "..", "..");

const SUPPORTED_JSON_REFERENCE_PATTERNS = Object.freeze([
  /exp3\.json$/i,
  /motion3\.json$/i,
  /cdi3\.json$/i,
  /cmo3\.json$/i,
  /model3\.json$/i,
  /physics3\.json$/i
]);
const SUPPORTED_BINARY_REFERENCE_PATTERNS = Object.freeze([
  /moc3$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.webp$/i
]);

function failInvalidModelAsset(message, rawErrorType = null) {
  throw new DesktopLive2DBridgeProtocolError({
    bridgeCommand: "initialize",
    errorCode: BRIDGE_ERROR_CODE.INVALID_MODEL_ASSET,
    message,
    retryable: false,
    rawErrorType
  });
}

function ensureObject(value, fieldName) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failInvalidModelAsset(`${fieldName} must be an object`);
  }
  return value;
}

function ensureNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    failInvalidModelAsset(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function ensureArrayOfStrings(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    failInvalidModelAsset(`${fieldName} must be an array of strings`);
  }
  return Object.freeze([...new Set(value.map((item) => item.trim()).filter(Boolean))]);
}

function normalizeRepoRelativeJsonPath(repoRelativePath, fieldName) {
  const normalized = ensureNonEmptyString(
    repoRelativePath,
    fieldName
  ).replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalized)) {
    failInvalidModelAsset(`${fieldName} must not be absolute`);
  }
  const parts = normalized.split("/");
  if (
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    failInvalidModelAsset(
      `${fieldName} must not contain empty segments, '.' or '..'`
    );
  }
  if (!normalized.startsWith(MODEL_ASSET_PREFIX)) {
    failInvalidModelAsset(
      `${fieldName} must stay under apps/desktop-live2d/assets/models/`
    );
  }
  if (!normalized.endsWith(".json")) {
    failInvalidModelAsset(`${fieldName} must point to a .json file`);
  }
  return normalized;
}

function resolveRepoRelativeAssetPath({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  repoRelativePath,
  fieldName
}) {
  const normalized = normalizeRepoRelativeJsonPath(repoRelativePath, fieldName);
  const workspaceRootResolved = path.resolve(workspaceRoot);
  const assetsRoot = path.resolve(workspaceRootResolved, MODEL_ASSET_PREFIX);
  const resolvedPath = path.resolve(workspaceRootResolved, normalized);
  if (!resolvedPath.startsWith(assetsRoot)) {
    failInvalidModelAsset(
      `resolved ${fieldName} escaped apps/desktop-live2d/assets/models/`
    );
  }
  return {
    workspace_root: workspaceRootResolved,
    repo_relative_path: normalized,
    resolved_path: resolvedPath
  };
}

async function readJsonFileOrFail(filePath, label) {
  let rawText;
  try {
    rawText = await readFile(filePath, "utf8");
  } catch (error) {
    failInvalidModelAsset(
      error instanceof Error ? error.message : `failed to read ${label}`,
      error instanceof Error ? error.name : typeof error
    );
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    failInvalidModelAsset(
      `${label} must be valid JSON`,
      error instanceof Error ? error.name : typeof error
    );
  }
}

function ensureAllowedReferencedAsset({
  workspaceRootResolved,
  resolvedModelJsonPath,
  relativeReferencePath,
  fieldName
}) {
  const referenceValue = ensureNonEmptyString(relativeReferencePath, fieldName);
  const resolvedReferencePath = path.resolve(
    path.dirname(resolvedModelJsonPath),
    referenceValue
  );
  const assetsRoot = path.resolve(workspaceRootResolved, MODEL_ASSET_PREFIX);
  if (!resolvedReferencePath.startsWith(assetsRoot)) {
    failInvalidModelAsset(
      `${fieldName} referenced an asset outside apps/desktop-live2d/assets/models/`
    );
  }
  const normalizedReferencePath = resolvedReferencePath.replaceAll("\\", "/");
  const isSupportedJson = SUPPORTED_JSON_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(normalizedReferencePath)
  );
  const isSupportedBinary = SUPPORTED_BINARY_REFERENCE_PATTERNS.some((pattern) =>
    pattern.test(normalizedReferencePath)
  );
  if (!isSupportedJson && !isSupportedBinary) {
    failInvalidModelAsset(
      `${fieldName} referenced an unsupported Cubism package asset '${referenceValue}'`
    );
  }
}

function normalizeCubismModelSettings({
  workspaceRootResolved,
  repoRelativeModelJsonPath,
  resolvedModelJsonPath,
  modelSettings
}) {
  const manifest = ensureObject(modelSettings, "Cubism model settings");
  const version = manifest.Version;
  const fileReferences = ensureObject(
    manifest.FileReferences,
    "Cubism model settings FileReferences"
  );
  if (!Number.isFinite(version) || version < 3) {
    failInvalidModelAsset(
      "desktop-live2d model settings must declare Cubism Version >= 3"
    );
  }
  ensureAllowedReferencedAsset({
    workspaceRootResolved,
    resolvedModelJsonPath,
    relativeReferencePath: fileReferences.Moc,
    fieldName: "FileReferences.Moc"
  });
  const textures = ensureArrayOfStrings(
    fileReferences.Textures,
    "FileReferences.Textures"
  );
  for (const texturePath of textures) {
    ensureAllowedReferencedAsset({
      workspaceRootResolved,
      resolvedModelJsonPath,
      relativeReferencePath: texturePath,
      fieldName: "FileReferences.Textures"
    });
  }
  if (fileReferences.Physics != null) {
    ensureAllowedReferencedAsset({
      workspaceRootResolved,
      resolvedModelJsonPath,
      relativeReferencePath: fileReferences.Physics,
      fieldName: "FileReferences.Physics"
    });
  }
  if (fileReferences.DisplayInfo != null) {
    ensureAllowedReferencedAsset({
      workspaceRootResolved,
      resolvedModelJsonPath,
      relativeReferencePath: fileReferences.DisplayInfo,
      fieldName: "FileReferences.DisplayInfo"
    });
  }
  if (fileReferences.Expressions != null) {
    const expressions = fileReferences.Expressions;
    if (
      !Array.isArray(expressions) ||
      expressions.some(
        (item) =>
          item === null ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.File !== "string" ||
          typeof item.Name !== "string"
      )
    ) {
      failInvalidModelAsset(
        "FileReferences.Expressions must be an array of { Name, File } objects"
      );
    }
    for (const expression of expressions) {
      ensureAllowedReferencedAsset({
        workspaceRootResolved,
        resolvedModelJsonPath,
        relativeReferencePath: expression.File,
        fieldName: `FileReferences.Expressions.${expression.Name}`
      });
    }
  }
  if (fileReferences.Motions != null) {
    const motions = ensureObject(
      fileReferences.Motions,
      "FileReferences.Motions"
    );
    for (const [motionName, definitions] of Object.entries(motions)) {
      if (
        !Array.isArray(definitions) ||
        definitions.some(
          (definition) =>
            definition === null ||
            typeof definition !== "object" ||
            Array.isArray(definition) ||
            typeof definition.File !== "string"
        )
      ) {
        failInvalidModelAsset(
          `FileReferences.Motions.${motionName} must be an array of motion objects`
        );
      }
      for (const definition of definitions) {
        ensureAllowedReferencedAsset({
          workspaceRootResolved,
          resolvedModelJsonPath,
          relativeReferencePath: definition.File,
          fieldName: `FileReferences.Motions.${motionName}`
        });
      }
    }
  }
  return Object.freeze({
    repo_relative_model_json_path: repoRelativeModelJsonPath,
    resolved_model_json_path: resolvedModelJsonPath
  });
}

async function loadRegisteredSceneManifest({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  modelKey,
  sceneManifestRepoRelativePath
}) {
  const resolvedSceneManifest = resolveRepoRelativeAssetPath({
    workspaceRoot,
    repoRelativePath: sceneManifestRepoRelativePath,
    fieldName: "scene_manifest_repo_relative_path"
  });
  const sceneManifest = ensureObject(
    await readJsonFileOrFail(
      resolvedSceneManifest.resolved_path,
      "desktop-live2d scene manifest"
    ),
    "desktop-live2d scene manifest"
  );
  const manifestModelKey = ensureNonEmptyString(
    sceneManifest.model_key,
    "scene manifest model_key"
  );
  if (manifestModelKey !== modelKey) {
    failInvalidModelAsset(
      `scene manifest model_key '${manifestModelKey}' did not match registry key '${modelKey}'`
    );
  }
  const repoRelativeModelJsonPath = normalizeRepoRelativeJsonPath(
    sceneManifest.model_settings_repo_relative_path,
    "scene manifest model_settings_repo_relative_path"
  );
  const modelSettingsFileName = ensureNonEmptyString(
    sceneManifest.model_settings_file_name,
    "scene manifest model_settings_file_name"
  );
  if (!modelSettingsFileName.endsWith(".model3.json")) {
    failInvalidModelAsset(
      "scene manifest model_settings_file_name must point to a *.model3.json file"
    );
  }
  const expectedModelSettingsPath = path.posix.join(
    path.posix.dirname(resolvedSceneManifest.repo_relative_path),
    modelSettingsFileName
  );
  if (repoRelativeModelJsonPath !== expectedModelSettingsPath) {
    failInvalidModelAsset(
      "scene manifest model_settings_repo_relative_path must match model_settings_file_name beside the manifest"
    );
  }
  const resolvedModelSettings = resolveRepoRelativeAssetPath({
    workspaceRoot,
    repoRelativePath: repoRelativeModelJsonPath,
    fieldName: "scene manifest model_settings_repo_relative_path"
  });
  const normalizedSettings = normalizeCubismModelSettings({
    workspaceRootResolved: resolvedModelSettings.workspace_root,
    repoRelativeModelJsonPath,
    resolvedModelJsonPath: resolvedModelSettings.resolved_path,
    modelSettings: await readJsonFileOrFail(
      resolvedModelSettings.resolved_path,
      "desktop-live2d Cubism model settings"
    )
  });
  return Object.freeze({
    model_key: manifestModelKey,
    display_name: ensureNonEmptyString(
      sceneManifest.display_name,
      "scene manifest display_name"
    ),
    presentation_mode: ensureNonEmptyString(
      sceneManifest.presentation_mode,
      "scene manifest presentation_mode"
    ),
    window_surface: ensureNonEmptyString(
      sceneManifest.window_surface,
      "scene manifest window_surface"
    ),
    viewport_fit:
      sceneManifest.viewport_fit &&
      typeof sceneManifest.viewport_fit === "object" &&
      !Array.isArray(sceneManifest.viewport_fit)
        ? Object.freeze({
            mode:
              typeof sceneManifest.viewport_fit.mode === "string"
                ? sceneManifest.viewport_fit.mode
                : "full_body",
            anchor:
              typeof sceneManifest.viewport_fit.anchor === "string"
                ? sceneManifest.viewport_fit.anchor
                : "bottom_center",
            scale_hint:
              typeof sceneManifest.viewport_fit.scale_hint === "number" &&
              Number.isFinite(sceneManifest.viewport_fit.scale_hint)
                ? sceneManifest.viewport_fit.scale_hint
                : 0.84
          })
        : Object.freeze({
            mode: "full_body",
            anchor: "bottom_center",
            scale_hint: 0.84
          }),
    supported_states: ensureArrayOfStrings(
      sceneManifest.supported_states,
      "scene manifest supported_states"
    ),
    supported_expressions: ensureArrayOfStrings(
      sceneManifest.supported_expressions,
      "scene manifest supported_expressions"
    ),
    supported_motions: ensureArrayOfStrings(
      sceneManifest.supported_motions,
      "scene manifest supported_motions"
    ),
    scene_manifest_repo_relative_path: resolvedSceneManifest.repo_relative_path,
    resolved_scene_manifest_path: resolvedSceneManifest.resolved_path,
    repo_relative_model_json_path: normalizedSettings.repo_relative_model_json_path,
    resolved_model_json_path: normalizedSettings.resolved_model_json_path
  });
}

export async function loadRegisteredModelLibrary({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT
} = {}) {
  const resolvedRegistry = resolveRepoRelativeAssetPath({
    workspaceRoot,
    repoRelativePath: MODEL_LIBRARY_REGISTRY_REPO_RELATIVE_PATH,
    fieldName: "model library registry path"
  });
  const registry = ensureObject(
    await readJsonFileOrFail(
      resolvedRegistry.resolved_path,
      "desktop-live2d model library registry"
    ),
    "desktop-live2d model library registry"
  );
  const defaultModelKey = ensureNonEmptyString(
    registry.default_model_key,
    "model library default_model_key"
  );
  if (!Array.isArray(registry.models) || registry.models.length === 0) {
    failInvalidModelAsset(
      "desktop-live2d model library registry must declare a non-empty models array"
    );
  }
  const registeredKeys = new Set();
  const models = [];
  for (const rawEntry of registry.models) {
    const entry = ensureObject(rawEntry, "model library entry");
    const modelKey = ensureNonEmptyString(entry.model_key, "model library entry model_key");
    if (registeredKeys.has(modelKey)) {
      failInvalidModelAsset(
        `desktop-live2d model library registry duplicated model_key '${modelKey}'`
      );
    }
    registeredKeys.add(modelKey);
    models.push(
      await loadRegisteredSceneManifest({
        workspaceRoot,
        modelKey,
        sceneManifestRepoRelativePath: entry.scene_manifest_repo_relative_path
      })
    );
  }
  if (!registeredKeys.has(defaultModelKey)) {
    failInvalidModelAsset(
      `desktop-live2d model library default_model_key '${defaultModelKey}' was not registered`
    );
  }
  return Object.freeze({
    default_model_key: defaultModelKey,
    models: Object.freeze(models)
  });
}

export async function resolveRegisteredModelSelection({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  modelKey = null
} = {}) {
  const library = await loadRegisteredModelLibrary({ workspaceRoot });
  const targetKey =
    modelKey == null
      ? library.default_model_key
      : ensureNonEmptyString(modelKey, "selected model_key");
  const selectedModel =
    library.models.find((entry) => entry.model_key === targetKey) || null;
  if (!selectedModel) {
    failInvalidModelAsset(
      `desktop-live2d selected model_key '${targetKey}' is not registered`
    );
  }
  return Object.freeze({
    ...selectedModel,
    default_model_key: library.default_model_key
  });
}

export function buildModelAssetRefFromLibrarySelection(modelSelection) {
  return Object.freeze({
    model_key: ensureNonEmptyString(modelSelection.model_key, "model_key"),
    display_name: ensureNonEmptyString(modelSelection.display_name, "display_name"),
    presentation_mode: ensureNonEmptyString(
      modelSelection.presentation_mode,
      "presentation_mode"
    ),
    window_surface: ensureNonEmptyString(
      modelSelection.window_surface,
      "window_surface"
    ),
    repo_relative_model_json_path: normalizeRepoRelativeJsonPath(
      modelSelection.repo_relative_model_json_path,
      "repo_relative_model_json_path"
    )
  });
}

export async function loadModelManifest({
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  modelAsset
}) {
  const normalizedModelAsset = ensureObject(modelAsset, "model_asset");
  const selectedModel = await resolveRegisteredModelSelection({
    workspaceRoot,
    modelKey: normalizedModelAsset.model_key
  });
  if (
    normalizedModelAsset.repo_relative_model_json_path != null &&
    normalizeRepoRelativeJsonPath(
      normalizedModelAsset.repo_relative_model_json_path,
      "repo_relative_model_json_path"
    ) !== selectedModel.repo_relative_model_json_path
  ) {
    failInvalidModelAsset(
      `model asset path for '${selectedModel.model_key}' did not match the registered Cubism package`
    );
  }
  return Object.freeze({
    model_key: selectedModel.model_key,
    display_name: selectedModel.display_name,
    presentation_mode: selectedModel.presentation_mode,
    window_surface: selectedModel.window_surface,
    viewport_fit: selectedModel.viewport_fit,
    supported_states: selectedModel.supported_states,
    supported_expressions: selectedModel.supported_expressions,
    supported_motions: selectedModel.supported_motions,
    repo_relative_model_json_path: selectedModel.repo_relative_model_json_path,
    resolved_model_json_path: selectedModel.resolved_model_json_path
  });
}
