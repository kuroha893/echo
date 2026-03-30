export function createDefaultViewportMetrics() {
  return Object.freeze({
    width: 960,
    height: 960
  });
}

export function normalizeViewportMetrics(rawMetrics) {
  if (rawMetrics === null || rawMetrics === undefined) {
    return createDefaultViewportMetrics();
  }
  const width =
    Number.isFinite(rawMetrics.width) && rawMetrics.width > 0
      ? rawMetrics.width
      : 960;
  const height =
    Number.isFinite(rawMetrics.height) && rawMetrics.height > 0
      ? rawMetrics.height
      : 960;
  return Object.freeze({
    width,
    height
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampRange(value, min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return value;
  }
  if (min <= max) {
    return clamp(value, min, max);
  }
  return (min + max) / 2;
}

function computeVisibleClampRange({
  stageSize,
  marginStart,
  marginEnd,
  scaledOffset,
  scaledSize,
  minVisibleRatio
}) {
  const fullVisibleMin = marginStart - scaledOffset;
  const fullVisibleMax = stageSize - marginEnd - (scaledOffset + scaledSize);
  if (fullVisibleMin <= fullVisibleMax) {
    return { min: fullVisibleMin, max: fullVisibleMax };
  }

  const availableSize = Math.max(1, stageSize - marginStart - marginEnd);
  const requiredVisibleSize = clamp(
    scaledSize * clamp(toFiniteNumber(minVisibleRatio, 0.2), 0.05, 1),
    1,
    availableSize
  );

  return {
    min: marginStart + requiredVisibleSize - (scaledOffset + scaledSize),
    max: stageSize - marginEnd - requiredVisibleSize - scaledOffset
  };
}

export function computeModelLayout({
  viewportMetrics,
  boundsX = 0,
  boundsY = 0,
  boundsWidth = 1,
  boundsHeight = 1,
  scaleMultiplier = 1.16,
  targetWidthRatio = 0.94,
  targetHeightRatio = 0.985,
  anchorXRatio = 0.5,
  anchorYRatio = 1,
  offsetX = 0,
  offsetY = 0,
  marginX = 2,
  marginY = 0,
  minVisibleRatioX = 0.2,
  minVisibleRatioY = 0.2,
  pivotXRatio = 0.5,
  pivotYRatio = 1,
  minScale = 0.04,
  maxScale = 2
}) {
  const metrics = normalizeViewportMetrics(viewportMetrics);
  const safeBoundsWidth = Math.max(1, Math.abs(toFiniteNumber(boundsWidth, 1)));
  const safeBoundsHeight = Math.max(1, Math.abs(toFiniteNumber(boundsHeight, 1)));
  const safeBoundsX = toFiniteNumber(boundsX, 0);
  const safeBoundsY = toFiniteNumber(boundsY, 0);

  const targetWidth = metrics.width * clamp(targetWidthRatio, 0.1, 1);
  const targetHeight = metrics.height * clamp(targetHeightRatio, 0.1, 1);
  const fitScale = Math.min(targetWidth / safeBoundsWidth, targetHeight / safeBoundsHeight);
  const scale = clamp(
    fitScale * clamp(toFiniteNumber(scaleMultiplier, 1.16), 0.2, 2.5),
    Math.max(0.001, minScale),
    Math.max(Math.max(0.001, minScale), maxScale)
  );

  const pivotX = safeBoundsX + safeBoundsWidth * clamp(pivotXRatio, 0, 1);
  const pivotY = safeBoundsY + safeBoundsHeight * clamp(pivotYRatio, 0, 1);
  const scaledLeftOffset = (safeBoundsX - pivotX) * scale;
  const scaledTopOffset = (safeBoundsY - pivotY) * scale;
  const scaledWidth = safeBoundsWidth * scale;
  const scaledHeight = safeBoundsHeight * scale;
  const xRange = computeVisibleClampRange({
    stageSize: metrics.width,
    marginStart: Math.max(0, marginX),
    marginEnd: Math.max(0, marginX),
    scaledOffset: scaledLeftOffset,
    scaledSize: scaledWidth,
    minVisibleRatio: clamp(minVisibleRatioX, 0.05, 1)
  });
  const yRange = computeVisibleClampRange({
    stageSize: metrics.height,
    marginStart: Math.max(0, marginY),
    marginEnd: Math.max(0, marginY),
    scaledOffset: scaledTopOffset,
    scaledSize: scaledHeight,
    minVisibleRatio: clamp(minVisibleRatioY, 0.05, 1)
  });
  const positionX = clampRange(
    metrics.width * clamp(anchorXRatio, 0, 1) + toFiniteNumber(offsetX, 0),
    xRange.min,
    xRange.max
  );
  const positionY = clampRange(
    metrics.height * clamp(anchorYRatio, 0, 1) + toFiniteNumber(offsetY, 0),
    yRange.min,
    yRange.max
  );

  return Object.freeze({
    scale,
    positionX,
    positionY,
    pivotX,
    pivotY,
    stage_width: metrics.width,
    stage_height: metrics.height
  });
}

export function computeFullBodyLayout({
  viewportMetrics,
  viewportFit,
  silhouetteScale = 0.84
}) {
  const metrics = normalizeViewportMetrics(viewportMetrics);
  const scaleHint =
    typeof viewportFit.scale_hint === "number" && viewportFit.scale_hint > 0
      ? viewportFit.scale_hint
      : 0.84;
  const effectiveScale = Math.max(0.45, Math.min(1.18, scaleHint * silhouetteScale));
  const stageFit = Math.min(metrics.width * 0.78, metrics.height * 0.9);
  const baseHeight = stageFit * effectiveScale;
  const baseWidth = baseHeight * 0.56;
  return Object.freeze({
    x: metrics.width * 0.5,
    y: metrics.height * 0.92,
    width: Math.round(baseWidth),
    height: Math.round(baseHeight),
    anchor_x: 0.5,
    anchor_y: 1.0,
    stage_width: metrics.width,
    stage_height: metrics.height
  });
}
