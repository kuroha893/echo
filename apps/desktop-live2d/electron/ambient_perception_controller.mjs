/**
 * Ambient Perception Controller
 *
 * Orchestrates the entire ambient perception pipeline:
 *   1. Polls for desktop context changes (foreground app, window title)
 *   2. Filters Echo-owned and low-confidence contexts
 *   3. Captures a screenshot
 *   4. Builds a unified proactive prompt
 *   5. Submits to the companion service via callback
 *   6. Enforces cooldowns, throttling, and repetition suppression
 *
 * See docs/llm/ambient-perception.md for the full architecture.
 */

import { collectDesktopContext } from "./desktop_context_service.mjs";
import { ScreenCaptureService } from "./screen_capture_service.mjs";

const INTERACTION_CADENCE = Object.freeze({
    minGapMs: 12_000,
    sameAppCooldownMs: 12_000,
    maxPer10Min: 40,
    silenceAfterUserSpeakMs: 6_000,
    sameSceneCooldownMs: 90_000,
    heartbeatSameSceneCooldownMs: 180_000,
});

// Polling interval for detecting desktop context changes
const CONTEXT_POLL_INTERVAL_MS = 3_000;

// Fallback heartbeat — fire even if no change detected
const HEARTBEAT_INTERVAL_MS = 15_000;

const LOW_CONFIDENCE_CONTEXT_HOLD_MS = 90_000;
const MIN_VISUAL_CHANGE_DISTANCE = 10;
const MIN_LUMA_PROFILE_DELTA = 12;
const MIN_GRAYSCALE_GRID_DELTA = 18;

// ── Prompt templates ────────────────────────────────────────────────────────

/**
 * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
 * @returns {string}
 */
function buildAmbientPrompt(ctx) {
    const previousCommentLine =
        ctx.previousAmbientCommentText && ctx.previousAmbientCommentText.trim() !== ""
            ? `上一条环境评论（避免同义复述）: ${ctx.previousAmbientCommentText}\n\n`
            : "";
    const urlLine = ctx.url ? `URL: ${ctx.url}\n` : "";
    return (
        `[环境感知]\n` +
        `用户正在使用: ${ctx.appName}\n` +
        `窗口标题: ${ctx.windowTitle}\n` +
        urlLine +
        `\n` +
        previousCommentLine +
        `请先判断当前画面相对上一次环境感知是否真的出现了新的可聊信息。` +
        `如果只是同一直播、同一视频、同一网页、同一对局继续播放，且没有新的明显变化、` +
        `新的笑点、槽点、信息点或剧情推进，直接回复 [沉默]。` +
        `只有在你确实观察到新内容时，才自然地主动发表评论、吐槽、提问、联想或接梗。` +
        `如果你准备说的话和上一条环境评论只是同义复述、换个说法重复、` +
        `或只是重复同一个观察点，也直接回复 [沉默]。` +
        `默认保持轻松直接、朋友式互动。` +
        `如果当前画面没有明显可聊点，回复 [沉默] 即可。`
    );
}

function normalizeSceneFragment(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\uFFFD/g, "")
        .replace(/\s+/g, " ")
        .replace(/[|]/g, " ")
        .replace(/\s*[-–—]\s*(google chrome|chrome|microsoft edge|edge|firefox|brave)$/i, "")
        .trim();
}

function buildSceneKey(ctx) {
    return [
        normalizeSceneFragment(ctx.appName),
        normalizeSceneFragment(ctx.windowTitle),
        normalizeSceneFragment(ctx.url),
    ].join("|");
}

function computeHammingDistance(left, right) {
    if (!left || !right || left.length !== right.length) {
        return Number.POSITIVE_INFINITY;
    }
    let distance = 0;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            distance += 1;
        }
    }
    return distance;
}

function hasMeaningfulVisualChange(previousFingerprint, nextFingerprint) {
    if (!previousFingerprint || !nextFingerprint) {
        return false;
    }
    return computeHammingDistance(previousFingerprint, nextFingerprint) >= MIN_VISUAL_CHANGE_DISTANCE;
}

function computeProfileDelta(previousProfile, nextProfile) {
    if (!Array.isArray(previousProfile) || !Array.isArray(nextProfile)) {
        return Number.POSITIVE_INFINITY;
    }
    if (previousProfile.length === 0 || previousProfile.length !== nextProfile.length) {
        return Number.POSITIVE_INFINITY;
    }
    let totalDelta = 0;
    for (let index = 0; index < previousProfile.length; index += 1) {
        totalDelta += Math.abs((previousProfile[index] || 0) - (nextProfile[index] || 0));
    }
    return totalDelta / previousProfile.length;
}

