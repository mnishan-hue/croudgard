import {
  ArrowLeft,
  Camera,
  CircleCheck,
  CircleOff,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { PageIntro, Panel } from "@/components/sentinel-shell";
import { CameraStream } from "@/components/camera-stream";
import { useSentinel } from "@/hooks/use-sentinel";

export default function CameraDetail() {
  const params = useParams<{ cameraId: string }>();
  const cameraId = params?.cameraId ?? "";
  const { snapshot, refresh } = useSentinel();
  const camera = snapshot?.facility.cameras.find(
    (item) => item.id === safeDecode(cameraId),
  );
  const zones =
    snapshot?.facility.zones.filter((zone) =>
      camera?.zone_ids?.includes(zone.id),
    ) ?? [];
  const primary = [...zones].sort((a, b) => b.risk - a.risk)[0];

  if (!snapshot)
    return (
      <div className="panel grid min-h-64 place-items-center p-8 text-center">
        <div>
          <div className="data-mono text-[11px] text-primary">
            BACKEND OFFLINE
          </div>
          <button
            onClick={() => void refresh()}
            className="mt-4 border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  if (!camera)
    return (
      <div className="panel grid min-h-64 place-items-center p-8 text-center">
        <div>
          <div className="data-mono text-[11px] text-destructive">
            CAMERA NOT FOUND
          </div>
          <Link
            href="/cameras"
            className="mt-4 inline-flex border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary"
          >
            BACK TO CAMERA GRID
          </Link>
        </div>
      </div>
    );

  const metrics = primary?.metrics;
  const reporting = snapshot.reporting_camera_ids.includes(camera.id);
  const streaming = snapshot.streaming_camera_ids?.includes(camera.id) ?? false;
  const values: [string, string, string?][] = [
    ["Crowd condition", reporting?humanize(primary?.crowd_state ?? "NO DATA"):"—"],
    ["People detected", reporting?formatNumber(metrics?.people_count):"—"],
    ["Density score", reporting?formatNumber(metrics?.density, " / 100"):"—"],
    ["Tracker speed", reporting&&metrics?.available_metrics.includes("movement")?formatNumber(metrics.average_speed, " px/s", 1):"Unavailable"],
    ["Movement direction", reporting&&metrics?.movement_direction?humanize(metrics.movement_direction):"Unavailable"],
    ["People entering", reporting&&metrics?.available_metrics.includes("inflow")?formatNumber(metrics.inflow):"Unavailable"],
    ["People leaving", reporting&&metrics?.available_metrics.includes("outflow")?formatNumber(metrics.outflow):"Unavailable"],
    ["People stopped", reporting&&metrics?.available_metrics.includes("stopped_percentage")?formatNumber(metrics.stopped_percentage, "%"):"Unavailable"],
    ["Queue growth", reporting&&metrics?.available_metrics.includes("queue_growth")?formatNumber(metrics.queue_growth, " people/s", 2):"Unavailable"],
    ["Direction conflict", reporting&&metrics?.available_metrics.includes("direction_conflict")?formatNumber(metrics?.direction_conflict, "%"):"Unavailable"],
    ["Movement disturbance", reporting&&metrics?.experimental_metrics.includes("movement_disturbance")?`${humanize(snapshot.prediction.ripple_state)} · experimental`:"Unavailable"],
    ["Current risk", reporting?formatNumber(primary?.risk, " / 100"):"—"],
    ["Processing rate", reporting&&metrics?.fps?formatNumber(metrics.fps, " FPS", 1):"—"],
    ["Trend", reporting?humanize(metrics?.trend??"UNAVAILABLE"):"—"],
  ];

  const online = camera.enabled && camera.status === "ONLINE";

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Camera monitoring"
        title={camera.name}
        description="Review this camera's live AI analysis, coverage area, and current crowd conditions in one place."
        action={
          <Link href="/cameras" className="button-secondary">
            <ArrowLeft size={14} /> All cameras
          </Link>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary
          icon={online ? CircleCheck : CircleOff}
          label="Camera status"
          value={
            reporting && streaming
              ? "Video and AI reporting"
              : reporting
                ? "AI reporting · video unavailable"
              : streaming
                ? "Video streaming · AI waiting"
              : online
                ? "Configured · waiting for worker"
              : camera.enabled
                ? humanize(camera.status)
                : "Disabled"
          }
          tone={reporting ? "good" : online ? "neutral" : "bad"}
        />
        <Summary
          icon={MapPin}
          label="Coverage"
          value={
            zones.map((zone) => zone.name).join(", ") || "No zone assigned"
          }
        />
        <Summary
          icon={ShieldCheck}
          label="AI analysis"
          value={camera.ai_enabled ? reporting ? "Reporting live" : "Ready for live camera" : "Disabled"}
          tone={reporting ? "good" : "neutral"}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel
          title="Live annotated footage"
          eyebrow={streaming ? "STREAMING FROM EDGE WORKER" : online ? "WAITING FOR EDGE WORKER" : "CAMERA UNAVAILABLE"}
        >
          <CameraStream cameraId={camera.id} cameraName={camera.name} streaming={streaming} />
          <p className="border-t border-border p-3 text-[9px] leading-relaxed text-muted-foreground">
            Detection overlays are produced by YOLO and ByteTrack. The backend
            keeps only the newest frame in memory and does not write footage to
            disk.
          </p>
        </Panel>
        <Panel title="Camera information" eyebrow="SETUP AND COVERAGE">
          <div className="divide-y divide-border">
            {[
              ["Camera ID", camera.id],
              ["Camera type", humanize(camera.camera_type)],
              ["AI provider", snapshot.ai_provider || "Not reported"],
              [
                "AI confidence",
                !reporting
                  ? "Unavailable"
                  : metrics?.people_count === 0
                    ? "No people detected"
                    : formatNumber(metrics?.confidence, "%"),
              ],
              [
                "Assigned zones",
                zones.map((zone) => zone.name).join(", ") || "Unassigned",
              ],
              ["Video source", camera.source || "Not configured"],
            ].map(([label, value]) => (
              <div key={label} className="p-4">
                <div className="data-mono text-[8px] text-muted-foreground">
                  {label}
                </div>
                <div className="mt-2 break-words text-[11px] text-foreground">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title="Current crowd conditions"
        eyebrow={primary ? `LIVE DATA · ${primary.name}` : "NO ZONE DATA"}
        className="mt-5"
      >
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {values.map(([label, value]) => (
            <div key={label} className="bg-card p-4">
              <div className="text-[10px] text-muted-foreground">{label}</div>
              <div className="data-mono mt-2 text-[14px] font-semibold text-foreground">
                {value}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function numberOrNull(value: unknown) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}
function formatNumber(value: unknown, suffix = "", digits = 0) {
  const result = numberOrNull(value);
  return result === null ? "—" : `${result.toFixed(digits)}${suffix}`;
}
function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function Summary({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof Camera;
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone === "good" ? "bg-secondary/10 text-secondary" : tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
      >
        <Icon size={19} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-[13px] font-semibold">{value}</div>
      </div>
    </div>
  );
}
