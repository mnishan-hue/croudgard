import { useMemo, useState } from "react";
import {
  Camera as CameraIcon,
  ExternalLink,
  Search,
  Signal,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { PageIntro } from "@/components/sentinel-shell";
import { useSentinel } from "@/hooks/use-sentinel";
import type { Camera, Zone } from "@/types/sentinel";

export default function Cameras() {
  const { snapshot, connection, refresh } = useSentinel();
  const [query, setQuery] = useState("");
  const [zoneId, setZoneId] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const cameras = snapshot?.facility.cameras ?? [];
  const zones = snapshot?.facility.zones ?? [];
  const filtered = useMemo(
    () =>
      cameras.filter((camera) => {
        const searchable =
          `${camera.name} ${camera.id} ${camera.camera_type} ${camera.source}`.toLowerCase();
        const matchesQuery = searchable.includes(query.trim().toLowerCase());
        const matchesZone =
          zoneId === "ALL" || camera.zone_ids.includes(zoneId);
        const matchesStatus =
          status === "ALL" ||
          (status === "ONLINE" &&
            camera.enabled &&
            camera.status === "ONLINE") ||
          (status === "OFFLINE" &&
            (!camera.enabled || camera.status === "OFFLINE")) ||
          (status === "DEGRADED" && camera.status === "DEGRADED");
        return matchesQuery && matchesZone && matchesStatus;
      }),
    [cameras, query, status, zoneId],
  );

  return (
    <div className="enter-rise">
      <PageIntro
        eyebrow="Camera monitoring"
        title="Cameras"
        description="Find a camera, check its coverage and crowd conditions, then open it for detailed on-device analysis."
        action={
          <div className="status-chip text-primary">
            <CameraIcon size={14} />
            <span>{cameras.length} configured</span>
          </div>
        }
      />
      {!snapshot ? (
        <div className="panel grid min-h-56 place-items-center p-8 text-center">
          <div>
            <div className="data-mono text-[11px] text-primary">
              {connection === "connecting"
                ? "LOADING CAMERA CONFIGURATION"
                : "BACKEND OFFLINE"}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Camera data is not replaced with fabricated browser values.
            </p>
            <button
              onClick={() => void refresh()}
              className="mt-4 border border-primary/40 px-3 py-2 data-mono text-[9px] text-primary"
            >
              RETRY
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="panel mb-4 flex flex-col gap-2 p-3 lg:flex-row lg:items-center">
            <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2.5">
              <Search size={15} className="text-muted-foreground" />
              <input
                aria-label="Search cameras"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search cameras"
                className="w-full bg-transparent text-[12px] outline-none"
              />
            </label>
            <select
              aria-label="Filter by zone"
              value={zoneId}
              onChange={(event) => setZoneId(event.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2.5 text-[11px]"
            >
              <option value="ALL">All zones</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-md border border-border bg-card px-3 py-2.5 text-[11px]"
            >
              <option value="ALL">All statuses</option>
              <option value="ONLINE">Online</option>
              <option value="DEGRADED">Needs attention</option>
              <option value="OFFLINE">Offline or disabled</option>
            </select>
            <span className="min-w-20 text-right text-[10px] text-muted-foreground">
              Showing {filtered.length} of {cameras.length}
            </span>
          </div>
          <div
            className={`grid gap-3 ${filtered.length <= 2 ? "lg:grid-cols-2" : filtered.length <= 4 ? "md:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"} ${cameras.length >= 9 ? "max-h-[720px] overflow-y-auto pr-1" : ""}`}
          >
            {filtered.map((camera) => (
              <CameraCard
                key={camera.id}
                camera={camera}
                zones={zones}
                provider={snapshot.ai_provider}
              />
            ))}
            {filtered.length === 0 && (
              <div className="panel col-span-full grid min-h-44 place-items-center data-mono text-[10px] text-muted-foreground">
                NO CAMERAS MATCH THE CURRENT FILTERS
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CameraCard({
  camera,
  zones,
  provider,
}: {
  camera: Camera;
  zones: Zone[];
  provider: string;
}) {
  const assigned = zones.filter((zone) => camera.zone_ids.includes(zone.id));
  const metrics = assigned.sort((a, b) => b.risk - a.risk)[0];
  const online = camera.enabled && camera.status === "ONLINE";
  return (
    <article className="panel overflow-hidden">
      <div className="relative grid h-28 place-items-center overflow-hidden bg-[#0b151f] grid-surface">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "radial-gradient(circle at 32% 45%, rgba(65,180,185,.22), transparent 22%), radial-gradient(circle at 68% 58%, rgba(232,170,61,.18), transparent 24%)",
          }}
        />
        <CameraIcon size={28} className="text-muted-foreground/50" />
        <span
          className={`absolute left-3 top-3 rounded-full border px-2 py-1 text-[9px] ${online ? "border-secondary/40 bg-secondary/10 text-secondary" : "border-destructive/40 bg-destructive/10 text-destructive"}`}
        >
          {online ? "Ready for analysis" : "Unavailable"}
        </span>
        <span className="absolute right-3 top-3 rounded-full border border-border bg-background/80 px-2 py-1 text-[9px] text-primary">
          Live camera AI
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">
              {camera.name}
            </h2>
            <div className="data-mono mt-1 truncate text-[9px] text-muted-foreground">
              {camera.id} ·{" "}
              {camera.camera_type.replaceAll("_", " ").toLowerCase()}
            </div>
          </div>
          <span
            className={`text-[10px] font-semibold ${online ? "text-secondary" : "text-destructive"}`}
          >
            {camera.enabled ? camera.status.toLowerCase() : "disabled"}
          </span>
        </div>
        <div className="mt-3 truncate text-[10px] text-muted-foreground">
          Coverage:{" "}
          {assigned.map((zone) => zone.name).join(", ") || "No zone assigned"}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-px bg-border">
          <Metric
            icon={Users}
            label="PEOPLE"
            value={String(metrics?.metrics.people_count ?? "—")}
          />
          <Metric
            icon={Signal}
            label="DENSITY"
            value={metrics ? `${Math.round(metrics.metrics.density)}%` : "—"}
          />
          <Metric
            label="RISK"
            value={metrics ? `${Math.round(metrics.risk)}%` : "—"}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[9px] text-muted-foreground">
            {provider} · {camera.ai_enabled ? "AI enabled" : "AI disabled"}
          </span>
          <Link
            href={`/cameras/${encodeURIComponent(camera.id)}`}
            className="button-secondary px-3 py-2"
          >
            View camera <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-card p-2.5">
      {Icon && <Icon size={12} className="mb-1 text-secondary" />}
      <div className="text-[8px] text-muted-foreground">
        {label.toLowerCase()}
      </div>
      <div className="data-mono mt-1 text-[13px] text-foreground">{value}</div>
    </div>
  );
}
