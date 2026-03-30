import { DesktopLive2DSceneController } from "./scene_controller.mjs";

async function fetchLocalModelManifest(modelManifestUrl) {
  const response = await fetch(String(modelManifestUrl));
  if (!response.ok) {
    throw new Error(`failed to load model manifest from ${modelManifestUrl}`);
  }
  return response.json();
}

function decodeFileUrlToPath(fileUrlLike) {
  const url = new URL(String(fileUrlLike));
  if (url.protocol !== "file:") {
    return String(fileUrlLike);
  }
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:/.test(pathname)) {
    pathname = pathname.slice(1);
  }
  const normalizedParts = [];
  for (const part of pathname.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      normalizedParts.pop();
      continue;
    }
    normalizedParts.push(part);
  }
  if (/^[A-Za-z]:$/.test(normalizedParts[0] || "")) {
    const [drive, ...rest] = normalizedParts;
    return `${drive}\\${rest.join("\\")}`;
  }
  return `/${normalizedParts.join("/")}`;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export class DesktopLive2DDomSceneHost {
  constructor({
    stageElement,
    statusElement,
    selectedModelKey = null,
    modelManifestUrl = new URL(
      "../assets/models/open-yachiyo-kaguya/scene_manifest.json",
      import.meta.url
    ),
    modelSettingsRepoRelativePath = null,
    resolvedModelSettingsUrl = null
  }) {
    const initialResolvedModelSettingsUrl =
      resolvedModelSettingsUrl ||
      new URL(
        "../assets/models/open-yachiyo-kaguya/open_yachiyo_kaguya.model3.json",
        import.meta.url
      );
    this._stageElement = stageElement;
    this._statusElement = statusElement;
    this._selectedModelKey = selectedModelKey;
    this._modelManifestUrl = modelManifestUrl;
    this._modelSettingsRepoRelativePath = modelSettingsRepoRelativePath;
    this._resolvedModelSettingsUrl = resolvedModelSettingsUrl;
    this._bridgeResolvedModelPath = decodeFileUrlToPath(initialResolvedModelSettingsUrl);
    this._controller = new DesktopLive2DSceneController({
      domStageElement: stageElement
    });
  }

  getController() {
    return this._controller;
  }

  async setModelScaleMultiplier(multiplier) {
    return await this._controller.setViewportScaleMultiplier(multiplier);
  }

  getModelScaleMultiplier() {
    return this._controller.getViewportScaleMultiplier();
  }

  getBridgeResolvedModelPath() {
    return this._bridgeResolvedModelPath;
  }

  async setViewportMetrics(viewportMetrics) {
    return await this._controller.setViewportMetrics(viewportMetrics);
  }

  async boot() {
    this.#setStatus("booting full-body scene...");
    const sceneManifest = await fetchLocalModelManifest(this._modelManifestUrl);
    if (
      this._selectedModelKey &&
      sceneManifest.model_key !== this._selectedModelKey
    ) {
      throw new Error(
        `scene manifest model_key '${sceneManifest.model_key}' did not match selected model '${this._selectedModelKey}'`
      );
    }
    const modelSettingsRepoRelativePath =
      this._modelSettingsRepoRelativePath ||
      assertNonEmptyString(
        sceneManifest.model_settings_repo_relative_path,
        "scene manifest model_settings_repo_relative_path"
      );
    const modelSettingsFileName = assertNonEmptyString(
      sceneManifest.model_settings_file_name,
      "scene manifest model_settings_file_name"
    );
    const resolvedModelSettingsUrl =
      this._resolvedModelSettingsUrl ||
      new URL(modelSettingsFileName, this._modelManifestUrl);
    const resolvedModelJsonPath = String(resolvedModelSettingsUrl);
    this._bridgeResolvedModelPath = decodeFileUrlToPath(resolvedModelSettingsUrl);
    const snapshot = await this._controller.initialize({
      ...sceneManifest,
      repo_relative_model_json_path: modelSettingsRepoRelativePath,
      resolved_model_json_path: resolvedModelJsonPath
    });
    this.#setStatus(
      `${snapshot.display_name} booted (${snapshot.runtime_mode})`
    );
    return snapshot;
  }

  async previewSequence() {
    const commands = [
      {
        command_id: "preview-state",
        command_type: "set_state",
        target: "state",
        value: "thinking",
        is_interruptible: true
      },
      {
        command_id: "preview-expression",
        command_type: "set_expression",
        target: "expression",
        value: "smile",
        is_interruptible: true
      }
    ];
    for (const command of commands) {
      await this._controller.dispatchCommand(command);
    }
  }

  #setStatus(value) {
    if (this._statusElement) {
      this._statusElement.textContent = value;
    }
  }
}
