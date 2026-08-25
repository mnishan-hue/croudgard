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

type RuntimeCamera = {
  camera: Camera;
  deviceId: string;
  stream: MediaStream;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  lastAnalyzedAt: number;
  lastRisk: number;
};

export type BrowserCameraMetric = {
  peopleCount: number;
  confidence: number;
  fps: number;
};

type BrowserCameraContextValue = {
  status: StationStatus;
  devices: MediaDeviceInfo[];
  assignments: Record<string, string>;
  streams: Record<string, MediaStream>;
  metrics: Record<string, BrowserCameraMetric>;
  error: string;
  prepare(cameras: Camera[]): Promise<void>;
  setAssignment(cameraId: string, deviceId: string): void;
  start(cameras: Camera[]): Promise<void>;
  stop(): void;
};

const BrowserCameraContext = createContext<BrowserCameraContextValue | null>(
  null,
);
const STORAGE_KEY = "crowdguard.browser-camera-assignments.v1";
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
        blob ? resolve(blob) : reject(new Error("Camera frame could not be encoded")),
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
  return reason instanceof Error ? reason.message : "The browser camera station stopped unexpectedly.";
}

export function BrowserCameraProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StationStatus>("IDLE");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [metrics, setMetrics] = useState<Record<string, BrowserCameraMetric>>({});
  const [error, setError] = useState("");
  const runningRef = useRef(false);
  const runtimesRef = useRef<RuntimeCamera[]>([]);
  const generationRef = useRef(0);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    generationRef.current += 1;
    for (const runtime of runtimesRef.current) {
      runtime.stream.getTracks().forEach((track) => track.stop());
      runtime.video.pause();
      runtime.video.srcObject = null;
    }
    runtimesRef.current = [];
    setStreams({});
    setMetrics({});
  }, []);

  const stop = useCallback(() => {
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
      setError("Direct cameras require HTTPS. Open the secure deployed website.");
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
      const available = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput",
      );
      if (!available.length) throw new Error("No cameras were found on this computer.");
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

  const setAssignment = useCallback((cameraId: string, deviceId: string) => {
    setAssignments((current) => ({ ...current, [cameraId]: deviceId }));
  }, []);

  const publish = useCallback(async (runtime: RuntimeCamera, model: PersonModel) => {
    const startedAt = performance.now();
    const detections = await model.detect(runtime.video, 50, 0.5);
    const people = detections.filter(
      (detection) => detection.class === "person" && detection.score >= 0.55,
    );
    const sourceWidth = runtime.video.videoWidth || 640;
    const sourceHeight = runtime.video.videoHeight || 360;
    const width = Math.min(720, sourceWidth);
    const height = Math.max(1, Math.round((sourceHeight / sourceWidth) * width));
    runtime.canvas.width = width;
    runtime.canvas.height = height;
    const context = runtime.canvas.getContext("2d");
    if (!context) throw new Error("Camera drawing surface is unavailable");
    context.drawImage(runtime.video, 0, 0, width, height);
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;
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
    context.fillText(`BROWSER AI · ${people.length} PEOPLE`, 15, 25);

    const occupiedArea = people.reduce((sum, person) => {
      const [, , boxWidth, boxHeight] = person.bbox;
      return sum + boxWidth * boxHeight;
    }, 0);
    const occupiedAreaRatio = clamp(occupiedArea / (sourceWidth * sourceHeight), 0, 1);
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
    const frame = await canvasBlob(runtime.canvas);
    const apiBase = serviceConfig.apiBaseUrl.replace(/\/$/, "");
    const [frameResponse, observationResponse] = await Promise.all([
      fetch(`${apiBase}/cameras/${encodeURIComponent(runtime.camera.id)}/frame`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: frame,
      }),
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
    if (!frameResponse.ok || !observationResponse.ok) {
      throw new Error(
        `Backend rejected camera data (${frameResponse.status}/${observationResponse.status})`,
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
    const elapsed = performance.now() - startedAt;
    if (elapsed < 180) await wait(180 - elapsed);
  }, []);

  const start = useCallback(
    async (cameras: Camera[]) => {
      const enabled = cameras.filter((camera) => camera.enabled).slice(0, 3);
      const selectedCameras = enabled.filter((camera) => assignments[camera.id]);
      const selected = selectedCameras.map((camera) => assignments[camera.id]);
      if (!selectedCameras.length) {
        setStatus("ERROR");
        setError("Select at least one physical camera to start monitoring.");
        return;
      }
      if (new Set(selected).size !== selected.length) {
        setStatus("ERROR");
        setError("Each CrowdGuard camera must use a different physical camera.");
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
          const deviceId = assignments[camera.id];
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: 640 },
              height: { ideal: 360 },
              frameRate: { ideal: 15, max: 24 },
            },
            audio: false,
          });
          const video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
              () => reject(new Error(`${camera.name} did not start in time.`)),
              10_000,
            );
            video.onloadedmetadata = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            video.onerror = () => {
              window.clearTimeout(timeout);
              reject(new Error(`${camera.name} could not produce video.`));
            };
          });
          await video.play();
          runtimes.push({
            camera,
            deviceId,
            stream,
            video,
            canvas: document.createElement("canvas"),
            lastAnalyzedAt: 0,
            lastRisk: 0,
          });
          // Keep partially opened devices reachable so a later camera failure
          // still closes every stream acquired during this start attempt.
          runtimesRef.current = runtimes;
        }
        runtimesRef.current = runtimes;
        setStreams(
          Object.fromEntries(
            runtimes.map((runtime) => [runtime.camera.id, runtime.stream]),
          ),
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments));
        runningRef.current = true;
        const generation = ++generationRef.current;
        setStatus("RUNNING");
        for (const runtime of runtimes) {
          for (const track of runtime.stream.getVideoTracks()) {
            track.onended = () => {
              if (!runningRef.current || generation !== generationRef.current) return;
              cleanup();
              setStatus("ERROR");
              setError(`${runtime.camera.name} was disconnected. Reconnect it and start again.`);
            };
          }
        }
        void (async () => {
          let consecutiveFailures = 0;
          while (runningRef.current && generation === generationRef.current) {
            for (const runtime of runtimes) {
              if (!runningRef.current || generation !== generationRef.current) return;
              try {
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
                await wait(700);
              }
            }
          }
        })();
      } catch (reason) {
        cleanup();
        setStatus("ERROR");
        setError(readableCameraError(reason));
      }
    },
    [assignments, cleanup, publish],
  );

  const value = useMemo(
    () => ({
      status,
      devices,
      assignments,
      streams,
      metrics,
      error,
      prepare,
      setAssignment,
      start,
      stop,
    }),
    [
      status,
      devices,
      assignments,
      streams,
      metrics,
      error,
      prepare,
      setAssignment,
      start,
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
    throw new Error("useBrowserCameras must be used inside BrowserCameraProvider");
  return value;
}
