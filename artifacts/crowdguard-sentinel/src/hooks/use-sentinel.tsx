import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getNoDataState, type DashboardState } from "@/lib/sentinel";
import type { BackendSnapshot, Facility } from "@/types/sentinel";
import { apiFetch } from "@/services/api";
import { connectSentinelSocket } from "@/services/websocket";

type Connection = "connecting" | "open" | "closed" | "error";
type SentinelContext = {
  state: DashboardState;
  snapshot: BackendSnapshot | null;
  facilities: Facility[];
  connection: Connection;
  error: string | null;
  refresh: () => Promise<void>;
  selectFacility: (id: string) => Promise<void>;
};
const Context = createContext<SentinelContext | null>(null);

function adapt(snapshot: BackendSnapshot): DashboardState {
  const f = snapshot.facility;
  const selectedExit = f.exits.find(
    (exit) => exit.id === snapshot.decision.recommended_exit_id,
  );
  const reporting = new Set(snapshot.reporting_camera_ids);
  const cameras = f.cameras.map((camera) => {
    const assigned = f.zones.filter((zone) =>
      camera.zone_ids.includes(zone.id),
    );
    const metrics = assigned[0]?.metrics;
    return {
      id: camera.id,
      name: camera.name,
      zone: assigned.map((zone) => zone.name).join(", ") || "Unassigned",
      online: reporting.has(camera.id),
      fps: reporting.has(camera.id) ? (metrics?.fps ?? 0) : 0,
      peopleDetected: metrics?.people_count ?? 0,
      density: Math.round(metrics?.density ?? 0),
      resolution: camera.source || "Browser camera",
      processing: camera.ai_enabled
        ? reporting.has(camera.id)
          ? "LIVE AI"
          : "Waiting for camera"
        : "AI disabled",
    };
  });
  const zones = f.zones.map((zone) => ({
    zone: zone.name,
    risk: Math.round(zone.risk),
    density: Math.round(zone.metrics.density),
    speed: zone.metrics.average_speed,
    queueGrowth: zone.metrics.queue_growth,
    inflow: Math.round(zone.metrics.inflow),
    outflow: Math.round(zone.metrics.outflow),
    stoppedPeople: Math.round(zone.metrics.stopped_percentage),
    directionConflict: Math.round(zone.metrics.direction_conflict),
  }));
  const predictions = snapshot.exit_coverage_complete
    ? f.exits.map((exit) => ({
        zone: exit.name,
        risk: Math.round(exit.risk),
        label: exit.status,
        trend: "→",
        recommendedExit: selectedExit?.name ?? "None",
        intervention: snapshot.intervention.status,
      }))
    : [];
  const hardware = f.sentinels[0]?.hardware_state;
  const hasData = snapshot.camera_ai_active;
  return {
    preset: {
      risk: hasData ? snapshot.prediction.risk : 0,
      state: hasData ? snapshot.prediction.crowd_state : "NO DATA",
      decision: snapshot.decision.reason,
      robot: hardware?.display_message ?? "NO SENTINEL",
      accent: "teal",
      people: hasData
        ? f.zones.reduce((sum, zone) => sum + zone.metrics.people_count, 0)
        : 0,
      a: hasData ? (f.exits[0]?.risk ?? 0) : 0,
      b: hasData ? (f.exits[1]?.risk ?? 0) : 0,
      ripple: snapshot.prediction.ripple_state !== "NONE",
    },
    cameras,
    zones,
    analysis: {
      state: hasData ? snapshot.prediction.crowd_state : "NO DATA",
      risk: hasData ? Math.round(snapshot.prediction.risk) : 0,
      confidence: hasData ? Math.round(snapshot.prediction.confidence) : 0,
      rippleDetected: snapshot.prediction.ripple_state !== "NONE",
      rippleStrength: 0,
      propagation: snapshot.prediction.ripple_state,
    },
    predictions,
    robot: {
      arm: hardware?.arm_state ?? "DISCONNECTED",
      display: hardware?.display_message ?? "NO DATA",
      exitALights: f.exits[0]
        ? (hardware?.led_routes[f.exits[0].id] ?? "N/A")
        : "N/A",
      exitBLights: f.exits[1]
        ? (hardware?.led_routes[f.exits[1].id] ?? "N/A")
        : "N/A",
      audio: hardware?.audio ?? "NONE",
    },
    events: snapshot.events.map((event) => ({
      timestamp: new Date(event.timestamp).toLocaleTimeString(),
      category: event.category,
      severity:
        event.severity === "CRITICAL"
          ? "critical"
          : event.severity === "WARNING"
            ? "watch"
            : "info",
      message: event.message,
    })),
    explanations: hasData
      ? snapshot.prediction.explanations.map((item) => ({
          signal: item.signal,
          value: String(Math.round(item.value)),
          unit: "",
          status: "measured",
          contribution: Math.round(item.contribution * 100),
          tooltip: item.description,
        }))
      : [],
    system: {
      timestamp: new Date(snapshot.timestamp).toLocaleTimeString(),
      systemState: hasData
        ? snapshot.intervention.status
        : "WAITING FOR CAMERA",
      aiEngine: hasData ? "CAMERA AI · REPORTING" : "CAMERA AI · WAITING",
      esp32: f.sentinels.some((item) => item.connected)
        ? "CONNECTED"
        : f.sentinels.some((item) => item.ip_address)
          ? "DISCONNECTED"
          : "NOT CONFIGURED",
      emergencyStatus:
        hasData && snapshot.prediction.risk >= 90
          ? "CRITICAL CROWD RISK"
          : "CLEAR",
    },
  };
}

export function SentinelProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextSnapshot, nextFacilities] = await Promise.all([
        apiFetch<BackendSnapshot>("/system"),
        apiFetch<Facility[]>("/facilities"),
      ]);
      setSnapshot(nextSnapshot);
      setFacilities(nextFacilities);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "BACKEND OFFLINE");
      setConnection("error");
    }
  }, []);
  useEffect(() => {
    void refresh();
    return connectSentinelSocket<BackendSnapshot>((next) => {
      setSnapshot(next);
      setError(null);
    }, setConnection);
  }, [refresh]);
  useEffect(() => {
    if (connection === "open") return;
    const fallback = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(fallback);
  }, [connection, refresh]);
  const selectFacility = useCallback(async (id: string) => {
    const next = await apiFetch<BackendSnapshot>(`/facilities/${id}/activate`, {
      method: "POST",
    });
    setSnapshot(next);
  }, []);
  const state = useMemo(
    () => (snapshot ? adapt(snapshot) : getNoDataState()),
    [snapshot],
  );
  return (
    <Context.Provider
      value={{
        state,
        snapshot,
        facilities,
        connection,
        error,
        refresh,
        selectFacility,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useSentinel() {
  const value = useContext(Context);
  if (!value)
    throw new Error("useSentinel must be used within SentinelProvider");
  return value;
}
