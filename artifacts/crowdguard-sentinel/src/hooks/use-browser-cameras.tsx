import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { serviceConfig } from "@/services/config";
import type { Camera } from "@/types/sentinel";
import {
  applyPersonNMS,
  calculateSyncCorrection,
  clamp,
  computeCameraRiskScores,
  computeOccupiedAreaRatio,
  type CameraAnalysisMetrics,
  type FilteredPersonDetection,
  type RawDetection,
} from "@/lib/cv-detection";

export type StationStatus =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "READY"
  | "LOADING_AI"
  | "BUFFERING"
  | "CONNECTING"
  | "RUNNING"
  | "ERROR";

export type CameraSourceMode = "LIVE_CAMERAS" | "DEMO_VIDEOS";

type PersonModel = {
  detect(
    input: HTMLVideoElement | HTMLCanvasElement,
    maxNumBoxes?: number,
  ): Promise<RawDetection[]>;
  dispose?(): void;
};

type RuntimeCamera = {
  camera: Camera;
  sourceMode: CameraSourceMode;
  deviceId?: string;
  stream?: MediaStream;
  objectUrl?: string;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  lastAnalyzedAt: number;
  lastRisk: number;
  lastFramePublishedAt: number;
  networkInFlight: boolean;
  inferenceDurationMs: number;
  publishLatencyMs: number;
  syncDriftMs: number;
  skippedFrames: number;
  boxes: FilteredPersonDetection[];
  hasAnalyzed: boolean;
};

export type BrowserCameraContextValue = {
  status: StationStatus;
  sourceMode: CameraSourceMode;
  devices: MediaDeviceInfo[];
  assignments: Record<string, string>;
  videoFiles: Record<string, File>;
  streams: Record<string, MediaStream>;
  videos: Record<string, HTMLVideoElement>;
  playing: Record<string, boolean>;
  metrics: Record<string, CameraAnalysisMetrics>;
  confidenceThreshold: number;
  setConfidenceThreshold(threshold: number): void;
  error: string;
  prepare(cameras: Camera[]): Promise<void>;
  setSourceMode(mode: CameraSourceMode): void;
  setAssignment(cameraId: string, deviceId: string): void;
  setVideoFile(cameraId: string, file?: File): void;
  start(cameras: Camera[]): Promise<void>;
  playAll(): Promise<void>;
  pauseAll(): Promise<void>;
  restartAll(): Promise<void>;
  playOne(cameraId: string): Promise<void>;
  pauseOne(cameraId: string): Promise<void>;
  restartOne(cameraId: string): Promise<void>;
  stop(): void;
};

const BrowserCameraContext = createContext<BrowserCameraContextValue | null>(
  null,
);

