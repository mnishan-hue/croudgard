export type {
  AIExplanation,
  CameraStatus,
  CrowdAnalysis,
  EventLog,
  HardwareStatus,
  RiskPrediction,
  RobotAction,
  Scenario,
  Severity,
  SystemStatus,
  ZoneMetrics,
} from '@/lib/sentinel';

export interface SentinelSnapshot {
  timestamp: string;
  systemState: string;
  system: import('@/lib/sentinel').SystemStatus;
  cameras: import('@/lib/sentinel').CameraStatus[];
  zones: import('@/lib/sentinel').ZoneMetrics[];
  analysis: import('@/lib/sentinel').CrowdAnalysis;
  predictions: import('@/lib/sentinel').RiskPrediction[];
  robot: import('@/lib/sentinel').RobotAction;
  events: import('@/lib/sentinel').EventLog[];
  explanations: import('@/lib/sentinel').AIExplanation[];
}