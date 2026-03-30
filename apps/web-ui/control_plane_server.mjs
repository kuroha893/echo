import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  parseAvatarModelSelectionSavePayload,
  buildDebugUpdatePayload,
  buildJsonError,
  buildJsonSuccess,
  buildSseEventFrame,
  DesktopWebControlPlaneError,
  parseProviderSettingsSavePayload,
  parseTextTurnSubmitPayload,
  parseTTSVoiceEnrollmentUploadPayload,
  parseTTSVoiceEnrollmentPayload,
  WEB_UI_API_ROUTE,
  WEB_UI_ERROR_CODE,
  WEB_UI_SSE_EVENT
} from "./public/control_plane_contracts.mjs";

const DEFAULT_PUBLIC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "public"
);

const DEFAULT_UPLOAD_ROOT = path.resolve(
  os.tmpdir(),
  "echo-web-ui",
  "voice-enrollment-uploads"
);

function resolveContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".mjs":
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sanitizeUploadExtension(fileName, mediaType) {
  const rawExtension = path.extname(String(fileName || "")).toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(rawExtension)) {
    return rawExtension;
  }
  const normalizedMediaType = String(mediaType || "").toLowerCase();
  if (normalizedMediaType === "audio/wav" || normalizedMediaType === "audio/x-wav") {
    return ".wav";
  }
  if (normalizedMediaType === "audio/mpeg") {
    return ".mp3";
  }
  if (normalizedMediaType === "audio/ogg") {
    return ".ogg";
  }
  if (normalizedMediaType === "audio/flac") {
    return ".flac";
  }
  if (normalizedMediaType === "audio/mp4" || normalizedMediaType === "audio/aac") {
    return ".m4a";
  }
  return ".bin";
}

async function readJsonRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DesktopWebControlPlaneError("request body must be valid JSON", {
      httpStatus: 400,
      errorCode: WEB_UI_ERROR_CODE.INVALID_REQUEST
    });
  }
}

async function maybeCall(operation) {
  if (typeof operation !== "function") {
    return null;
  }
  return await operation();
}

export class DesktopWebControlPlaneServer {
  constructor({
    operations,
    staticRoot = DEFAULT_PUBLIC_ROOT,
    uploadRoot = DEFAULT_UPLOAD_ROOT,
    host = "127.0.0.1",
    port = 0
  }) {
    this._operations = operations;
    this._staticRoot = staticRoot;
    this._uploadRoot = uploadRoot;
    this._host = host;
    this._port = port;
    this._server = null;
    this._address = null;
    this._sseClients = new Set();
    this._trackedUploadPaths = new Set();
  }

  getOrigin() {
    if (!this._address) {
      throw new Error("desktop web control plane server is not started");
    }
    return `http://${this._address.address}:${this._address.port}`;
  }

  async start() {
    if (this._server) {
      return this.getOrigin();
    }
    this._server = http.createServer(async (request, response) => {
      await this._handleRequest(request, response);
    });
    await new Promise((resolve, reject) => {
      this._server.once("error", reject);
      this._server.listen(this._port, this._host, () => {
        this._server.off("error", reject);
        resolve();
      });
    });
    this._address = this._server.address();
    return this.getOrigin();
  }

