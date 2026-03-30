import assert from "node:assert/strict";
import path from "node:path";

import { loadModelManifest } from "../bridge/model_assets.mjs";
import { DesktopLive2DSceneController } from "./scene_controller.mjs";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function run() {
  const manifest = await loadModelManifest({
    workspaceRoot,
    modelAsset: {
      model_key: "demo-fullbody",
      repo_relative_model_json_path:
        "apps/desktop-live2d/assets/models/demo-fullbody/model3.json",
      display_name: "Demo Full-Body Character",
      presentation_mode: "full_body",
      window_surface: "character_window"
    }
  });

  const controller = new DesktopLive2DSceneController();
  const initSnapshot = await controller.initialize(manifest);
  assert.equal(initSnapshot.model_key, "demo-fullbody");
  assert.equal(initSnapshot.presentation_mode, "full_body");
  assert.equal(initSnapshot.model_loaded, true);
  assert.equal(initSnapshot.mouth_open, 0);
  assert.equal(initSnapshot.lipsync_active, false);
  assert.equal(initSnapshot.lipsync_source, null);

  const stateReceipt = await controller.dispatchCommand({
    command_id: "state-1",
    command_type: "set_state",
    target: "state",
    value: "thinking",
    is_interruptible: true
  });
  assert.equal(stateReceipt.snapshot.state, "thinking");

  const expressionReceipt = await controller.dispatchCommand({
    command_id: "expression-1",
    command_type: "set_expression",
    target: "expression",
    value: "smile",
    is_interruptible: true
  });
  assert.equal(expressionReceipt.snapshot.active_expression, "smile");

  const motionReceipt = await controller.dispatchCommand({
    command_id: "motion-1",
    command_type: "set_motion",
    target: "motion",
    value: "nod",
    is_interruptible: true
  });
  assert.equal(motionReceipt.snapshot.last_motion, "nod");

  const clearReceipt = await controller.dispatchCommand({
    command_id: "clear-1",
    command_type: "clear_expression",
    target: "expression",
    value: true,
    is_interruptible: true
  });
  assert.equal(clearReceipt.snapshot.active_expression, null);
  assert.equal(clearReceipt.snapshot.mouth_open, 0);
  assert.equal(clearReceipt.snapshot.lipsync_active, false);

  let unsupportedCaught = false;
  try {
    await controller.dispatchCommand({
      command_id: "mouth-1",
      command_type: "set_mouth_open",
      target: "mouth",
      value: 0.4,
      is_interruptible: true
    });
  } catch (error) {
    unsupportedCaught = true;
    assert.equal(error.errorCode, "unsupported_command");
  }
  assert.equal(unsupportedCaught, true);
  console.log("desktop-live2d scene self-check passed");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
