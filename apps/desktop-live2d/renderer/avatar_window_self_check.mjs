import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DesktopLive2DAvatarWindowRuntime } from "./avatar_window_runtime.mjs";
import { DesktopLive2DDomSceneHost } from "./dom_scene_host.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const canonicalResolvedModelJsonPath = path.resolve(
  workspaceRoot,
  "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/open_yachiyo_kaguya.model3.json"
);
const sceneManifestPath = path.resolve(
  workspaceRoot,
  "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/scene_manifest.json"
);
const liteResolvedModelJsonPath = path.resolve(
  workspaceRoot,
  "apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite/open_yachiyo_kaguya_lite.model3.json"
);
const liteSceneManifestPath = path.resolve(
  workspaceRoot,
  "apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite/scene_manifest.json"
);

class FakeSceneController {
  constructor() {
    this._snapshot = {
      model_key: "open-yachiyo-kaguya",
      display_name: "Open Yachiyo Kaguya",
      presentation_mode: "full_body",
      window_surface: "character_window",
      resolved_model_json_path: canonicalResolvedModelJsonPath,
      runtime_mode: "avatar_fake_scene",
      model_loaded: true,
      state: "idle",
      active_expression: null,
      last_motion: null,
      mouth_open: 0,
      lipsync_active: false,
      lipsync_source: null
    };
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getManifest() {
    return {
      model_key: this._snapshot.model_key,
      resolved_model_json_path: this._snapshot.resolved_model_json_path,
      presentation_mode: this._snapshot.presentation_mode,
      window_surface: this._snapshot.window_surface
    };
  }

  async dispatchCommand(request) {
    if (request.command_type === "set_state") {
      this._snapshot.state = request.value;
    } else if (request.command_type === "set_expression") {
      this._snapshot.active_expression = request.value;
    } else if (request.command_type === "set_motion") {
      this._snapshot.last_motion = request.value;
    }
    return {
      adapter_key: "desktop.live2d",
      outcome: "completed",
      message: "fake avatar dispatch completed"
    };
  }
}

class FakeSceneHost {
  constructor() {
    this._controller = new FakeSceneController();
    this.bootCount = 0;
  }

  getController() {
    return this._controller;
  }

  async boot() {
    this.bootCount += 1;
    return this._controller.getSnapshot();
  }
}

class FakeLipsyncDriver {
  constructor() {
    this._snapshot = {
      lipsync_active: false,
      current_mouth_open: 0,
      peak_mouth_open: 0
    };
    this._history = [];
  }

  ingestPeak(value) {
    this._snapshot = {
      lipsync_active: value > 0,
      current_mouth_open: value,
      peak_mouth_open: Math.max(this._snapshot.peak_mouth_open, value)
    };
    this._history.push({ mouth_open: value });
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getFrameHistory() {
    return Object.freeze([...this._history]);
  }
}

class FakeAudioPlaybackController {
  constructor({ lipsyncDriver }) {
    this._lipsyncDriver = lipsyncDriver;
    this._snapshot = {
      playback_active: false,
      buffered_fragment_count: 0,
      final_fragment_received: false,
      last_report_kind: null
    };
    this.destroyed = false;
  }

  getSnapshot() {
    return Object.freeze({ ...this._snapshot });
  }

  getBackendDescriptor() {
    return Object.freeze({
      backend_key: "desktop.live2d.audio.fake",
      runtime_mode: "avatar_fake_audio",
      supports_device_audio_output: false
    });
  }

  async deliverFragment(request) {
    this._lipsyncDriver.ingestPeak(0.72);
    this._snapshot = {
      playback_active: !request.is_final,
      buffered_fragment_count: request.is_final ? 0 : request.fragment_index + 1,
      final_fragment_received: request.is_final,
      last_report_kind: request.is_final ? "finished" : "accepted"
    };
    const reports = request.is_final
      ? [
          { report_kind: "accepted" },
          { report_kind: "started" },
          { report_kind: "finished" }
        ]
      : [{ report_kind: "accepted" }];
    return {
      playback_snapshot: this.getSnapshot(),
      reports
    };
  }

