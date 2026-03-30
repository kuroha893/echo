import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildErrorEnvelope
} from "../bridge/protocol.mjs";
import {
  COMPANION_HOST_MESSAGE_KIND,
  COMPANION_HOST_OPERATION,
  COMPANION_HOST_STATUS,
  DesktopCompanionHostProtocolError,
  buildServiceOperationRequest,
  buildDesktopBridgeResponseMessage,
  parseCompanionHostMessage
} from "./companion_service_protocol.mjs";

const HOST_SCRIPT_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "python",
  "companion_service_host.py"
);

function resolvePythonLaunch() {
  const explicitExecutable = process.env.ECHO_DESKTOP_PYTHON_EXECUTABLE;
  if (explicitExecutable) {
    return {
      command: explicitExecutable,
      args: ["-u", HOST_SCRIPT_PATH]
    };
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const embeddedCandidate = path.join(
        localAppData,
        "Python",
        "pythoncore-3.14-64",
        "python.exe"
      );
      if (fs.existsSync(embeddedCandidate)) {
        return {
          command: embeddedCandidate,
          args: ["-u", HOST_SCRIPT_PATH]
        };
      }
    }
    return {
      command: "py",
      args: ["-3", "-u", HOST_SCRIPT_PATH]
    };
  }

  return {
    command: "python3",
    args: ["-u", HOST_SCRIPT_PATH]
  };
}

function buildHostLaunchEnvironment({
  workspaceRoot,
  userDataDirectory
}) {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT: workspaceRoot,
    ECHO_DESKTOP_LIVE2D_USER_DATA_DIR: userDataDirectory
  };
}

export class DesktopCompanionPythonHostError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DesktopCompanionPythonHostError";
    this.failure = options.failure || null;
    this.stderrTail = options.stderrTail || [];
  }
}

export class DesktopCompanionPythonHost {
  constructor({
    workspaceRoot,
    userDataDirectory,
    onDesktopBridgeRequest
  }) {
    this._workspaceRoot = workspaceRoot;
    this._userDataDirectory = userDataDirectory;
    this._onDesktopBridgeRequest = onDesktopBridgeRequest;
    this._child = null;
    this._stdoutReader = null;
    this._stderrReader = null;
    this._ready = false;
    this._closed = false;
    this._writeLock = Promise.resolve();
    this._serviceWaiters = new Map();
    this._stderrLines = [];
  }

