import { desktopCapturer } from "electron";

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const FINGERPRINT_WIDTH = 8;
const FINGERPRINT_HEIGHT = 8;

function buildGrayscaleValues(thumbnail) {
    const tinyImage = thumbnail.resize({
        width: FINGERPRINT_WIDTH,
        height: FINGERPRINT_HEIGHT,
    });
    const bitmap = tinyImage.toBitmap();
    if (!bitmap || bitmap.length === 0) {
        return [];
    }

    const grayscaleValues = [];
    for (let index = 0; index < bitmap.length; index += 4) {
        const blue = bitmap[index] || 0;
        const green = bitmap[index + 1] || 0;
        const red = bitmap[index + 2] || 0;
        const grayscale = Math.round((red * 299 + green * 587 + blue * 114) / 1000);
        grayscaleValues.push(grayscale);
    }
    return grayscaleValues;
}

function buildVisualFingerprint(grayscaleValues) {
    if (grayscaleValues.length === 0) {
        return "";
    }

    const average =
        grayscaleValues.reduce((sum, value) => sum + value, 0) / grayscaleValues.length;
    let bits = "";
    for (const value of grayscaleValues) {
        bits += value >= average ? "1" : "0";
    }
    return bits;
}

function buildLumaProfile(grayscaleValues) {
    if (grayscaleValues.length !== FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT) {
        return [];
    }

    const blockSize = 2;
    const profile = [];
    for (let blockY = 0; blockY < FINGERPRINT_HEIGHT; blockY += blockSize) {
        for (let blockX = 0; blockX < FINGERPRINT_WIDTH; blockX += blockSize) {
            let sum = 0;
            let count = 0;
            for (let offsetY = 0; offsetY < blockSize; offsetY += 1) {
                for (let offsetX = 0; offsetX < blockSize; offsetX += 1) {
                    const x = blockX + offsetX;
                    const y = blockY + offsetY;
                    const index = y * FINGERPRINT_WIDTH + x;
                    sum += grayscaleValues[index] || 0;
                    count += 1;
                }
            }
            profile.push(Math.round(sum / Math.max(count, 1)));
        }
    }
    return profile;
}

function buildGrayscaleGrid(grayscaleValues) {
    if (grayscaleValues.length !== FINGERPRINT_WIDTH * FINGERPRINT_HEIGHT) {
        return [];
    }
    return grayscaleValues.map((value) => Math.max(0, Math.min(255, value || 0)));
}

/**
 * Screen capture service for ambient perception.
 *
 * Provides on-demand screen capture. The capture scheduling is now owned by
 * AmbientPerceptionController — this service only handles the low-level
 * Electron desktopCapturer interaction.
 */
export class ScreenCaptureService {
    constructor() {
        this._capturing = false;
    }

    /**
     * Capture the primary screen and return a base64-encoded PNG image attachment.
     *
    * @returns {Promise<{ attachment: { media_type: string, data: string, detail: string }, visualFingerprint: string, lumaProfile: number[], grayscaleGrid: number[] } | null>}
      *   Returns the image attachment and coarse visual signatures, or null if
      *   capture fails or is empty.
     */
    async captureScreen() {
        if (this._capturing) return null;
        this._capturing = true;
        try {
            const sources = await desktopCapturer.getSources({
                types: ["screen"],
                thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
            });
            if (sources.length === 0) return null;
            const primary = sources[0];
            const thumbnail = primary.thumbnail;
            if (thumbnail.isEmpty()) return null;
            const pngBuffer = thumbnail.toPNG();
            const base64Data = pngBuffer.toString("base64");
            const grayscaleValues = buildGrayscaleValues(thumbnail);
            return {
                attachment: {
                    media_type: "image/png",
                    data: base64Data,
                    detail: "low",
                },
                visualFingerprint: buildVisualFingerprint(grayscaleValues),
                lumaProfile: buildLumaProfile(grayscaleValues),
                grayscaleGrid: buildGrayscaleGrid(grayscaleValues),
            };
        } catch (error) {
            console.error("[screen-capture-service] capture failed:", error);
            return null;
        } finally {
            this._capturing = false;
        }
    }
}
