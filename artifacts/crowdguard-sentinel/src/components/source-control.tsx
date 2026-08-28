import { useMemo, useState } from "react";
import {
  Activity,
  Camera,
  CheckCircle2,
  FileVideo2,
  Gauge,
  Info,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sliders,
  Square,
  X,
} from "lucide-react";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { Camera as FacilityCamera } from "@/types/sentinel";
import type { CameraAnalysisMetrics } from "@/lib/cv-detection";

export function SourceControl({ cameras }: { cameras: FacilityCamera[] }) {
  const station = useBrowserCameras();
  const [open, setOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const enabled = useMemo(
    () => cameras.filter((camera) => camera.enabled).slice(0, 3),
    [cameras],
  );
  const demo = station.sourceMode === "DEMO_VIDEOS";
  const running = station.status === "RUNNING";
  const busy = [
    "REQUESTING_PERMISSION",
    "LOADING_AI",
    "BUFFERING",
    "CONNECTING",
  ].includes(station.status);
  const selectedCount = enabled.filter((camera) =>
    demo
      ? Boolean(station.videoFiles[camera.id])
      : Boolean(station.assignments[camera.id]),
  ).length;

  async function configure() {
    setOpen(true);
    if (!demo && station.status !== "READY" && !running) {
      await station.prepare(enabled);
    }
  }

  return (
    <>
      <section className="mb-5 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${running ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
            >
              {running ? <Gauge size={19} /> : <Camera size={19} />}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Camera sources</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${running ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground"}`}
                >
                  {running
                    ? `${Object.keys(station.videos).length} active (Main Area, Exit A, Exit B)`
                    : "Not running"}
                </span>
                {running && (
                  <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-[9px] font-medium text-secondary">
                    {demo ? "SOURCE: RECORDED VIDEO" : "SOURCE: LIVE CAMERA"} ·
                    ANALYSIS: LIVE AI
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {running
                  ? "Three video sources run simultaneously with synchronized playback and real-time on-device person detection."
                  : "Choose live USB cameras or three recorded demonstration videos (Main Area, Exit A, Exit B)."}
              </p>
              {station.error && (
                <p className="mt-2 text-[11px] text-destructive">
                  {station.error}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!running && (
              <div className="flex rounded-lg border border-border bg-background p-1">
                <Mode
                  active={!demo}
                  onClick={() => station.setSourceMode("LIVE_CAMERAS")}
                >
                  Live cameras
                </Mode>
                <Mode
                  active={demo}
                  onClick={() => station.setSourceMode("DEMO_VIDEOS")}
                >
                  3-Video demo
                </Mode>
              </div>
            )}
            {running && (
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background p-1">
                <button
                  className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void station.playAll()}
                  title="Play all videos"
                >
                  <Play size={12} className="inline mr-1" /> Play All
                </button>
                <button
                  className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void station.pauseAll()}
                  title="Pause all videos"
                >
                  <Pause size={12} className="inline mr-1" /> Pause All
                </button>
                <button
                  className="rounded px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => void station.restartAll()}
                  title="Restart all videos from time 0"
                >
                  <RotateCcw size={12} className="inline mr-1" /> Restart All
                </button>
              </div>
            )}
            <button
              className="button-primary"
              onClick={() => void configure()}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <Settings2 size={14} />
              )}
              {running ? "Source controls" : "Set up sources"}
            </button>
            {running && (
              <button className="button-danger" onClick={station.stop}>
                <Square size={13} /> Stop
              </button>
            )}
          </div>
        </div>
      </section>

      {open && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Camera source setup"
        >
          <div className="mx-auto my-4 max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[.14em] text-secondary">
                  {demo
                    ? "Synchronized 3-source demonstration mode"
                    : "Live multi-camera connection"}
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {running
                    ? "Source playback & AI monitor"
                    : demo
                      ? "Choose three videos (Main Area, Exit A, Exit B)"
                      : "Assign your cameras"}
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  {demo
                    ? "Selected videos buffer together and start simultaneously from time 0. Drift is automatically aligned to the reference video."
                    : "Assign a separate physical camera to Main Area, Exit A, and Exit B."}
                </p>
              </div>
              <button
                className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            <div className="p-5">
              {busy ? (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <LoaderCircle
                      className="mx-auto animate-spin text-secondary"
                      size={32}
                    />
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {station.status === "LOADING_AI"
                        ? "Loading offline COCO-SSD person detection model…"
                        : station.status === "BUFFERING"
                          ? "Buffering all three video sources for synchronized playback…"
                          : station.status === "CONNECTING"
                            ? "Synchronizing and starting video feeds…"
                            : "Waiting for camera permission…"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Please wait while sources prepare.
                    </p>
                  </div>
                </div>
              ) : running ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-secondary status-pulse" />
                      <span className="text-xs font-semibold text-secondary">
                        AI analysis is active on all sources
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="button-secondary text-xs"
                        onClick={() => void station.playAll()}
                      >
                        <Play size={12} /> Play All
                      </button>
                      <button
                        className="button-secondary text-xs"
                        onClick={() => void station.pauseAll()}
                      >
                        <Pause size={12} /> Pause All
                      </button>
                      <button
                        className="button-secondary text-xs"
                        onClick={() => void station.restartAll()}
                      >
                        <RotateCcw size={12} /> Restart All (Time 0)
                      </button>
                      <button
                        className="button-secondary text-xs"
                        onClick={() => setShowDiagnostics((prev) => !prev)}
                      >
                        <Activity size={12} />{" "}
                        {showDiagnostics ? "Hide diagnostics" : "Diagnostics"}
                      </button>
                    </div>
                  </div>

                  {/* Sensitivity Slider */}
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Sliders size={14} className="text-secondary" />
                      <span className="font-medium">
                        Detection confidence threshold:
                      </span>
                      <span className="font-mono text-secondary">
                        {Math.round(station.confidenceThreshold * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0.30"
                        max="0.80"
                        step="0.05"
                        value={station.confidenceThreshold}
                        onChange={(e) =>
                          station.setConfidenceThreshold(
                            parseFloat(e.target.value),
                          )
                        }
                        className="h-1.5 w-32 accent-secondary"
                        aria-label="Confidence threshold"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        (Default: 48%)
                      </span>
                    </div>
                  </div>

                  {/* Diagnostics Panel */}
                  {showDiagnostics && (
                    <div className="mb-4 rounded-lg border border-border bg-background/50 p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-foreground mb-3">
                        <Activity size={14} className="text-secondary" />
                        Performance instrumentation
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {enabled
                          .filter((camera) => station.videos[camera.id])
                          .map((camera) => {
                            const metric = station.metrics[camera.id];
                            return (
                              <div
                                key={camera.id}
                                className="rounded-lg border border-border bg-card p-3 text-[11px]"
                              >
                                <div className="font-semibold text-secondary">
                                  {camera.name}
                                </div>
                                <div className="mt-2 space-y-1 text-muted-foreground">
                                  <div className="flex justify-between">
                                    <span>Inference duration:</span>
                                    <span className="font-mono text-foreground">
                                      {metric?.inferenceDurationMs ?? 0} ms
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>AI FPS:</span>
                                    <span className="font-mono text-foreground">
                                      {metric?.fps.toFixed(1) ?? "0.0"}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Sync drift:</span>
                                    <span className="font-mono text-foreground">
                                      {metric?.syncDriftMs ?? 0} ms
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Skipped frames:</span>
                                    <span className="font-mono text-foreground">
                                      {metric?.skippedFrames ?? 0}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Publish latency:</span>
                                    <span className="font-mono text-foreground">
                                      {metric?.publishLatencyMs ?? 0} ms
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Live Previews */}
                  <div className="grid gap-4 md:grid-cols-3">
                    {enabled
                      .filter((camera) => station.videos[camera.id])
                      .map((camera) => (
                        <SourceCard
                          key={camera.id}
                          camera={camera}
                          playing={station.playing[camera.id]}
                          metric={station.metrics[camera.id]}
                          onPlay={() => void station.playOne(camera.id)}
                          onPause={() => void station.pauseOne(camera.id)}
                          onRestart={() => void station.restartOne(camera.id)}
                        />
                      ))}
                  </div>
                </>
              ) : demo ? (
                <div>
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                    <Info size={14} className="text-secondary shrink-0" />
                    <span>
                      Select demonstration videos for Main Area, Exit A, and
                      Exit B. All 3 files will be pre-buffered and started
                      simultaneously.
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {enabled.map((camera, index) => (
                      <VideoSlot
                        key={camera.id}
                        camera={camera}
                        index={index}
                        file={station.videoFiles[camera.id]}
                        onFile={(file) => station.setVideoFile(camera.id, file)}
                      />
                    ))}
                  </div>
                </div>
              ) : station.devices.length ? (
                <div>
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-xs">
                    <CheckCircle2 size={15} className="text-secondary" />
                    {station.devices.length} physical camera
                    {station.devices.length === 1 ? "" : "s"} found
                    <button
                      className="button-secondary ml-auto"
                      onClick={() => void station.prepare(enabled)}
                    >
                      <RefreshCw size={12} /> Rescan
                    </button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {enabled.map((camera, index) => (
                      <label
                        key={camera.id}
                        className="rounded-xl border border-border bg-background p-4"
                      >
                        <span className="text-[9px] font-medium uppercase tracking-wider text-secondary">
                          Location {index + 1}
                        </span>
                        <span className="mt-1 block text-sm font-semibold">
                          {camera.name}
                        </span>
                        <select
                          className="mt-4 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-xs"
                          value={station.assignments[camera.id] ?? ""}
                          onChange={(event) =>
                            station.setAssignment(camera.id, event.target.value)
                          }
                        >
                          <option value="">Not connected</option>
                          {station.devices.map((device, deviceIndex) => (
                            <option
                              key={device.deviceId}
                              value={device.deviceId}
                              disabled={Object.entries(
                                station.assignments,
                              ).some(
                                ([cameraId, deviceId]) =>
                                  cameraId !== camera.id &&
                                  deviceId === device.deviceId,
                              )}
                            >
                              {device.label || `Camera ${deviceIndex + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid min-h-56 place-items-center text-center">
                  <div>
                    <Camera
                      className="mx-auto text-muted-foreground"
                      size={32}
                    />
                    <p className="mt-3 text-xs text-muted-foreground">
                      Allow camera access in your browser, then rescan.
                    </p>
                    <button
                      className="button-primary mt-4"
                      onClick={() => void station.prepare(enabled)}
                    >
                      <RefreshCw size={13} /> Find cameras
                    </button>
                  </div>
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/50 p-4">
              <p className="text-[10px] text-muted-foreground">
                Offline AI runs on GPU-optimized frames; video streams play
                natively at full original framerate.
              </p>
              {!running && (
                <button
                  className="button-primary"
                  disabled={
                    busy ||
                    selectedCount === 0 ||
                    (demo && selectedCount !== enabled.length)
                  }
                  onClick={() => void station.start(enabled)}
                >
                  <Play size={13} />{" "}
                  {demo
                    ? "Start All 3"
                    : `Start ${selectedCount || ""} source${selectedCount === 1 ? "" : "s"}`}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Mode({
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
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-[10px] font-medium transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function VideoSlot({
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
    <div className="rounded-xl border border-border bg-background p-4">
      <span className="text-[9px] font-medium uppercase tracking-wider text-secondary">
        {slotLabels[index] ?? `Source ${index + 1}`}
      </span>
      <h3 className="mt-1 text-sm font-semibold">{camera.name}</h3>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-card p-5 text-center">
        <FileVideo2 className="mx-auto text-primary" size={25} />
        <p className="mt-2 truncate text-xs font-medium">
          {file?.name ?? "No video selected"}
        </p>
        <p className="mt-1 text-[9px] text-muted-foreground">
          {file
            ? `${(file.size / 1_048_576).toFixed(1)} MB · Ready`
            : "MP4, WebM or MOV"}
        </p>
        <label className="button-secondary mt-3 inline-flex cursor-pointer text-xs">
          {file ? "Replace video" : "Choose video"}
          <input
            className="sr-only"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {file && (
          <button
            className="ml-2 text-[10px] text-destructive hover:underline"
            onClick={() => onFile()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  camera,
  playing,
  metric,
  onPlay,
  onPause,
  onRestart,
}: {
  camera: FacilityCamera;
  playing?: boolean;
  metric?: CameraAnalysisMetrics;
  onPlay(): void;
  onPause(): void;
  onRestart(): void;
}) {
  const isWarmingUp = metric?.isWarmingUp ?? true;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div>
          <div className="text-xs font-semibold">{camera.name}</div>
          <div className="mt-0.5 text-[9px] text-secondary">
            {playing ? "Playing" : "Paused"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold font-mono text-secondary">
            {isWarmingUp ? "—" : `${metric?.peopleCount ?? 0}`}
          </div>
          <div className="text-[9px] text-muted-foreground">
            {isWarmingUp ? "AI warming up" : "Estimated detections"}
          </div>
        </div>
      </div>
      <div className="p-3 bg-card/50 flex items-center justify-between text-xs">
        <div className="space-x-1">
          <button
            className="button-secondary px-2 py-1 text-[11px]"
            onClick={onPlay}
            disabled={playing}
            title="Play this source"
          >
            <Play size={11} />
          </button>
          <button
            className="button-secondary px-2 py-1 text-[11px]"
            onClick={onPause}
            disabled={!playing}
            title="Pause this source"
          >
            <Pause size={11} />
          </button>
          <button
            className="button-secondary px-2 py-1 text-[11px]"
            onClick={onRestart}
            title="Restart this source from 0"
          >
            <RotateCcw size={11} />
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Risk:{" "}
          <span className="text-foreground font-mono">
            {Math.round(metric?.riskScore ?? 0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
