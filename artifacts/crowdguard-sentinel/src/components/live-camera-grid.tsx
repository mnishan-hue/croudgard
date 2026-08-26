import { useEffect, useRef } from "react";
import { ExternalLink, Radio, Users } from "lucide-react";
import { Link } from "wouter";
import { CameraStream } from "@/components/camera-stream";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { BackendSnapshot } from "@/types/sentinel";

export function LiveCameraGrid({ snapshot }: { snapshot: BackendSnapshot }) {
  const station = useBrowserCameras();
  const cameras = snapshot.facility.cameras.filter((camera) => camera.enabled);
  const reporting = new Set(snapshot.reporting_camera_ids);
  const streaming = new Set(snapshot.streaming_camera_ids ?? []);
  const columns =
    cameras.length === 1
      ? "grid-cols-1"
      : cameras.length === 2
        ? "md:grid-cols-2"
        : cameras.length <= 4
          ? "md:grid-cols-2 xl:grid-cols-3"
          : "sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div
      className={
        "grid gap-3 " +
        columns +
        (cameras.length > 9 ? " max-h-[760px] overflow-y-auto pr-1" : "")
      }
    >
      {cameras.map((camera) => {
        const zones = snapshot.facility.zones.filter((zone) =>
          camera.zone_ids.includes(zone.id),
        );
        const primary = [...zones].sort((a, b) => b.risk - a.risk)[0];
        const live = reporting.has(camera.id);
        const videoLive = streaming.has(camera.id);
        const browserSource = Boolean(station.videos[camera.id]);
        const recorded = browserSource && station.sourceMode === "DEMO_VIDEOS";
        const browserMetric = station.metrics[camera.id];
        const analyzed = live || Boolean(browserMetric);

        return (
          <Link
            key={camera.id}
            href={"/cameras/" + encodeURIComponent(camera.id)}
            className="group overflow-hidden border border-border bg-card transition-colors hover:border-primary/50"
          >
            <div className="relative">
              {browserSource ? (
                <NativeCameraStream
                  cameraName={camera.name}
                  source={station.videos[camera.id]}
                  stream={station.streams[camera.id]}
                />
              ) : (
                <CameraStream
                  cameraId={camera.id}
                  cameraName={camera.name}
                  streaming={videoLive}
                  compact
                />
              )}
              <ExternalLink
                size={13}
                className="absolute right-3 top-3 z-10 text-muted-foreground group-hover:text-primary"
              />
              {browserSource && (
                <div className="absolute bottom-2 left-2 z-10 flex gap-1">
                  <span className="status-chip py-1 text-secondary">
                    {recorded ? "RECORDED VIDEO" : "LIVE CAMERA"}
                  </span>
                  <span className="status-chip py-1 text-secondary">
                    <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />
                    ANALYSIS LIVE
                  </span>
                </div>
              )}
            </div>
            <div className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold">{camera.name}</div>
                  <div className="mt-1 text-[9px] text-muted-foreground">
                    {zones.map((zone) => zone.name).join(", ") || "Unassigned"}
                  </div>
                </div>
                <div className="flex items-center gap-1 data-mono text-[10px] text-secondary">
                  <Users size={12} />
                  {analyzed
                    ? (browserMetric?.peopleCount ??
                      primary?.metrics.people_count ??
                      0)
                    : "—"}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-px bg-border">
                <Datum
                  label="STATE"
                  value={
                    live
                      ? (primary?.crowd_state.replaceAll("_", " ") ?? "NO DATA")
                      : "NO DATA"
                  }
                />
                <Datum
                  label="RISK"
                  value={live ? String(Math.round(primary?.risk ?? 0)) : "—"}
                />
                <Datum
                  label="TREND"
                  value={live ? (primary?.metrics.trend ?? "—") : "—"}
                />
                <Datum
                  label="FPS"
                  value={
                    browserMetric?.fps
                      ? browserMetric.fps.toFixed(1)
                      : live && primary?.metrics.fps
                        ? primary.metrics.fps.toFixed(1)
                        : "—"
                  }
                />
              </div>
            </div>
          </Link>
        );
      })}
      {!cameras.length && (
        <div className="panel col-span-full grid min-h-40 place-items-center text-[11px] text-muted-foreground">
          No enabled cameras are configured.
        </div>
      )}
    </div>
  );
}

function NativeCameraStream({
  cameraName,
  source,
  stream,
}: {
  cameraName: string;
  source: HTMLVideoElement;
  stream?: MediaStream;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.playsInline = true;

    if (stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
      return () => {
        video.pause();
        video.srcObject = null;
      };
    }

    video.srcObject = null;
    video.src = source.currentSrc || source.src;
    const synchronize = () => {
      if (Math.abs(video.currentTime - source.currentTime) > 0.25) {
        video.currentTime = source.currentTime;
      }
      video.playbackRate = source.playbackRate;
      if (source.paused) video.pause();
      else void video.play().catch(() => undefined);
    };
    synchronize();
    const timer = window.setInterval(synchronize, 300);
    return () => {
      window.clearInterval(timer);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [source, stream]);

  return (
    <div className="relative aspect-video overflow-hidden bg-[#071019]">
      <video
        ref={ref}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
        aria-label={`Native live footage from ${cameraName}`}
      />
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-sm border border-secondary/40 bg-[#071019]/80 px-2 py-1 data-mono text-[7px] text-secondary backdrop-blur">
        <Radio size={9} /> NATIVE LIVE VIDEO
      </div>
    </div>
  );
}
function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-2">
      <div className="data-mono text-[7px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[9px] text-foreground">{value}</div>
    </div>
  );
}
