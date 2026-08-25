from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CrowdState(str, Enum):
    NORMAL = "NORMAL"
    CONGESTION_BUILDING = "CONGESTION_BUILDING"
    CONGESTED = "CONGESTED"
    FLOW_INSTABILITY = "FLOW_INSTABILITY"
    PROPAGATING_DISTURBANCE = "PROPAGATING_DISTURBANCE"
    CRITICAL_CROWD_RISK = "CRITICAL_CROWD_RISK"


class ZoneMetrics(BaseModel):
    density: float = 0
    people_count: int = 0
    average_speed: float = 0
    direction_conflict: float = 0
    inflow: float = 0
    outflow: float = 0
    inflow_outflow_ratio: float = 0
    queue_growth: float = 0
    stopped_percentage: float = 0
    ripple_score: float = 0
    risk: float = 0
    confidence: float = 0
    fps: float = 0
    movement_direction: str | None = None
    direction_variance: float | None = None
    crowd_accumulation: float = 0
    congestion_score: float = 0
    trend: Literal["RISING", "STABLE", "FALLING", "UNAVAILABLE"] = "UNAVAILABLE"
    available_metrics: list[str] = Field(default_factory=list)
    experimental_metrics: list[str] = Field(default_factory=list)


class Camera(BaseModel):
    id: str
    facility_id: str
    name: str
    enabled: bool = True
    status: Literal["ONLINE", "OFFLINE", "DEGRADED"] = "ONLINE"
    source: str = ""
    zone_ids: list[str] = Field(default_factory=list)
    camera_type: str = "GENERAL"
    ai_enabled: bool = True
    description: str = ""


class Zone(BaseModel):
    id: str
    facility_id: str
    name: str
    type: str = "GENERAL"
    camera_ids: list[str] = Field(default_factory=list)
    risk: float = 0
    crowd_state: CrowdState = CrowdState.NORMAL
    metrics: ZoneMetrics = Field(default_factory=ZoneMetrics)
    enabled: bool = True
    map_x: float = 50
    map_y: float = 50


class Exit(BaseModel):
    id: str
    facility_id: str
    name: str
    zone_id: str
    enabled: bool = True
    availability: float = 1
    risk: float = 0
    status: Literal["AVAILABLE", "CAUTION", "CONGESTED", "RESTRICTED", "CLOSED"] = "AVAILABLE"
    capacity: int = 100
    camera_ids: list[str] = Field(default_factory=list)
    current_inflow: float = 0
    current_outflow: float = 0


class Route(BaseModel):
    id: str
    name: str
    from_junction_id: str
    exit_id: str


class Junction(BaseModel):
    id: str
    name: str
    connected_exit_ids: list[str] = Field(default_factory=list)
    sentinel_ids: list[str] = Field(default_factory=list)
    map_x: float = 50
    map_y: float = 50


class HardwareState(BaseModel):
    arm_state: str = "NORMAL"
    display_message: str = "NORMAL"
    audio: str = "NONE"
    audio_state: str = "IDLE"
    led_routes: dict[str, str] = Field(default_factory=dict)


class Sentinel(BaseModel):
    id: str
    name: str
    junction_id: str
    nearby_exit_ids: list[str] = Field(default_factory=list)
    device_id: str
    ip_address: str = ""
    protocol: Literal["HTTP"] = "HTTP"
    connected: bool = False
    last_heartbeat: str | None = None
    last_command: str | None = None
    command_acknowledged: bool = False
    latency_ms: float | None = None
    hardware_state: HardwareState = Field(default_factory=HardwareState)


class Facility(BaseModel):
    id: str
    name: str
    description: str = ""
    cameras: list[Camera]
    zones: list[Zone]
    exits: list[Exit]
    routes: list[Route]
    junctions: list[Junction]
    sentinels: list[Sentinel]


class AIExplanation(BaseModel):
    signal: str
    value: float
    contribution: float
    description: str


class AIPrediction(BaseModel):
    provider: str = "CAMERA_AI"
    crowd_state: CrowdState
    affected_zone_id: str | None = None
    risk: float
    confidence: float
    explanations: list[AIExplanation] = Field(default_factory=list)
    ripple_state: Literal["NONE", "LOCAL", "SPREADING", "HIGH"] = "NONE"


