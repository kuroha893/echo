import readline from "node:readline";

import {
  BRIDGE_COMMAND,
  BRIDGE_ERROR_CODE,
  buildAudioPlaybackResponse,
  buildBubbleResponse,
  buildCompanionSessionResponse,
  buildErrorEnvelope,
  buildInitializeResponse,
  buildPingResponse,
  buildShutdownResponse,
  parseIncomingJsonLine
} from "../bridge/protocol.mjs";
import { loadModelManifest } from "../bridge/model_assets.mjs";
import { DesktopLive2DSceneController } from "./scene_controller.mjs";
import { BubbleStateManager } from "../shared/bubble_state_manager.mjs";
import { DesktopLive2DAudioPlaybackController } from "../shared/audio_playback_controller.mjs";
import { AudioPlaybackContractError } from "../shared/audio_playback_contracts.mjs";
import { HeadlessAudioPlaybackBackend } from "../shared/headless_audio_playback_backend.mjs";
import { CompanionSessionStateManager } from "../shared/companion_session_state_manager.mjs";
import { DesktopLive2DCompanionSessionContractError } from "../shared/companion_session_contracts.mjs";

const workspaceRoot =
  process.env.ECHO_DESKTOP_LIVE2D_WORKSPACE_ROOT ||
  import.meta.dirname;
const sceneController = new DesktopLive2DSceneController();
const bubbleStateManager = new BubbleStateManager();
const audioPlaybackController = new DesktopLive2DAudioPlaybackController({
  backend: new HeadlessAudioPlaybackBackend()
});
const companionSessionStateManager = new CompanionSessionStateManager();
let initialized = false;
let closing = false;