  async close() {
    for (const client of this._sseClients) {
      client.response.end();
    }
    this._sseClients.clear();
    if (!this._server) {
      await this._cleanupTrackedUploads();
      return;
    }
    await new Promise((resolve, reject) => {
      this._server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this._server = null;
    this._address = null;
    await this._cleanupTrackedUploads();
  }

  publishTranscriptSnapshot(snapshot) {
    this._publishSseEvent(WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT, snapshot);
  }

  publishProviderReadiness(readiness) {
    this._publishSseEvent(WEB_UI_SSE_EVENT.PROVIDER_READINESS, readiness);
  }

  publishDebugUpdate(update) {
    this._publishSseEvent(
      WEB_UI_SSE_EVENT.DEBUG_UPDATE,
      update?.category ? update : buildDebugUpdatePayload(update)
    );
  }

  async _handleRequest(request, response) {
    try {
      const requestUrl = new URL(
        request.url || "/",
        `http://${request.headers.host || "127.0.0.1"}`
      );
      if (
        request.method === "GET" &&
        (requestUrl.pathname === WEB_UI_API_ROUTE.INDEX ||
          requestUrl.pathname === "/index.html")
      ) {
        await this._serveStaticFile("index.html", response);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === WEB_UI_API_ROUTE.EVENTS) {
        await this._handleSseRequest(response);
        return;
      }
      if (
        request.method === "GET" &&
        !requestUrl.pathname.startsWith("/api/") &&
        requestUrl.pathname !== "/"
      ) {
        await this._serveStaticFile(requestUrl.pathname.slice(1), response);
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === WEB_UI_API_ROUTE.PROVIDER_SETTINGS) {
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.loadProviderSettings())
        );
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY
      ) {
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.loadAvatarModelLibrary())
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === WEB_UI_API_ROUTE.AVATAR_MODEL_LIBRARY
      ) {
        const rawPayload = await readJsonRequestBody(request);
        const payload = parseAvatarModelSelectionSavePayload(rawPayload);
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.saveAvatarModelSelection(payload))
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === WEB_UI_API_ROUTE.PROVIDER_SETTINGS) {
        const rawPayload = await readJsonRequestBody(request);
        const payload = parseProviderSettingsSavePayload(rawPayload);
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.saveProviderSettings(payload))
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === WEB_UI_API_ROUTE.PROVIDER_SETTINGS_VALIDATE
      ) {
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.validateProviderSettings())
        );
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === WEB_UI_API_ROUTE.PROVIDER_READINESS) {
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.getProviderReadiness())
        );
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === WEB_UI_API_ROUTE.DESKTOP_STATE) {
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.snapshotDesktopState())
        );
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === WEB_UI_API_ROUTE.TEXT_TURNS) {
        const rawPayload = await readJsonRequestBody(request);
        const payload = parseTextTurnSubmitPayload(rawPayload);
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.submitTextTurn(payload))
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === WEB_UI_API_ROUTE.TTS_VOICE_ENROLLMENT_UPLOAD
      ) {
        const rawPayload = await readJsonRequestBody(request);
        const payload = parseTTSVoiceEnrollmentUploadPayload(rawPayload);
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._persistVoiceEnrollmentUpload(payload))
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === WEB_UI_API_ROUTE.TTS_VOICE_ENROLLMENT
      ) {
        const rawPayload = await readJsonRequestBody(request);
        const payload = parseTTSVoiceEnrollmentPayload(rawPayload);
        await this._writeJson(
          response,
          200,
          buildJsonSuccess(await this._operations.runTtsVoiceEnrollment(payload))
        );
        return;
      }
      if (requestUrl.pathname.startsWith("/api/")) {
        throw new DesktopWebControlPlaneError(
          `route '${requestUrl.pathname}' was not found`,
          { httpStatus: 404, errorCode: WEB_UI_ERROR_CODE.NOT_FOUND }
        );
      }
      throw new DesktopWebControlPlaneError(
        `static asset '${requestUrl.pathname}' was not found`,
        { httpStatus: 404, errorCode: WEB_UI_ERROR_CODE.NOT_FOUND }
      );
    } catch (error) {
      const responseError =
        error instanceof DesktopWebControlPlaneError
          ? error
          : new DesktopWebControlPlaneError(
              error instanceof Error ? error.message : String(error),
              {
                httpStatus: 500,
                errorCode: WEB_UI_ERROR_CODE.INTERNAL_ERROR
              }
            );
      await this._writeJson(
        response,
        responseError.httpStatus,
        buildJsonError({
          errorCode: responseError.errorCode,
          message: responseError.message
        })
      );
    }
  }

  async _persistVoiceEnrollmentUpload(payload) {
    const fileBytes = Buffer.from(payload.data_base64, "base64");
    if (fileBytes.length === 0) {
      throw new DesktopWebControlPlaneError("uploaded audio file must not be empty");
    }
    await fs.mkdir(this._uploadRoot, { recursive: true });
    const fileExtension = sanitizeUploadExtension(payload.file_name, payload.media_type);
    const persistedPath = path.join(
      this._uploadRoot,
      `${crypto.randomUUID()}${fileExtension}`
    );
    await fs.writeFile(persistedPath, fileBytes);
    this._trackedUploadPaths.add(persistedPath);
    return {
      persisted_reference_audio_path: persistedPath,
      original_file_name: payload.file_name,
      media_type: payload.media_type,
      byte_size: fileBytes.length
    };
  }

  async _cleanupTrackedUploads() {
    const deleteTasks = [];
    for (const uploadPath of this._trackedUploadPaths) {
      deleteTasks.push(
        fs.unlink(uploadPath).catch(() => {})
      );
    }
    this._trackedUploadPaths.clear();
    await Promise.all(deleteTasks);
  }

  async _serveStaticFile(relativePath, response) {
    const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[\\/])+/, "");
    const absolutePath = path.resolve(this._staticRoot, normalizedPath);
    if (!absolutePath.startsWith(path.resolve(this._staticRoot))) {
      throw new DesktopWebControlPlaneError("static path is invalid", {
        httpStatus: 404,
        errorCode: WEB_UI_ERROR_CODE.NOT_FOUND
      });
    }
    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(absolutePath);
    } catch {
      throw new DesktopWebControlPlaneError(
        `static asset '${relativePath}' was not found`,
        { httpStatus: 404, errorCode: WEB_UI_ERROR_CODE.NOT_FOUND }
      );
    }
    response.writeHead(200, {
      "content-type": resolveContentType(absolutePath),
      "cache-control": "no-store"
    });
    response.end(fileBuffer);
  }

  async _handleSseRequest(response) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    response.write(": connected\n\n");
    const client = { response };
    this._sseClients.add(client);
    response.on("close", () => {
      this._sseClients.delete(client);
    });

    const initialDesktopState = await maybeCall(this._operations.snapshotDesktopState);
    if (initialDesktopState?.companion_session_snapshot) {
      response.write(
        buildSseEventFrame({
          event: WEB_UI_SSE_EVENT.TRANSCRIPT_SNAPSHOT,
          data: initialDesktopState.companion_session_snapshot
        })
      );
    }
    const initialReadiness = await maybeCall(this._operations.getProviderReadiness);
    if (initialReadiness) {
      response.write(
        buildSseEventFrame({
          event: WEB_UI_SSE_EVENT.PROVIDER_READINESS,
          data: initialReadiness
        })
      );
    }
    const initialDebugState = await maybeCall(this._operations.getDebugState);
    if (initialDebugState) {
      response.write(
        buildSseEventFrame({
          event: WEB_UI_SSE_EVENT.DEBUG_UPDATE,
          data: initialDebugState
        })
      );
    }
  }

  _publishSseEvent(event, data) {
    const frame = buildSseEventFrame({ event, data });
    for (const client of this._sseClients) {
      client.response.write(frame);
    }
  }

  async _writeJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(JSON.stringify(payload));
  }
}
