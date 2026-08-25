export type Severity = "info" | "watch" | "urgent" | "critical";
export interface SystemStatus {
  timestamp: string;
  systemState: string;
  aiEngine: string;
  esp32: string;
  emergencyStatus: string;
}
export interface CameraStatus {
  id: string;
  name: string;
  zone: string;
  online: boolean;
  fps: number;
  peopleDetected: number;
  density: number;
  resolution: string;
  processing: string;
}
export interface ZoneMetrics {
  zone: string;
  risk: number;
  density: number;
  speed: number;
  queueGrowth: number;
  inflow: number;
  outflow: number;
  stoppedPeople: number;
  directionConflict: number;
}
export interface CrowdAnalysis {
  state: string;
  risk: number;
  confidence: number;
  rippleDetected: boolean;
  rippleStrength: number;
  propagation: string;
}
export interface RiskPrediction {
  zone: string;
  risk: number;
  label: string;
  trend: string;
  recommendedExit: string;
  intervention: string;
}
export interface HardwareStatus {
  device: string;
  category: string;
  status: "online" | "warning" | "offline";
  latency: number;
  state: string;
  message: string;
}
export interface RobotAction {
  arm: string;
  display: string;
  exitALights: string;
  exitBLights: string;
  audio: string;
  beacon: string;
}
export interface EventLog {
  timestamp: string;
  category: string;
  severity: Severity;
  message: string;
}
export interface AIExplanation {
  signal: string;
  value: string;
  unit: string;
  status: string;
  contribution: number;
  tooltip: string;
}

export interface DashboardState {
  preset: {
    risk: number;
    state: string;
    decision: string;
    robot: string;
    accent: string;
    people: number;
    a: number;
    b: number;
    ripple: boolean;
  };
  cameras: CameraStatus[];
  zones: ZoneMetrics[];
  analysis: CrowdAnalysis;
  predictions: RiskPrediction[];
  robot: RobotAction;
  events: EventLog[];
  explanations: AIExplanation[];
  system: SystemStatus;
}

export function getNoDataState(): DashboardState {
  return {
    preset: {
      risk: 0,
      state: "NO DATA",
      decision: "Waiting for current camera observations",
      robot: "NO DATA",
      accent: "teal",
      people: 0,
      a: 0,
      b: 0,
      ripple: false,
    },
    cameras: [],
    zones: [],
    predictions: [],
    events: [],
    explanations: [],
    analysis: {
      state: "NO DATA",
      risk: 0,
      confidence: 0,
      rippleDetected: false,
      rippleStrength: 0,
      propagation: "NONE",
    },
    robot: {
      arm: "DISCONNECTED",
      display: "NO DATA",
      exitALights: "N/A",
      exitBLights: "N/A",
      audio: "NONE",
      beacon: "REMOVED",
    },
    system: {
      timestamp: "—",
      systemState: "WAITING FOR DATA",
      aiEngine: "CAMERA AI · WAITING",
      esp32: "NOT CONFIGURED",
      emergencyStatus: "NO DATA",
    },
  };
}
