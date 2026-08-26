import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  FileVideo2,
  Gauge,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { Camera as FacilityCamera } from "@/types/sentinel";

export function SourceControl({ cameras }: { cameras: FacilityCamera[] }) {
  const station = useBrowserCameras();
  const [open, setOpen] = useState(false);
  const enabled = useMemo(
    () => cameras.filter((camera) => camera.enabled).slice(0, 3),
    [cameras],
  );
  const demo = station.sourceMode === "DEMO_VIDEOS";
  const running = station.status === "RUNNING";
  const busy = ["REQUESTING_PERMISSION", "LOADING_AI", "CONNECTING"].includes(
    station.status,
  );
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
                  className={`rounded-full px-2 py-1 text-[9px] font-medium ${running ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground"}`}
                >
                  {running
                    ? `${Object.keys(station.videos).length} analyzing`
                    : "Not running"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {running
                  ? "Video playback stays native while lightweight AI samples frames in the background."
                  : "Choose live USB cameras or local videos. Processing remains on this computer."}
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
                  Video demo
                </Mode>
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
              {running ? "View cameras" : "Set up sources"}
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
                    ? "Local video demonstration"
                    : "Live camera connection"}
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  {running
                    ? "Camera monitor"
                    : demo
                      ? "Choose three videos"
                      : "Assign your cameras"}
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                  {demo
                    ? "Use Main Area, Exit A and Exit B videos. All selected files start together."
                    : "Each location should use a different USB camera. You can start with one and add the others later."}
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
                      size={30}
                    />
                    <p className="mt-3 text-xs text-muted-foreground">
                      {station.status === "LOADING_AI"
                        ? "Loading offline people detection…"
                        : station.status === "CONNECTING"
                          ? "Starting camera feeds…"
                          : "Waiting for camera permission…"}
                    </p>
                  </div>
                </div>
              ) : running ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
                    <span className="text-[10px] font-medium text-secondary">
                      AI analysis is running
                    </span>
                    <div className="flex gap-2">
                      <button
                        className="button-secondary"
                        onClick={() => void station.playAll()}
                      >
                        <Play size={12} /> Play
                      </button>
                      <button
                        className="button-secondary"
                        onClick={() => void station.pauseAll()}
                      >
                        <Pause size={12} /> Pause
                      </button>
                      <button
                        className="button-secondary"
                        onClick={() => void station.restartAll()}
                      >
                        <RotateCcw size={12} /> Restart
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {enabled
                      .filter((camera) => station.videos[camera.id])
                      .map((camera) => (
                        <Preview
                          key={camera.id}
                          camera={camera}
                          video={station.videos[camera.id]}
                          people={station.metrics[camera.id]?.peopleCount}
                          fps={station.metrics[camera.id]?.fps}
                        />
                      ))}
                  </div>
                </>
              ) : demo ? (
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
              ) : station.devices.length ? (
                <div>
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-xs">
                    <CheckCircle2 size={15} className="text-secondary" />
                    {station.devices.length} camera
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
                      Allow camera access, then rescan.
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
                AI uses 416px analysis frames; the displayed video keeps its
                native playback rate.
              </p>
              {!running && (
                <button
                  className="button-primary"
                  disabled={busy || selectedCount === 0}
                  onClick={() => void station.start(enabled)}
                >
                  <Play size={13} /> Start {selectedCount || ""} source
                  {selectedCount === 1 ? "" : "s"}
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
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <span className="text-[9px] font-medium uppercase tracking-wider text-secondary">
        Source {index + 1}
      </span>
      <h3 className="mt-1 text-sm font-semibold">{camera.name}</h3>
      <div className="mt-4 rounded-lg border border-dashed border-border bg-card p-5 text-center">
        <FileVideo2 className="mx-auto text-primary" size={25} />
        <p className="mt-2 truncate text-xs">
          {file?.name ?? "No video selected"}
        </p>
        <p className="mt-1 text-[9px] text-muted-foreground">
          {file
            ? `${(file.size / 1_048_576).toFixed(1)} MB`
            : "MP4, WebM or MOV"}
        </p>
        <label className="button-secondary mt-3 inline-flex cursor-pointer">
          {file ? "Replace" : "Choose video"}
          <input
            className="sr-only"
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
            onChange={(event) => onFile(event.target.files?.[0])}
          />
        </label>
        {file && (
          <button
            className="ml-2 text-[10px] text-destructive"
            onClick={() => onFile()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Preview({
  camera,
  video,
  people,
  fps,
}: {
  camera: FacilityCamera;
  video: HTMLVideoElement;
  people?: number;
  fps?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    video.className = "h-full w-full object-contain";
    host.current.replaceChildren(video);
    const current = host.current;
    return () => {
      if (video.parentElement === current) current.removeChild(video);
    };
  }, [video]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div ref={host} className="aspect-video bg-black" />
      <div className="flex items-center justify-between p-3">
        <div>
          <div className="text-xs font-semibold">{camera.name}</div>
          <div className="mt-0.5 text-[9px] text-secondary">Live</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{people ?? "—"} people</div>
          <div className="text-[9px] text-muted-foreground">
            {fps ? `${fps.toFixed(1)} AI fps` : "AI warming up"}
          </div>
        </div>
      </div>
    </div>
  );
}
