export type Scenario = 'normal' | 'exitA' | 'exitB' | 'ripple' | 'critical' | 'recovery';
export type Severity = 'info' | 'watch' | 'urgent' | 'critical';

export interface SystemStatus {
  timestamp: string; systemState: string; aiEngine: string; esp32: string; emergencyStatus: string;
}
export interface CameraStatus {
  id: string; name: string; zone: string; online: boolean; fps: number; peopleDetected: number;
  density: number; resolution: string; processing: string;
}
export interface ZoneMetrics {
  zone: string; risk: number; density: number; speed: number; queueGrowth: number; inflow: number;
  outflow: number; stoppedPeople: number; directionConflict: number;
}
export interface CrowdAnalysis {
  state: string; risk: number; confidence: number; rippleDetected: boolean; rippleStrength: number;
  propagation: string;
}
export interface RiskPrediction {
  zone: string; risk: number; label: string; trend: string; recommendedExit: string; intervention: string;
}
export interface HardwareStatus {
  device: string; category: string; status: 'online' | 'warning' | 'offline'; latency: number; state: string; message: string;
}
export interface RobotAction {
  arm: string; display: string; exitALights: string; exitBLights: string; audio: string; beacon: string;
}
export interface EventLog {
  timestamp: string; category: string; severity: Severity; message: string;
}
export interface AIExplanation {
  signal: string; value: string; unit: string; status: string; contribution: number; tooltip: string;
}

