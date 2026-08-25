import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  CircleAlert,
  Gauge,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MapPanel, PageIntro, Panel } from "@/components/sentinel-shell";
import { useSentinel } from "@/hooks/use-sentinel";
import { apiFetch } from "@/services/api";
import type { BackendSnapshot } from "@/types/sentinel";
import { TeachableCamera } from "@/components/teachable-camera";
import { LiveCameraGrid } from "@/components/live-camera-grid";

export default function LiveControl() {
  const { snapshot, connection, refresh } = useSentinel();
  const [controlConfirm, setControlConfirm] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const chart = useMemo(
    () =>
      snapshot?.risk_timeline.map((sample) => ({
        time: new Date(sample.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        risk: sample.risk,
        intervention: sample.intervention,
      })) ?? [],
    [snapshot],
  );
  const marker = chart.find((sample) => sample.intervention)?.time;
  if (!snapshot)
    return (
      <div className="enter-rise">
        <PageIntro
          eyebrow="01 / COMMAND SURFACE"
          title="Live Control"
          description="Waiting for the CrowdGuard backend. Operational values remain empty until current camera observations arrive."
        />
        <div className="panel grid min-h-72 place-items-center text-center">
          <div>
            <div className="data-mono text-[11px] text-primary">
              {connection === "connecting" ? "CONNECTING" : "BACKEND OFFLINE"}
            </div>
            <button
              onClick={() => void refresh()}
              className="mt-4 border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary"
            >
              RETRY
            </button>
          </div>
        </div>
      </div>
    );

  const { facility, prediction, decision, intervention } = snapshot;
  const affected = facility.zones.find(
    (zone) => zone.id === prediction.affected_zone_id,
  );
  const recommended = facility.exits.find(
    (exit) => exit.id === decision.recommended_exit_id,
  );
  const previous = chart.at(-2)?.risk ?? prediction.risk;
  const trend =
    prediction.risk < previous
      ? "IMPROVING"
      : prediction.risk > previous
        ? "WORSENING"
        : "STABLE";
  const critical = prediction.risk >= 90;
  const hasLiveAI = snapshot.camera_ai_active;
  const liveCamera = facility.cameras.find(
    (camera) =>
      camera.enabled && camera.ai_enabled && camera.status === "ONLINE",
  );

  async function toggleAutomatic() {
    setControlBusy(true);
    try {
      await apiFetch<BackendSnapshot>("/control/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: !snapshot!.automatic_control }),
      });
      await refresh();
      setControlConfirm(false);
    } finally {
      setControlBusy(false);
    }
  }

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Live safety overview"
        title="Crowd operations"
        description={`Start the camera below to generate live people counts, crowd classification, risk, and exit guidance for ${facility.name}.`}
        action={
          <div
            className={`status-chip ${hasLiveAI ? "text-secondary" : "text-primary"}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${hasLiveAI ? "status-pulse bg-secondary" : "bg-primary"}`}
            />
            <span>
              {hasLiveAI ? "Camera AI reporting" : "Waiting for camera AI"}
            </span>
          </div>
        }
      />
      {hasLiveAI ? (
        <section
          className={`mb-5 border p-4 ${critical ? "border-destructive/60 bg-destructive/10" : "border-primary/35 bg-primary/[.05]"}`}
        >
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="flex gap-3">
              <CircleAlert
                size={22}
                className={critical ? "text-destructive" : "text-primary"}
              />
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">
                  Current situation
                </div>
                <h2 className="mt-1 text-[17px] font-semibold">
                  {humanize(prediction.crowd_state)}
                  {affected ? ` in ${affected.name}` : ""}
                </h2>
                <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
                  {decision.reason}
                </p>
                {recommended && (
                  <p className="mt-3 text-[13px] font-semibold text-secondary">
                    Guide people toward {recommended.name}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border sm:grid-cols-4">
              <Brief label="Safer exit" value={recommended?.name ?? "None"} />
              <Brief
                label="Recommended action"
                value={humanize(decision.action)}
              />
              <Brief label="Response" value={humanize(intervention.status)} />
              <Brief label="Trend" value={humanize(trend)} />
            </div>
          </div>
        </section>
      ) : (
        <section className="mb-5 rounded-lg border border-primary/30 bg-primary/[.04] p-5">
          <div className="flex gap-3">
            <CircleAlert size={22} className="text-primary" />
            <div>
              <h2 className="text-[16px] font-semibold">
                No live camera measurements yet
              </h2>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Start live analysis below. Until the camera reports, CrowdGuard
                intentionally hides risk, people count, and exit
                recommendations.
              </p>
            </div>
          </div>
        </section>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={Gauge}
          label="Crowd risk"
          value={hasLiveAI ? String(Math.round(prediction.risk)) : "—"}
          unit={hasLiveAI ? "/ 100" : ""}
          note={
            hasLiveAI ? humanize(prediction.crowd_state) : "Waiting for camera"
          }
          danger={hasLiveAI && prediction.risk >= 75}
        />
        <Metric
          icon={Users}
          label="People detected"
          value={
            hasLiveAI
              ? String(
                  facility.zones.reduce(
                    (sum, zone) => sum + zone.metrics.people_count,
                    0,
                  ),
                )
              : "—"
          }
          unit={hasLiveAI ? "people" : ""}
          note={hasLiveAI ? "Live camera count" : "Waiting for camera"}
        />
        <Metric
          icon={ArrowRight}
          label="Best available exit"
          value={hasLiveAI ? (recommended?.name ?? "None") : "—"}
          unit={hasLiveAI ? "route" : ""}
          note={
            hasLiveAI && decision.exit_ranking.length
              ? `Ranked 1 of ${decision.exit_ranking.length}`
              : "Waiting for camera"
          }
        />
        <Metric
          icon={Bot}
          label="Guidance control"
          value={snapshot.automatic_control ? "Automatic" : "Manual"}
          unit="mode"
          note={
            facility.sentinels.every((item) => item.connected)
              ? "All units connected"
              : "A unit is offline"
          }
        />
      </div>
      {liveCamera && (
        <Panel
          title="Live camera AI"
          eyebrow={
            hasLiveAI
              ? "REPORTING TO CROWDGUARD"
              : "START ANALYSIS TO CREATE LIVE DATA"
          }
          className="mb-5"
        >
          <TeachableCamera cameraId={liveCamera.id} />
        </Panel>
      )}
      <Panel title="Camera network" eyebrow={`${snapshot.reporting_camera_ids.length} OF ${facility.cameras.filter((camera)=>camera.enabled).length} REPORTING`} className="mb-5">
        <div className="p-3"><LiveCameraGrid snapshot={snapshot}/></div>
      </Panel>
      <div
        className={`${hasLiveAI ? "grid" : "hidden"} gap-5 xl:grid-cols-[1.45fr_1fr]`}
      >
        <Panel
          title="Live facility map"
          eyebrow="DYNAMIC ZONES / ROUTES / JUNCTIONS"
        >
          <MapPanel />
        </Panel>
        <Panel title="Exit ranking" eyebrow="LOWER SAFETY SCORE IS BETTER">
          <div className="divide-y divide-border">
            {decision.exit_ranking.map((item, index) => (
              <div key={item.exit_id} className="flex items-center gap-3 p-4">
                <span className="data-mono text-[15px] text-primary">
                  #{index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold">{item.name}</div>
                  <div className="mt-1 data-mono text-[8px] text-muted-foreground">
                    {item.exit_id}
                  </div>
                </div>
                <span className="data-mono text-[12px] text-secondary">
                  {item.score}
                </span>
              </div>
            ))}
            {decision.exit_ranking.length === 0 && (
              <div className="p-8 text-center data-mono text-[9px] text-destructive">
                NO AVAILABLE EXIT
              </div>
            )}
          </div>
        </Panel>
      </div>
      <div
        className={`${hasLiveAI ? "grid" : "hidden"} mt-5 gap-5 xl:grid-cols-[1.45fr_1fr]`}
      >
        <Panel
          title="Risk trajectory"
          eyebrow="TIMESTAMPED BACKEND HISTORY"
          action={
            <span
              className={`flex items-center gap-1 data-mono text-[9px] ${trend === "IMPROVING" ? "text-secondary" : trend === "WORSENING" ? "text-destructive" : "text-primary"}`}
            >
              {trend === "IMPROVING" ? (
                <TrendingDown size={13} />
              ) : (
                <TrendingUp size={13} />
              )}{" "}
              {trend}
            </span>
          }
        >
          <div className="h-[250px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid
                  stroke="#263442"
                  strokeDasharray="2 5"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tick={{ fill: "#768493", fontSize: 8 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: "#768493", fontSize: 8 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#17232f",
                    border: "1px solid #334454",
                    fontSize: 10,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="risk"
                  stroke="#e8aa3d"
                  fill="#e8aa3d22"
                  strokeWidth={2}
                />
                {marker && (
                  <ReferenceLine
                    x={marker}
                    stroke="#41b4b9"
                    strokeDasharray="4 3"
                    label={{
                      value: "INTERVENTION",
                      fill: "#41b4b9",
                      fontSize: 8,
                      position: "insideTopRight",
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Explainability" eyebrow="WHY THIS CLASSIFICATION?">
          <div className="divide-y divide-border">
            {prediction.explanations.map((item) => (
              <div key={item.signal} className="p-4">
                <div className="flex justify-between text-[10px]">
                  <span>{item.signal}</span>
                  <span className="data-mono text-primary">
                    {Math.round(item.value)}
                  </span>
                </div>
                <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
                <div className="mt-2 h-1 bg-muted">
                  <div
                    className="h-full bg-secondary"
                    style={{
                      width: `${Math.min(100, item.contribution * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title="Sentinel action stack"
        eyebrow="ALL CONFIGURED STATIONARY UNITS"
        className="mt-5"
      >
        <div className="grid gap-px bg-border lg:grid-cols-2">
          {facility.sentinels.map((sentinel) => (
            <div key={sentinel.id} className="bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold">
                    {sentinel.name}
                  </div>
                  <div className="mt-1 data-mono text-[8px] text-muted-foreground">
                    {sentinel.device_id} ·{" "}
                    {sentinel.connected ? "CONNECTED" : "DISCONNECTED"}
                  </div>
                </div>
                <Activity
                  size={16}
                  className={
                    sentinel.connected ? "text-secondary" : "text-destructive"
                  }
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <State label="ARM" value={sentinel.hardware_state.arm_state} />
                <State
                  label="DISPLAY"
                  value={sentinel.hardware_state.display_message}
                />
                <State
                  label="AUDIO"
                  value={`${sentinel.hardware_state.audio} · ${sentinel.hardware_state.audio_state}`}
                />
                {Object.entries(sentinel.hardware_state.led_routes).map(
                  ([exitId, value]) => (
                    <State
                      key={exitId}
                      label={`${facility.exits.find((exit) => exit.id === exitId)?.name ?? exitId} LED ROUTE`}
                      value={value}
                    />
                  ),
                )}
              </div>
            </div>
          ))}
          {facility.sentinels.length === 0 && (
            <div className="bg-card p-8 text-center data-mono text-[9px] text-muted-foreground">
              NO SENTINEL CONFIGURED
            </div>
          )}
        </div>
      </Panel>
      <div className="mt-5 flex flex-wrap items-center gap-3 border border-border p-3">
        <ShieldCheck size={15} className="text-secondary" />
        <p className="min-w-60 flex-1 text-[10px] text-muted-foreground">
          Automatic control is enforced by backend decision and hardware
          services. Changing modes requires confirmation.
        </p>
        <button
          onClick={() => setControlConfirm(true)}
          className="button-secondary"
        >
          {snapshot.automatic_control
            ? "Switch to manual"
            : "Enable automatic guidance"}
        </button>
      </div>
      {controlConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4"
        >
          <div className="panel max-w-md p-5">
            <h2 className="text-base font-semibold">
              Confirm control-mode change
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {snapshot.automatic_control
                ? "Manual mode stops automatic guidance updates until an operator enables them again."
                : "Automatic mode allows verified backend decisions to update connected guidance units."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setControlConfirm(false)}
                className="button-secondary"
              >
                Cancel
              </button>
              <button
                disabled={controlBusy}
                onClick={() => void toggleAutomatic()}
                className="button-primary"
              >
                {controlBusy ? "Applying…" : "Confirm change"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function Brief({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-28 bg-card p-3">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="mt-2 text-[11px] font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  unit,
  note,
  danger = false,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  unit: string;
  note: string;
  danger?: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="flex justify-between">
        <span className="text-[10px] font-medium text-muted-foreground">
          {label}
        </span>
        <Icon
          size={16}
          className={danger ? "text-destructive" : "text-secondary"}
        />
      </div>
      <div
        className={`mt-3 data-mono text-[25px] ${danger ? "text-destructive" : "text-primary"}`}
      >
        {value}{" "}
        <span className="text-[9px] font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      <div className="mt-2 text-[9px] text-muted-foreground">{note}</div>
    </div>
  );
}
function State({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border bg-muted/20 p-3">
      <div className="data-mono text-[7px] text-muted-foreground">{label}</div>
      <div className="mt-2 data-mono text-[9px] text-foreground">{value}</div>
    </div>
  );
}
function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
