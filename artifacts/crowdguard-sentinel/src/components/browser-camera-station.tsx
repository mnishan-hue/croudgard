import { useState } from "react";
import {
  Activity,
  Camera,
  CheckCircle2,
  FileVideo2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sliders,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { Camera as FacilityCamera } from "@/types/sentinel";
import type { CameraAnalysisMetrics } from "@/lib/cv-detection";

export function BrowserCameraStation({
  cameras,
}: {
  cameras: FacilityCamera[];
}) {
  const station = useBrowserCameras();
  const [open, setOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const enabled = cameras.filter((camera) => camera.enabled).slice(0, 3);
  const isDemo = station.sourceMode === "DEMO_VIDEOS";
  const selectedCount = enabled.filter((camera) =>
    isDemo
      ? Boolean(station.videoFiles[camera.id])
      : Boolean(station.assignments[camera.id]),
  ).length;
  const runningCount = Object.keys(station.videos).length;
  const busy = [
    "REQUESTING_PERMISSION",
    "LOADING_AI",
    "BUFFERING",
    "CONNECTING",
  ].includes(station.status);

  async function configure() {
    setOpen(true);
    if (!isDemo && !station.devices.length) await station.prepare(enabled);
  }

  return (
    <>
      <div className="mb-5 rounded-lg border border-secondary/25 bg-secondary/[.035] p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-10 w-10 place-items-center rounded-md border border-secondary/30 bg-secondary/5 text-secondary">
            {isDemo ? <FileVideo2 size={19} /> : <Camera size={19} />}
          </div>
          <div className="min-w-64 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold">
                {isDemo
                  ? "Demonstration video mode (Main Area, Exit A, Exit B)"
                  : "Browser camera station"}
              </h2>
              {station.status === "RUNNING" && (
                <span className="status-chip py-1 text-secondary">
                  <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />
                  {runningCount} source{runningCount === 1 ? "" : "s"} analyzing
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              {isDemo
                ? "Run three synchronized local videos through the real on-device person detection and safety decision pipeline."
                : "Connect up to three physical USB cameras. Each feed is analyzed independently."}
            </p>
            {station.error && (
              <p className="mt-2 text-[10px] text-destructive">
                {station.error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!station.status.includes("RUNNING") && (
              <>
                <ModeButton
                  active={!isDemo}
                  onClick={() => station.setSourceMode("LIVE_CAMERAS")}
                >
                  Live cameras
                </ModeButton>
                <ModeButton
                  active={isDemo}
                  onClick={() => station.setSourceMode("DEMO_VIDEOS")}
                >
                  Demo videos
                </ModeButton>
              </>
            )}
            {station.status === "RUNNING" ? (
              <>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void station.playAll()}
                  title="Play all videos simultaneously"
                >
                  <Play size={12} /> Play All
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void station.pauseAll()}
                  title="Pause all videos simultaneously"
                >
                  <Pause size={12} /> Pause All
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void station.restartAll()}
                  title="Restart all videos simultaneously from time 0"
                >
                  <RotateCcw size={12} /> Restart All
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setOpen(true)}
                >
                  View sources
                </button>
                <button
                  type="button"
                  className="button-danger"
                  onClick={station.stop}
                >
                  <Square size={12} /> Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button-primary"
                onClick={() => void configure()}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : isDemo ? (
                  <FileVideo2 size={14} />
                ) : (
                  <Camera size={14} />
                )}
                {busy
                  ? "Preparing…"
                  : isDemo
                    ? "Configure 3-video demo"
                    : "Connect cameras"}
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Configure camera sources"
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/80 p-4"
        >
          <div className="panel my-6 w-full max-w-5xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <div className="data-mono text-[8px] text-secondary">
                  {isDemo
                    ? "LOCAL SYNCHRONIZED SOURCES · OFFLINE COCO-SSD"
                    : "DIRECT BROWSER CAPTURE"}
                </div>
                <h2 className="mt-1 text-[18px] font-semibold">
                  {isDemo
                    ? "3-Source demonstration mode"
                    : "Connect physical cameras"}
                </h2>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                  {isDemo
                    ? "Choose Main Area, Exit A, and Exit B videos. All 3 files buffer and start together from time 0."
                    : "Assign a different device to each location. Keep this website open while monitoring."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close source setup"
                className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5">
              {station.status === "REQUESTING_PERMISSION" ? (
                <Waiting message="Waiting for camera permission…" />
              ) : station.status === "LOADING_AI" ? (
                <Waiting message="Loading the on-device COCO-SSD person detector…" />
              ) : station.status === "BUFFERING" ? (
                <Waiting message="Buffering video files for synchronized start…" />
              ) : station.status === "CONNECTING" ? (
                <Waiting
                  message={
                    isDemo
                      ? "Synchronizing recorded sources at time 0…"
                      : "Opening camera feeds…"
                  }
                />
              ) : station.status === "RUNNING" ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-secondary/30 bg-secondary/5 p-3">
                    <div className="data-mono text-[9px] text-secondary">
                      {isDemo
                        ? "SYNCHRONIZED RECORDED VIDEO · ANALYSIS LIVE"
                        : "LIVE CAMERA · ANALYSIS LIVE"}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void station.playAll()}
                      >
                        <Play size={12} /> Start all
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void station.pauseAll()}
                      >
                        <Pause size={12} /> Pause all
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void station.restartAll()}
                      >
                        <RotateCcw size={12} /> Restart all
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setShowDiagnostics((p) => !p)}
                      >
                        <Activity size={12} /> Diagnostics
                      </button>
                    </div>
                  </div>

                  {/* Confidence Slider */}
                  <div className="mb-4 flex items-center justify-between border border-border bg-background p-3 text-[11px]">
                    <div className="flex items-center gap-2">
                      <Sliders size={13} className="text-secondary" />
                      <span>Person confidence threshold:</span>
                      <span className="font-mono text-secondary">
                        {Math.round(station.confidenceThreshold * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.30"
                      max="0.80"
                      step="0.05"
                      value={station.confidenceThreshold}
                      onChange={(e) =>
                        station.setConfidenceThreshold(parseFloat(e.target.value))
                      }
                      className="w-32 accent-secondary"
                    />
                  </div>

                  {/* Diagnostics */}
                  {showDiagnostics && (
                    <div className="mb-4 border border-border bg-background/50 p-3 text-[10px]">
                      <div className="font-semibold text-secondary mb-2">
                        Performance Instrumentation
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {enabled
                          .filter((c) => station.videos[c.id])
                          .map((camera) => {
                            const m = station.metrics[camera.id];
                            return (
                              <div
                                key={camera.id}
                                className="border border-border bg-card p-2"
                              >
                                <div className="font-semibold text-foreground">
                                  {camera.name}
                                </div>
                                <div className="mt-1 space-y-0.5 text-muted-foreground">
                                  <div>Inference: {m?.inferenceDurationMs ?? 0} ms</div>
                                  <div>AI FPS: {m?.fps.toFixed(1) ?? 0}</div>
                                  <div>Sync drift: {m?.syncDriftMs ?? 0} ms</div>
                                  <div>Skipped frames: {m?.skippedFrames ?? 0}</div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-3">
                    {enabled
                      .filter((camera) => station.videos[camera.id])
                      .map((camera) => (
                        <LocalPreview
                          key={camera.id}
                          camera={camera}
                          recorded={isDemo}
                          playing={station.playing[camera.id]}
                          metric={station.metrics[camera.id]}
                          onPlay={() => void station.playOne(camera.id)}
                          onPause={() => void station.pauseOne(camera.id)}
                          onRestart={() => void station.restartOne(camera.id)}
                        />
                      ))}
                  </div>
                </>
              ) : (
                <>
                  {station.error && (
                    <div className="mb-4 flex gap-3 border border-destructive/40 bg-destructive/5 p-3 text-[10px] text-destructive">
                      <TriangleAlert size={16} className="shrink-0" />
                      <span>{station.error}</span>
                    </div>
                  )}
                  {isDemo ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      {enabled.map((camera, index) => (
                        <VideoFileSlot
                          key={camera.id}
                          camera={camera}
                          index={index}
                          file={station.videoFiles[camera.id]}
                          onFile={(file) =>
                            station.setVideoFile(camera.id, file)
                          }
                        />
                      ))}
                    </div>
                  ) : station.devices.length ? (
                    <div>
                      <div
                        className={
                          "mb-4 flex items-center gap-2 border p-3 text-[10px] " +
                          (station.devices.length >= 3
                            ? "border-secondary/30 bg-secondary/5 text-secondary"
                            : "border-primary/35 bg-primary/5 text-primary")
                        }
                      >
                        {station.devices.length >= 3 ? (
                          <CheckCircle2 size={15} />
                        ) : (
                          <TriangleAlert size={15} />
                        )}
                        {station.devices.length} physical camera
                        {station.devices.length === 1 ? "" : "s"} detected
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        {enabled.map((camera, index) => (
                          <label
                            key={camera.id}
                            className="border border-border bg-card p-4"
                          >
                            <span className="data-mono text-[8px] text-secondary">
                              LOCATION {index + 1}
                            </span>
                            <span className="mt-1 block text-[13px] font-semibold">
                              {camera.name}
                            </span>
                            <select
                              value={station.assignments[camera.id] ?? ""}
                              onChange={(event) =>
                                station.setAssignment(
                                  camera.id,
                                  event.target.value,
                                )
                              }
                              className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-[11px] text-foreground"
                            >
                              <option value="">Not connected</option>
                              {station.devices.map((device, deviceIndex) => (
                                <option
                                  key={device.deviceId}
                                  value={device.deviceId}
                                  disabled={Object.entries(
                                    station.assignments,
                                  ).some(
                                    ([assignedCameraId, assignedDeviceId]) =>
                                      assignedCameraId !== camera.id &&
                                      assignedDeviceId === device.deviceId,
                                  )}
                                >
                                  {device.label ||
                                    "Camera " + (deviceIndex + 1)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-h-48 place-items-center text-center">
                      <div>
                        <Camera
                          size={32}
                          className="mx-auto text-muted-foreground/40"
                        />
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          Allow camera access to discover connected devices.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/30 p-4">
              <p className="max-w-2xl text-[9px] text-muted-foreground">
                One offline COCO-SSD model is shared by all sources. Analysis runs on resized frames without interrupting native playback.
              </p>
              <div className="flex gap-2">
                {station.status === "RUNNING" ? (
                  <button
                    type="button"
                    className="button-danger"
                    onClick={station.stop}
                  >
                    <Square size={12} /> Stop all sources
                  </button>
                ) : (
                  <>
                    {!isDemo && (
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void station.prepare(enabled)}
                        disabled={busy}
                      >
                        <RefreshCw size={12} /> Rescan
                      </button>
                    )}
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => void station.start(enabled)}
                      disabled={busy || selectedCount === 0}
                    >
                      <CheckCircle2 size={13} />{" "}
                      {isDemo
                        ? "Start 3-source demonstration"
                        : "Start " +
                          (selectedCount || "selected") +
                          " camera" +
                          (selectedCount === 1 ? "" : "s")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick(): void;
  children: string;
}) {
  return (
    <button
      type="button"
      className={active ? "button-primary" : "button-secondary"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function VideoFileSlot({
  camera,
  index,
  file,
  onFile,
}: {
  camera: FacilityCamera;
  index: number;
  file?: File;
  onFile(file?: File): void;
}) {
  const slotLabels = ["1. Main Area", "2. Exit A", "3. Exit B"];
  return (
    <div className="border border-border bg-card p-4">
      <div className="data-mono text-[8px] text-secondary">
        {slotLabels[index] ?? `SOURCE ${index + 1}`}
      </div>
      <div className="mt-1 text-[13px] font-semibold">{camera.name}</div>
      <div className="mt-4 rounded-md border border-dashed border-border bg-background/40 p-4 text-center">
        <FileVideo2 size={24} className="mx-auto text-secondary" />
        <div className="mt-2 truncate text-[10px] font-medium">
          {file?.name ?? "No video selected"}
        </div>
        <div className="mt-1 data-mono text-[7px] text-muted-foreground">
          {file
            ? (file.size / 1_048_576).toFixed(1) + " MB · LOCAL FILE"
            : "MP4 · WEBM · MOV"}
        </div>
        <label className="button-secondary mt-3 inline-flex cursor-pointer text-xs">
          {file ? "Replace video" : "Select video"}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            className="sr-only"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {file && (
          <button
            type="button"
            className="ml-2 mt-3 text-[9px] text-destructive"
            onClick={() => onFile()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Waiting({ message }: { message: string }) {
  return (
    <div className="grid min-h-64 place-items-center text-center">
      <div>
        <LoaderCircle
          size={30}
          className="mx-auto animate-spin text-secondary"
        />
        <p className="mt-4 data-mono text-[10px] text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

function LocalPreview({
  camera,
  recorded,
  playing,
  metric,
  onPlay,
  onPause,
  onRestart,
}: {
  camera: FacilityCamera;
  recorded: boolean;
  playing?: boolean;
  metric?: CameraAnalysisMetrics;
  onPlay(): void;
  onPause(): void;
  onRestart(): void;
}) {
  const isWarmingUp = metric?.isWarmingUp ?? true;

  return (
    <div className="overflow-hidden border border-secondary/30 bg-card">
      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
        <span className="status-chip py-1 text-secondary">
          {recorded ? "RECORDED VIDEO" : "LIVE CAMERA"}
        </span>
        <span className="status-chip py-1 text-secondary">
          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />{" "}
          {isWarmingUp ? "AI WARMING UP" : "ANALYSIS LIVE"}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold">{camera.name}</div>
            <div className="mt-1 data-mono text-[7px] text-muted-foreground">
              {playing ? "PLAYING" : "PAUSED"}
            </div>
          </div>
          <div className="text-right data-mono text-[9px] text-secondary">
            <div className="text-sm font-semibold">
              {isWarmingUp ? "—" : `${metric?.peopleCount ?? 0} PEOPLE`}
            </div>
            <div className="mt-1 text-muted-foreground">
              {metric?.fps
                ? `${metric.fps.toFixed(1)} AI FPS (${metric.inferenceDurationMs}ms)`
                : "AI STARTING"}
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            aria-label={"Play " + camera.name}
            className="button-secondary"
            onClick={onPlay}
            disabled={playing}
          >
            <Play size={11} />
          </button>
          <button
            type="button"
            aria-label={"Pause " + camera.name}
            className="button-secondary"
            onClick={onPause}
            disabled={!playing}
          >
            <Pause size={11} />
          </button>
          <button
            type="button"
            aria-label={"Restart " + camera.name}
            className="button-secondary"
            onClick={onRestart}
          >
            <RotateCcw size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