export const scenarios: { id: Scenario; label: string; short: string }[] = [
  { id: 'normal', label: 'Normal Crowd', short: 'Balanced flow' },
  { id: 'exitA', label: 'Exit A Congestion', short: 'Queue growth' },
  { id: 'exitB', label: 'Exit B Congestion', short: 'Counterflow' },
  { id: 'ripple', label: 'Ripple Detected', short: 'Disturbance onset' },
  { id: 'critical', label: 'Critical Crowd State', short: 'Immediate action' },
  { id: 'recovery', label: 'Flow Recovery', short: 'Conditions improving' },
];

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function getMockState(scenario: Scenario) {
  const presets: Record<Scenario, { risk: number; state: string; decision: string; robot: string; accent: string; people: number; a: number; b: number; ripple: boolean }> = {
    normal: { risk: 18, state: 'STABLE', decision: 'Maintain balanced routing', robot: 'Standby · monitoring', accent: 'teal', people: 286, a: 34, b: 29, ripple: false },
    exitA: { risk: 72, state: 'CONGESTION', decision: 'Divert to Exit B', robot: 'Redirecting to Exit B', accent: 'amber', people: 412, a: 86, b: 28, ripple: false },
    exitB: { risk: 68, state: 'CONGESTION', decision: 'Divert to Exit A', robot: 'Redirecting to Exit A', accent: 'amber', people: 398, a: 26, b: 82, ripple: false },
    ripple: { risk: 79, state: 'PROPAGATING DISTURBANCE', decision: 'Restrict inflow and guide to ranked exit', robot: 'Route guidance active', accent: 'red', people: 431, a: 67, b: 63, ripple: true },
    critical: { risk: 94, state: 'CRITICAL', decision: 'Open all exits · alert marshal', robot: 'Emergency response engaged', accent: 'red', people: 509, a: 94, b: 89, ripple: true },
    recovery: { risk: 31, state: 'RECOVERING', decision: 'Continue Exit B routing', robot: 'Guidance active · easing', accent: 'teal', people: 354, a: 48, b: 35, ripple: false },
  };
  const p = presets[scenario];
  const cameras: CameraStatus[] = [
    { id: 'cam-01', name: 'North Concourse', zone: 'Exit A approach', online: true, fps: 24, peopleDetected: Math.round(p.people * .42), density: p.a, resolution: '1920 × 1080', processing: 'Edge / 38ms' },
    { id: 'cam-02', name: 'Central Plaza', zone: 'Decision zone', online: true, fps: 25, peopleDetected: Math.round(p.people * .34), density: Math.round((p.a + p.b) / 2), resolution: '2560 × 1440', processing: 'Edge / 42ms' },
    { id: 'cam-03', name: 'South Concourse', zone: 'Exit B approach', online: scenario !== 'critical', fps: scenario === 'critical' ? 0 : 24, peopleDetected: Math.round(p.people * .24), density: p.b, resolution: '1920 × 1080', processing: scenario === 'critical' ? 'Signal degraded' : 'Edge / 36ms' },
  ];
  const zones: ZoneMetrics[] = [
    { zone: 'Exit A', risk: p.a, density: p.a, speed: Math.max(0.4, 1.8 - p.a / 70), queueGrowth: p.a > 70 ? 3.8 : p.a > 45 ? 1.4 : -.3, inflow: Math.round(32 + p.a / 2), outflow: Math.round(39 - p.a / 4), stoppedPeople: Math.round(p.a * 1.3), directionConflict: p.ripple ? 48 : p.a > 70 ? 19 : 5 },
    { zone: 'Central Plaza', risk: Math.round((p.a + p.b) / 2), density: Math.round((p.a + p.b) / 2), speed: Math.max(.5, 1.6 - p.risk / 100), queueGrowth: p.ripple ? 4.2 : .4, inflow: 48, outflow: 43, stoppedPeople: Math.round(p.risk * .7), directionConflict: p.ripple ? 67 : 8 },
    { zone: 'Exit B', risk: p.b, density: p.b, speed: Math.max(0.5, 1.9 - p.b / 72), queueGrowth: p.b > 70 ? 3.4 : p.b > 45 ? 1.1 : -.2, inflow: Math.round(28 + p.b / 2), outflow: Math.round(41 - p.b / 4), stoppedPeople: Math.round(p.b * 1.1), directionConflict: p.ripple ? 41 : p.b > 70 ? 24 : 4 },
  ];
  const analysis: CrowdAnalysis = { state: p.state, risk: p.risk, confidence: p.ripple ? 91 : 96, rippleDetected: p.ripple, rippleStrength: p.ripple ? (scenario === 'critical' ? 89 : 64) : 0, propagation: p.ripple ? 'South-east · 1.8 m/s' : 'None detected' };
  const predictions: RiskPrediction[] = [
    { zone: 'Exit A', risk: p.a, label: p.a > 75 ? 'High congestion' : p.a > 45 ? 'Watch' : 'Normal', trend: p.a > 50 ? '↑' : '→', recommendedExit: p.a > p.b ? 'Exit B' : 'Exit A', intervention: p.a > p.b ? 'Robot diversion' : 'No action' },
    { zone: 'Exit B', risk: p.b, label: p.b > 75 ? 'High congestion' : p.b > 45 ? 'Watch' : 'Normal', trend: p.b > 50 ? '↑' : '→', recommendedExit: p.b > p.a ? 'Exit A' : 'Exit B', intervention: p.b > p.a ? 'Robot diversion' : 'No action' },
  ];
  const robot: RobotAction = { arm: p.risk > 75 ? 'BLOCK_ROUTE' : 'NORMAL', display: p.robot, exitALights: p.a > p.b ? 'RED_RESTRICTED' : 'GREEN_GUIDANCE', exitBLights: p.b > p.a ? 'RED_RESTRICTED' : 'GREEN_GUIDANCE', audio: p.risk > 75 ? 'FOLLOW_ILLUMINATED_ROUTE' : 'NONE', beacon: 'REMOVED' };
  const events: EventLog[] = [
    { timestamp: now(), category: 'SYSTEM', severity: 'info', message: 'Scenario state synchronized to operator console' },
    { timestamp: '14:32:08', category: 'AI', severity: p.risk > 75 ? 'urgent' : 'info', message: p.ripple ? 'Directional ripple detected in central plaza' : 'Crowd state model refreshed · confidence ' + analysis.confidence + '%' },
    { timestamp: '14:31:54', category: 'HARDWARE', severity: p.risk > 60 ? 'watch' : 'info', message: p.risk > 60 ? 'Guidance route published to stationary Sentinel' : 'Stationary Sentinel heartbeat nominal' },
    { timestamp: '14:31:21', category: 'CAMERA', severity: 'info', message: 'All edge inference streams reporting within SLA' },
    { timestamp: '14:30:47', category: 'SYSTEM', severity: 'info', message: 'Simulated crowd-flow baseline updated' },
  ];
  const explanations: AIExplanation[] = [
    { signal: 'Occupancy density', value: String(Math.round((p.a + p.b) / 2)), unit: '%', status: p.risk > 70 ? 'elevated' : 'nominal', contribution: 38, tooltip: 'Anonymous person tracks per square metre' },
    { signal: 'Flow velocity', value: (1.8 - p.risk / 90).toFixed(1), unit: 'm/s', status: p.risk > 70 ? 'slowing' : 'nominal', contribution: 24, tooltip: 'Median movement speed across tracked vectors' },
    { signal: 'Direction conflict', value: String(p.ripple ? 67 : Math.round(p.risk / 4)), unit: '%', status: p.ripple ? 'elevated' : 'nominal', contribution: p.ripple ? 30 : 12, tooltip: 'Opposing trajectories crossing the decision zone' },
  ];
  return { preset: p, cameras, zones, analysis, predictions, robot, events, explanations, system: { timestamp: now(), systemState: p.risk > 85 ? 'INTERVENTION' : p.risk > 60 ? 'ADVISORY' : 'NOMINAL', aiEngine: 'ONLINE · 42ms', esp32: 'ONLINE · 18ms', emergencyStatus: p.risk > 85 ? 'RESPONSE ACTIVE' : 'CLEAR' } as SystemStatus };
}

export function getNoDataState(): ReturnType<typeof getMockState> {
  const baseline = getMockState('normal');
  return {
    ...baseline,
    preset: { ...baseline.preset, risk: 0, state: 'NO DATA', decision: 'Waiting for backend', robot: 'NO DATA', people: 0, a: 0, b: 0, ripple: false },
    cameras: [],
    zones: [],
    predictions: [],
    analysis: { state: 'NO DATA', risk: 0, confidence: 0, rippleDetected: false, rippleStrength: 0, propagation: 'NONE' },
    robot: { arm: 'DISCONNECTED', display: 'NO DATA', exitALights: 'N/A', exitBLights: 'N/A', audio: 'NONE', beacon: 'REMOVED' },
    events: [],
    explanations: [],
    system: { timestamp: '—', systemState: 'BACKEND OFFLINE', aiEngine: 'OFFLINE', esp32: 'UNKNOWN', emergencyStatus: 'NO DATA' },
  };
}
