import { useEffect, useRef } from "react";
import { Activity, ExternalLink, Radio } from "lucide-react";
import { Link } from "wouter";
import { CameraStream } from "@/components/camera-stream";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import type { BackendSnapshot } from "@/types/sentinel";
import type { CameraAnalysisMetrics } from "@/lib/cv-detection";

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
        const isMainArea = zones.some((zone) => zone.type === "MAIN_AREA");
        const live = reporting.has(camera.id);
        const videoLive = streaming.has(camera.id);
        const browserSource = Boolean(station.videos[camera.id]);
        const recorded = browserSource && station.sourceMode === "DEMO_VIDEOS";
        const browserMetric = station.metrics[camera.id];
        const isRunning = station.status === "RUNNING";

        const hasAnalyzedData = browserMetric && !browserMetric.isWarmingUp;

        const riskValue = hasAnalyzedData
          ? Math.round(browserMetric.riskScore)
          : live
            ? Math.round(primary?.risk ?? 0)
            : "—";

        const trendValue = hasAnalyzedData
          ? browserMetric.trend
          : live
            ? (primary?.metrics.trend ?? "—")
            : "—";

        return (
          <Link
            key={camera.id}
            href={"/cameras/" + encodeURIComponent(camera.id)}
            className="group overflow-hidden border border-border bg-card transition-colors hover:border-primary/50"
          >
            <div className="relative aspect-video overflow-hidden bg-[#071019]">
              {browserSource ? (
                <DirectCameraFeed
                  cameraName={camera.name}
                  sourceVideo={station.videos[camera.id]}
                  stream={station.streams[camera.id]}
                  metric={browserMetric}
                  overlayLabel={
                    isMainArea
                      ? snapshot.queue_level
                        ? `QUEUE ${snapshot.queue_level} · WAIT ${snapshot.estimated_wait_label ?? "—"}`
                        : "MAIN QUEUE ANALYZING"
                      : "EXIT ANALYSIS ACTIVE"
                  }
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
                <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex gap-1">
                  <span className="status-chip py-0.5 text-[8px] text-secondary">
                    SOURCE: {recorded ? "RECORDED VIDEO" : "LIVE CAMERA"}
                  </span>
                  <span className="status-chip py-0.5 text-[8px] text-secondary">
                    <span className="status-pulse h-1.5 w-1.5 rounded-full bg-secondary" />
                    {hasAnalyzedData
                      ? "ANALYSIS: LIVE AI"
                      : "ANALYSIS: WARMING UP"}
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
                <div className="flex items-center gap-1.5 data-mono text-[11px] font-semibold text-secondary">
                  <Activity size={13} />
                  <span>
                    {isMainArea
                      ? (snapshot.queue_level ??
                        (isRunning ? "Analyzing" : "—"))
                      : live || hasAnalyzedData
                        ? "Live"
                        : "—"}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-px bg-border">
                <Datum
                  label="STATE"
                  value={
                    hasAnalyzedData
                      ? stateForRisk(browserMetric.riskScore)
                      : live
                        ? (primary?.crowd_state.replaceAll("_", " ") ??
                          "NO DATA")
                        : isRunning
                          ? "INITIALIZING"
                          : "NO DATA"
                  }
                />
                <Datum
                  label="LEVEL"
                  value={
                    riskValue !== "—" ? crowdLevel(Number(riskValue)) : "—"
                  }
                />
                <Datum label="TREND" value={trendValue} />
                <Datum
                  label="ANALYSIS"
                  value={
                    hasAnalyzedData || live
                      ? "LIVE AI"
                      : isRunning
                        ? "STARTING"
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

function DirectCameraFeed({
  cameraName,
  sourceVideo,
  stream,
  metric,
  overlayLabel,
}: {
  cameraName: string;
  sourceVideo: HTMLVideoElement;
  stream?: MediaStream;
  metric?: CameraAnalysisMetrics;
  overlayLabel: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep a stable display element. The AI source video is never moved between
  // the dashboard and source dialog, avoiding detachments and playback stalls.
  useEffect(() => {
    const displayVideo = videoRef.current;
    if (!displayVideo) return;

    displayVideo.muted = true;
    displayVideo.playsInline = true;
    let capturedStream: MediaStream | undefined;
    let synchronizationTimer: number | undefined;

    if (stream) {
      displayVideo.srcObject = stream;
    } else {
      const capturable = sourceVideo as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const capture = capturable.captureStream ?? capturable.mozCaptureStream;
      if (capture) {
        try {
          capturedStream = capture.call(sourceVideo);
          displayVideo.srcObject = capturedStream;
        } catch {
          capturedStream = undefined;
        }
      }

      if (!capturedStream) {
        displayVideo.srcObject = null;
        displayVideo.src = sourceVideo.currentSrc || sourceVideo.src;
        const synchronize = () => {
          if (
            Math.abs(displayVideo.currentTime - sourceVideo.currentTime) > 0.25
          ) {
            displayVideo.currentTime = sourceVideo.currentTime;
          }
          displayVideo.playbackRate = sourceVideo.playbackRate;
          if (sourceVideo.paused) displayVideo.pause();
          else void displayVideo.play().catch(() => undefined);
        };
        synchronize();
        synchronizationTimer = window.setInterval(synchronize, 300);
      }
    }

    if (!sourceVideo.paused) {
      void displayVideo.play().catch(() => undefined);
    }

    return () => {
      if (synchronizationTimer !== undefined) {
        window.clearInterval(synchronizationTimer);
      }
      displayVideo.pause();
      displayVideo.srcObject = null;
      displayVideo.removeAttribute("src");
      displayVideo.load();
      capturedStream?.getTracks().forEach((track) => track.stop());
    };
  }, [sourceVideo, stream]);

  // Redraw only when a new AI result arrives, not on every video frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const displayWidth = canvas.clientWidth || 300;
    const displayHeight = canvas.clientHeight || 168;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!metric || metric.isWarmingUp || !metric.boxes.length) return;

    const sourceWidth = 300;
    const sourceHeight = Math.round(
      ((sourceVideo.videoHeight || 360) / (sourceVideo.videoWidth || 640)) *
        300,
    );
    const scaleX = displayWidth / sourceWidth;
    const scaleY = displayHeight / (sourceHeight || 168);

    context.lineWidth = 2;
    context.strokeStyle = "#2dd4bf";
    context.fillStyle = "#071019cc";
    context.font = "bold 10px monospace";

    for (const person of metric.boxes) {
      const [x, y, boxWidth, boxHeight] = person.bbox;
      const left = x * scaleX;
      const top = y * scaleY;
      const width = boxWidth * scaleX;
      const height = boxHeight * scaleY;
      context.strokeRect(left, top, width, height);

      const label = `DETECTION ${Math.round(person.score * 100)}%`;
      const textWidth = context.measureText(label).width + 6;
      context.fillRect(left, Math.max(0, top - 15), textWidth, 15);
      context.fillStyle = "#2dd4bf";
      context.fillText(label, left + 3, Math.max(10, top - 3));
      context.fillStyle = "#071019cc";
    }

    context.fillStyle = "#071019e0";
    context.fillRect(
      6,
      6,
      Math.min(260, context.measureText(overlayLabel).width + 14),
      20,
    );
    context.fillStyle = "#2dd4bf";
    context.fillText(overlayLabel, 12, 20);
  }, [metric, overlayLabel, sourceVideo]);

  return (
    <div className="relative h-full w-full bg-[#071019]">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-full w-full object-contain"
        aria-label={`Native live footage from ${cameraName}`}
      />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-sm border border-secondary/40 bg-[#071019]/80 px-2 py-1 data-mono text-[7px] text-secondary backdrop-blur">
        <Radio size={9} /> NATIVE LIVE VIDEO · {cameraName}
      </div>
    </div>
  );
}
function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-2">
      <div className="data-mono text-[7px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[9px] font-medium text-foreground">
        {value}
      </div>
    </div>
  );
}

function stateForRisk(risk: number): string {
  if (risk >= 90) return "CRITICAL RISK";
  if (risk >= 75) return "FLOW INSTABILITY";
  if (risk >= 60) return "CONGESTED";
  if (risk >= 40) return "CONGESTION BUILDING";
  return "NORMAL";
}

function crowdLevel(risk: number): string {
  if (risk >= 75) return "VERY HIGH";
  if (risk >= 55) return "HIGH";
  if (risk >= 35) return "MODERATE";
  return "LOW";
}
