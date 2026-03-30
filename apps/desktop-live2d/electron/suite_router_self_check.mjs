import assert from "node:assert/strict";
import path from "node:path";

import { BRIDGE_COMMAND } from "../bridge/protocol.mjs";
import {
  buildShellInfoForWindowRole,
  buildWindowSuiteDefinitions,
  computeAvatarWindowBounds,
  computeBubbleWindowBounds,
  computeChatWindowBounds,
  DESKTOP_WINDOW_ROLE,
  isBridgeExecutionTargetRole,
  parseDesktopWindowRoleFromArgv,
  resolveBridgeTargetWindowRole
} from "./window_suite_router.mjs";

const appRoot = path.resolve(import.meta.dirname, "..");
const preloadPath = path.resolve(appRoot, "electron", "preload.mjs");
const rendererRootPath = path.resolve(appRoot, "renderer");

function run() {
  const suiteDefinitions = buildWindowSuiteDefinitions({
    preloadPath,
    rendererRootPath
  });
  const roles = Object.keys(suiteDefinitions).sort();
  assert.deepEqual(roles, ["avatar", "bubble", "chat"]);

  assert.equal(
    suiteDefinitions.avatar.browserWindowOptions.frame,
    false
  );
  assert.equal(
    suiteDefinitions.avatar.browserWindowOptions.transparent,
    true
  );
  assert.equal(
    suiteDefinitions.avatar.browserWindowOptions.alwaysOnTop,
    true
  );

  assert.equal(
    suiteDefinitions.chat.browserWindowOptions.alwaysOnTop,
    true
  );
  assert.equal(
    suiteDefinitions.chat.browserWindowOptions.frame,
    false
  );
  assert.equal(
    suiteDefinitions.chat.browserWindowOptions.transparent,
    true
  );
  assert.equal(
    suiteDefinitions.bubble.browserWindowOptions.frame,
    false
  );
  assert.equal(
    suiteDefinitions.bubble.browserWindowOptions.transparent,
    true
  );
  assert.equal(
    suiteDefinitions.bubble.browserWindowOptions.alwaysOnTop,
    true
  );
  assert.match(suiteDefinitions.avatar.launchUrl, /avatar\.html\?windowRole=avatar$/);
  assert.match(suiteDefinitions.chat.launchUrl, /chat\.html\?windowRole=chat$/);
  assert.match(suiteDefinitions.bubble.launchUrl, /bubble\.html\?windowRole=bubble$/);

  assert.equal(
    resolveBridgeTargetWindowRole({
      bridge_command: BRIDGE_COMMAND.DISPATCH_COMMAND
    }),
    DESKTOP_WINDOW_ROLE.AVATAR
  );
  assert.equal(
    resolveBridgeTargetWindowRole({
      bridge_command: BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT
    }),
    DESKTOP_WINDOW_ROLE.AVATAR
  );
  assert.equal(
    resolveBridgeTargetWindowRole({
      bridge_command: BRIDGE_COMMAND.BUBBLE_REPLACE
    }),
    DESKTOP_WINDOW_ROLE.BUBBLE
  );
  assert.equal(
    resolveBridgeTargetWindowRole({
      bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT
    }),
    DESKTOP_WINDOW_ROLE.CHAT
  );
  assert.equal(
    resolveBridgeTargetWindowRole({
      bridge_command: BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT
    }),
    DESKTOP_WINDOW_ROLE.CHAT
  );

  assert.equal(isBridgeExecutionTargetRole(DESKTOP_WINDOW_ROLE.AVATAR), true);
  assert.equal(isBridgeExecutionTargetRole(DESKTOP_WINDOW_ROLE.CHAT), true);
  assert.equal(isBridgeExecutionTargetRole(DESKTOP_WINDOW_ROLE.BUBBLE), true);

  assert.equal(
    parseDesktopWindowRoleFromArgv([
      "electron",
      `${"--echo-desktop-live2d-window-role="}${DESKTOP_WINDOW_ROLE.CHAT}`
    ]),
    DESKTOP_WINDOW_ROLE.CHAT
  );
  assert.equal(
    buildShellInfoForWindowRole(DESKTOP_WINDOW_ROLE.AVATAR).windowSurface,
    "character_window"
  );
  assert.equal(
    buildShellInfoForWindowRole(DESKTOP_WINDOW_ROLE.CHAT).windowRole,
    DESKTOP_WINDOW_ROLE.CHAT
  );
  assert.equal(
    buildShellInfoForWindowRole(DESKTOP_WINDOW_ROLE.BUBBLE).windowSurface,
    "bubble_window"
  );

  const display = {
    workArea: {
      x: 0,
      y: 0,
      width: 1440,
      height: 900
    }
  };
  const avatarBounds = computeAvatarWindowBounds({
    avatarWidth: suiteDefinitions.avatar.browserWindowOptions.width,
    avatarHeight: suiteDefinitions.avatar.browserWindowOptions.height,
    display
  });
  assert.deepEqual(avatarBounds, {
    x: 962,
    y: 262,
    width: 460,
    height: 620
  });
  const chatBounds = computeChatWindowBounds({
    avatarBounds,
    chatWidth: suiteDefinitions.chat.browserWindowOptions.width,
    chatHeight: suiteDefinitions.chat.browserWindowOptions.height,
    display
  });
  assert.deepEqual(chatBounds, {
    x: 490,
    y: 262,
    width: 460,
    height: 620
  });
  const bubbleBounds = computeBubbleWindowBounds({
    avatarBounds,
    bubbleWidth: suiteDefinitions.bubble.browserWindowOptions.width,
    bubbleHeight: suiteDefinitions.bubble.browserWindowOptions.height,
    display
  });
  assert.deepEqual(bubbleBounds, {
    x: 864,
    y: 16,
    width: 560,
    height: 236
  });

  process.stdout.write("desktop-live2d suite router self-check passed\n");
}

run();
