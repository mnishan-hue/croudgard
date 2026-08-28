import os
from datetime import datetime, timezone
from functools import wraps
from threading import RLock
from uuid import uuid4

from backend.ai.live import CameraAIProvider
from backend.decision import DecisionEngine
from backend.hardware.esp32_client import ESP32Client, canonical_hardware_state
from backend.models import CrowdState, Decision, EventLog, Intervention, LiveSnapshot, RiskSample, utc_now
from backend.queue import MainAreaQueueEstimator


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
        self.queue_estimator = MainAreaQueueEstimator()
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
        enabled_camera_ids = {
            camera.id for camera in self.facility.cameras if camera.enabled
        }
        full_source_group = set(camera_ids) == enabled_camera_ids
        if request.action in {"RESTART", "STOP"}:
            for camera in cameras:
                self.camera_people_counts.pop(camera.id, None)
                self.camera_crowd_observations.pop(camera.id, None)
                self.camera_cv_observations.pop(camera.id, None)
                self.camera_frames.pop(camera.id, None)
            if full_source_group:
                self.risk_history.clear()
                self.risk_timeline.clear()
                self.last_dispatched_command.clear()
                self.decision_engine.reset_state()
                self.queue_estimator.reset()
            if full_source_group and self.store.get_setting("automatic_control") == "true":
                try:
                    self.dispatch_decision(
                        Decision(
                            action="NORMAL",
                            reason="Camera analysis reset to a safe neutral state.",
                        ),
                        force=True,
                    )
                except ConnectionError as exc:
                    self.store.add_event(
                        EventLog(
                            category="HARDWARE",
                            severity="WARNING",
                            message=str(exc),
                        )
                    )
        names = ", ".join(camera.name for camera in cameras)
        self.store.add_event(EventLog(category="DEMO_VIDEO", message=f"Camera sources {request.action.lower()}: {names}"))
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
        fresh_people = self._fresh(self.camera_people_counts)
        fresh_classifications = self._fresh(self.camera_crowd_observations)
        fresh_cv = self._fresh_cv()
        fresh_crowd = {**fresh_classifications, **fresh_cv}
        enabled_exits = [exit_ for exit_ in facility.exits if exit_.enabled]
        exit_coverage_complete = bool(enabled_exits) and all(
            any(camera_id in fresh_crowd for camera_id in exit_.camera_ids)
            for exit_ in enabled_exits
        )
        prediction = self.ai.predict(facility)
        if not fresh_crowd:
            self.decision_engine.reset_state()
            decision = Decision(action="NORMAL", reason="Waiting for a current camera classification before making an operational decision.")
        elif prediction.risk >= 45 and not exit_coverage_complete:
            self.decision_engine.reset_state()
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
        main_zone = next(
            (zone for zone in facility.zones if zone.enabled and zone.type == "MAIN_AREA"),
            None,
        )
        main_has_data = bool(main_zone) and any(
            camera_id in fresh_people or camera_id in fresh_crowd
            for camera_id in main_zone.camera_ids
        )
        queue_estimate = None
        if main_zone and main_has_data:
            sample_id = tuple(
                sorted(
                    (source, camera_id, item["captured_at"].isoformat())
                    for source, observations in (
                        ("people", fresh_people),
                        ("classification", fresh_classifications),
                        ("cv", fresh_cv),
                    )
                    for camera_id, item in observations.items()
                )
            )
            queue_estimate = self.queue_estimator.estimate(
                main_zone,
                facility.exits,
                facility.zones,
                decision,
                sample_id,
            )
        else:
            self.queue_estimator.reset()
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
            queue_level=queue_estimate.queue_level if queue_estimate else None,
            queue_trend=queue_estimate.queue_trend if queue_estimate else None,
            estimated_wait=queue_estimate.estimated_wait if queue_estimate else None,
            estimated_wait_label=queue_estimate.estimated_wait_label if queue_estimate else None,
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
            self.store.add_event(EventLog(category="COMPUTER_VISION",severity=severity,message=f"{camera.name} changed to {state.value.replace('_',' ').lower()} from {observation.tracked_people} estimated detections"))
        snapshot = self.snapshot()
        if snapshot.automatic_control and snapshot.exit_coverage_complete:
            try:
                self.dispatch_decision(
                    snapshot.decision,
                    estimated_wait=snapshot.estimated_wait,
                    estimated_wait_label=snapshot.estimated_wait_label,
                )
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
        if sentinel.protocol == "CLOUD_POLL":
            if sentinel.connected and sentinel.last_heartbeat:
                return {
                    "device_id": sentinel.device_id,
                    "status": "ready",
                    "transport": "CLOUD_POLL",
                    "last_heartbeat": sentinel.last_heartbeat,
                }
            raise ConnectionError(
                "Cloud relay is waiting for the ESP32 to contact this backend"
            )
        was_connected = sentinel.connected
        try:
            status = self.hardware.heartbeat(sentinel)
            sentinel.last_error = None
        except Exception as exc:
            previous_error = sentinel.last_error
            sentinel.connected = False
            sentinel.command_acknowledged = False
            sentinel.last_error = str(exc)
            if was_connected or previous_error != sentinel.last_error:
                self.store.add_event(EventLog(category="HARDWARE", severity="WARNING", message=f"{sentinel.name} disconnected: {exc}"))
            self.store.save_facility(facility)
            raise
        if not was_connected:
            self.store.add_event(EventLog(category="HARDWARE", message=f"{sentinel.name} connected"))
        if not was_connected or sentinel.acknowledged_state != sentinel.desired_state or not sentinel.command_acknowledged:
            if not self._send_hardware_state(facility, sentinel, sentinel.desired_state, "RECONNECT", force=True):
                self.store.save_facility(facility)
                raise ConnectionError("Sentinel reconnected but did not acknowledge desired-state synchronization")
        self.store.save_facility(facility)
        return status

    def _send_hardware_state(
        self, facility, sentinel, state: str, source: str, force: bool = False,
        estimated_wait: float | None = None,
        estimated_wait_label: str | None = None,
        recommended_exit_id: str | None = None,
    ) -> bool:
        if sentinel.protocol == "CLOUD_POLL":
            if (
                not force
                and sentinel.last_command == state
                and not sentinel.command_acknowledged
            ):
                return False
            self._queue_cloud_state(
                sentinel, state, source, estimated_wait,
                estimated_wait_label, recommended_exit_id,
            )
            return True
        command_key = f"{state}:{estimated_wait_label or ''}:{recommended_exit_id or ''}"
        already_applied = (
            sentinel.command_acknowledged
            and sentinel.acknowledged_state == state
            and self.last_dispatched_command.get(sentinel.id) == command_key
        )
        if not force and already_applied:
            return False
        command_id = str(uuid4())
        sentinel.command_acknowledged = False
        try:
            self.hardware.set_state(sentinel, {
                "action": state,
                "command_id": command_id,
                "estimated_wait_minutes": estimated_wait,
                "estimated_wait_label": estimated_wait_label,
                "recommended_exit_id": recommended_exit_id,
            })
        except Exception as exc:
            sentinel.connected = False
            sentinel.command_acknowledged = False
            sentinel.last_error = str(exc)
            self.last_dispatched_command.pop(sentinel.id, None)
            self.store.add_event(EventLog(category="HARDWARE", severity="WARNING", message=f"{sentinel.name} command {state} pending after failure: {exc}"))
            return False
        self.last_dispatched_command[sentinel.id] = command_key
        self.store.add_event(EventLog(category="HARDWARE", message=f"{sentinel.name} acknowledged {state} ({source.lower()})"))
        return True

    def _queue_cloud_state(
        self, sentinel, state: str, source: str,
        estimated_wait: float | None = None,
        estimated_wait_label: str | None = None,
        recommended_exit_id: str | None = None,
    ):
        """Persist one command for delivery when the ESP32 next polls Render."""
        sentinel.last_command = state
        sentinel.last_command_id = str(uuid4())
        sentinel.last_command_wait_minutes = estimated_wait
        sentinel.last_command_wait_label = estimated_wait_label
        sentinel.last_command_recommended_exit_id = recommended_exit_id
        sentinel.command_acknowledged = False
        sentinel.last_error = None
        self.last_dispatched_command.pop(sentinel.id, None)
        self.store.add_event(
            EventLog(
                category="HARDWARE",
                message=f"{sentinel.name} queued {state} for cloud relay ({source.lower()})",
            )
        )

    def _device_sentinel(self, device_id: str):
        facility = self.facility
        sentinel = next(
            (item for item in facility.sentinels if item.device_id == device_id), None
        )
        if sentinel is None:
            raise ValueError("Device ID is not configured")
        if sentinel.protocol != "CLOUD_POLL":
            raise ValueError("Device is not configured for cloud relay")
        return facility, sentinel

    @synchronized
    def device_heartbeat(self, device_id: str, report):
        facility, sentinel = self._device_sentinel(device_id)
        was_connected = sentinel.connected
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.last_error = None
        if report.hardware_state is not None:
            sentinel.hardware_state = report.hardware_state
        if (
            report.last_command_id
            and report.last_command_id == sentinel.last_command_id
            and report.state == sentinel.desired_state
        ):
            sentinel.last_command = report.state
            sentinel.acknowledged_state = report.state
            sentinel.command_acknowledged = True
            self.last_dispatched_command[sentinel.id] = report.state
        if not was_connected:
            self.store.add_event(
                EventLog(category="HARDWARE", message=f"{sentinel.name} connected through cloud relay")
            )
        self.store.save_facility(facility)
        return {
            "connected": True,
            "device_id": device_id,
            "desired_state": sentinel.desired_state,
            "command_pending": not sentinel.command_acknowledged,
        }

    @synchronized
    def device_command(self, device_id: str, device_last_command_id: str | None):
        facility, sentinel = self._device_sentinel(device_id)
        was_connected = sentinel.connected
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.last_error = None
        if not was_connected:
            self.store.add_event(
                EventLog(
                    category="HARDWARE",
                    message=f"{sentinel.name} connected through cloud relay",
                )
            )
        if sentinel.last_command_id is None or sentinel.last_command != sentinel.desired_state:
            self._queue_cloud_state(sentinel, sentinel.desired_state, "CONNECT")
        pending = (
            not sentinel.command_acknowledged
            or device_last_command_id != sentinel.last_command_id
        )
        self.store.save_facility(facility)
        if not pending:
            return {"pending": False, "device_id": device_id}
        return {
            "pending": True,
            "type": "SET_STATE",
            "device_id": device_id,
            "state": sentinel.last_command,
            "command_id": sentinel.last_command_id,
            "estimated_wait_minutes": sentinel.last_command_wait_minutes,
            "estimated_wait_label": sentinel.last_command_wait_label,
            "recommended_exit_id": sentinel.last_command_recommended_exit_id,
        }

    @synchronized
    def device_acknowledgement(self, device_id: str, acknowledgement):
        facility, sentinel = self._device_sentinel(device_id)
        if acknowledgement.acknowledged is not True:
            raise ValueError("Device did not acknowledge the command")
        if acknowledgement.command_id != sentinel.last_command_id:
            raise ValueError("Acknowledgement command ID does not match")
        if acknowledgement.state != sentinel.last_command:
            raise ValueError("Acknowledgement state does not match")
        first_ack = not sentinel.command_acknowledged
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.acknowledged_state = acknowledgement.state
        sentinel.command_acknowledged = True
        sentinel.last_error = None
        if acknowledgement.hardware_state is not None:
            sentinel.hardware_state = acknowledgement.hardware_state
        self.last_dispatched_command[sentinel.id] = acknowledgement.state
        if first_ack:
            self.store.add_event(
                EventLog(
                    category="HARDWARE",
                    message=f"{sentinel.name} acknowledged {acknowledgement.state} (cloud relay)",
                )
            )
        self.store.save_facility(facility)
        return {
            "acknowledged": True,
            "device_id": device_id,
            "state": acknowledgement.state,
            "command_id": acknowledgement.command_id,
        }

    @synchronized
    def dispatch_decision(
        self, decision: Decision, sentinel_id: str | None = None,
        force: bool = False, source: str = "AI",
        estimated_wait: float | None = None,
        estimated_wait_label: str | None = None,
    ):
        facility = self.facility
        targets = [item for item in facility.sentinels if sentinel_id is None or item.id == sentinel_id]
        if not targets:
            raise ValueError("Sentinel does not exist")
        state = canonical_hardware_state(decision.action, decision.recommended_exit_id, decision.route_state)
        for sentinel in targets:
            desired_changed = sentinel.desired_state != state
            guidance_changed = (
                sentinel.last_command_wait_label != estimated_wait_label
                or sentinel.last_command_recommended_exit_id
                != decision.recommended_exit_id
            )
            sentinel.desired_state = state
            if sentinel.protocol == "CLOUD_POLL":
                if desired_changed or guidance_changed or force or sentinel.last_command_id is None:
                    self._queue_cloud_state(
                        sentinel, state, source, estimated_wait,
                        estimated_wait_label, decision.recommended_exit_id,
                    )
                continue
            if not sentinel.connected:
                sentinel.command_acknowledged = False
                if desired_changed:
                    self.store.add_event(EventLog(category="HARDWARE", severity="WARNING", message=f"{sentinel.name} is disconnected; preserving desired state {state}"))
                continue
            self._send_hardware_state(
                facility, sentinel, state, source, force=force,
                estimated_wait=estimated_wait,
                estimated_wait_label=estimated_wait_label,
                recommended_exit_id=decision.recommended_exit_id,
            )
        self.store.save_facility(facility)
        return facility

    def _synchronize_automatic_recovery(self) -> None:
        """Return stale route guidance to neutral while automatic control is on.

        Camera observations expire without invoking ``record_cv_observation``
        again. In that case ``snapshot()`` correctly reports a NORMAL decision,
        but there used to be no event that dispatched the matching NEUTRAL
        command. The periodic hardware monitor closes that gap. It only sends a
        recovery command, never a new redirect, so fresh camera observations
        remain the sole source of automatic route changes.
        """
        if self.store.get_setting("automatic_control") != "true":
            return
        facility = self.facility
        if facility is None or not any(
            sentinel.desired_state != "NEUTRAL"
            for sentinel in facility.sentinels
        ):
            return
        snapshot = self.snapshot()
        if snapshot.decision.action == "NORMAL":
            self.dispatch_decision(
                snapshot.decision,
                source="AUTO_RECOVERY",
                estimated_wait=snapshot.estimated_wait,
                estimated_wait_label=snapshot.estimated_wait_label,
            )

    @synchronized
    def poll_hardware(self):
        """Bounded connection maintenance; safe to call from a periodic background task."""
        self._synchronize_automatic_recovery()
        facility = self.facility
        if facility is None:
            return
        for sentinel in facility.sentinels:
            if sentinel.protocol == "CLOUD_POLL":
                try:
                    configured_timeout = float(
                        os.getenv("CROWDGUARD_DEVICE_STALE_SECONDS", "20")
                    )
                except ValueError:
                    configured_timeout = 20.0
                timeout = max(10.0, configured_timeout)
                if sentinel.last_heartbeat:
                    last_seen = self._captured_at(sentinel.last_heartbeat)
                    age = (datetime.now(timezone.utc) - last_seen).total_seconds()
                    if age > timeout and sentinel.connected:
                        sentinel.connected = False
                        sentinel.command_acknowledged = False
                        sentinel.last_error = "Cloud device heartbeat timed out"
                        self.store.add_event(
                            EventLog(
                                category="HARDWARE",
                                severity="WARNING",
                                message=f"{sentinel.name} cloud relay disconnected",
                            )
                        )
                        self.store.save_facility(facility)
                continue
            if not sentinel.ip_address:
                continue
            try:
                self.heartbeat(sentinel.id)
            except Exception:
                # heartbeat() records the failure; camera/AI processing must continue.
                continue

    @synchronized
    def clear_live_data(self):
        self.camera_people_counts.clear()
        self.camera_crowd_observations.clear()
        self.camera_cv_observations.clear()
        self.camera_frames.clear()
        self.risk_history.clear()
        self.risk_timeline.clear()
        self.decision_engine.reset_state()
        self.queue_estimator.reset()
        self.store.clear_events()
        return self.snapshot()
