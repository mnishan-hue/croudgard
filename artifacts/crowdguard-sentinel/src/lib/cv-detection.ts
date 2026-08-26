export type BoundingBox = [number, number, number, number]; // [x, y, width, height]

export type RawDetection = {
  bbox: BoundingBox;
  class: string;
  score: number;
};

export type FilteredPersonDetection = {
  bbox: BoundingBox;
  score: number;
};

export type TrendDirection = "RISING" | "STABLE" | "FALLING" | "UNAVAILABLE";

export type CameraAnalysisMetrics = {
  cameraId: string;
  timestamp: string;
  peopleCount: number;
  confidence: number;
  fps: number;
  occupiedAreaRatio: number;
  densityScore: number;
  congestionScore: number;
  riskScore: number;
  trend: TrendDirection;
  boxes: FilteredPersonDetection[];
  inferenceDurationMs: number;
  publishLatencyMs: number;
  syncDriftMs: number;
  skippedFrames: number;
  isWarmingUp: boolean;
};

/**
 * Calculates the Intersection over Union (IoU) of two bounding boxes [x, y, w, h].
 */
export function calculateIoU(boxA: BoundingBox, boxB: BoundingBox): number {
  const [x1, y1, w1, h1] = boxA;
  const [x2, y2, w2, h2] = boxB;

  const left = Math.max(x1, x2);
  const top = Math.max(y1, y2);
  const right = Math.min(x1 + w1, x2 + w2);
  const bottom = Math.min(y1 + h1, y2 + h2);

  const intersectionWidth = Math.max(0, right - left);
  const intersectionHeight = Math.max(0, bottom - top);
  const intersectionArea = intersectionWidth * intersectionHeight;

  if (intersectionArea <= 0) return 0;

  const areaA = w1 * h1;
  const areaB = w2 * h2;
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

/**
 * Non-Maximum Suppression (NMS) to eliminate duplicate overlapping person detections.
 * Keeps the highest scoring box when two boxes overlap more than iouThreshold.
 */
export function applyPersonNMS(
  detections: RawDetection[],
  confidenceThreshold = 0.48,
  iouThreshold = 0.40,
): FilteredPersonDetection[] {
  const candidates = detections
    .filter(
      (d) =>
        d.class === "person" &&
        d.score >= confidenceThreshold &&
        d.bbox[2] > 2 &&
        d.bbox[3] > 2,
    )
    .map((d) => ({ bbox: d.bbox, score: d.score }))
    .sort((a, b) => b.score - a.score);

  const selected: FilteredPersonDetection[] = [];

  for (const candidate of candidates) {
    let duplicate = false;
    for (const kept of selected) {
      if (calculateIoU(candidate.bbox, kept.bbox) >= iouThreshold) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Clamps a number between minimum and maximum.
 */
export function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Computes the Occupied Area Ratio from detected bounding boxes on a frame.
 */
export function computeOccupiedAreaRatio(
  people: FilteredPersonDetection[],
  frameWidth: number,
  frameHeight: number,
): number {
  const totalFrameArea = frameWidth * frameHeight;
  if (totalFrameArea <= 0 || people.length === 0) return 0;

  const occupiedArea = people.reduce((sum, p) => {
    return sum + p.bbox[2] * p.bbox[3];
  }, 0);

  return clamp(occupiedArea / totalFrameArea, 0, 1);
}

/**
 * Calculates density, congestion, and risk scores from independent camera detections.
 */
export function computeCameraRiskScores(
  cameraId: string,
  peopleCount: number,
  occupiedAreaRatio: number,
  previousRisk: number,
): {
  densityScore: number;
  congestionScore: number;
  riskScore: number;
  trend: TrendDirection;
} {
  // Exit zones have lower capacity limits than the main open area
  const capacity = cameraId.toLowerCase().includes("exit") ? 18 : 30;

  const peopleRatio = (peopleCount / capacity) * 100;
  const areaRatio = occupiedAreaRatio * 100;
  const densityScore = clamp(Math.max(peopleRatio, areaRatio * 0.9));

  const congestionScore = clamp(densityScore * 0.82 + peopleCount * 1.6);
  const riskScore = clamp(densityScore * 0.65 + congestionScore * 0.35);

  let trend: TrendDirection = "STABLE";
  if (previousRisk > 0) {
    const delta = riskScore - previousRisk;
    if (delta >= 2.5) trend = "RISING";
    else if (delta <= -2.5) trend = "FALLING";
  }

  return {
    densityScore: Math.round(densityScore * 10) / 10,
    congestionScore: Math.round(congestionScore * 10) / 10,
    riskScore: Math.round(riskScore * 10) / 10,
    trend,
  };
}

/**
 * Checks if a slave video has drifted significantly from the master reference video clock.
 * Tolerance is 150ms to 250ms (default 200ms).
 */
export function calculateSyncCorrection(
  currentTime: number,
  masterTime: number,
  toleranceSeconds = 0.20,
): {
  needsCorrection: boolean;
  driftMs: number;
} {
  const driftSeconds = currentTime - masterTime;
  const driftMs = Math.round(driftSeconds * 1000);
  const needsCorrection = Math.abs(driftSeconds) > toleranceSeconds;

  return {
    needsCorrection,
    driftMs,
  };
}
