import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { LiveCameraGrid } from "@/components/live-camera-grid";
import { MapPanel, PageIntro, Panel } from "@/components/sentinel-shell";
import { SourceControl } from "@/components/source-control";
import { useBrowserCameras } from "@/hooks/use-browser-cameras";
import { useSentinel } from "@/hooks/use-sentinel";
import { apiFetch } from "@/services/api";
import type { BackendSnapshot, Exit, Zone } from "@/types/sentinel";

export default function Operations() {
  const { snapshot, refresh, error } = useSentinel();
  const cameraStation = useBrowserCameras();
  const [changingAuto, setChangingAuto] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);

  const isLocalRunning = cameraStation.status === "RUNNING";

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
  const hardwareConfigured = facility.sentinels.some(
    (sentinel) =>
      Boolean(sentinel.ip_address) ||
      (sentinel.protocol === "CLOUD_POLL" &&
        sentinel.device_id !== "unconfigured"),
  );
  const monitoring = snapshot.camera_ai_active || isLocalRunning;
  const enabledExits = facility.exits.filter((exit) => exit.enabled);

  const exitSummary = enabledExits.map((exit) => {
    const zone = facility.zones.find((item) => item.id === exit.zone_id);
    const reporting =
      zone?.camera_ids.some(
        (cameraId) =>
          snapshot.reporting_camera_ids.includes(cameraId) ||
          Boolean(
            cameraStation.metrics[cameraId] &&
            !cameraStation.metrics[cameraId].isWarmingUp,
          ),
      ) ?? false;
    return {
      exit,
      level: reporting ? crowdLevel(exit.risk) : "WAITING",
      trend:
        reporting && zone?.metrics.trend !== "UNAVAILABLE"
          ? (zone?.metrics.trend ?? "WAITING")
          : "WAITING",
    };
  });

  async function toggleAutomatic() {
    if (!snapshot) return;
    setChangingAuto(true);
    setControlError(null);
    try {
      await apiFetch<BackendSnapshot>("/control/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: !snapshot.automatic_control }),
      });
      await refresh();
    } catch (reason) {
      setControlError(
        reason instanceof Error
          ? reason.message
          : "Control mode could not be updated.",
      );
    } finally {
      setChangingAuto(false);
    }
  }

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Live operations"
        title="See the crowd. Act quickly."
        description="Calm queue guidance, exit conditions and ESP32 status on one operator screen."
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

      <section className="mb-4 grid overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-[1.35fr_.95fr_.8fr_.8fr_.95fr] lg:gap-px">
        <div className="bg-card p-4">
          <div className="text-[9px] font-medium uppercase tracking-[.14em] text-muted-foreground">
            System decision
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${decision.route_state === "NEUTRAL" ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
            >
              {decision.route_state === "NEUTRAL" ? (
                <CheckCircle2 size={16} />
              ) : (
                <ArrowRight size={16} />
              )}
            </span>
            <div>
              <div className="text-lg font-semibold leading-tight">
                {monitoring
                  ? decisionMessage(decision.route_state)
                  : "WAITING FOR CAMERAS"}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {monitoring
                  ? recommendedExit
                    ? `Recommended route: ${recommendedExit.name}`
                    : decision.route_state === "NEUTRAL"
                      ? "Both exits available"
                      : "No preferred exit"
                  : "No operational guidance yet"}
              </div>
            </div>
          </div>
        </div>

        <QuickStatus
          label="Main Area"
          value={monitoring ? (snapshot.queue_level ?? "ANALYZING") : "WAITING"}
          lines={[
            `Trend: ${monitoring ? (snapshot.queue_trend ?? "Analyzing") : "Waiting"}`,
            `Wait: ${monitoring ? (snapshot.estimated_wait_label ?? "Analyzing") : "—"}`,
          ]}
        />

        {exitSummary.slice(0, 2).map(({ exit, level, trend }) => (
          <QuickStatus
            key={exit.id}
            label={exit.name}
            value={level}
            lines={[
              `Trend: ${trend}`,
              exit.id === decision.recommended_exit_id
                ? "RECOMMENDED"
                : "Route monitored",
            ]}
            recommended={exit.id === decision.recommended_exit_id}
          />
        ))}

        <QuickStatus
          icon={Cpu}
          label="Control"
          value={connectedSentinels ? "ESP32 ONLINE" : "ESP32 OFFLINE"}
          lines={[
            `Intervention: ${monitoring ? humanize(snapshot.intervention.status) : "Waiting"}`,
            snapshot.automatic_control ? "Automatic mode" : "Manual mode",
          ]}
          warning={!connectedSentinels}
        />
      </section>

      {!monitoring && <SourceControl cameras={facility.cameras} />}

      <Panel
        title="Live cameras (Main Area · Exit A · Exit B)"
        eyebrow={
          monitoring
            ? "SYNCHRONIZED NATIVE PLAYBACK · BACKGROUND AI"
            : "CONNECT A SOURCE ABOVE"
        }
        className="mb-5 rounded-xl"
      >
        <div className="p-3">
          <LiveCameraGrid snapshot={snapshot} />
        </div>
      </Panel>

      {monitoring && <SourceControl cameras={facility.cameras} />}

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
                  ) : decision.action === "CRITICAL" ? (
                    <ShieldAlert size={19} />
                  ) : (
                    <ArrowRight size={19} />
                  )}
                </span>
                <div>
                  <h3 className="text-base font-semibold">
                    {!monitoring
                      ? "Connect cameras to begin"
                      : decisionMessage(decision.route_state)}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {decision.reason}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-px bg-border sm:grid-cols-3">
              <DecisionDatum
                label="System decision"
                value={monitoring ? humanize(decision.route_state) : "Waiting"}
              />
              <DecisionDatum
                label="Recommended exit"
                value={
                  monitoring
                    ? (recommendedExit?.name ??
                      (decision.route_state === "NEUTRAL"
                        ? "Both clear"
                        : "None"))
                    : "Waiting"
                }
              />
              <DecisionDatum
                label="Intervention"
                value={
                  monitoring
                    ? humanize(snapshot.intervention.status)
                    : "Waiting"
                }
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {facility.exits
                .filter((exit) => exit.enabled)
                .map((exit) => (
                  <ExitCard
                    key={exit.id}
                    exit={exit}
                    zone={facility.zones.find(
                      (zone) => zone.id === exit.zone_id,
                    )}
                    reporting={
                      facility.zones
                        .find((zone) => zone.id === exit.zone_id)
                        ?.camera_ids.some(
                          (cameraId) =>
                            snapshot.reporting_camera_ids.includes(cameraId) ||
                            Boolean(
                              cameraStation.metrics[cameraId] &&
                              !cameraStation.metrics[cameraId].isWarmingUp,
                            ),
                        ) ?? false
                    }
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
                  AI decisions continue if the ESP32 is temporarily offline.
                </div>
              </div>
              <button
                className={
                  snapshot.automatic_control
                    ? "button-primary"
                    : "button-secondary"
                }
                disabled={changingAuto}
                onClick={() => void toggleAutomatic()}
              >
                {changingAuto
                  ? "Updating…"
                  : snapshot.automatic_control
                    ? "Automatic on"
                    : "Enable automatic"}
              </button>
            </div>
            {controlError && (
              <p role="alert" className="mt-3 text-[11px] text-destructive">
                {controlError}
              </p>
            )}
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
          Configure ESP32 <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

function QuickStatus({
  icon: Icon,
  label,
  value,
  lines,
  recommended = false,
  warning = false,
}: {
  icon?: typeof ShieldAlert;
  label: string;
  value: string;
  lines: string[];
  recommended?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={`bg-card p-4 ${recommended ? "ring-1 ring-inset ring-secondary/50" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[.14em] text-muted-foreground">
        {Icon && <Icon size={12} />}
        {label}
      </div>
      <div
        className={`mt-2 text-sm font-semibold ${recommended ? "text-secondary" : warning ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </div>
      <div className="mt-2 space-y-0.5 text-[9px] text-muted-foreground">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}

function ExitCard({
  exit,
  zone,
  reporting,
  selected,
}: {
  exit: Exit;
  zone?: Zone;
  reporting: boolean;
  selected: boolean;
}) {
  const level = reporting ? crowdLevel(exit.risk) : "WAITING";
  const safe = level === "LOW";
  return (
    <div
      className={`rounded-lg border p-3 ${selected ? "border-secondary bg-secondary/5" : "border-border bg-background"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{exit.name}</span>
        <span
          className={`rounded-full px-2 py-1 text-[9px] ${safe ? "bg-secondary/15 text-secondary" : "bg-primary/15 text-primary"}`}
        >
          {level}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Crowd level
          </div>
          <div className="mt-1 text-lg font-semibold">{level}</div>
        </div>
        {selected && (
          <span className="text-[9px] font-medium text-secondary">
            Recommended
          </span>
        )}
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground">
        Trend:{" "}
        <span className="font-medium text-foreground">
          {zone?.metrics.trend === "UNAVAILABLE" || !zone
            ? "Waiting"
            : zone.metrics.trend}
        </span>
      </div>
    </div>
  );
}

function DecisionDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-3">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function crowdLevel(risk: number) {
  if (risk >= 75) return "VERY HIGH";
  if (risk >= 55) return "HIGH";
  if (risk >= 35) return "MODERATE";
  return "LOW";
}

function decisionMessage(state: BackendSnapshot["decision"]["route_state"]) {
  if (state === "REDIRECT_A") return "USE EXIT A";
  if (state === "REDIRECT_B") return "USE EXIT B";
  if (state === "BOTH_BUSY") return "PLEASE WALK SLOWLY";
  return "THANK YOU";
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
