import time
import threading
from datetime import datetime, timedelta, timezone

from backend.ai.mock import MockAIProvider
from backend.decision import DecisionEngine
from backend.hardware.mock_esp32 import MockESP32Client
from backend.models import CrowdState, EventLog, Intervention, LiveSnapshot, RiskSample


SCENARIOS = {"NORMAL": 20, "EXIT_A_CONGESTION": 82, "EXIT_B_CONGESTION": 82, "RIPPLE_DETECTED": 78, "CRITICAL_STATE": 95, "RECOVERY": 31, "ZONE_CONGESTION": 76, "EXIT_CONGESTION": 84, "MULTI_ZONE_EVENT": 88}
CLASS_RISK = {"LOW_OR_EMPTY": 8, "NORMAL_FLOW": 25, "BUILDING_CONGESTION": 58, "HIGH_CONGESTION": 86}


class CrowdGuardService:
    def __init__(self, store):
        self.store = store; self.ai = MockAIProvider(); self.decision_engine = DecisionEngine(); self.hardware = MockESP32Client(); self.risk_history = [22,31,44,56,69,82,76,65,53,41,29]
        self.camera_people_counts: dict[str, dict] = {}
        self.camera_crowd_observations: dict[str, dict] = {}
        now=datetime.now(timezone.utc)
        self.risk_timeline=[RiskSample(timestamp=(now-timedelta(seconds=(len(self.risk_history)-index-1)*10)).isoformat(),risk=risk,intervention=index==5) for index,risk in enumerate(self.risk_history)]
        self._transition_lock=threading.Lock(); self._transition_id=0

    def begin_transition(self):
        with self._transition_lock: self._transition_id+=1; return self._transition_id

    def cancel_transitions(self): self.begin_transition()

    @property
    def facility(self): return self.store.get_facility(self.store.get_setting("active_facility"))

    def snapshot(self):
        facility = self.facility; prediction = self.ai.predict(facility); decision = self.decision_engine.decide(facility.zones, facility.exits)
        falling=len(self.risk_history)>1 and self.risk_history[-1] < self.risk_history[-2]
        rising_three=len(self.risk_history)>2 and self.risk_history[-1] > self.risk_history[-2] > self.risk_history[-3]
        status="RESOLVED" if prediction.risk < 40 else "EFFECTIVE" if falling else "NOT_IMPROVING" if rising_three and prediction.risk >= 70 else "ACTIVE"
        intervention = Intervention(status=status, recommended_exit_id=decision.recommended_exit_id, affected_zone_id=decision.affected_zone_id, started_risk=max(self.risk_history), current_risk=prediction.risk)
        return LiveSnapshot(facility=facility, automatic_control=self.store.get_setting("automatic_control") == "true", prediction=prediction, decision=decision, intervention=intervention, events=self.store.events(), risk_history=self.risk_history, risk_timeline=self.risk_timeline, current_scenario=self.store.get_setting("current_scenario") or "NORMAL", events_acknowledged_at=self.store.get_setting("events_acknowledged_at"))

    def record_person_count(self, observation):
        facility = self.facility
        camera = next((item for item in facility.cameras if item.id == observation.camera_id), None)
        if camera is None:
            raise ValueError("Camera does not exist in the active facility")
        if not camera.enabled or not camera.ai_enabled:
            raise ValueError("Camera or camera AI is disabled")
        captured_at = datetime.fromisoformat(observation.captured_at.replace("Z", "+00:00"))
        if captured_at.tzinfo is None:
            captured_at = captured_at.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - captured_at.astimezone(timezone.utc)).total_seconds()
        if age > 30 or age < -5:
            raise ValueError("Person-count observation is stale or has an invalid timestamp")
        if observation.confidence < .5:
            raise ValueError("Person-count confidence is below the accepted threshold")
        previous = self.camera_people_counts.get(camera.id)
        smoothed_count = observation.count if previous is None else round(previous["count"] * .35 + observation.count * .65)
        self.camera_people_counts[camera.id] = {"count": smoothed_count, "confidence": observation.confidence, "captured_at": captured_at}
        affected = []
        for zone in facility.zones:
            observed = [self.camera_people_counts[camera_id] for camera_id in zone.camera_ids if camera_id in self.camera_people_counts]
            if observed:
                # Cameras assigned to the same zone usually see overlapping people.
                # Use the strongest view rather than summing and double-counting.
                zone.metrics.people_count = max(item["count"] for item in observed)
                zone.metrics.confidence = round(sum(item["confidence"] for item in observed) / len(observed) * 100, 1)
                affected.append(zone.id)
        self.store.save_facility(facility)
        return {"camera_id": camera.id, "count": smoothed_count, "confidence": observation.confidence, "captured_at": observation.captured_at, "zone_ids": affected}

    def record_crowd_observation(self, observation):
        facility=self.facility
        camera=next((item for item in facility.cameras if item.id==observation.camera_id),None)
        if camera is None: raise ValueError("Camera does not exist in the active facility")
        if not camera.enabled or not camera.ai_enabled: raise ValueError("Camera or camera AI is disabled")
        captured_at=datetime.fromisoformat(observation.captured_at.replace("Z","+00:00"))
        if captured_at.tzinfo is None: captured_at=captured_at.replace(tzinfo=timezone.utc)
        age=(datetime.now(timezone.utc)-captured_at.astimezone(timezone.utc)).total_seconds()
        if age>30 or age<-5: raise ValueError("Crowd observation is stale or has an invalid timestamp")
        if observation.confidence<.6: raise ValueError("Crowd classification confidence is below the accepted threshold")
        target=CLASS_RISK[observation.classification]
        previous=self.camera_crowd_observations.get(camera.id)
        smoothed=target if previous is None else round(previous["risk"]*.4+target*.6,1)
        self.camera_crowd_observations[camera.id]={"risk":smoothed,"confidence":observation.confidence,"captured_at":captured_at,"classification":observation.classification}
        affected=[]
        for zone in facility.zones:
            observed=[self.camera_crowd_observations[camera_id] for camera_id in zone.camera_ids if camera_id in self.camera_crowd_observations]
            if not observed: continue
            zone.risk=max(item["risk"] for item in observed);zone.metrics.risk=zone.risk
            zone.metrics.confidence=round(sum(item["confidence"] for item in observed)/len(observed)*100,1)
            zone.crowd_state=CrowdState.CRITICAL_CROWD_RISK if zone.risk>=90 else CrowdState.FLOW_INSTABILITY if zone.risk>=75 else CrowdState.CONGESTED if zone.risk>=60 else CrowdState.CONGESTION_BUILDING if zone.risk>=40 else CrowdState.NORMAL
            affected.append(zone.id)
        for exit_ in facility.exits:
            zone=next((item for item in facility.zones if item.id==exit_.zone_id),None)
            if zone: exit_.risk=zone.risk;exit_.status="CONGESTED" if zone.risk>=70 else "CAUTION" if zone.risk>=40 else "AVAILABLE"
        maximum=max((zone.risk for zone in facility.zones),default=0)
        marker=maximum>=45 and (not self.risk_history or self.risk_history[-1]<45)
        self.risk_history=(self.risk_history+[maximum])[-30:];self.risk_timeline=(self.risk_timeline+[RiskSample(risk=maximum,intervention=marker)])[-30:]
        self.store.save_facility(facility)
        return {"camera_id":camera.id,"classification":observation.classification,"confidence":observation.confidence,"smoothed_risk":smoothed,"zone_ids":affected,"decision":self.decision_engine.decide(facility.zones,facility.exits)}

    def apply_scenario(self, scenario, target_id=None, value_override=None):
        facility = self.facility; value = value_override if value_override is not None else SCENARIOS.get(scenario.upper())
        if value is None: raise ValueError("Unknown scenario")
        self.store.set_setting("current_scenario", scenario.upper())
        targets = [z for z in facility.zones if z.enabled]
        if target_id:
            targets = [z for z in targets if z.id == target_id]
            if not targets: raise ValueError("Target zone does not exist or is disabled")
        elif scenario.upper() in {"EXIT_A_CONGESTION", "EXIT_B_CONGESTION"}:
            index = 0 if scenario.upper() == "EXIT_A_CONGESTION" else 1
            configured = [exit_ for exit_ in facility.exits if exit_.enabled]
            if len(configured) <= index: raise ValueError("Scenario requires another enabled exit")
            selected_zone_id = configured[index].zone_id
            targets = [zone for zone in targets if zone.id == selected_zone_id]
        elif scenario not in {"MULTI_ZONE_EVENT", "NORMAL", "RECOVERY"}: targets = targets[:1]
        for zone in facility.zones:
            if zone in targets:
                zone.risk = value; zone.metrics.risk=value; zone.metrics.density=value; zone.metrics.queue_growth=max(-.4,(value-35)/14); zone.metrics.ripple_score=value if "RIPPLE" in scenario else max(0,value-40)
            elif scenario in {"NORMAL", "RECOVERY"}: zone.risk=value; zone.metrics.risk=value; zone.metrics.density=value
        for exit_ in facility.exits:
            zone = next((z for z in facility.zones if z.id == exit_.zone_id), None)
            if zone: exit_.risk=zone.risk; exit_.status="CONGESTED" if zone.risk>=70 else "CAUTION" if zone.risk>=40 else "AVAILABLE"
        marker=value>=45 and (not self.risk_history or self.risk_history[-1]<45)
        self.risk_history=(self.risk_history+[value])[-30:]
        self.risk_timeline=(self.risk_timeline+[RiskSample(risk=value,intervention=marker)])[-30:]
        self.store.save_facility(facility)
        decision=self.decision_engine.decide(facility.zones,facility.exits)
        if self.store.get_setting("automatic_control") == "true" and decision.action != "NORMAL":
            for sentinel in facility.sentinels: self.hardware.set_state(sentinel, decision.model_dump())
            self.store.save_facility(facility)
        self.store.add_event(EventLog(category="AI", severity="CRITICAL" if value>=90 else "WARNING" if value>=50 else "INFO", message=f"Demo scenario {scenario.upper()} applied; values are simulated."))
        return self.snapshot()

    def reset_demo(self):
        self.cancel_transitions(); self.store.reset(); self.camera_people_counts.clear(); self.camera_crowd_observations.clear()
        self.risk_history=[20]
        self.risk_timeline=[RiskSample(risk=20,intervention=False)]
        return self.apply_scenario("NORMAL")

    def run_transition(self, scenario, target_id=None, delay=.7, transition_id=None):
        final=SCENARIOS.get(scenario.upper())
        if final is None: return
        current=self.snapshot().prediction.risk
        if scenario.upper()=="RECOVERY": steps=[max(31,round(current-(current-31)*fraction)) for fraction in (.2,.4,.6,.8,1)]
        elif scenario.upper()=="NORMAL": steps=[max(20,round(current-(current-20)*fraction)) for fraction in (.3,.6,1)]
        else: steps=[round(current+(final-current)*fraction) for fraction in (.2,.4,.6,.8,1)]
        for value in steps:
            if transition_id is not None and transition_id != self._transition_id: return
            self.apply_scenario(scenario,target_id,value)
            time.sleep(delay)