function writeEnvelope(envelope) {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

function buildAudioPlaybackErrorEnvelope(request, error) {
  if (error instanceof AudioPlaybackContractError) {
    return buildErrorEnvelope({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
      message: error.message,
      retryable: false,
      rawErrorType: error.name
    });
  }
  return buildErrorEnvelope({
    requestId: request.request_id,
    bridgeCommand: request.bridge_command,
    errorCode: BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message: error instanceof Error ? error.message : "desktop-live2d audio playback failed",
    retryable: false,
    rawErrorType: error instanceof Error ? error.name : typeof error
  });
}

function buildCompanionSessionErrorEnvelope(request, error) {
  if (error instanceof DesktopLive2DCompanionSessionContractError) {
    return buildErrorEnvelope({
      requestId: request.request_id,
      bridgeCommand: request.bridge_command,
      errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
      message: error.message,
      retryable: false,
      rawErrorType: error.name
    });
  }
  return buildErrorEnvelope({
    requestId: request.request_id,
    bridgeCommand: request.bridge_command,
    errorCode: BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message:
      error instanceof Error
        ? error.message
        : "desktop-live2d companion session bridge failed",
    retryable: false,
    rawErrorType: error instanceof Error ? error.name : typeof error
  });
}

function buildSceneErrorEnvelope(request, error) {
  return buildErrorEnvelope({
    requestId: request.request_id,
    bridgeCommand: request.bridge_command,
    errorCode: error.errorCode || BRIDGE_ERROR_CODE.INTERNAL_APP_ERROR,
    message: error.message || "desktop-live2d scene bridge failed",
    retryable: Boolean(error.retryable),
    commandId: error.commandId || null,
    commandType: error.commandType || null,
    rawErrorType: error.rawErrorType || null
  });
}

async function handleRequest(request) {
  switch (request.bridge_command) {
    case BRIDGE_COMMAND.PING:
      return buildPingResponse(request.request_id);
    case BRIDGE_COMMAND.INITIALIZE: {
      if (request.full_body_required !== true) {
        return buildErrorEnvelope({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          errorCode: BRIDGE_ERROR_CODE.INVALID_MODEL_ASSET,
          message: "first desktop-live2d backend requires a full-body model window",
          retryable: false
        });
      }
      const manifest = await loadModelManifest({
        workspaceRoot,
        modelAsset: request.model_asset
      });
      const snapshot = await sceneController.initialize(manifest);
      initialized = true;
      return buildInitializeResponse({
        requestId: request.request_id,
        modelKey: snapshot.model_key,
        resolvedModelJsonPath: manifest.resolved_model_json_path,
        presentationMode: snapshot.presentation_mode,
        windowSurface: manifest.window_surface
      });
    }
    case BRIDGE_COMMAND.DISPATCH_COMMAND: {
      if (!initialized) {
        return buildErrorEnvelope({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          errorCode: BRIDGE_ERROR_CODE.NOT_INITIALIZED,
          message: "desktop-live2d scene bridge must be initialized before dispatch",
          retryable: false,
          commandId: request.command_id,
          commandType: request.command_type
        });
      }
      try {
        const receipt = await sceneController.dispatchCommand(request);
        return {
          request_id: request.request_id,
          status: "ok",
          bridge_command: BRIDGE_COMMAND.DISPATCH_COMMAND,
          command_id: request.command_id,
          command_type: request.command_type,
          adapter_key: receipt.adapter_key,
          adapter_profile_key: request.adapter_profile_key,
          outcome: receipt.outcome,
          message: receipt.message
        };
      } catch (error) {
        return buildSceneErrorEnvelope(request, error);
      }
    }
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_FRAGMENT:
      try {
        const playbackResult = await audioPlaybackController.deliverFragment(request);
        return buildAudioPlaybackResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          playbackSnapshot: playbackResult.playback_snapshot,
          reports: playbackResult.reports
        });
      } catch (error) {
        return buildAudioPlaybackErrorEnvelope(request, error);
      }
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_ABORT:
      try {
        const playbackResult = await audioPlaybackController.abortChunk(request);
        return buildAudioPlaybackResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          playbackSnapshot: playbackResult.playback_snapshot,
          reports: playbackResult.reports
        });
      } catch (error) {
        return buildAudioPlaybackErrorEnvelope(request, error);
      }
    case BRIDGE_COMMAND.AUDIO_PLAYBACK_SNAPSHOT:
      return buildAudioPlaybackResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        playbackSnapshot: audioPlaybackController.getSnapshot(),
        reports: []
      });
    case BRIDGE_COMMAND.COMPANION_SESSION_UPSERT_TRANSCRIPT:
      try {
        const snapshot = companionSessionStateManager.upsertTranscript(request);
        return buildCompanionSessionResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          companionSessionSnapshot: snapshot
        });
      } catch (error) {
        return buildCompanionSessionErrorEnvelope(request, error);
      }
    case BRIDGE_COMMAND.COMPANION_SESSION_SNAPSHOT:
      return buildCompanionSessionResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        companionSessionSnapshot: companionSessionStateManager.getSnapshot()
      });
    case BRIDGE_COMMAND.COMPANION_SESSION_ENQUEUE_INPUT:
      try {
        const enqueueResult = companionSessionStateManager.enqueueInput(request);
        return buildCompanionSessionResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          companionSessionSnapshot: enqueueResult.snapshot
        });
      } catch (error) {
        return buildCompanionSessionErrorEnvelope(request, error);
      }
    case BRIDGE_COMMAND.COMPANION_SESSION_DRAIN_INPUT:
      try {
        const drainResult = companionSessionStateManager.drainInputs(request);
        return buildCompanionSessionResponse({
          requestId: request.request_id,
          bridgeCommand: request.bridge_command,
          companionSessionSnapshot: drainResult.snapshot,
          drainedInputs: drainResult.drained_inputs
        });
      } catch (error) {
        return buildCompanionSessionErrorEnvelope(request, error);
      }
    case BRIDGE_COMMAND.BUBBLE_REPLACE:
      return buildBubbleResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        bubbleSnapshot: bubbleStateManager.replace({
          bubble_text: request.bubble_text,
          speaker_label: request.speaker_label,
          is_streaming: request.is_streaming
        })
      });
    case BRIDGE_COMMAND.BUBBLE_APPEND:
      return buildBubbleResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        bubbleSnapshot: bubbleStateManager.append({
          text_fragment: request.text_fragment,
          speaker_label: request.speaker_label,
          is_streaming: request.is_streaming
        })
      });
    case BRIDGE_COMMAND.BUBBLE_CLEAR:
      return buildBubbleResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        bubbleSnapshot: bubbleStateManager.clear({
          reason: request.reason
        })
      });
    case BRIDGE_COMMAND.BUBBLE_SNAPSHOT:
      return buildBubbleResponse({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        bubbleSnapshot: bubbleStateManager.getSnapshot()
      });
    case BRIDGE_COMMAND.SHUTDOWN:
      closing = true;
      await sceneController.destroy();
      await audioPlaybackController.destroy();
      return buildShutdownResponse(request.request_id, request.reason);
    default:
      return buildErrorEnvelope({
        requestId: request.request_id,
        bridgeCommand: request.bridge_command,
        errorCode: BRIDGE_ERROR_CODE.INVALID_REQUEST,
        message: `unsupported bridge command '${request.bridge_command}'`,
        retryable: false
      });
  }
}

const lineReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

lineReader.on("line", async (line) => {
  let request;
  try {
    request = parseIncomingJsonLine(line);
  } catch (error) {
    writeEnvelope(
      buildErrorEnvelope({
        requestId: "00000000-0000-4000-8000-000000000000",
        bridgeCommand: BRIDGE_COMMAND.PING,
        errorCode: BRIDGE_ERROR_CODE.PROTOCOL_ERROR,
        message: error instanceof Error ? error.message : "invalid bridge request",
        retryable: false,
        rawErrorType: error instanceof Error ? error.name : typeof error
      })
    );
    return;
  }
  const response = await handleRequest(request);
  writeEnvelope(response);
  if (request.bridge_command === BRIDGE_COMMAND.SHUTDOWN) {
    lineReader.close();
    process.stdin.pause();
    setTimeout(() => process.exit(0), 10);
  }
});

lineReader.on("close", () => {
  if (!closing) {
    process.exit(0);
  }
});
