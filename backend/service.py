from datetime import datetime, timezone
from functools import wraps
from threading import RLock

from backend.ai.live import CameraAIProvider
from backend.decision import DecisionEngine
from backend.hardware.esp32_client import ESP32Client
from backend.models import CrowdState, Decision, EventLog, Intervention, LiveSnapshot, RiskSample


CLASS_RISK = {
    "LOW_OR_EMPTY": 0,
    "NORMAL_FLOW": 25,
    "BUILDING_CONGESTION": 58,
    "HIGH_CONGESTION": 86,
}
OBSERVATION_TTL_SECONDS = 10
FRAME_TTL_SECONDS = 3


def synchronized(method):
    @wraps(method)
    def wrapped(self, *args, **kwargs):
        with self._state_lock:
            return method(self, *args, **kwargs)
    return wrapped


class CrowdGuardService:
    def __init__(self, store):
        self.store = store
        self._state_lock = RLock()
        self.ai = CameraAIProvider()
        self.decision_engine = DecisionEngine()
        self.hardware = ESP32Client()
        self.last_dispatched_command: dict[str, str] = {}
        self.camera_people_counts: dict[str, dict] = {}
        self.camera_crowd_observations: dict[str, dict] = {}
        self.camera_cv_observations: dict[str, list[dict]] = {}
        self.camera_frames: dict[str, dict] = {}
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

    def _fresh(self, observations: dict[str, dict], ttl_seconds: float = OBSERVATION_TTL_SECONDS) -> dict[str, dict]:
        now = datetime.now(timezone.utc)
        return {
            camera_id: item
            for camera_id, item in observations.items()
            if (now - item["captured_at"].astimezone(timezone.utc)).total_seconds() <= ttl_seconds
        }

    def reporting_camera_ids(self) -> list[str]:
        return sorted(set(self._fresh(self.camera_people_counts)) | set(self._fresh(self.camera_crowd_observations)) | set(self._fresh_cv()))

    def streaming_camera_ids(self) -> list[str]:
        return sorted(self._fresh(self.camera_frames, FRAME_TTL_SECONDS))

    @synchronized
    def record_camera_frame(self, camera_id: str, data: bytes):
        camera = self._camera(camera_id)
        if len(data) < 4 or not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            raise ValueError("Frame is not a complete JPEG image")
        previous = self.camera_frames.get(camera.id)
        item = {
            "data": data,
            "captured_at": datetime.now(timezone.utc),
            "sequence": 1 if previous is None else previous["sequence"] + 1,
        }
        self.camera_frames[camera.id] = item
        return {"camera_id": camera.id, "sequence": item["sequence"], "bytes": len(data)}

    @synchronized
    def camera_frame(self, camera_id: str):
        self._camera(camera_id)
        return self.current_camera_frame(camera_id)

    @synchronized
    def current_camera_frame(self, camera_id: str):
        return self._fresh(self.camera_frames, FRAME_TTL_SECONDS).get(camera_id)

    @synchronized
    def remove_camera_state(self, camera_id: str):
        self.camera_people_counts.pop(camera_id, None)
        self.camera_crowd_observations.pop(camera_id, None)
        self.camera_cv_observations.pop(camera_id, None)
        self.camera_frames.pop(camera_id, None)

    @synchronized
    def control_demo_videos(self, request):
        camera_ids = list(dict.fromkeys(request.camera_ids))
        cameras = [self._camera(camera_id) for camera_id in camera_ids]
        if request.action == "RESTART":
            for camera in cameras:
                self.camera_people_counts.pop(camera.id, None)
                self.camera_crowd_observations.pop(camera.id, None)
                self.camera_cv_observations.pop(camera.id, None)
                self.camera_frames.pop(camera.id, None)
            self.risk_history.clear()
            self.risk_timeline.clear()
            self.last_dispatched_command.clear()
        names = ", ".join(camera.name for camera in cameras)
        self.store.add_event(EventLog(category="DEMO_VIDEO", message=f"Recorded video sources {request.action.lower()}: {names}"))
        return {"action": request.action, "camera_ids": camera_ids, "snapshot": self.snapshot()}

    def _fresh_cv(self) -> dict[str, dict]:
        latest = {camera_id: history[-1] for camera_id, history in self.camera_cv_observations.items() if history}
        return self._fresh(latest)

    def _live_facility(self):
        facility = self.facility.model_copy(deep=True)
        people = self._fresh(self.camera_people_counts)
        cv = self._fresh_cv()
        crowd = {**self._fresh(self.camera_crowd_observations), **cv}
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
                if "metrics" in strongest:
                    metrics = strongest["metrics"]
                    zone.metrics.people_count = metrics.people_count
                    zone.metrics.density = metrics.density_score
                    zone.metrics.fps = metrics.fps
                    zone.metrics.average_speed = metrics.average_speed_px_s or 0
                    zone.metrics.movement_direction = metrics.movement_direction
                    zone.metrics.direction_variance = metrics.direction_variance
                    zone.metrics.direction_conflict = metrics.direction_conflict or 0
                    zone.metrics.inflow = metrics.inflow or 0
                    zone.metrics.outflow = metrics.outflow or 0
                    zone.metrics.inflow_outflow_ratio = round((metrics.inflow or 0) / max(metrics.outflow or 0, 1), 2)
                    zone.metrics.stopped_percentage = metrics.stopped_percentage or 0
                    zone.metrics.queue_growth = metrics.queue_growth or 0
                    zone.metrics.crowd_accumulation = metrics.crowd_accumulation or 0
                    zone.metrics.congestion_score = metrics.congestion_score
                    zone.metrics.trend = metrics.trend
                    zone.metrics.ripple_score = {"NONE":0,"LOCAL":35,"SPREADING":65,"HIGH":90,"UNAVAILABLE":0}[metrics.disturbance]
                    available_metrics = ["people_count","density_score","risk_score","fps"]
                    if metrics.average_speed_px_s is not None:
                        available_metrics.extend(["movement", "direction_conflict"])
                    if metrics.stopped_percentage is not None:
                        available_metrics.append("stopped_percentage")
                    if metrics.queue_growth is not None:
                        available_metrics.extend(["queue_growth", "crowd_accumulation"])
                    if metrics.inflow is not None:
                        available_metrics.extend(["inflow", "outflow"])
                    zone.metrics.available_metrics = available_metrics
                    zone.metrics.experimental_metrics = ["movement_disturbance"] if metrics.disturbance != "UNAVAILABLE" else []
        for exit_ in facility.exits:
            zone = next((zone for zone in facility.zones if zone.id == exit_.zone_id), None)
            exit_.risk = zone.risk if zone else 0
            exit_.current_inflow = zone.metrics.inflow if zone else 0
            exit_.current_outflow = zone.metrics.outflow if zone else 0
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

    @synchronized
    def snapshot(self):
        facility = self._live_facility()
        reporting_ids = self.reporting_camera_ids()
        fresh_crowd = {**self._fresh(self.camera_crowd_observations), **self._fresh_cv()}
        enabled_exits = [exit_ for exit_ in facility.exits if exit_.enabled]
        exit_coverage_complete = bool(enabled_exits) and all(
            any(camera_id in fresh_crowd for camera_id in exit_.camera_ids)
            for exit_ in enabled_exits
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
            streaming_camera_ids=self.streaming_camera_ids(),
            exit_coverage_complete=exit_coverage_complete,
        )

    def _camera(self, camera_id: str):
        camera = next((item for item in self.facility.cameras if item.id == camera_id), None)
        if camera is None:
            raise ValueError("Camera does not exist in the active facility")
        if not camera.enabled or not camera.ai_enabled:
            raise ValueError("Camera or camera AI is disabled")
        return camera

    @synchronized
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

    @synchronized
    def record_crowd_observation(self, observation):
        camera = self._camera(observation.camera_id)
        captured_at = self._captured_at(observation.captured_at)
        self._validate_age(captured_at)
        if observation.confidence < .6:
            raise ValueError("Crowd classification confidence is below the accepted threshold")
        previous = self.camera_crowd_observations.get(camera.id)
        target = CLASS_RISK[observation.classification]
        samples = 1 if previous is None else previous.get("samples", 1) + 1
        smoothed = target if previous is None else round(previous.get("raw_risk", previous["risk"]) * .4 + target * .6, 1)
        raw_smoothed = smoothed
        if smoothed >= 45 and samples < 3:
            smoothed = 44.9
        changed = previous is None or previous["classification"] != observation.classification
        self.camera_crowd_observations[camera.id] = {"risk": smoothed, "raw_risk": raw_smoothed, "samples": samples, "confidence": observation.confidence, "captured_at": captured_at, "classification": observation.classification}
        maximum = max((item["risk"] for item in self._fresh(self.camera_crowd_observations).values()), default=0)
        marker = maximum >= 45 and (not self.risk_history or self.risk_history[-1] < 45)
        self.risk_history = (self.risk_history + [maximum])[-30:]
        self.risk_timeline = (self.risk_timeline + [RiskSample(risk=maximum, intervention=marker)])[-30:]
        if changed:
            severity = "CRITICAL" if smoothed >= 90 else "WARNING" if smoothed >= 50 else "INFO"
            self.store.add_event(EventLog(category="CAMERA_AI", severity=severity, message=f"{camera.name} reported {observation.classification.replace('_', ' ').lower()} at {round(observation.confidence * 100)}% confidence"))
        return {"camera_id": camera.id, "classification": observation.classification, "confidence": observation.confidence, "smoothed_risk": smoothed, "zone_ids": camera.zone_ids, "snapshot": self.snapshot()}

    @synchronized
    def record_cv_observation(self, observation):
        camera = self._camera(observation.camera_id)
        captured_at = self._captured_at(observation.captured_at)
        self._validate_age(captured_at)
        history = self.camera_cv_observations.setdefault(camera.id, [])
        recent_risks = [item["raw_risk"] for item in history[-19:]] + [observation.risk_score]
        smoothed_risk = round(sum(recent_risks) / len(recent_risks), 2)
        if smoothed_risk >= 45 and len(recent_risks) < 3:
            smoothed_risk = 44.9
        if history:
            previous = history[-1]["risk"]
            if previous >= 45 and smoothed_risk >= 38:
                smoothed_risk = max(smoothed_risk, 45)
            elif previous < 45 and smoothed_risk < 50:
                smoothed_risk = min(smoothed_risk, 44.9)
        state = self._state_for_risk(smoothed_risk)
        changed = not history or history[-1]["state"] != state
        item = {"risk":smoothed_risk,"raw_risk":observation.risk_score,"confidence":observation.detection_confidence,"captured_at":captured_at,"metrics":observation,"state":state}
        history.append(item)
        self.camera_cv_observations[camera.id] = history[-20:]
        maximum = max((value["risk"] for value in self._fresh_cv().values()), default=0)
        marker = maximum >= 45 and (not self.risk_history or self.risk_history[-1] < 45)
        self.risk_history = (self.risk_history + [maximum])[-60:]
        self.risk_timeline = (self.risk_timeline + [RiskSample(risk=maximum, intervention=marker)])[-60:]
        if changed:
            severity = "CRITICAL" if smoothed_risk >= 90 else "WARNING" if smoothed_risk >= 50 else "INFO"
            self.store.add_event(EventLog(category="COMPUTER_VISION",severity=severity,message=f"{camera.name} changed to {state.value.replace('_',' ').lower()} from {observation.tracked_people} anonymous tracks"))
        snapshot = self.snapshot()
        if snapshot.automatic_control and snapshot.exit_coverage_complete:
            try:
                self.dispatch_decision(snapshot.decision)
            except ConnectionError as exc:
                self.store.add_event(EventLog(category="HARDWARE",severity="WARNING",message=str(exc)))
            snapshot = self.snapshot()
        return {"camera_id":camera.id,"smoothed_risk":smoothed_risk,"state":state,"zone_ids":camera.zone_ids,"snapshot":snapshot}

    @synchronized
    def heartbeat(self, sentinel_id: str):
        facility = self.facility
        sentinel = next((item for item in facility.sentinels if item.id == sentinel_id), None)
        if sentinel is None:
            raise ValueError("Sentinel does not exist")
        try:
            status = self.hardware.heartbeat(sentinel)
        except Exception:
            sentinel.connected = False
            sentinel.command_acknowledged = False
            self.store.save_facility(facility)
            raise
        self.store.save_facility(facility)
        return status

    @synchronized
    def dispatch_decision(self, decision: Decision, sentinel_id: str | None = None, force: bool = False):
        facility = self.facility
        targets = [item for item in facility.sentinels if item.connected and (sentinel_id is None or item.id == sentinel_id)]
        if not targets:
            raise ConnectionError("No connected Sentinel is available")
        command_key = f"{decision.action}:{decision.recommended_exit_id or ''}"
        for sentinel in targets:
            if not force and self.last_dispatched_command.get(sentinel.id) == command_key:
                continue
            self.hardware.set_state(sentinel, decision.model_dump())
            self.last_dispatched_command[sentinel.id] = command_key
            self.store.add_event(EventLog(category="HARDWARE",message=f"{sentinel.name} acknowledged {command_key}"))
        self.store.save_facility(facility)
        return facility

    @synchronized
    def clear_live_data(self):
        self.camera_people_counts.clear()
        self.camera_crowd_observations.clear()
        self.camera_cv_observations.clear()
        self.camera_frames.clear()
        self.risk_history.clear()
        self.risk_timeline.clear()
        self.store.clear_events()
        return self.snapshot()
