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

type StationStatus =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "READY"
  | "LOADING_AI"
  | "CONNECTING"
  | "RUNNING"
  | "ERROR";

type Detection = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
};

type PersonModel = {
  detect(
    input: HTMLVideoElement | HTMLCanvasElement,
    maxNumBoxes?: number,
    minScore?: number,
  ): Promise<Detection[]>;
};

export type CameraSourceMode = "LIVE_CAMERAS" | "DEMO_VIDEOS";

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
};

export type BrowserCameraMetric = {
  peopleCount: number;
  confidence: number;
  fps: number;
};

type BrowserCameraContextValue = {
  status: StationStatus;
  sourceMode: CameraSourceMode;
  devices: MediaDeviceInfo[];
  assignments: Record<string, string>;
  videoFiles: Record<string, File>;
  streams: Record<string, MediaStream>;
  videos: Record<string, HTMLVideoElement>;
  playing: Record<string, boolean>;
  metrics: Record<string, BrowserCameraMetric>;
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
const ANALYSIS_WIDTH = 416;
const ANALYSIS_TICKS_PER_SECOND = 6;
const FRAME_PUBLISH_INTERVAL_MS = 1_000;
const MODEL_PATH = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/person_model/model.json`;

let modelPromise: Promise<PersonModel> | null = null;

function loadPersonModel() {
  modelPromise ??= import("@tensorflow-models/coco-ssd").then((module) =>
    module.load({ base: "lite_mobilenet_v2", modelUrl: MODEL_PATH }),
  ) as Promise<PersonModel>;
  return modelPromise.catch((reason) => {
    modelPromise = null;
    throw reason;
  });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function canvasBlob(canvas: HTMLCanvasElement) {
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

function readableCameraError(reason: unknown) {
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

async function sendDemoControl(
  action: "START" | "PAUSE" | "RESTART" | "STOP",
  cameraIds: string[],
) {
  const apiBase = serviceConfig.apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(apiBase + "/demo/video-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, camera_ids: cameraIds }),
  });
  if (response.ok) return;

  // Keep video input usable during a rolling frontend/backend deployment.
  // Older CrowdGuard backends do not have the lifecycle route yet.
  if (response.status === 404 || response.status === 405) {
    if (action === "RESTART") {
      const resetResponse = await fetch(apiBase + "/system/clear-live-data", {
        method: "POST",
      });
      if (!resetResponse.ok) {
        throw new Error(
          "Backend rejected demo analysis reset (" + resetResponse.status + ")",
        );
      }
    }
    return;
  }

  throw new Error(
    "Backend rejected recorded-video control (" + response.status + ")",
  );
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
  const [metrics, setMetrics] = useState<Record<string, BrowserCameraMetric>>(
    {},
  );
  const [error, setError] = useState("");
  const runningRef = useRef(false);
  const runtimesRef = useRef<RuntimeCamera[]>([]);
  const generationRef = useRef(0);

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
    const demoIds = runtimesRef.current
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) {
      void sendDemoControl("STOP", demoIds).catch(() => undefined);
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
        throw new Error("No cameras were found on this computer.");
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

  const publish = useCallback(
    async (runtime: RuntimeCamera, model: PersonModel) => {
      const sourceWidth = runtime.video.videoWidth || 640;
      const sourceHeight = runtime.video.videoHeight || 360;
      const width = Math.min(ANALYSIS_WIDTH, sourceWidth);
      const height = Math.max(
        1,
        Math.round((sourceHeight / sourceWidth) * width),
      );
      runtime.canvas.width = width;
      runtime.canvas.height = height;
      const context = runtime.canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Camera drawing surface is unavailable");
      context.drawImage(runtime.video, 0, 0, width, height);
      const detections = await model.detect(runtime.canvas, 30, 0.48);
      const people = detections.filter(
        (detection) => detection.class === "person" && detection.score >= 0.55,
      );
      const scaleX = 1;
      const scaleY = 1;
      context.lineWidth = 2;
      context.font = "12px monospace";
      context.strokeStyle = "#2dd4bf";
      context.fillStyle = "#071019cc";
      for (const person of people) {
        const [x, y, boxWidth, boxHeight] = person.bbox;
        const left = x * scaleX;
        const top = y * scaleY;
        const scaledWidth = boxWidth * scaleX;
        const scaledHeight = boxHeight * scaleY;
        context.strokeRect(left, top, scaledWidth, scaledHeight);
        const label = `PERSON ${Math.round(person.score * 100)}%`;
        const labelWidth = context.measureText(label).width + 8;
        context.fillRect(left, Math.max(0, top - 18), labelWidth, 18);
        context.fillStyle = "#2dd4bf";
        context.fillText(label, left + 4, Math.max(12, top - 5));
        context.fillStyle = "#071019cc";
      }
      context.fillStyle = "#071019cc";
      context.fillRect(8, 8, 154, 25);
      context.fillStyle = "#2dd4bf";
      context.fillText(`LIVE AI · ${people.length} PEOPLE`, 15, 25);

      const occupiedArea = people.reduce((sum, person) => {
        const [, , boxWidth, boxHeight] = person.bbox;
        return sum + boxWidth * boxHeight;
      }, 0);
      const occupiedAreaRatio = clamp(
        occupiedArea / (width * height),
        0,
        1,
      );
      const capacity = runtime.camera.id.includes("exit") ? 18 : 30;
      const densityScore = clamp(
        Math.max((people.length / capacity) * 100, occupiedAreaRatio * 100),
      );
      const congestionScore = clamp(densityScore * 0.85 + people.length * 1.5);
      const riskScore = clamp(densityScore * 0.7 + congestionScore * 0.3);
      const now = performance.now();
      const fps = clamp(
        runtime.lastAnalyzedAt ? 1000 / (now - runtime.lastAnalyzedAt) : 0,
        0,
        240,
      );
      const trend =
        Math.abs(riskScore - runtime.lastRisk) < 3
          ? "STABLE"
          : riskScore > runtime.lastRisk
            ? "RISING"
            : "FALLING";
      runtime.lastAnalyzedAt = now;
      runtime.lastRisk = riskScore;
      const confidence = people.length
        ? people.reduce((sum, person) => sum + person.score, 0) / people.length
        : 0.75;
      const apiBase = serviceConfig.apiBaseUrl.replace(/\/$/, "");
      const shouldPublishFrame =
        now - runtime.lastFramePublishedAt >= FRAME_PUBLISH_INTERVAL_MS;
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
      const [frameResponse, observationResponse] = await Promise.all([
        frameRequest,
        fetch(`${apiBase}/ai/cv-observation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id: runtime.camera.id,
            people_count: people.length,
            tracked_people: people.length,
            detection_confidence: confidence,
            fps,
            density_score: densityScore,
            occupied_area_ratio: occupiedAreaRatio,
            congestion_score: congestionScore,
            risk_score: riskScore,
            trend,
            disturbance: riskScore >= 75 ? "LOCAL" : "NONE",
          }),
        }),
      ]);
      if (frameResponse?.ok) runtime.lastFramePublishedAt = now;
      if ((frameResponse && !frameResponse.ok) || !observationResponse.ok) {
        throw new Error(
          `Backend rejected camera data (${frameResponse?.status ?? "skipped"}/${observationResponse.status})`,
        );
      }
      setMetrics((current) => ({
        ...current,
        [runtime.camera.id]: {
          peopleCount: people.length,
          confidence,
          fps,
        },
      }));
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
          "Each CrowdGuard camera must use a different physical camera.",
        );
        return;
      }

      cleanup();
      setError("");
      setStatus("LOADING_AI");
      try {
        const model = await loadPersonModel();
        setStatus("CONNECTING");
        const runtimes: RuntimeCamera[] = [];
        for (const camera of selectedCameras) {
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          let deviceId: string | undefined;
          let stream: MediaStream | undefined;
          let objectUrl: string | undefined;
          const loaded = new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => reject(new Error(camera.name + " did not start in time.")),
              10_000,
            );
            video.onloadedmetadata = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            video.onerror = () => {
              window.clearTimeout(timeout);
              reject(new Error(camera.name + " could not produce video."));
            };
          });
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
          await loaded;
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
          });
          runtimesRef.current = runtimes;
        }

        await Promise.all(runtimes.map((runtime) => runtime.video.play()));
        setStreams(
          Object.fromEntries(
            runtimes
              .filter((runtime) => runtime.stream)
              .map((runtime) => [
                runtime.camera.id,
                runtime.stream as MediaStream,
              ]),
          ),
        );
        setVideos(
          Object.fromEntries(
            runtimes.map((runtime) => [runtime.camera.id, runtime.video]),
          ),
        );
        setPlaying(
          Object.fromEntries(
            runtimes.map((runtime) => [runtime.camera.id, true]),
          ),
        );
        if (sourceMode === "LIVE_CAMERAS") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
        } else {
          await sendDemoControl(
            "START",
            runtimes.map((runtime) => runtime.camera.id),
          );
        }

        runningRef.current = true;
        const generation = ++generationRef.current;
        setStatus("RUNNING");
        for (const runtime of runtimes) {
          runtime.video.onended = () =>
            setPlaying((current) => ({
              ...current,
              [runtime.camera.id]: false,
            }));
          for (const track of runtime.stream?.getVideoTracks() ?? []) {
            track.onended = () => {
              if (!runningRef.current || generation !== generationRef.current)
                return;
              cleanup();
              setStatus("ERROR");
              setError(
                runtime.camera.name +
                  " was disconnected. Reconnect it and start again.",
              );
            };
          }
        }

        void (async () => {
          let consecutiveFailures = 0;
          const tickMilliseconds = 1000 / ANALYSIS_TICKS_PER_SECOND;
          let runtimeIndex = 0;
          while (runningRef.current && generation === generationRef.current) {
            const tickStartedAt = performance.now();
            const runtime = runtimes[runtimeIndex % runtimes.length];
            runtimeIndex += 1;
            if (!runningRef.current || generation !== generationRef.current)
              return;
            if (
              runtime.video.paused ||
              runtime.video.ended ||
              runtime.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
            ) {
              await wait(tickMilliseconds);
              continue;
            }
            try {
              await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve()),
              );
              await publish(runtime, model);
              consecutiveFailures = 0;
            } catch (reason) {
              consecutiveFailures += 1;
              if (consecutiveFailures >= 3) {
                cleanup();
                setStatus("ERROR");
                setError(readableCameraError(reason));
                return;
              }
            }
            const remaining =
              tickMilliseconds - (performance.now() - tickStartedAt);
            await wait(Math.max(0, remaining));
          }
        })();
      } catch (reason) {
        cleanup();
        setStatus("ERROR");
        setError(readableCameraError(reason));
      }
    },
    [assignments, cleanup, publish, sourceMode, videoFiles],
  );

  const playOne = useCallback(async (cameraId: string) => {
    const runtime = runtimesRef.current.find(
      (candidate) => candidate.camera.id === cameraId,
    );
    if (!runtime) return;
    await runtime.video.play();
    if (runtime.sourceMode === "DEMO_VIDEOS") {
      await sendDemoControl("START", [cameraId]);
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
      await sendDemoControl("PAUSE", [cameraId]);
    }
    setPlaying((current) => ({ ...current, [cameraId]: false }));
  }, []);

  const restartOne = useCallback(async (cameraId: string) => {
    const runtime = runtimesRef.current.find(
      (candidate) => candidate.camera.id === cameraId,
    );
    if (!runtime) return;
    if (runtime.sourceMode === "DEMO_VIDEOS") {
      await sendDemoControl("RESTART", [cameraId]);
    }
    runtime.lastAnalyzedAt = 0;
    runtime.lastRisk = 0;
    runtime.video.currentTime = 0;
    await runtime.video.play();
    setPlaying((current) => ({ ...current, [cameraId]: true }));
  }, []);

  const playAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    await Promise.all(runtimes.map((runtime) => runtime.video.play()));
    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) await sendDemoControl("START", demoIds);
    setPlaying(
      Object.fromEntries(runtimes.map((runtime) => [runtime.camera.id, true])),
    );
  }, []);

  const pauseAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    for (const runtime of runtimes) runtime.video.pause();
    setPlaying(
      Object.fromEntries(runtimes.map((runtime) => [runtime.camera.id, false])),
    );
    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) await sendDemoControl("PAUSE", demoIds);
  }, []);

  const restartAll = useCallback(async () => {
    const runtimes = runtimesRef.current;
    const demoIds = runtimes
      .filter((runtime) => runtime.sourceMode === "DEMO_VIDEOS")
      .map((runtime) => runtime.camera.id);
    if (demoIds.length) await sendDemoControl("RESTART", demoIds);
    for (const runtime of runtimes) {
      runtime.lastAnalyzedAt = 0;
      runtime.lastRisk = 0;
      runtime.video.currentTime = 0;
    }
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
