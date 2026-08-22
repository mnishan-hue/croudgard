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


class Camera(BaseModel):
    id: str
    facility_id: str
    name: str
    enabled: bool = True
    status: Literal["ONLINE", "OFFLINE", "DEGRADED"] = "ONLINE"
    source: str = "demo://generated"
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
    connected: bool = True
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
    provider: str = "MOCK"
    simulated: bool = True
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


class LiveSnapshot(BaseModel):
    timestamp: str = Field(default_factory=utc_now)
    facility: Facility
    ai_mode: str = "DEMO MODE"
    ai_provider: str = "MOCK"
    backend_connected: bool = True
    automatic_control: bool = True
    prediction: AIPrediction
    decision: Decision
    intervention: Intervention
    events: list[EventLog]
    risk_history: list[float]


class ScenarioRequest(BaseModel):
    scenario: str
    target_id: str | None = None
    timed: bool = False


class ManualControlRequest(BaseModel):
    action: Literal["NORMAL", "REDIRECT_TO_EXIT", "CRITICAL", "RESET"]
    recommended_exit_id: str | None = None
    sentinel_id: str | None = None


class AutoControlRequest(BaseModel):
    enabled: bool
