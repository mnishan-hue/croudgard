import time
import threading

from backend.ai.mock import MockAIProvider
from backend.decision import DecisionEngine
from backend.hardware.mock_esp32 import MockESP32Client
from backend.models import EventLog, Intervention, LiveSnapshot


SCENARIOS = {"NORMAL": 20, "EXIT_A_CONGESTION": 82, "EXIT_B_CONGESTION": 82, "RIPPLE_DETECTED": 78, "CRITICAL_STATE": 95, "RECOVERY": 31, "ZONE_CONGESTION": 76, "EXIT_CONGESTION": 84, "MULTI_ZONE_EVENT": 88}


class CrowdGuardService:
    def __init__(self, store):
        self.store = store; self.ai = MockAIProvider(); self.decision_engine = DecisionEngine(); self.hardware = MockESP32Client(); self.risk_history = [22,31,44,56,69,82,76,65,53,41,29]; self._transition_lock=threading.Lock(); self._transition_id=0

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
        return LiveSnapshot(facility=facility, automatic_control=self.store.get_setting("automatic_control") == "true", prediction=prediction, decision=decision, intervention=intervention, events=self.store.events(), risk_history=self.risk_history)

    def apply_scenario(self, scenario, target_id=None, value_override=None):
        facility = self.facility; value = value_override if value_override is not None else SCENARIOS.get(scenario.upper())
        if value is None: raise ValueError("Unknown scenario")
        targets = [z for z in facility.zones if z.enabled]
        if target_id: targets = [z for z in targets if z.id == target_id]
        elif "EXIT_A" in scenario: targets = [z for z in targets if z.id.endswith("exit_a")]
        elif "EXIT_B" in scenario: targets = [z for z in targets if z.id.endswith("exit_b")]
        elif scenario not in {"MULTI_ZONE_EVENT", "NORMAL", "RECOVERY"}: targets = targets[:1]
        for zone in facility.zones:
            if zone in targets:
                zone.risk = value; zone.metrics.risk=value; zone.metrics.density=value; zone.metrics.queue_growth=max(-.4,(value-35)/14); zone.metrics.ripple_score=value if "RIPPLE" in scenario else max(0,value-40)
            elif scenario in {"NORMAL", "RECOVERY"}: zone.risk=value; zone.metrics.risk=value; zone.metrics.density=value
        for exit_ in facility.exits:
            zone = next((z for z in facility.zones if z.id == exit_.zone_id), None)
            if zone: exit_.risk=zone.risk; exit_.status="CONGESTED" if zone.risk>=70 else "CAUTION" if zone.risk>=40 else "AVAILABLE"
        self.store.save_facility(facility); self.risk_history=(self.risk_history+[value])[-30:]
        decision=self.decision_engine.decide(facility.zones,facility.exits)
        if self.store.get_setting("automatic_control") == "true" and decision.action != "NORMAL":
            for sentinel in facility.sentinels: self.hardware.set_state(sentinel, decision.model_dump())
            self.store.save_facility(facility)
        self.store.add_event(EventLog(category="AI", severity="CRITICAL" if value>=90 else "WARNING" if value>=50 else "INFO", message=f"Demo scenario {scenario.upper()} applied; values are simulated."))
        return self.snapshot()

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