function hasMeaningfulProfileChange(previousProfile, nextProfile) {
    const delta = computeProfileDelta(previousProfile, nextProfile);
    if (!Number.isFinite(delta)) {
        return false;
    }
    return delta >= MIN_LUMA_PROFILE_DELTA;
}

function computeGridDelta(previousGrid, nextGrid) {
    if (!Array.isArray(previousGrid) || !Array.isArray(nextGrid)) {
        return Number.POSITIVE_INFINITY;
    }
    if (previousGrid.length === 0 || previousGrid.length !== nextGrid.length) {
        return Number.POSITIVE_INFINITY;
    }
    let totalDelta = 0;
    for (let index = 0; index < previousGrid.length; index += 1) {
        totalDelta += Math.abs((previousGrid[index] || 0) - (nextGrid[index] || 0));
    }
    return totalDelta / previousGrid.length;
}

function hasMeaningfulGridChange(previousGrid, nextGrid) {
    const delta = computeGridDelta(previousGrid, nextGrid);
    if (!Number.isFinite(delta)) {
        return false;
    }
    return delta >= MIN_GRAYSCALE_GRID_DELTA;
}

function normalizeAmbientCommentText(text) {
    return String(text || "")
        .replace(/\[沉默\]|\[silence\]/gi, "")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function extractLatestAssistantText(result) {
    const runResults = Array.isArray(result?.run_results) ? result.run_results : [];
    const latestRunResult = runResults[runResults.length - 1] || null;
    const turnId = latestRunResult?.turn_context?.turn_id || null;
    const snapshot = latestRunResult?.final_companion_session_snapshot
        || result?.final_desktop_snapshot?.companion_session_snapshot
        || null;
    const transcriptEntries = Array.isArray(snapshot?.transcript_entries)
        ? snapshot.transcript_entries
        : [];
    const assistantEntries = transcriptEntries
        .filter((entry) => entry?.role === "assistant")
        .filter((entry) => !turnId || entry?.turn_id === turnId)
        .filter((entry) => entry?.is_streaming === false)
        .sort((left, right) => (left?.sequence_index || 0) - (right?.sequence_index || 0));
    const latestEntry = assistantEntries[assistantEntries.length - 1] || null;
    return normalizeAmbientCommentText(latestEntry?.raw_text || latestEntry?.text || "");
}

// ── Controller ──────────────────────────────────────────────────────────────

export class AmbientPerceptionController {
    /**
     * @param {object} options
     * @param {(text: string, opts: { images: Array<object> }) => Promise<any>} options.onSubmit
     *   Callback to submit text + images to the companion service.
     * @param {() => string} options.getSessionState
     *   Returns current session state ("idle", "listening", "thinking", "speaking", etc.)
     * @param {(category: string, action: string, detail: any) => void} [options.onDebug]
     *   Optional debug event publisher.
     */
    constructor({ onSubmit, getSessionState, onDebug }) {
        this._onSubmit = onSubmit;
        this._getSessionState = getSessionState;
        this._onDebug = onDebug || (() => { });

        this._screenCapture = new ScreenCaptureService();

        this._running = false;
        this._contextPollTimer = null;
        this._heartbeatTimer = null;

        // Last known desktop context for change detection
        this._lastContext = null;
        this._lastExternalContext = null;
        this._lastExternalContextAt = 0;

        // Throttle state
        this._lastCommentTimestamp = 0;
        this._lastCommentByApp = new Map(); // appName → timestamp
        this._commentTimestamps = []; // recent comment timestamps for rate limiting
        this._lastCommentSceneKey = "";
        this._lastCommentSceneAt = 0;
        this._lastCommentVisualFingerprint = "";
        this._lastCommentLumaProfile = [];
        this._lastCommentGrayscaleGrid = [];
        this._lastAmbientAssistantText = "";

        // Last user speech timestamp (set externally)
        this._lastUserSpeechTimestamp = 0;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────

    start() {
        if (this._running) return;
        this._running = true;

        this._contextPollTimer = setInterval(() => {
            this._pollContextChange();
        }, CONTEXT_POLL_INTERVAL_MS);

        this._heartbeatTimer = setInterval(() => {
            this._onHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);

        this._onDebug("ambient_perception", "started", null);
    }

    stop() {
        this._running = false;
        if (this._contextPollTimer !== null) {
            clearInterval(this._contextPollTimer);
            this._contextPollTimer = null;
        }
        if (this._heartbeatTimer !== null) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        this._onDebug("ambient_perception", "stopped", null);
    }

    /**
     * Notify the controller that the user just spoke (for post-speech silence).
     */
    notifyUserSpeech() {
        this._lastUserSpeechTimestamp = Date.now();
    }

    /**
     * Trigger a one-shot perception cycle (e.g. from tray menu "立即观察").
     */
    async triggerOnce() {
        const rawCtx = await collectDesktopContext();
        const ctx = this._stabilizeContext(rawCtx);
        await this._executePerceptionCycle(ctx, true, "manual");
    }

    // ── Internal: polling and heartbeat ─────────────────────────────────────

    async _pollContextChange() {
        if (!this._running) return;

        const rawCtx = await collectDesktopContext();
        const ctx = this._stabilizeContext(rawCtx);

        // Detect meaningful change
        const changed = this._isContextChanged(ctx);
        if (!changed) return;

        this._lastContext = ctx;
        await this._executePerceptionCycle(ctx, false, "change");
    }

    async _onHeartbeat() {
        if (!this._running) return;

        const rawCtx = await collectDesktopContext();
        const ctx = this._stabilizeContext(rawCtx);
        this._lastContext = ctx;
        await this._executePerceptionCycle(ctx, false, "heartbeat");
    }

    // ── Internal: change detection ──────────────────────────────────────────

    /**
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
     * @returns {boolean}
     */
    _isContextChanged(ctx) {
        if (!this._lastContext) return true;
        if (this._lastContext.appName !== ctx.appName) return true;
        if (this._lastContext.windowTitle !== ctx.windowTitle) return true;
        return false;
    }

    /**
     * Reuse the last reliable external context when Echo samples one of its own
     * windows or another low-confidence generic shell context.
     *
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
     * @returns {import("./desktop_context_service.mjs").DesktopContext}
     */
    _stabilizeContext(ctx) {
        if (ctx.confidence === "high" && !ctx.isOwnWindow) {
            this._lastExternalContext = ctx;
            this._lastExternalContextAt = Date.now();
            return ctx;
        }

        if (!this._lastExternalContext) {
            return ctx;
        }

        if (Date.now() - this._lastExternalContextAt > LOW_CONFIDENCE_CONTEXT_HOLD_MS) {
            return ctx;
        }

        if (!ctx.isOwnWindow && !ctx.isGenericShell) {
            return ctx;
        }

        this._onDebug("ambient_perception", "stabilized_foreground_context", {
            suppressed_app: ctx.appName,
            suppressed_title: ctx.windowTitle,
            reused_app: this._lastExternalContext.appName,
            reused_title: this._lastExternalContext.windowTitle,
        });

        return {
            ...this._lastExternalContext,
            idleSeconds: ctx.idleSeconds,
            timestampUtc: ctx.timestampUtc,
        };
    }

    // ── Internal: perception cycle ──────────────────────────────────────────

    /**
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
    * @param {boolean} forced - If true, skip throttle checks
    * @param {"manual" | "change" | "heartbeat"} source
     */
    async _executePerceptionCycle(ctx, forced, source) {
        // Session state guard: only fire when idle
        const sessionState = this._getSessionState();
        if (sessionState !== "idle") {
            this._onDebug("ambient_perception", "skipped_session_busy", {
                state: sessionState,
            });
            return;
        }

        if (ctx.isOwnWindow) {
            this._onDebug("ambient_perception", "skipped_own_window", {
                app: ctx.appName,
                title: ctx.windowTitle,
            });
            return;
        }

        // Throttle checks (skip if forced)
        if (!forced && !this._passesThrottle(ctx, source)) {
            return;
        }

        const prompt = buildAmbientPrompt({
            ...ctx,
            previousAmbientCommentText: this._lastAmbientAssistantText,
        });

        const images = [];
        const capture = await this._screenCapture.captureScreen();
        const visualFingerprint = capture?.visualFingerprint || "";
        const lumaProfile = Array.isArray(capture?.lumaProfile) ? capture.lumaProfile : [];
        const grayscaleGrid = Array.isArray(capture?.grayscaleGrid) ? capture.grayscaleGrid : [];
        if (!forced && !this._passesVisualChangeGate(ctx, source, visualFingerprint, lumaProfile, grayscaleGrid)) {
            return;
        }
        if (capture?.attachment) {
            images.push(capture.attachment);
        }

        // Submit
        try {
            const result = await this._onSubmit(prompt, { images });
            this._recordComment(ctx, visualFingerprint, lumaProfile, grayscaleGrid, extractLatestAssistantText(result));
            this._onDebug("ambient_perception", "submitted", {
                app: ctx.appName,
                source,
                hasScreenshot: images.length > 0,
            });
        } catch (error) {
            console.error("[ambient-perception] submit failed:", error);
        }
    }

    // ── Internal: throttle logic ────────────────────────────────────────────

    /**
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
     * @param {"manual" | "change" | "heartbeat"} source
     * @returns {boolean}
     */
    _passesThrottle(ctx, source) {
        const params = INTERACTION_CADENCE;
        const now = Date.now();

        // 1. Post-speech silence
        if (now - this._lastUserSpeechTimestamp < params.silenceAfterUserSpeakMs) {
            this._onDebug("ambient_perception", "throttled_post_speech", null);
            return false;
        }

        // 2. Minimum gap between comments
        if (now - this._lastCommentTimestamp < params.minGapMs) {
            this._onDebug("ambient_perception", "throttled_min_gap", null);
            return false;
        }

        // 3. Same-app cooldown
        const lastForApp = this._lastCommentByApp.get(ctx.appName);
        if (lastForApp && now - lastForApp < params.sameAppCooldownMs) {
            this._onDebug("ambient_perception", "throttled_same_app", {
                app: ctx.appName,
            });
            return false;
        }

        // 4. Rate limit: max comments per 10 minutes
        const tenMinAgo = now - 10 * 60 * 1000;
        this._commentTimestamps = this._commentTimestamps.filter(
            (ts) => ts > tenMinAgo
        );
        if (this._commentTimestamps.length >= params.maxPer10Min) {
            this._onDebug("ambient_perception", "throttled_rate_limit", {
                count: this._commentTimestamps.length,
            });
            return false;
        }

        return true;
    }

    /**
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
     * @param {"manual" | "change" | "heartbeat"} source
     * @param {string} visualFingerprint
     * @param {number[]} lumaProfile
     * @param {number[]} grayscaleGrid
     * @returns {boolean}
     */
    _passesVisualChangeGate(ctx, source, visualFingerprint, lumaProfile, grayscaleGrid) {
        const sceneKey = buildSceneKey(ctx);
        if (sceneKey === "" || sceneKey !== this._lastCommentSceneKey) {
            return true;
        }

        if (
            hasMeaningfulVisualChange(this._lastCommentVisualFingerprint, visualFingerprint)
            || hasMeaningfulProfileChange(this._lastCommentLumaProfile, lumaProfile)
            || hasMeaningfulGridChange(this._lastCommentGrayscaleGrid, grayscaleGrid)
        ) {
            this._onDebug("ambient_perception", "same_scene_visual_change_detected", {
                app: ctx.appName,
                source,
            });
            return true;
        }

        const cooldownMs =
            source === "heartbeat"
                ? INTERACTION_CADENCE.heartbeatSameSceneCooldownMs
                : INTERACTION_CADENCE.sameSceneCooldownMs;

        if (Date.now() - this._lastCommentSceneAt < cooldownMs) {
            this._onDebug("ambient_perception", "throttled_same_scene_static", {
                app: ctx.appName,
                source,
            });
            return false;
        }

        return true;
    }

    /**
     * @param {import("./desktop_context_service.mjs").DesktopContext} ctx
     * @param {string} visualFingerprint
     * @param {number[]} lumaProfile
     * @param {number[]} grayscaleGrid
     * @param {string} assistantText
     */
    _recordComment(ctx, visualFingerprint, lumaProfile, grayscaleGrid, assistantText) {
        const now = Date.now();
        this._lastCommentTimestamp = now;
        this._lastCommentByApp.set(ctx.appName, now);
        this._commentTimestamps.push(now);
        this._lastCommentSceneKey = buildSceneKey(ctx);
        this._lastCommentSceneAt = now;
        this._lastCommentVisualFingerprint = visualFingerprint;
        this._lastCommentLumaProfile = Array.isArray(lumaProfile) ? lumaProfile : [];
        this._lastCommentGrayscaleGrid = Array.isArray(grayscaleGrid) ? grayscaleGrid : [];
        if (assistantText !== "") {
            this._lastAmbientAssistantText = assistantText;
        }
    }
}
