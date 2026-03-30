import readline from "node:readline";

import { DesktopLive2DBridgeSession } from "./app_bridge_session.mjs";
import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildErrorEnvelope,
  buildProtocolErrorFromUnknown,
  parseIncomingJsonLine
} from "./protocol.mjs";

const workspaceRoot =
  process.env.ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT ||
  import.meta.dirname;
const session = new DesktopLive2DBridgeSession({
  adapterKey: "desktop.live2d",
  workspaceRoot
});

function writeEnvelope(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

const lineReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

lineReader.on("line", async (line) => {
  let parsedRequest;
  try {
    parsedRequest = parseIncomingJsonLine(line);
  } catch (error) {
    const normalized = buildProtocolErrorFromUnknown({
      bridgeCommand: BRIDGE_COMMAND.PING,
      error
    });
    writeEnvelope(
      buildErrorEnvelope({
        requestId: "00000000-0000-4000-8000-000000000000",
        bridgeCommand: BRIDGE_COMMAND.PING,
        errorCode:
          normalized.errorCode || BRIDGE_ERROR_CODE.PROTOCOL_ERROR,
        message: normalized.message,
        retryable: normalized.retryable,
        rawErrorType: normalized.rawErrorType
      })
    );
    return;
  }

  const response = await session.handleRequest(parsedRequest);
  writeEnvelope(response);
  if (parsedRequest.bridge_command === BRIDGE_COMMAND.SHUTDOWN) {
    lineReader.close();
    process.stdin.pause();
    setTimeout(() => {
      process.exit(0);
    }, 10);
  }
});

lineReader.on("close", () => {
  if (!session.isClosing()) {
    process.exit(0);
  }
});

process.on("uncaughtException", (error) => {
  process.stderr.write(
    `[desktop-live2d bridge] uncaughtException: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  process.stderr.write(
    `[desktop-live2d bridge] unhandledRejection: ${error instanceof Error ? error.stack || error.message : String(error)}\n`
  );
  process.exit(1);
});
