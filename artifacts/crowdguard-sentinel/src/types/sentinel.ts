export type CrowdState = 'NORMAL' | 'CONGESTION_BUILDING' | 'CONGESTED' | 'FLOW_INSTABILITY' | 'PROPAGATING_DISTURBANCE' | 'CRITICAL_CROWD_RISK';
export type Scenario = 'normal' | 'exitA' | 'exitB' | 'ripple' | 'critical' | 'recovery';
export type Severity = 'info' | 'watch' | 'urgent' | 'critical';
export interface ZoneMetrics { density:number; people_count:number; average_speed:number; direction_conflict:number; inflow:number; outflow:number; inflow_outflow_ratio:number; queue_growth:number; stopped_percentage:number; ripple_score:number; risk:number; confidence:number }
export interface Camera { id:string; facility_id:string; name:string; enabled:boolean; status:'ONLINE'|'OFFLINE'|'DEGRADED'; source:string; zone_ids:string[]; camera_type:string; ai_enabled:boolean; description:string }
export interface Zone { id:string; facility_id:string; name:string; type:string; camera_ids:string[]; risk:number; crowd_state:CrowdState; metrics:ZoneMetrics; enabled:boolean; map_x:number; map_y:number }
export interface Exit { id:string; facility_id:string; name:string; zone_id:string; enabled:boolean; availability:number; risk:number; status:'AVAILABLE'|'CAUTION'|'CONGESTED'|'RESTRICTED'|'CLOSED'; capacity:number; camera_ids:string[]; current_inflow:number; current_outflow:number }
export interface Route { id:string; name:string; from_junction_id:string; exit_id:string }
export interface Junction { id:string; name:string; connected_exit_ids:string[]; sentinel_ids:string[]; map_x:number; map_y:number }
export interface HardwareState { arm_state:string; display_message:string; audio:string; audio_state:string; led_routes:Record<string,string> }
export interface Sentinel { id:string; name:string; junction_id:string; nearby_exit_ids:string[]; device_id:string; connected:boolean; hardware_state:HardwareState }
export interface Facility { id:string; name:string; description:string; cameras:Camera[]; zones:Zone[]; exits:Exit[]; routes:Route[]; junctions:Junction[]; sentinels:Sentinel[] }
export interface BackendSnapshot { timestamp:string; facility:Facility; ai_mode:string; ai_provider:string; backend_connected:boolean; automatic_control:boolean; prediction:{provider:string;simulated:boolean;crowd_state:CrowdState;affected_zone_id:string|null;risk:number;confidence:number;ripple_state:string;explanations:{signal:string;value:number;contribution:number;description:string}[]}; decision:{action:string;recommended_exit_id:string|null;affected_zone_id:string|null;reason:string;exit_ranking:{exit_id:string;name:string;score:number}[]}; intervention:{status:string;recommended_exit_id:string|null;affected_zone_id:string|null;started_risk:number|null;current_risk:number|null}; events:{id?:number;timestamp:string;category:string;severity:'INFO'|'WARNING'|'CRITICAL';message:string}[]; risk_history:number[] }
export interface RiskSample { timestamp:string; risk:number; intervention:boolean }
export interface BackendSnapshot { risk_timeline:RiskSample[] }
export type { AIExplanation, CameraStatus, CrowdAnalysis, EventLog, HardwareStatus, RiskPrediction, RobotAction, SystemStatus } from '@/lib/sentinel';
