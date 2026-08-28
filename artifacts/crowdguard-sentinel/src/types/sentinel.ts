export type CrowdState =
  | "NORMAL"
  | "CONGESTION_BUILDING"
  | "CONGESTED"
  | "FLOW_INSTABILITY"
  | "PROPAGATING_DISTURBANCE"
  | "CRITICAL_CROWD_RISK";
export type Severity = "info" | "watch" | "urgent" | "critical";
export interface ZoneMetrics {
  density: number;
  people_count: number;
  average_speed: number;
  direction_conflict: number;
  inflow: number;
  outflow: number;
  inflow_outflow_ratio: number;
  queue_growth: number;
  stopped_percentage: number;
  ripple_score: number;
  risk: number;
  confidence: number;
  fps: number;
  movement_direction: string | null;
  direction_variance: number | null;
  crowd_accumulation: number;
  congestion_score: number;
  trend: "RISING" | "STABLE" | "FALLING" | "UNAVAILABLE";
  available_metrics: string[];
  experimental_metrics: string[];
}
export interface Camera {
  id: string;
  facility_id: string;
  name: string;
  enabled: boolean;
  status: "ONLINE" | "OFFLINE" | "DEGRADED";
  source: string;
  zone_ids: string[];
  camera_type: string;
  ai_enabled: boolean;
  description: string;
}
export interface Zone {
  id: string;
  facility_id: string;
  name: string;
  type: string;
  camera_ids: string[];
  risk: number;
  crowd_state: CrowdState;
  metrics: ZoneMetrics;
  enabled: boolean;
  map_x: number;
  map_y: number;
}
export interface Exit {
  id: string;
  facility_id: string;
  name: string;
  zone_id: string;
  enabled: boolean;
  availability: number;
  risk: number;
  status: "AVAILABLE" | "CAUTION" | "CONGESTED" | "RESTRICTED" | "CLOSED";
  capacity: number;
  camera_ids: string[];
  current_inflow: number;
  current_outflow: number;
}
export interface Route {
  id: string;
  name: string;
  from_junction_id: string;
  exit_id: string;
}
export interface Junction {
  id: string;
  name: string;
  connected_exit_ids: string[];
  sentinel_ids: string[];
  map_x: number;
  map_y: number;
}
export interface HardwareState {
  arm_state: string;
  display_message: string;
  audio: string;
  audio_state: string;
  led_routes: Record<string, string>;
}
export interface Sentinel {
  id: string;
  name: string;
  junction_id: string;
  nearby_exit_ids: string[];
  device_id: string;
  ip_address: string;
  protocol: "HTTP" | "CLOUD_POLL";
  connected: boolean;
  last_heartbeat: string | null;
  last_command: string | null;
  desired_state:
    "NEUTRAL" | "REDIRECT_A" | "REDIRECT_B" | "BOTH_BUSY" | "RESET";
  acknowledged_state:
    "NEUTRAL" | "REDIRECT_A" | "REDIRECT_B" | "BOTH_BUSY" | "RESET" | null;
  last_command_id: string | null;
  command_acknowledged: boolean;
  last_error: string | null;
  latency_ms: number | null;
  hardware_state: HardwareState;
}
export interface Facility {
  id: string;
  name: string;
  description: string;
  cameras: Camera[];
  zones: Zone[];
  exits: Exit[];
  routes: Route[];
  junctions: Junction[];
  sentinels: Sentinel[];
}
export interface BackendSnapshot {
  timestamp: string;
  facility: Facility;
  ai_mode: string;
  ai_provider: string;
  backend_connected: boolean;
  automatic_control: boolean;
  current_scenario: string;
  events_acknowledged_at: string | null;
  camera_ai_active: boolean;
  reporting_camera_ids: string[];
  streaming_camera_ids: string[];
  exit_coverage_complete: boolean;
  queue_level: "LOW" | "MODERATE" | "HIGH" | "VERY HIGH" | null;
  queue_trend: "RISING" | "STABLE" | "FALLING" | null;
  estimated_wait: number | null;
  estimated_wait_label: string | null;
  prediction: {
    provider: string;
    crowd_state: CrowdState;
    affected_zone_id: string | null;
    risk: number;
    confidence: number;
    ripple_state: string;
    explanations: {
      signal: string;
      value: number;
      contribution: number;
      description: string;
    }[];
  };
  decision: {
    action: string;
    route_state: "NEUTRAL" | "REDIRECT_A" | "REDIRECT_B" | "BOTH_BUSY";
    recommended_exit_id: string | null;
    affected_zone_id: string | null;
    reason: string;
    exit_ranking: { exit_id: string; name: string; score: number }[];
  };
  intervention: {
    status: string;
    recommended_exit_id: string | null;
    affected_zone_id: string | null;
    started_risk: number | null;
    current_risk: number | null;
  };
  events: {
    id?: number;
    timestamp: string;
    category: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    message: string;
  }[];
  risk_history: number[];
}
export interface RiskSample {
  timestamp: string;
  risk: number;
  intervention: boolean;
}
export interface BackendSnapshot {
  risk_timeline: RiskSample[];
}
export type {
  AIExplanation,
  CameraStatus,
  CrowdAnalysis,
  EventLog,
  HardwareStatus,
  RiskPrediction,
  RobotAction,
  SystemStatus,
} from "@/lib/sentinel";
