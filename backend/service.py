from datetime import datetime, timezone

from backend.ai.live import CameraAIProvider
from backend.decision import DecisionEngine
from backend.hardware.unconfigured import UnconfiguredHardwareClient
from backend.models import CrowdState, Decision, EventLog, Intervention, LiveSnapshot, RiskSample


CLASS_RISK = {
    "LOW_OR_EMPTY": 0,
    "NORMAL_FLOW": 25,
    "BUILDING_CONGESTION": 58,
    "HIGH_CONGESTION": 86,
}
OBSERVATION_TTL_SECONDS = 10


class CrowdGuardService:
    def __init__(self, store):
        self.store = store
        self.ai = CameraAIProvider()
        self.decision_engine = DecisionEngine()
        self.hardware = UnconfiguredHardwareClient()
        self.camera_people_counts: dict[str, dict] = {}
        self.camera_crowd_observations: dict[str, dict] = {}
        self.risk_history: list[float] = []
        self.risk_timeline: list[RiskSample] = []

    @property
    def facility(self):
        return self.store.get_facility(self.store.get_setting("active_facility"))

    def cancel_transitions(self):
        return None

    @staticmethod
    def _captured_at(value: str) -> datetime:
        captured_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return captured_at if captured_at.tzinfo else captured_at.replace(tzinfo=timezone.utc)

    @staticmethod
    def _validate_age(captured_at: datetime):
        age = (datetime.now(timezone.utc) - captured_at.astimezone(timezone.utc)).total_seconds()
        if age > 30 or age < -5:
            raise ValueError("Observation is stale or has an invalid timestamp")

    def _fresh(self, observations: dict[str, dict]) -> dict[str, dict]:
        now = datetime.now(timezone.utc)
        return {
            camera_id: item
            for camera_id, item in observations.items()
            if (now - item["captured_at"].astimezone(timezone.utc)).total_seconds() <= OBSERVATION_TTL_SECONDS
        }

    def reporting_camera_ids(self) -> list[str]:
        return sorted(set(self._fresh(self.camera_people_counts)) | set(self._fresh(self.camera_crowd_observations)))

    def _live_facility(self):
        facility = self.facility.model_copy(deep=True)
        people = self._fresh(self.camera_people_counts)
        crowd = self._fresh(self.camera_crowd_observations)
        for zone in facility.zones:
            count_observations = [people[camera_id] for camera_id in zone.camera_ids if camera_id in people]
            crowd_observations = [crowd[camera_id] for camera_id in zone.camera_ids if camera_id in crowd]
            if count_observations:
                zone.metrics.people_count = max(item["count"] for item in count_observations)
                zone.metrics.confidence = round(sum(item["confidence"] for item in count_observations) / len(count_observations) * 100, 1)
            if crowd_observations:
                strongest = max(crowd_observations, key=lambda item: item["risk"])
                zone.risk = strongest["risk"]
                zone.metrics.risk = zone.risk
                zone.metrics.density = zone.risk
                zone.metrics.confidence = round(sum(item["confidence"] for item in crowd_observations) / len(crowd_observations) * 100, 1)
                zone.crowd_state = self._state_for_risk(zone.risk)
        for exit_ in facility.exits:
            zone = next((zone for zone in facility.zones if zone.id == exit_.zone_id), None)
            exit_.risk = zone.risk if zone else 0
            exit_.status = "CONGESTED" if exit_.risk >= 70 else "CAUTION" if exit_.risk >= 40 else "AVAILABLE"
        return facility

    @staticmethod
    def _state_for_risk(risk: float) -> CrowdState:
        if risk >= 90:
            return CrowdState.CRITICAL_CROWD_RISK
        if risk >= 75:
            return CrowdState.FLOW_INSTABILITY
        if risk >= 60:
            return CrowdState.CONGESTED
        if risk >= 40:
            return CrowdState.CONGESTION_BUILDING
        return CrowdState.NORMAL

    def snapshot(self):
        facility = self._live_facility()
        reporting_ids = self.reporting_camera_ids()
        fresh_crowd = self._fresh(self.camera_crowd_observations)
        exit_coverage_complete = bool(facility.exits) and all(
            any(camera_id in fresh_crowd for camera_id in exit_.camera_ids)
            for exit_ in facility.exits
            if exit_.enabled
        )
        prediction = self.ai.predict(facility)
        if not fresh_crowd:
            decision = Decision(action="NORMAL", reason="Waiting for a current camera classification before making an operational decision.")
        elif prediction.risk >= 45 and not exit_coverage_complete:
            decision = Decision(action="NORMAL", affected_zone_id=prediction.affected_zone_id, reason="Crowd risk is visible, but every enabled exit needs a current camera observation before route guidance can be issued.")
        else:
            decision = self.decision_engine.decide(facility.zones, facility.exits)
        intervention = Intervention(
            status="ACTIVE" if decision.action != "NORMAL" else "RESOLVED",
            recommended_exit_id=decision.recommended_exit_id,
            affected_zone_id=decision.affected_zone_id,
            started_risk=max(self.risk_history) if self.risk_history else None,
            current_risk=prediction.risk if fresh_crowd else None,
        )
        return LiveSnapshot(
            facility=facility,
            prediction=prediction,
            decision=decision,
            intervention=intervention,
            automatic_control=self.store.get_setting("automatic_control") == "true",
            events=self.store.events(),
            risk_history=self.risk_history,
            risk_timeline=self.risk_timeline,
            events_acknowledged_at=self.store.get_setting("events_acknowledged_at"),
            camera_ai_active=bool(reporting_ids),
            reporting_camera_ids=reporting_ids,
            exit_coverage_complete=exit_coverage_complete,
        )

    def _camera(self, camera_id: str):
        camera = next((item for item in self.facility.cameras if item.id == camera_id), None)
        if camera is None:
            raise ValueError("Camera does not exist in the active facility")
        if not camera.enabled or not camera.ai_enabled:
            raise ValueError("Camera or camera AI is disabled")
        return camera

    def record_person_count(self, observation):
        camera = self._camera(observation.camera_id)
        captured_at = self._captured_at(observation.captured_at)
        self._validate_age(captured_at)
        if observation.confidence < .5:
            raise ValueError("Person-count confidence is below the accepted threshold")
        previous = self.camera_people_counts.get(camera.id)
        smoothed = observation.count if previous is None else round(previous["count"] * .35 + observation.count * .65)
        self.camera_people_counts[camera.id] = {"count": smoothed, "confidence": observation.confidence, "captured_at": captured_at}
        return {"camera_id": camera.id, "count": smoothed, "confidence": observation.confidence, "zone_ids": camera.zone_ids}

    def record_crowd_observation(self, observation):
        camera = self._camera(observation.camera_id)
        captured_at = self._captured_at(observation.captured_at)
        self._validate_age(captured_at)
        if observation.confidence < .6:
            raise ValueError("Crowd classification confidence is below the accepted threshold")
        previous = self.camera_crowd_observations.get(camera.id)
        target = CLASS_RISK[observation.classification]
        smoothed = target if previous is None else round(previous["risk"] * .4 + target * .6, 1)
        changed = previous is None or previous["classification"] != observation.classification
        self.camera_crowd_observations[camera.id] = {"risk": smoothed, "confidence": observation.confidence, "captured_at": captured_at, "classification": observation.classification}
        maximum = max((item["risk"] for item in self._fresh(self.camera_crowd_observations).values()), default=0)
        marker = maximum >= 45 and (not self.risk_history or self.risk_history[-1] < 45)
        self.risk_history = (self.risk_history + [maximum])[-30:]
        self.risk_timeline = (self.risk_timeline + [RiskSample(risk=maximum, intervention=marker)])[-30:]
        if changed:
            severity = "CRITICAL" if smoothed >= 90 else "WARNING" if smoothed >= 50 else "INFO"
            self.store.add_event(EventLog(category="CAMERA_AI", severity=severity, message=f"{camera.name} reported {observation.classification.replace('_', ' ').lower()} at {round(observation.confidence * 100)}% confidence"))
        return {"camera_id": camera.id, "classification": observation.classification, "confidence": observation.confidence, "smoothed_risk": smoothed, "zone_ids": camera.zone_ids, "snapshot": self.snapshot()}

    def clear_live_data(self):
        self.camera_people_counts.clear()
        self.camera_crowd_observations.clear()
        self.risk_history.clear()
        self.risk_timeline.clear()
        self.store.clear_events()
        return self.snapshot()