const STORAGE_KEY = "crowdguard.browser-camera-assignments.v1";
const ANALYSIS_WIDTH = 300;
const ANALYSIS_TICKS_PER_SECOND = 12;
const FRAME_PUBLISH_INTERVAL_MS = 1_000;
const MODEL_PATH = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/person_model/model.json`;
const SYNC_TOLERANCE_SECONDS = 0.2; // 200 ms sync tolerance window

let modelPromise: Promise<PersonModel> | null = null;

async function createPersonModel(): Promise<PersonModel> {
  const [tf, cocoSsd] = await Promise.all([
    import("@tensorflow/tfjs"),
    import("@tensorflow-models/coco-ssd"),
  ]);

  if (tf.getBackend() !== "webgl") {
    try {
      await tf.setBackend("webgl");
    } catch {
      await tf.setBackend("cpu");
    }
  }
  await tf.ready();

  const model = await cocoSsd.load({
    base: "lite_mobilenet_v2",
    modelUrl: MODEL_PATH,
  });

  return model as unknown as PersonModel;
}

function loadPersonModel(): Promise<PersonModel> {
  modelPromise ??= createPersonModel();
  return modelPromise.catch((reason) => {
    modelPromise = null;
    throw reason;
  });
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) =>
    window.setTimeout(resolve, milliseconds),
  );
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Camera frame could not be encoded")),
      "image/jpeg",
      0.72,
    );
  });
}

function readableCameraError(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === "NotAllowedError")
      return "Camera permission was denied. Allow camera access in the browser address bar and try again.";
    if (reason.name === "NotFoundError")
      return "A selected camera is no longer connected.";
    if (reason.name === "NotReadableError")
      return "A selected camera is already being used by another application.";
  }
  return reason instanceof Error
    ? reason.message
    : "The browser camera station stopped unexpectedly.";
}

function createWarmingMetric(runtime: RuntimeCamera): CameraAnalysisMetrics {
  return {
    cameraId: runtime.camera.id,
    timestamp: new Date().toISOString(),
    peopleCount: 0,
    confidence: 0,
    fps: 0,
    occupiedAreaRatio: 0,
    densityScore: 0,
    congestionScore: 0,
    riskScore: 0,
    trend: "UNAVAILABLE",
    boxes: [],
    inferenceDurationMs: 0,
    publishLatencyMs: 0,
    syncDriftMs: 0,
    skippedFrames: 0,
    isWarmingUp: true,
  };
}
async function sendDemoControl(
  action: "START" | "PAUSE" | "RESTART" | "STOP",
  cameraIds: string[],
) {
  const apiBase = serviceConfig.apiBaseUrl.replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(apiBase + "/demo/video-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, camera_ids: cameraIds }),
      signal: controller.signal,
    });
    if (response.ok) return;

    if (response.status === 404 || response.status === 405) {
      if (action === "RESTART") {
        await fetch(apiBase + "/system/clear-live-data", {
          method: "POST",
        }).catch(() => undefined);
      }
      return;
    }
  } catch (err) {
    // Offline backend should not crash frontend demonstration.
    console.warn("Backend camera-control notification deferred", err);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function BrowserCameraProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StationStatus>("IDLE");
  const [sourceMode, setSourceModeState] =
    useState<CameraSourceMode>("LIVE_CAMERAS");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [videoFiles, setVideoFiles] = useState<Record<string, File>>({});
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [videos, setVideos] = useState<Record<string, HTMLVideoElement>>({});
  const [playing, setPlaying] = useState<Record<string, boolean>>({});
  const [metrics, setMetrics] = useState<Record<string, CameraAnalysisMetrics>>(
    {},
  );
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.48);
  const [error, setError] = useState("");

  const runningRef = useRef(false);
  const runtimesRef = useRef<RuntimeCamera[]>([]);
  const generationRef = useRef(0);
  const confidenceRef = useRef(confidenceThreshold);
  confidenceRef.current = confidenceThreshold;

  // Preload model on startup
  useEffect(() => {
    const preloadTimer = window.setTimeout(() => {
      void loadPersonModel().catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(preloadTimer);
  }, []);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    generationRef.current += 1;
    for (const runtime of runtimesRef.current) {
      runtime.stream?.getTracks().forEach((track) => track.stop());
      runtime.video.pause();
      runtime.video.srcObject = null;
      runtime.video.removeAttribute("src");
      runtime.video.load();
      if (runtime.objectUrl) URL.revokeObjectURL(runtime.objectUrl);
    }
    runtimesRef.current = [];
    setStreams({});
    setVideos({});
    setPlaying({});
    setMetrics({});
  }, []);

  const stop = useCallback(() => {
    const cameraIds = runtimesRef.current.map((runtime) => runtime.camera.id);
    if (cameraIds.length) {
      void sendDemoControl("STOP", cameraIds).catch(() => undefined);
    }
    cleanup();
    setError("");
    setStatus("IDLE");
  }, [cleanup]);

  useEffect(() => cleanup, [cleanup]);

  const prepare = useCallback(async (cameras: Camera[]) => {
    setError("");
    if (
      !window.isSecureContext &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      setStatus("ERROR");
      setError(
        "Direct cameras require HTTPS. Open the secure deployed website.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("ERROR");
      setError("This browser does not support direct camera access.");
      return;
    }
    setStatus("REQUESTING_PERMISSION");
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const available = (
        await navigator.mediaDevices.enumerateDevices()
      ).filter((device) => device.kind === "videoinput");
      if (!available.length)
        throw new Error("No physical cameras were found on this computer.");
      const validIds = new Set(available.map((device) => device.deviceId));
      let saved: Record<string, string> = {};
      try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
          string,
          string
        >;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
      const used = new Set<string>();
      const next: Record<string, string> = {};
      for (const camera of cameras) {
        const savedId = saved[camera.id];
        const deviceId =
          savedId && validIds.has(savedId) && !used.has(savedId)
            ? savedId
            : available.find((device) => !used.has(device.deviceId))?.deviceId;
        if (deviceId) {
          next[camera.id] = deviceId;
          used.add(deviceId);
        }
      }
      setDevices(available);
      setAssignments(next);
      setStatus("READY");
    } catch (reason) {
      setStatus("ERROR");
      setError(readableCameraError(reason));
    }
  }, []);

  const setSourceMode = useCallback(
    (mode: CameraSourceMode) => {
      if (mode === sourceMode) return;
      stop();
      setSourceModeState(mode);
      setError("");
    },
    [sourceMode, stop],
  );

  const setAssignment = useCallback((cameraId: string, deviceId: string) => {
    setAssignments((current) => ({ ...current, [cameraId]: deviceId }));
  }, []);

  const setVideoFile = useCallback((cameraId: string, file?: File) => {
    setVideoFiles((current) => {
      const next = { ...current };
      if (file) next[cameraId] = file;
      else delete next[cameraId];
      return next;
    });
  }, []);

  const analyzeRuntime = useCallback(
    async (runtime: RuntimeCamera, model: PersonModel) => {
      const inferenceStart = performance.now();
      const sourceWidth = runtime.video.videoWidth || 640;
      const sourceHeight = runtime.video.videoHeight || 360;
      const targetWidth = Math.min(ANALYSIS_WIDTH, sourceWidth);
      const targetHeight = Math.max(
        1,
        Math.round((sourceHeight / sourceWidth) * targetWidth),
      );

      if (
        runtime.canvas.width !== targetWidth ||
        runtime.canvas.height !== targetHeight
      ) {
        runtime.canvas.width = targetWidth;
        runtime.canvas.height = targetHeight;
      }

      const context = runtime.canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Camera drawing surface is unavailable");
      context.drawImage(runtime.video, 0, 0, targetWidth, targetHeight);

      const rawDetections = await model.detect(runtime.canvas, 50);
      const people = applyPersonNMS(rawDetections, confidenceRef.current, 0.4);
      runtime.boxes = people;
      runtime.hasAnalyzed = true;

      const occupiedAreaRatio = computeOccupiedAreaRatio(
        people,
        targetWidth,
        targetHeight,
      );

      const { densityScore, congestionScore, riskScore, trend } =
        computeCameraRiskScores(
          runtime.camera.id,
          people.length,
          occupiedAreaRatio,
          runtime.lastRisk,
        );

      const now = performance.now();
      const inferenceDuration = Math.round(now - inferenceStart);
      runtime.inferenceDurationMs = inferenceDuration;

      const fps = runtime.lastAnalyzedAt
        ? clamp(1000 / (now - runtime.lastAnalyzedAt), 0, 240)
        : 0;

      runtime.lastAnalyzedAt = now;
      runtime.lastRisk = riskScore;

      const avgConfidence = people.length
        ? people.reduce((sum, person) => sum + person.score, 0) / people.length
        : 0.75;

      const timestamp = new Date().toISOString();

      const metric: CameraAnalysisMetrics = {
        cameraId: runtime.camera.id,
        timestamp,
        peopleCount: people.length,
        confidence: Math.round(avgConfidence * 100) / 100,
        fps: Math.round(fps * 10) / 10,
        occupiedAreaRatio: Math.round(occupiedAreaRatio * 1000) / 1000,
        densityScore,
        congestionScore,
        riskScore,
        trend,
        boxes: people,
        inferenceDurationMs: inferenceDuration,
        publishLatencyMs: runtime.publishLatencyMs,
        syncDriftMs: runtime.syncDriftMs,
        skippedFrames: runtime.skippedFrames,
        isWarmingUp: false,
      };

      setMetrics((current) => ({
        ...current,
        [runtime.camera.id]: metric,
      }));

      // Asynchronously publish to backend without blocking local analysis
      if (!runtime.networkInFlight) {
        runtime.networkInFlight = true;
        const apiBase = serviceConfig.apiBaseUrl.replace(/\/$/, "");
        const shouldPublishFrame =
          now - runtime.lastFramePublishedAt >= FRAME_PUBLISH_INTERVAL_MS;

        void (async () => {
          const publishStart = performance.now();
          try {
            const frameRequest = shouldPublishFrame
              ? canvasBlob(runtime.canvas).then((frame) =>
                  fetch(
                    `${apiBase}/cameras/${encodeURIComponent(runtime.camera.id)}/frame`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "image/jpeg" },
                      body: frame,
                    },
                  ),
                )
              : Promise.resolve(null);

            const observationRequest = fetch(`${apiBase}/ai/cv-observation`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                camera_id: runtime.camera.id,
                captured_at: timestamp,
                people_count: people.length,
                tracked_people: people.length,
                detection_confidence: avgConfidence,
                fps: Math.max(0.1, fps),
                density_score: densityScore,
                occupied_area_ratio: occupiedAreaRatio,
                congestion_score: congestionScore,
                risk_score: riskScore,
                trend,
                disturbance: riskScore >= 75 ? "LOCAL" : "NONE",
              }),
            });

            const [frameResponse, obsResponse] = await Promise.all([
              frameRequest,
              observationRequest,
            ]);

            if (frameResponse?.ok) runtime.lastFramePublishedAt = now;
            runtime.publishLatencyMs = Math.round(
              performance.now() - publishStart,
            );

            if (
              (frameResponse && !frameResponse.ok) ||
              (!obsResponse.ok && obsResponse.status !== 404)
            ) {
              console.warn(
                `Backend rejected camera observation (${obsResponse.status})`,
              );
            }
          } catch (reason) {
            // Background publish delayed or backend offline
          } finally {
            runtime.networkInFlight = false;
          }
        })();
      }
    },
    [],
  );

  const start = useCallback(
    async (cameras: Camera[]) => {
      const enabled = cameras.filter((camera) => camera.enabled).slice(0, 3);
      const selectedCameras = enabled.filter((camera) =>
        sourceMode === "DEMO_VIDEOS"
          ? Boolean(videoFiles[camera.id])
          : Boolean(assignments[camera.id]),
      );
      const selectedDevices = selectedCameras.map(
        (camera) => assignments[camera.id],
      );

      if (!selectedCameras.length) {
        setStatus("ERROR");
        setError(
          sourceMode === "DEMO_VIDEOS"
            ? "Select at least one recorded video to start the demonstration."
            : "Select at least one physical camera to start monitoring.",
        );
        return;
      }

      if (
        sourceMode === "LIVE_CAMERAS" &&
        new Set(selectedDevices).size !== selectedDevices.length
      ) {
        setStatus("ERROR");
        setError(
          "Each CrowdGuard camera location must use a different physical camera.",
        );
        return;
      }

      cleanup();
      setError("");
      setStatus("LOADING_AI");

      try {
        const model = await loadPersonModel();
        setStatus("BUFFERING");

        const runtimes: RuntimeCamera[] = [];

        // 1. Instantiate and configure video elements
        for (const camera of selectedCameras) {
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          video.autoplay = false;

          let deviceId: string | undefined;
          let stream: MediaStream | undefined;
          let objectUrl: string | undefined;

          if (sourceMode === "DEMO_VIDEOS") {
            objectUrl = URL.createObjectURL(videoFiles[camera.id]);
            video.src = objectUrl;
          } else {
            deviceId = assignments[camera.id];
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: { exact: deviceId },
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 30, max: 30 },
              },
              audio: false,
            });
            video.srcObject = stream;
          }

          runtimes.push({
            camera,
            sourceMode,
            deviceId,
            stream,
            objectUrl,
            video,
            canvas: document.createElement("canvas"),
            lastAnalyzedAt: 0,
            lastRisk: 0,
            lastFramePublishedAt: 0,
            networkInFlight: false,
            inferenceDurationMs: 0,
            publishLatencyMs: 0,
            syncDriftMs: 0,
            skippedFrames: 0,
            boxes: [],
            hasAnalyzed: false,
          });
        }

        runtimesRef.current = runtimes;

        // 2. Buffer all selected videos simultaneously until ready
        const bufferPromises = runtimes.map((runtime) => {
          return new Promise<void>((resolve, reject) => {
            const video = runtime.video;

            const onReady = () => {
              cleanupListeners();
              resolve();
            };

            const onError = () => {
              cleanupListeners();
              reject(
                new Error(
                  `${runtime.camera.name}: Video failed to load or decode.`,
                ),
              );
            };

            const timeout = window.setTimeout(() => {
              cleanupListeners();
              reject(
                new Error(
                  `${runtime.camera.name}: Video buffering timed out. Ensure the format is supported.`,
                ),
              );
            }, 12_000);

            function cleanupListeners() {
              window.clearTimeout(timeout);
              video.removeEventListener("canplay", onReady);
              video.removeEventListener("canplaythrough", onReady);
              video.removeEventListener("loadeddata", onReady);
              video.removeEventListener("error", onError);
            }

            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
              window.clearTimeout(timeout);
              resolve();
              return;
            }

            video.addEventListener("canplay", onReady);
            video.addEventListener("canplaythrough", onReady);
            video.addEventListener("loadeddata", onReady);
            video.addEventListener("error", onError);
          });
        });

        await Promise.all(bufferPromises);

        setStatus("CONNECTING");

        // 3. Set time to 0 and start all videos simultaneously with Promise.all
        for (const runtime of runtimes) {
          if (runtime.sourceMode === "DEMO_VIDEOS") {
            runtime.video.currentTime = 0;
          }
        }

        if (sourceMode === "DEMO_VIDEOS") {
          await sendDemoControl(
            "RESTART",
            runtimes.map((runtime) => runtime.camera.id),
          );
        }

        await Promise.all(runtimes.map((runtime) => runtime.video.play()));

        setStreams(
          Object.fromEntries(
            runtimes
              .filter((r) => r.stream)
              .map((r) => [r.camera.id, r.stream as MediaStream]),
          ),
        );
        setVideos(
          Object.fromEntries(runtimes.map((r) => [r.camera.id, r.video])),
        );
        setPlaying(
          Object.fromEntries(runtimes.map((r) => [r.camera.id, true])),
        );

        // Do not present zero as a completed detection before the first frame.
        setMetrics(
          Object.fromEntries(
            runtimes.map((runtime) => [
              runtime.camera.id,
              createWarmingMetric(runtime),
            ]),
          ),
        );
        if (sourceMode === "LIVE_CAMERAS") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
        }

        runningRef.current = true;
        const generation = ++generationRef.current;
        setStatus("RUNNING");

        // Set up video end and track disconnection listeners
        for (const runtime of runtimes) {
          runtime.video.onended = () => {
            setPlaying((current) => ({
              ...current,
              [runtime.camera.id]: false,
            }));
          };

          for (const track of runtime.stream?.getVideoTracks() ?? []) {
            track.onended = () => {
              if (!runningRef.current || generation !== generationRef.current)
                return;
              cleanup();
              setStatus("ERROR");
              setError(
                `${runtime.camera.name} was disconnected. Reconnect it and restart.`,
              );
            };
          }
        }

        // 4. Periodic synchronization monitor for multi-video playback
        const syncInterval = window.setInterval(() => {
          if (!runningRef.current || generation !== generationRef.current) {
            window.clearInterval(syncInterval);
            return;
          }

          if (sourceMode !== "DEMO_VIDEOS" || runtimes.length <= 1) return;

          // Designate first active unended video as reference master
          const master = runtimes.find(
            (r) => !r.video.paused && !r.video.ended && r.video.readyState >= 2,
          );
          if (!master) return;

          const masterTime = master.video.currentTime;

          for (const slave of runtimes) {
            if (slave === master) {
              slave.syncDriftMs = 0;
              continue;
            }
            if (slave.video.paused || slave.video.ended) continue;

            const sync = calculateSyncCorrection(
              slave.video.currentTime,
              masterTime,
              SYNC_TOLERANCE_SECONDS,
            );

            slave.syncDriftMs = sync.driftMs;

            if (
              sync.needsCorrection &&
              !slave.video.seeking &&
              slave.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            ) {
              slave.video.currentTime = masterTime;
            }
          }
        }, 250);

        // 5. Fair Round-Robin AI Inference Scheduler
        void (async () => {
          let consecutiveFailures = 0;
          const tickMilliseconds = 1000 / ANALYSIS_TICKS_PER_SECOND;
          let runtimeIndex = 0;

          while (runningRef.current && generation === generationRef.current) {
            const tickStartedAt = performance.now();
            const runtime = runtimes[runtimeIndex % runtimes.length];
            runtimeIndex += 1;

            if (!runningRef.current || generation !== generationRef.current)
              break;

            if (
              runtime.video.paused ||
              runtime.video.ended ||
              runtime.video.seeking ||
              runtime.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            ) {
              runtime.skippedFrames += 1;
              await wait(tickMilliseconds);
              continue;
            }

            try {
              await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve()),
              );
              await analyzeRuntime(runtime, model);
              consecutiveFailures = 0;
            } catch (reason) {
              consecutiveFailures += 1;
              console.warn("Camera inference frame error", reason);
              if (consecutiveFailures >= 5) {
                cleanup();
                setStatus("ERROR");
                setError(readableCameraError(reason));
                break;
              }
            }

            const remaining =
              tickMilliseconds - (performance.now() - tickStartedAt);
            await wait(Math.max(4, remaining));
          }
          window.clearInterval(syncInterval);
        })();
      } catch (reason) {
        cleanup();
        setStatus("ERROR");
        setError(readableCameraError(reason));
      }
    },
    [analyzeRuntime, assignments, cleanup, sourceMode, videoFiles],
  );

  const playOne = useCallback(async (cameraId: string) => {
    const runtime = runtimesRef.current.find(
      (candidate) => candidate.camera.id === cameraId,
    );
    if (!runtime) return;
    await runtime.video.play();
    if (runtime.sourceMode === "DEMO_VIDEOS") {
      void sendDemoControl("START", [cameraId]);
    }
    setPlaying((current) => ({ ...current, [cameraId]: true }));
  }, []);

  const pauseOne = useCallback(async (cameraId: string) => {
    const runtime = runtimesRef.current.find(
      (candidate) => candidate.camera.id === cameraId,
    );
    if (!runtime) return;
    runtime.video.pause();
    if (runtime.sourceMode === "DEMO_VIDEOS") {
      void sendDemoControl("PAUSE", [cameraId]);
    }
    setPlaying((current) => ({ ...current, [cameraId]: false }));
  }, []);

  const restartOne = useCallback(async (cameraId: string) => {
    const runtime = runtimesRef.current.find(
      (candidate) => candidate.camera.id === cameraId,
    );
    if (!runtime) return;

    runtime.video.pause();
    runtime.video.currentTime = 0;
    runtime.lastAnalyzedAt = 0;
    runtime.lastRisk = 0;
    runtime.boxes = [];
    runtime.hasAnalyzed = false;
    setMetrics((current) => ({
      ...current,
      [cameraId]: createWarmingMetric(runtime),
    }));

    if (runtime.sourceMode === "DEMO_VIDEOS") {
      await sendDemoControl("RESTART", [cameraId]);
    }
    await runtime.video.play();
    setPlaying((current) => ({ ...current, [cameraId]: true }));
  }, []);
  const playAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    const activeRuntimes = runtimes.filter((r) => !r.video.ended);

    // Sync non-ended videos to master time if paused
    const master =
      activeRuntimes.find((r) => !r.video.paused) ?? activeRuntimes[0];
    if (master && sourceMode === "DEMO_VIDEOS") {
      for (const r of activeRuntimes) {
        if (
          r !== master &&
          Math.abs(r.video.currentTime - master.video.currentTime) >
            SYNC_TOLERANCE_SECONDS
        ) {
          r.video.currentTime = master.video.currentTime;
        }
      }
    }

    await Promise.all(activeRuntimes.map((runtime) => runtime.video.play()));

    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) void sendDemoControl("START", demoIds);

    setPlaying((current) => {
      const next = { ...current };
      for (const r of activeRuntimes) next[r.camera.id] = true;
      return next;
    });
  }, [sourceMode]);

  const pauseAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    for (const runtime of runtimes) runtime.video.pause();

    setPlaying((current) => {
      const next = { ...current };
      for (const r of runtimes) next[r.camera.id] = false;
      return next;
    });

    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) void sendDemoControl("PAUSE", demoIds);
  }, []);

  const restartAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);

    for (const runtime of runtimes) {
      runtime.video.pause();
      runtime.video.currentTime = 0;
      runtime.lastAnalyzedAt = 0;
      runtime.lastRisk = 0;
      runtime.boxes = [];
      runtime.hasAnalyzed = false;
    }
    setMetrics(
      Object.fromEntries(
        runtimes.map((runtime) => [
          runtime.camera.id,
          createWarmingMetric(runtime),
        ]),
      ),
    );

    if (demoIds.length) await sendDemoControl("RESTART", demoIds);
    await Promise.all(runtimes.map((runtime) => runtime.video.play()));
    setPlaying(
      Object.fromEntries(runtimes.map((runtime) => [runtime.camera.id, true])),
    );
  }, []);
  const value = useMemo(
    () => ({
      status,
      sourceMode,
      devices,
      assignments,
      videoFiles,
      streams,
      videos,
      playing,
      metrics,
      confidenceThreshold,
      setConfidenceThreshold,
      error,
      prepare,
      setSourceMode,
      setAssignment,
      setVideoFile,
      start,
      playAll,
      pauseAll,
      restartAll,
      playOne,
      pauseOne,
      restartOne,
      stop,
    }),
    [
      status,
      sourceMode,
      devices,
      assignments,
      videoFiles,
      streams,
      videos,
      playing,
      metrics,
      confidenceThreshold,
      error,
      prepare,
      setSourceMode,
      setAssignment,
      setVideoFile,
      start,
      playAll,
      pauseAll,
      restartAll,
      playOne,
      pauseOne,
      restartOne,
      stop,
    ],
  );

  return (
    <BrowserCameraContext.Provider value={value}>
      {children}
    </BrowserCameraContext.Provider>
  );
}

export function useBrowserCameras() {
  const value = useContext(BrowserCameraContext);
  if (!value)
    throw new Error(
      "useBrowserCameras must be used inside BrowserCameraProvider",
    );
  return value;
}