class Intervention(BaseModel):
    status: Literal["PENDING", "ACTIVE", "EFFECTIVE", "NOT_IMPROVING", "RESOLVED"] = "RESOLVED"
    recommended_exit_id: str | None = None
    affected_zone_id: str | None = None
    started_risk: float | None = None
    current_risk: float | None = None


class Decision(BaseModel):
    action: Literal["NORMAL", "REDIRECT_TO_EXIT", "CRITICAL", "RECOVERY", "RESET"]
    recommended_exit_id: str | None = None
    affected_zone_id: str | None = None
    reason: str
    exit_ranking: list[dict[str, float | str]] = Field(default_factory=list)


class EventLog(BaseModel):
    id: int | None = None
    timestamp: str = Field(default_factory=utc_now)
    category: str
    severity: Literal["INFO", "WARNING", "CRITICAL"] = "INFO"
    message: str

class RiskSample(BaseModel):
    timestamp: str = Field(default_factory=utc_now)
    risk: float
    intervention: bool = False



class LiveSnapshot(BaseModel):
    timestamp: str = Field(default_factory=utc_now)
    facility: Facility
    ai_mode: str = "LIVE CAMERA"
    ai_provider: str = "CAMERA_AI"
    backend_connected: bool = True
    automatic_control: bool = True
    prediction: AIPrediction
    decision: Decision
    intervention: Intervention
    events: list[EventLog]
    risk_history: list[float]
    risk_timeline: list[RiskSample] = Field(default_factory=list)
    current_scenario: str = "LIVE"
    events_acknowledged_at: str | None = None
    camera_ai_active: bool = False
    reporting_camera_ids: list[str] = Field(default_factory=list)
    streaming_camera_ids: list[str] = Field(default_factory=list)
    exit_coverage_complete: bool = False


class PersonCountObservation(BaseModel):
    camera_id: str
    count: int = Field(ge=0, le=10000)
    confidence: float = Field(ge=0, le=1)
    captured_at: str = Field(default_factory=utc_now)


class CrowdClassificationObservation(BaseModel):
    camera_id: str
    classification: Literal["LOW_OR_EMPTY", "NORMAL_FLOW", "BUILDING_CONGESTION", "HIGH_CONGESTION"]
    confidence: float = Field(ge=0, le=1)
    captured_at: str = Field(default_factory=utc_now)


class ComputerVisionObservation(BaseModel):
    camera_id: str
    captured_at: str = Field(default_factory=utc_now)
    people_count: int = Field(ge=0, le=10000)
    detection_confidence: float = Field(ge=0, le=1)
    fps: float = Field(ge=0, le=240)
    density_score: float = Field(ge=0, le=100)
    occupied_area_ratio: float = Field(ge=0, le=1)
    average_speed_px_s: float | None = Field(default=None, ge=0)
    speed_band: Literal["SLOW", "NORMAL", "FAST", "UNAVAILABLE"] = "UNAVAILABLE"
    movement_direction: Literal["LEFT", "RIGHT", "UP", "DOWN", "MIXED", "STATIONARY", "UNAVAILABLE"] = "UNAVAILABLE"
    direction_variance: float | None = Field(default=None, ge=0, le=1)
    direction_conflict: float | None = Field(default=None, ge=0, le=100)
    inflow: float | None = Field(default=None, ge=0)
    outflow: float | None = Field(default=None, ge=0)
    stopped_percentage: float | None = Field(default=None, ge=0, le=100)
    queue_growth: float | None = None
    crowd_accumulation: float | None = None
    congestion_score: float = Field(ge=0, le=100)
    risk_score: float = Field(ge=0, le=100)
    trend: Literal["RISING", "STABLE", "FALLING", "UNAVAILABLE"] = "UNAVAILABLE"
    disturbance: Literal["NONE", "LOCAL", "SPREADING", "HIGH", "UNAVAILABLE"] = "UNAVAILABLE"
    tracked_people: int = Field(ge=0, le=10000)


class ManualControlRequest(BaseModel):
    action: Literal["NORMAL", "REDIRECT_TO_EXIT", "CRITICAL", "RESET"]
    recommended_exit_id: str | None = None
    sentinel_id: str | None = None


class AutoControlRequest(BaseModel):
    enabled: bool
