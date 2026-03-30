import path from "node:path";
import { pathToFileURL } from "node:url";

import { BRIDGE_COMMAND } from "../bridge/protocol.mjs";

export const DESKTOP_WINDOW_ROLE = Object.freeze({
  AVATAR: "avatar",
  CHAT: "chat",
  BUBBLE: "bubble",
  CONSOLE: "console"
});

const VALID_WINDOW_ROLE_SET = new Set(Object.values(DESKTOP_WINDOW_ROLE));
const BRIDGE_EXECUTION_TARGET_SET = new Set([
  DESKTOP_WINDOW_ROLE.AVATAR,
  DESKTOP_WINDOW_ROLE.CHAT,
  DESKTOP_WINDOW_ROLE.BUBBLE
]);
const AVATAR_TARGET_COMMANDS = new Set([
  BRIDGE_COMMAND.PING,
  BRIDGE_COMMAND.INITIALIZE,
  BRIDGE_COMMAND.DISPATCH_COMMAND,
  BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT,
  BRIDGE_COMMAND.AUDIO_PLAYBACK_ABORT,
  BRIDGE_COMMAND.AUDIO_PLAYBACK_SNAPSHOT,
  BRIDGE_COMMAND.SHUTDOWN
]);
const CHAT_TARGET_COMMANDS = new Set([
  BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT,
  BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT,
  BRIDGE_COMMAND.COMPANION_SESSION_ENQUEUE_INPUT,
  BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT
]);
const BUBBLE_TARGET_COMMANDS = new Set([
  BRIDGE_COMMAND.BUBBLE_REPLACE,
  BRIDGE_COMMAND.BUBBLE_APPEND,
  BRIDGE_COMMAND.BUBBLE_CLEAR,
  BRIDGE_COMMAND.BUBBLE_SNAPSHOT
]);
const WINDOW_ROLE_ARG_PREFIX = "--echo-desktop-live2d-window-role=";
const WINDOW_ROLE_TO_ENTRY_FILE = Object.freeze({
  [DESKTOP_WINDOW_ROLE.AVATAR]: "avatar.html",
  [DESKTOP_WINDOW_ROLE.CHAT]: "chat.html",
  [DESKTOP_WINDOW_ROLE.BUBBLE]: "bubble.html",
  [DESKTOP_WINDOW_ROLE.CONSOLE]: "console.html"
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeRightBottomWindowBounds({
  width,
  height,
  display,
  marginRight = 16,
  marginBottom = 16
}) {
  const fallback = { x: undefined, y: undefined, width, height };
  const workArea = display?.workArea;
  if (!workArea || typeof workArea !== "object") {
    return fallback;
  }
  return {
    x: Math.round(workArea.x + workArea.width - width - marginRight),
    y: Math.round(workArea.y + workArea.height - height - marginBottom),
    width,
    height
  };
}

export function isDesktopWindowRole(value) {
  return VALID_WINDOW_ROLE_SET.has(value);
}

export function isBridgeExecutionTargetRole(role) {
  return BRIDGE_EXECUTION_TARGET_SET.has(role);
}

export function parseDesktopWindowRoleFromArgv(argv = process.argv) {
  for (const rawValue of argv) {
    if (!rawValue.startsWith(WINDOW_ROLE_ARG_PREFIX)) {
      continue;
    }
    const role = rawValue.slice(WINDOW_ROLE_ARG_PREFIX.length);
    if (isDesktopWindowRole(role)) {
      return role;
    }
  }
  return DESKTOP_WINDOW_ROLE.AVATAR;
}

export function buildShellInfoForWindowRole(role) {
  if (!isDesktopWindowRole(role)) {
    throw new Error(`unsupported desktop window role '${String(role)}'`);
  }
  const windowSurface =
    role === DESKTOP_WINDOW_ROLE.AVATAR
      ? "character_window"
      : role === DESKTOP_WINDOW_ROLE.BUBBLE
        ? "bubble_window"
        : role === DESKTOP_WINDOW_ROLE.CHAT
          ? "chat_window"
          : role === DESKTOP_WINDOW_ROLE.CONSOLE
            ? "console_window"
            : "character_window";
  return Object.freeze({
    appName: "echo-desktop-live2d",
    presentationMode: "full_body",
    windowSurface,
    windowRole: role
  });
}

export function buildWindowSuiteDefinitions({
  preloadPath,
  rendererRootPath,
  roleLaunchUrlOverrides = null
}) {
  const sharedWebPreferences = Object.freeze({
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  });
  const sharedLaunchShape = Object.freeze({
    show: true,
    backgroundColor: "#0b1420"
  });

  return Object.freeze({
    [DESKTOP_WINDOW_ROLE.AVATAR]: Object.freeze({
      role: DESKTOP_WINDOW_ROLE.AVATAR,
      title: "Echo Avatar",
      launchUrl:
        roleLaunchUrlOverrides?.[DESKTOP_WINDOW_ROLE.AVATAR] ||
        buildRendererLaunchUrl(rendererRootPath, DESKTOP_WINDOW_ROLE.AVATAR),
      browserWindowOptions: {
        ...sharedLaunchShape,
        width: 460,
        height: 620,
        minWidth: 180,
        minHeight: 260,
        maxWidth: 900,
        maxHeight: 1400,
        transparent: true,
        frame: false,
        resizable: true,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#00000000",
        webPreferences: {
          ...sharedWebPreferences,
          additionalArguments: [
            `${WINDOW_ROLE_ARG_PREFIX}${DESKTOP_WINDOW_ROLE.AVATAR}`
          ]
        }
      }
    }),
    [DESKTOP_WINDOW_ROLE.CHAT]: Object.freeze({
      role: DESKTOP_WINDOW_ROLE.CHAT,
      title: "Echo Chat",
      launchUrl:
        roleLaunchUrlOverrides?.[DESKTOP_WINDOW_ROLE.CHAT] ||
        buildRendererLaunchUrl(rendererRootPath, DESKTOP_WINDOW_ROLE.CHAT),
      browserWindowOptions: {
        ...sharedLaunchShape,
        width: 460,
        height: 620,
        transparent: true,
        frame: false,
        resizable: true,
        hasShadow: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#00000000",
        webPreferences: {
          ...sharedWebPreferences,
          additionalArguments: [
            `${WINDOW_ROLE_ARG_PREFIX}${DESKTOP_WINDOW_ROLE.CHAT}`
          ]
        }
      }
    }),
    [DESKTOP_WINDOW_ROLE.BUBBLE]: Object.freeze({
      role: DESKTOP_WINDOW_ROLE.BUBBLE,
      title: "Echo Bubble",
      launchUrl:
        roleLaunchUrlOverrides?.[DESKTOP_WINDOW_ROLE.BUBBLE] ||
        buildRendererLaunchUrl(rendererRootPath, DESKTOP_WINDOW_ROLE.BUBBLE),
      browserWindowOptions: {
        ...sharedLaunchShape,
        show: false,
        width: 1440,
        height: 260,
        transparent: true,
        frame: false,
        resizable: false,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true,
        backgroundColor: "#00000000",
        webPreferences: {
          ...sharedWebPreferences,
          additionalArguments: [
            `${WINDOW_ROLE_ARG_PREFIX}${DESKTOP_WINDOW_ROLE.BUBBLE}`
          ]
        }
      }
    }),
    [DESKTOP_WINDOW_ROLE.CONSOLE]: Object.freeze({
      role: DESKTOP_WINDOW_ROLE.CONSOLE,
      title: "Echo Console",
      launchUrl:
        roleLaunchUrlOverrides?.[DESKTOP_WINDOW_ROLE.CONSOLE] ||
        buildRendererLaunchUrl(rendererRootPath, DESKTOP_WINDOW_ROLE.CONSOLE),
      browserWindowOptions: {
        ...sharedLaunchShape,
        show: false,
        width: 800,
        height: 600,
        minWidth: 640,
        minHeight: 420,
        transparent: false,
        frame: false,
        resizable: true,
        hasShadow: true,
        alwaysOnTop: false,
        skipTaskbar: true,
        backgroundColor: "#12121a",
        webPreferences: {
          ...sharedWebPreferences,
          additionalArguments: [
            `${WINDOW_ROLE_ARG_PREFIX}${DESKTOP_WINDOW_ROLE.CONSOLE}`
          ]
        }
      }
    })
  });
}

export function resolveRendererEntryFileName(role) {
  const entryFileName = WINDOW_ROLE_TO_ENTRY_FILE[role];
  if (!entryFileName) {
    throw new Error(`desktop-live2d has no renderer entrypoint for role '${String(role)}'`);
  }
  return entryFileName;
}

export function buildRendererLaunchUrl(rendererRootPath, role) {
  const roleFragment = encodeURIComponent(role);
  const entryPath = path.resolve(rendererRootPath, resolveRendererEntryFileName(role));
  const baseUrl = pathToFileURL(entryPath).toString();
  return `${baseUrl}?windowRole=${roleFragment}`;
}

export function computeAvatarWindowBounds({
  avatarWidth,
  avatarHeight,
  display,
  marginRight = 18,
  marginBottom = 18
}) {
  return computeRightBottomWindowBounds({
    width: avatarWidth,
    height: avatarHeight,
    display,
    marginRight,
    marginBottom
  });
}

export function computeChatWindowBounds({
  avatarBounds,
  chatWidth,
  chatHeight,
  display,
  gap = 12,
  margin = 16
}) {
  const workArea = display?.workArea;
  if (!workArea || !avatarBounds) {
    return { x: undefined, y: undefined, width: chatWidth, height: chatHeight };
  }

  const workLeft = workArea.x + margin;
  const workTop = workArea.y + margin;
  const workRight = workArea.x + workArea.width - margin;
  const workBottom = workArea.y + workArea.height - margin;

  let x = avatarBounds.x - chatWidth - gap;
  if (x < workLeft) {
    x = avatarBounds.x + avatarBounds.width + gap;
  }
  x = clamp(x, workLeft, workRight - chatWidth);

  const preferredY = avatarBounds.y + avatarBounds.height - chatHeight;
  const y = clamp(preferredY, workTop, workBottom - chatHeight);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: chatWidth,
    height: chatHeight
  };
}

export function computeBubbleWindowBounds({
  avatarBounds,
  bubbleWidth,
  bubbleHeight,
  display,
  margin = 16
}) {
  const workArea = display?.workArea;
  if (!workArea) {
    return { x: undefined, y: undefined, width: bubbleWidth, height: bubbleHeight };
  }

  const workLeft = workArea.x + margin;
  const workTop = workArea.y + margin;
  const workRight = workArea.x + workArea.width - margin;
  const workBottom = workArea.y + workArea.height - margin;

  const width = Math.min(bubbleWidth, Math.max(640, workArea.width - margin * 2));
  const height = Math.min(bubbleHeight, Math.max(180, Math.round(workArea.height * 0.24)));
  const x = clamp(workArea.x + (workArea.width - width) / 2, workLeft, workRight - width);
  const y = clamp(workBottom - height, workTop, workBottom - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
}

export function resolveBridgeTargetWindowRole(bridgeRequest) {
  const command = bridgeRequest?.bridge_command;
  if (AVATAR_TARGET_COMMANDS.has(command)) {
    return DESKTOP_WINDOW_ROLE.AVATAR;
  }
  if (CHAT_TARGET_COMMANDS.has(command)) {
    return DESKTOP_WINDOW_ROLE.CHAT;
  }
  if (BUBBLE_TARGET_COMMANDS.has(command)) {
    return DESKTOP_WINDOW_ROLE.BUBBLE;
  }
  throw new Error(
    `desktop-live2d suite router has no window target for bridge command '${String(command)}'`
  );
}