  async abortChunk() {
    this._snapshot = {
      playback_active: false,
      buffered_fragment_count: 0,
      final_fragment_received: false,
      last_report_kind: "aborted"
    };
    return {
      playback_snapshot: this.getSnapshot(),
      reports: [{ report_kind: "aborted" }]
    };
  }

  async destroy() {
    this.destroyed = true;
  }
}

async function run() {
  const activeModelSettings = JSON.parse(
    await readFile(canonicalResolvedModelJsonPath, "utf8")
  );
  assert.equal(activeModelSettings.Version, 3);
  assert.equal(typeof activeModelSettings.FileReferences?.Moc, "string");
  assert.equal(Array.isArray(activeModelSettings.FileReferences?.Textures), true);
  assert.equal(activeModelSettings.FileReferences.Textures.length > 0, true);

  const activeSceneHost = new DesktopLive2DDomSceneHost({
    stageElement: {
      appendChild() {},
      clientWidth: 460,
      clientHeight: 620
    },
    statusElement: {
      textContent: ""
    }
  });
  assert.equal(
    activeSceneHost.getBridgeResolvedModelPath(),
    canonicalResolvedModelJsonPath
  );
  const originalFetch = globalThis.fetch;
  let capturedInitializeManifest = null;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return JSON.parse(await readFile(sceneManifestPath, "utf8"));
    }
  });
  activeSceneHost.getController().initialize = async (manifest) => {
    capturedInitializeManifest = manifest;
    return {
      display_name: manifest.display_name,
      runtime_mode: "avatar_boot_capture",
      model_key: manifest.model_key,
      presentation_mode: manifest.presentation_mode,
      window_surface: manifest.window_surface
    };
  };
  try {
    await activeSceneHost.boot();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(capturedInitializeManifest.model_key, "open-yachiyo-kaguya");
  assert.equal(
    capturedInitializeManifest.repo_relative_model_json_path,
    "apps/desktop-live2d/assets/models/open-yachiyo-kaguya/open_yachiyo_kaguya.model3.json"
  );
  assert.equal(
    decodeURIComponent(capturedInitializeManifest.resolved_model_json_path).endsWith(
      "open_yachiyo_kaguya.model3.json"
    ),
    true
  );

  const liteSceneHost = new DesktopLive2DDomSceneHost({
    stageElement: {
      appendChild() {},
      clientWidth: 460,
      clientHeight: 620
    },
    statusElement: {
      textContent: ""
    },
    selectedModelKey: "open-yachiyo-kaguya-lite",
    modelManifestUrl: new URL(`file:///${liteSceneManifestPath.replaceAll("\\", "/")}`)
  });
  let capturedLiteManifest = null;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return JSON.parse(await readFile(liteSceneManifestPath, "utf8"));
    }
  });
  liteSceneHost.getController().initialize = async (manifest) => {
    capturedLiteManifest = manifest;
    return {
      display_name: manifest.display_name,
      runtime_mode: "avatar_boot_capture",
      model_key: manifest.model_key,
      presentation_mode: manifest.presentation_mode,
      window_surface: manifest.window_surface
    };
  };
  try {
    await liteSceneHost.boot();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(capturedLiteManifest.model_key, "open-yachiyo-kaguya-lite");
  assert.equal(
    capturedLiteManifest.repo_relative_model_json_path,
    "apps/desktop-live2d/assets/models/open-yachiyo-kaguya-lite/open_yachiyo_kaguya_lite.model3.json"
  );
  assert.equal(
    decodeURIComponent(capturedLiteManifest.resolved_model_json_path).endsWith(
      "open_yachiyo_kaguya_lite.model3.json"
    ),
    true
  );
  assert.equal(
    liteSceneHost.getBridgeResolvedModelPath(),
    liteResolvedModelJsonPath
  );

  globalThis.document = {
    createElement() {
      return {
        style: {},
        textContent: "",
        appendChild() {},
        remove() {}
      };
    }
  };
  let registeredHandler = null;
  const fakeDesktopApi = {
    shellInfo: {
      appName: "echo-desktop-live2d",
      presentationMode: "full_body",
      windowSurface: "character_window",
      windowRole: "avatar"
    },
    async registerHostBridgeHandler(handler) {
      registeredHandler = handler;
      return { ok: true, accepted: true, windowRole: "avatar" };
    }
  };

  const fakeSceneHost = new FakeSceneHost();
  const fakeLipsyncDriver = new FakeLipsyncDriver();
  const fakeAudioPlaybackController = new FakeAudioPlaybackController({
    lipsyncDriver: fakeLipsyncDriver
  });
  const runtime = new DesktopLive2DAvatarWindowRuntime({
    stageElement: {
      innerHTML: "",
      appendChild() {}
    },
    statusElement: {
      textContent: ""
    },
    runtimeLabelElement: {
      textContent: ""
    },
    runtimeDotElement: {
      classList: { toggle() {} }
    },
    playbackLabelElement: {
      textContent: ""
    },
    playbackDotElement: {
      classList: { toggle() {} }
    },
    lipsyncLabelElement: {
      textContent: ""
    },
    lipsyncMeterFillElement: {
      style: {}
    },
    desktopApi: fakeDesktopApi,
    shellInfo: fakeDesktopApi.shellInfo,
    sceneHost: fakeSceneHost,
    audioLipsyncDriver: fakeLipsyncDriver,
    audioPlaybackController: fakeAudioPlaybackController
  });

  await runtime.boot();
  assert.equal(typeof registeredHandler, "function");
  assert.equal(fakeSceneHost.bootCount, 1);

  const initResponse = await registeredHandler({
    request_id: "11111111-1111-4111-8111-111111111111",
    bridge_command: "initialize",
    full_body_required: true
  });
  assert.equal(initResponse.status, "ok");
  assert.equal(initResponse.model_key, "open-yachiyo-kaguya");
  assert.equal(
    initResponse.resolved_model_json_path,
    canonicalResolvedModelJsonPath
  );
  assert.equal(initResponse.presentation_mode, "full_body");

  const dispatchResponse = await registeredHandler({
    request_id: "22222222-2222-4222-8222-222222222222",
    bridge_command: "dispatch_command",
    command_id: "33333333-3333-4333-8333-333333333333",
    command_type: "set_state",
    adapter_profile_key: null,
    value: "thinking"
  });
  assert.equal(dispatchResponse.status, "ok");
  assert.equal(runtime.buildDebugSnapshot().scene_snapshot.state, "thinking");

  const bubbleResponse = await registeredHandler({
    request_id: "44444444-4444-4444-8444-444444444444",
    bridge_command: "bubble_replace",
    bubble_text: "Hello avatar window",
    speaker_label: "Echo",
    is_streaming: true
  });
  assert.equal(bubbleResponse.status, "error");
  assert.equal(bubbleResponse.error_code, "invalid_request");

  const audioResponse = await registeredHandler({
    request_id: "55555555-5555-4555-8555-555555555555",
    bridge_command: "audio_playback_fragment",
    fragment_index: 1,
    is_final: true
  });
  assert.deepEqual(
    audioResponse.reports.map((item) => item.report_kind),
    ["accepted", "started", "finished"]
  );
  assert.equal(
    runtime.buildDebugSnapshot().audio_playback_snapshot.last_report_kind,
    "finished"
  );
  assert.ok(runtime.buildDebugSnapshot().lipsync_snapshot.peak_mouth_open > 0);

  const unsupportedResponse = await registeredHandler({
    request_id: "66666666-6666-4666-8666-666666666666",
    bridge_command: "companion_session_snapshot"
  });
  assert.equal(unsupportedResponse.status, "error");
  assert.equal(unsupportedResponse.error_code, "invalid_request");

  process.stdout.write("desktop-live2d avatar window self-check passed\n");
}

run().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
