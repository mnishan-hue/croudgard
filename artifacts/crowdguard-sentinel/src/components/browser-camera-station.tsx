import { useEffect, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileVideo2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { Camera as FacilityCamera } from "@/types/sentinel";

export function BrowserCameraStation({
  cameras,
}: {
  cameras: FacilityCamera[];
}) {
  const station = useBrowserCameras();
  const [open, setOpen] = useState(false);
  const enabled = cameras.filter((camera) => camera.enabled).slice(0, 3);
  const isDemo = station.sourceMode === "DEMO_VIDEOS";
  const selectedCount = enabled.filter((camera) =>
    isDemo
      ? Boolean(station.videoFiles[camera.id])
      : Boolean(station.assignments[camera.id]),
  ).length;
  const runningCount = Object.keys(station.videos).length;
  const busy = ["REQUESTING_PERMISSION", "LOADING_AI", "CONNECTING"].includes(
    station.status,
  );

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
                {isDemo ? "Demonstration video mode" : "Browser camera station"}
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
                ? "Run up to three local recorded videos through the real CrowdGuard AI, risk, decision, and ESP32 pipeline."
                : "Connect up to three USB cameras. Each live feed is analyzed independently and contributes to CrowdGuard."}
            </p>
            {station.error && (
              <p className="mt-2 text-[10px] text-destructive">
                {station.error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
            {station.status === "RUNNING" ? (
              <>
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
                    ? "Configure demo"
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
                    ? "LOCAL RECORDED SOURCES · OFFLINE AI"
                    : "DIRECT BROWSER CAPTURE"}
                </div>
                <h2 className="mt-1 text-[18px] font-semibold">
                  {isDemo
                    ? "Demonstration video mode"
                    : "Connect physical cameras"}
                </h2>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                  {isDemo
                    ? "Choose Main Area, Exit A, and Exit B videos. Playback starts together while AI samples current frames without slowing the native video."
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
                <Waiting message="Loading the on-device person detector…" />
              ) : station.status === "CONNECTING" ? (
                <Waiting
                  message={
                    isDemo
                      ? "Synchronizing recorded sources…"
                      : "Opening camera feeds…"
                  }
                />
              ) : station.status === "RUNNING" ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-secondary/30 bg-secondary/5 p-3">
                    <div className="data-mono text-[9px] text-secondary">
                      {isDemo
                        ? "RECORDED VIDEO · ANALYSIS LIVE"
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
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {enabled
                      .filter((camera) => station.videos[camera.id])
                      .map((camera) => (
                        <LocalPreview
                          key={camera.id}
                          camera={camera}
                          video={station.videos[camera.id]}
                          recorded={isDemo}
                          playing={station.playing[camera.id]}
                          people={station.metrics[camera.id]?.peopleCount}
                          confidence={station.metrics[camera.id]?.confidence}
                          fps={station.metrics[camera.id]?.fps}
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
                        {station.devices.length < 3 &&
                          " · You can start now and add more later."}
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        {enabled.map((camera, index) => (
                          <label
                            key={camera.id}
                            className="border border-border bg-card p-4"
                          >
                            <span className="data-mono text-[8px] text-secondary">
                              CAMERA {index + 1}
                            </span>
                            <span className="mt-1 block text-[13px] font-semibold">
                              {camera.name}
                            </span>
                            <span className="mt-1 block text-[9px] text-muted-foreground">
                              {camera.zone_ids.join(", ") ||
                                "Unassigned location"}
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
                One offline COCO-SSD model is shared by all sources. Only
                current frames are sampled; no inference queue is retained.
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
                        ? "Start demonstration"
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
  return (
    <div className="border border-border bg-card p-4">
      <div className="data-mono text-[8px] text-secondary">
        SOURCE {index + 1}
      </div>
      <div className="mt-1 text-[13px] font-semibold">{camera.name}</div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        {camera.zone_ids.join(", ") || "Unassigned location"}
      </div>
      <div className="mt-4 rounded-md border border-dashed border-border bg-background/40 p-4 text-center">
        <FileVideo2 size={24} className="mx-auto text-secondary" />
        <div className="mt-2 truncate text-[10px]">
          {file?.name ?? "No video selected"}
        </div>
        <div className="mt-1 data-mono text-[7px] text-muted-foreground">
          {file
            ? (file.size / 1_048_576).toFixed(1) + " MB · LOCAL FILE"
            : "MP4 · WEBM · MOV"}
        </div>
        <label className="button-secondary mt-3 inline-flex cursor-pointer">
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
  video,
  recorded,
  playing,
  people,
  confidence,
  fps,
  onPlay,
  onPause,
  onRestart,
}: {
  camera: FacilityCamera;
  video: HTMLVideoElement;
  recorded: boolean;
  playing?: boolean;
  people?: number;
  confidence?: number;
  fps?: number;
  onPlay(): void;
  onPause(): void;
  onRestart(): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    video.className = "h-full w-full object-contain";
    host.replaceChildren(video);
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [video]);

  return (
    <div className="overflow-hidden border border-secondary/30 bg-card">
      <div ref={hostRef} className="relative aspect-video bg-[#071019]" />
      <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
        <span className="status-chip py-1 text-secondary">
          {recorded ? "RECORDED VIDEO" : "LIVE CAMERA"}
        </span>
        <span className="status-chip py-1 text-secondary">
          <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />{" "}
          ANALYSIS LIVE
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold">{camera.name}</div>
            <div className="mt-1 data-mono text-[7px] text-muted-foreground">
              {camera.id}
            </div>
          </div>
          <div className="text-right data-mono text-[8px] text-secondary">
            <div>{people ?? "—"} PEOPLE</div>
            <div className="mt-1 text-muted-foreground">
              {fps ? fps.toFixed(1) + " AI FPS" : "AI STARTING"}
              {confidence !== undefined
                ? " · " + Math.round(confidence * 100) + "% CONF"
                : ""}
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