  async snapshotDesktopState({ modelKey = null, targetSessionKind = null } = {}) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.SNAPSHOT_DESKTOP_STATE,
      {
        model_key: modelKey,
        target_session_kind: targetSessionKind
      }
    );
    return response.payload;
  }

  async submitDesktopInput(
    text,
    {
      images = [],
      visibleInTranscript = true,
      modelKey = null,
      targetSessionKind = null
    } = {}
  ) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.SUBMIT_DESKTOP_INPUT,
      {
        text,
        images,
        visible_in_transcript: visibleInTranscript,
        model_key: modelKey,
        target_session_kind: targetSessionKind
      }
    );
    return response.payload;
  }

  async loadProviderSettings() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.LOAD_PROVIDER_SETTINGS,
      {}
    );
    return response.payload;
  }

  async saveProviderSettings(settingsUpdate) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.SAVE_PROVIDER_SETTINGS,
      settingsUpdate
    );
    return response.payload;
  }

  async validateProviderSettings() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.VALIDATE_PROVIDER_SETTINGS,
      {}
    );
    return response.payload;
  }

  async getProviderReadiness() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.GET_PROVIDER_READINESS,
      {}
    );
    return response.payload;
  }

  async runTTSVoiceEnrollment(payload) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.RUN_TTS_VOICE_ENROLLMENT,
      payload
    );
    return response.payload;
  }

  async listClonedVoices() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.LIST_CLONED_VOICES,
      {}
    );
    return response.payload;
  }

  async listSessions() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.LIST_SESSIONS,
      {}
    );
    return response.payload;
  }

  async createSession({
    title = "",
    makeActive = true,
    modelKey = null,
    sessionKind = "direct",
    voiceProfileKey = null
  } = {}) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.CREATE_SESSION,
      {
        title,
        make_active: makeActive,
        model_key: modelKey,
        session_kind: sessionKind,
        voice_profile_key: voiceProfileKey
      }
    );
    return response.payload;
  }

  async switchSession(sessionId, { modelKey = null } = {}) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.SWITCH_SESSION,
      { session_id: sessionId, model_key: modelKey }
    );
    return response.payload;
  }

  async deleteSession(sessionId) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.DELETE_SESSION,
      { session_id: sessionId }
    );
    return response.payload;
  }

  async forkSession(sourceSessionId, { cutAfterIndex = null, title = "", makeActive = true } = {}) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.FORK_SESSION,
      {
        source_session_id: sourceSessionId,
        cut_after_index: cutAfterIndex,
        title,
        make_active: makeActive
      }
    );
    return response.payload;
  }

  async getActiveSession() {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.GET_ACTIVE_SESSION,
      {}
    );
    return response.payload;
  }

  async getSessionDetail(sessionId) {
    const response = await this._requestServiceOperation(
      COMPANION_HOST_OPERATION.GET_SESSION_DETAIL,
      { session_id: sessionId }
    );
    return response.payload;
  }

  async close() {
    if (this._closed) {
      return;
    }
    this._closed = true;
    if (this._child && this._child.exitCode === null) {
      try {
        await this._requestServiceOperation(
          COMPANION_HOST_OPERATION.SHUTDOWN,
          {}
        );
      } catch {
        // The host may already be broken; fall through to kill.
      }
      if (this._child.exitCode === null) {
        this._child.kill();
      }
    }
    this._failPendingRequests(
      new DesktopCompanionPythonHostError(
        "desktop companion python host has been closed",
        { stderrTail: this._stderrLines }
      )
    );
  }

  async _requestServiceOperation(operation, payload) {
    await this._ensureStarted();
    const request = buildServiceOperationRequest({
      operation,
      payload
    });
    const waiter = this._createWaiter(request.request_id);
    await this._writeMessage(request);
    return await waiter.promise;
  }

  async _ensureStarted() {
    if (this._ready) {
      return;
    }
    if (this._closed) {
      throw new DesktopCompanionPythonHostError(
        "desktop companion python host is closed"
      );
    }

    const launch = resolvePythonLaunch();
    const child = spawn(launch.command, launch.args, {
      cwd: this._workspaceRoot,
      env: buildHostLaunchEnvironment({
        workspaceRoot: this._workspaceRoot,
        userDataDirectory: this._userDataDirectory
      }),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this._child = child;
    child.stdin?.setDefaultEncoding("utf8");
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    this._stdoutReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });
    this._stderrReader = readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity
    });

    this._stdoutReader.on("line", (line) => {
      void this._handleStdoutLine(line);
    });
    this._stderrReader.on("line", (line) => {
      if (line) {
        this._stderrLines.push(line);
        this._stderrLines = this._stderrLines.slice(-48);
      }
    });

    child.on("exit", (code, signal) => {
      this._ready = false;
      const suffix = signal
        ? `signal ${signal}`
        : `exit code ${code === null ? "unknown" : code}`;
      this._failPendingRequests(
        new DesktopCompanionPythonHostError(
          `desktop companion python host exited with ${suffix}`,
          { stderrTail: this._stderrLines }
        )
      );
    });

    child.on("error", (error) => {
      this._ready = false;
      this._failPendingRequests(
        new DesktopCompanionPythonHostError(
          error instanceof Error ? error.message : String(error),
          { stderrTail: this._stderrLines }
        )
      );
    });

    this._ready = true;
  }

  async _handleStdoutLine(line) {
    let message;
    try {
      message = parseCompanionHostMessage(line);
    } catch (error) {
      this._failPendingRequests(
        new DesktopCompanionPythonHostError(
          error instanceof Error ? error.message : "invalid companion host message",
          { stderrTail: this._stderrLines }
        )
      );
      return;
    }

    if (message.message_kind === COMPANION_HOST_MESSAGE_KIND.SERVICE_OPERATION_RESPONSE) {
      const waiter = this._serviceWaiters.get(message.request_id);
      if (!waiter) {
        return;
      }
      this._serviceWaiters.delete(message.request_id);
      if (message.status === COMPANION_HOST_STATUS.OK) {
        waiter.resolve(message);
        return;
      }
      waiter.reject(
        new DesktopCompanionPythonHostError(
          message.error_message || `${message.operation} failed`,
          {
            failure: message.failure,
            stderrTail: this._stderrLines
          }
        )
      );
      return;
    }

    if (message.message_kind === COMPANION_HOST_MESSAGE_KIND.DESKTOP_BRIDGE_REQUEST) {
      const bridgeResponse = await this._forwardBridgeRequest(message.bridge_request);
      await this._writeMessage(
        buildDesktopBridgeResponseMessage({
          requestId: message.request_id,
          bridgeResponse
        })
      );
    }
  }

  async _forwardBridgeRequest(bridgeRequest) {
    try {
      return await this._onDesktopBridgeRequest(bridgeRequest);
    } catch (error) {
      return buildErrorEnvelope({
        requestId:
          bridgeRequest.request_id || "00000000-0000-4000-8000-000000000000",
        bridgeCommand: bridgeRequest.bridge_command || BRIDGE_COMMAND.PING,
        errorCode: BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
        message:
          error instanceof Error
            ? error.message
            : "desktop companion renderer bridge failed",
        retryable: false,
        rawErrorType: error instanceof Error ? error.name : typeof error
      });
    }
  }

  _createWaiter(requestId) {
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    const waiter = {
      promise,
      resolve,
      reject
    };
    this._serviceWaiters.set(requestId, waiter);
    return waiter;
  }

  async _writeMessage(message) {
    if (!this._child || !this._child.stdin) {
      throw new DesktopCompanionPythonHostError(
        "desktop companion python host stdin is unavailable",
        { stderrTail: this._stderrLines }
      );
    }
    const line = `${JSON.stringify(message)}${os.EOL}`;
    const nextWrite = this._writeLock.catch(() => undefined).then(
      () =>
        new Promise((resolve, reject) => {
          this._child.stdin.write(line, "utf8", (error) => {
            if (error) {
              reject(
                new DesktopCompanionPythonHostError(
                  error instanceof Error ? error.message : String(error),
                  { stderrTail: this._stderrLines }
                )
              );
              return;
            }
            resolve();
          });
        })
    );
    this._writeLock = nextWrite;
    return await nextWrite;
  }

  _failPendingRequests(error) {
    for (const waiter of this._serviceWaiters.values()) {
      waiter.reject(error);
    }
    this._serviceWaiters.clear();
  }
}
