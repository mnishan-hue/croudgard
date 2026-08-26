import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Cpu,
  Map,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { LiveCameraGrid } from "@/components/live-camera-grid";
import { MapPanel, PageIntro, Panel } from "@/components/sentinel-shell";
import { SourceControl } from "@/components/source-control";
import { useSentinel } from "@/hooks/use-sentinel";
import { apiFetch } from "@/services/api";
import type { BackendSnapshot, Exit } from "@/types/sentinel";

export default function Operations() {
  const { snapshot, refresh, error } = useSentinel();
  const [changingAuto, setChangingAuto] = useState(false);

  const totalPeople = useMemo(
    () =>
      snapshot?.facility.zones.reduce(
        (total, zone) => total + zone.metrics.people_count,
        0,
      ) ?? 0,
    [snapshot],
  );

  if (!snapshot) {
    return (
      <div>
        <PageIntro
          eyebrow="Operations"
          title="Live overview"
          description="Connect the backend to begin monitoring."
        />
        <div className="grid min-h-64 place-items-center rounded-xl border border-border bg-card p-8 text-center">
          <div>
            <ShieldAlert className="mx-auto text-primary" size={30} />
            <h2 className="mt-3 text-sm font-semibold">Backend unavailable</h2>
            <p className="mt-2 max-w-md text-xs text-muted-foreground">
              {error ?? "Start CrowdGuard locally and refresh this page."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { facility, prediction, decision } = snapshot;
  const recommendedExit = facility.exits.find(
    (exit) => exit.id === decision.recommended_exit_id,
  );
  const connectedSentinels = facility.sentinels.filter(
    (sentinel) => sentinel.connected,
  ).length;
  const risk = Math.round(prediction.risk);
  const monitoring = snapshot.camera_ai_active;

  async function toggleAutomatic() {
    if (!snapshot) return;
    setChangingAuto(true);
    try {
      await apiFetch<BackendSnapshot>("/control/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: !snapshot.automatic_control }),
      });
      await refresh();
    } finally {
      setChangingAuto(false);
    }
  }

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Live operations"
        title="See the crowd. Act quickly."
        description="Cameras, people count, exit safety and ESP32 guidance are kept together on one clear operator screen."
        action={
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1.5 text-[10px] font-medium ${monitoring ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
            >
              {monitoring ? "Monitoring live" : "Waiting for cameras"}
            </span>
          </div>
        }
      />

      <SourceControl cameras={facility.cameras} />

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Users}
          label="People now"
          value={monitoring ? String(totalPeople) : "—"}
          detail={
            monitoring ? "Across monitored zones" : "Start a camera source"
          }
          tone="teal"
        />
        <Metric
          icon={ShieldAlert}
          label="Current risk"
          value={monitoring ? `${risk}%` : "—"}
          detail={
            monitoring
              ? humanize(prediction.crowd_state)
              : "No live classification"
          }
          tone={risk >= 70 ? "red" : risk >= 40 ? "amber" : "teal"}
        />
        <Metric
          icon={Camera}
          label="Camera AI"
          value={`${snapshot.reporting_camera_ids.length}/${facility.cameras.filter((camera) => camera.enabled).length}`}
          detail="Sources reporting"
          tone={snapshot.reporting_camera_ids.length ? "teal" : "amber"}
        />
        <Metric
          icon={Cpu}
          label="ESP32"
          value={connectedSentinels ? "Connected" : "Setup needed"}
          detail={
            connectedSentinels
              ? `${connectedSentinels} field unit online`
              : "Open Devices to connect"
          }
          tone={connectedSentinels ? "teal" : "amber"}
        />
      </section>

      <Panel
        title="Live cameras"
        eyebrow={
          monitoring
            ? "NATIVE PLAYBACK · BACKGROUND AI"
            : "CONNECT A SOURCE ABOVE"
        }
        className="mb-5 rounded-xl"
      >
        <div className="p-3">
          <LiveCameraGrid snapshot={snapshot} />
        </div>
      </Panel>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <Panel
          title="Current decision"
          eyebrow={
            monitoring ? humanize(decision.action) : "WAITING FOR CAMERA DATA"
          }
          className="rounded-xl"
        >
          <div className="p-5">
            <div
              className={`rounded-xl border p-4 ${decision.action === "NORMAL" ? "border-secondary/30 bg-secondary/5" : "border-primary/35 bg-primary/5"}`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${decision.action === "NORMAL" ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
                >
                  {decision.action === "NORMAL" ? (
                    <CheckCircle2 size={19} />
                  ) : (
                    <ArrowRight size={19} />
                  )}
                </span>
                <div>
                  <h3 className="text-base font-semibold">
                    {!monitoring
                      ? "Connect cameras to begin"
                      : recommendedExit
                        ? `Guide people toward ${recommendedExit.name}`
                        : "Normal crowd flow"}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {decision.reason}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {facility.exits
                .filter((exit) => exit.enabled)
                .map((exit) => (
                  <ExitCard
                    key={exit.id}
                    exit={exit}
                    selected={exit.id === decision.recommended_exit_id}
                  />
                ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <div>
                <div className="text-xs font-semibold">
                  Automatic ESP32 guidance
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Requires a connected device and current exit cameras.
                </div>
              </div>
              <button
                className={
                  snapshot.automatic_control
                    ? "button-primary"
                    : "button-secondary"
                }
                disabled={
                  changingAuto ||
                  (!snapshot.automatic_control && connectedSentinels === 0)
                }
                onClick={() => void toggleAutomatic()}
              >
                {changingAuto
                  ? "Updating…"
                  : snapshot.automatic_control
                    ? "Automatic on"
                    : "Enable automatic"}
              </button>
            </div>
          </div>
        </Panel>

        <Panel
          title="Facility map"
          eyebrow="ROUTES AND EXIT STATUS"
          className="rounded-xl"
        >
          <MapPanel />
        </Panel>
      </section>

      <details className="mt-5 rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer items-center gap-3 p-4 text-xs font-semibold">
          <Sparkles size={16} className="text-primary" />
          Advanced AI details
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            Open only when needed
          </span>
        </summary>
        <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2 xl:grid-cols-3">
          {prediction.explanations.length ? (
            prediction.explanations.map((item) => (
              <div
                key={item.signal}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {humanize(item.signal)}
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {Math.round(item.value)}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              AI explanations appear after camera analysis begins.
            </p>
          )}
        </div>
      </details>

      <div className="mt-5 flex justify-end">
        <Link href="/hardware" className="button-secondary">
          <Cpu size={13} /> Configure ESP32 <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "amber" | "red";
}) {
  const color =
    tone === "red"
      ? "text-destructive bg-destructive/10"
      : tone === "amber"
        ? "text-primary bg-primary/10"
        : "text-secondary bg-secondary/10";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${color}`}>
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function ExitCard({ exit, selected }: { exit: Exit; selected: boolean }) {
  const safe = exit.status === "AVAILABLE";
  return (
    <div
      className={`rounded-lg border p-3 ${selected ? "border-secondary bg-secondary/5" : "border-border bg-background"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{exit.name}</span>
        <span
          className={`rounded-full px-2 py-1 text-[9px] ${safe ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
        >
          {humanize(exit.status)}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Risk
          </div>
          <div className="mt-1 text-lg font-semibold">
            {Math.round(exit.risk)}%
          </div>
        </div>
        {selected && (
          <span className="text-[9px] font-medium text-secondary">
            Recommended
          </span>
        )}
      </div>
    </div>
  );
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
