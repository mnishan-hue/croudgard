from backend.ai.base import AIProvider
from backend.models import AIExplanation, AIPrediction, CrowdState, Facility


class MockAIProvider(AIProvider):
    def predict(self, facility: Facility) -> AIPrediction:
        affected = max(facility.zones, key=lambda zone: zone.risk, default=None)
        risk = affected.risk if affected else 0
        state = CrowdState.NORMAL
        if risk >= 90: state = CrowdState.CRITICAL_CROWD_RISK
        elif risk >= 75: state = CrowdState.FLOW_INSTABILITY
        elif risk >= 60: state = CrowdState.CONGESTED
        elif risk >= 40: state = CrowdState.CONGESTION_BUILDING
        metrics = affected.metrics if affected else None
        ripple = "HIGH" if metrics and metrics.ripple_score >= 80 else "SPREADING" if metrics and metrics.ripple_score >= 55 else "LOCAL" if metrics and metrics.ripple_score >= 25 else "NONE"
        return AIPrediction(crowd_state=state, affected_zone_id=affected.id if affected else None, risk=risk, confidence=metrics.confidence if metrics else 0, ripple_state=ripple, explanations=[
            AIExplanation(signal="Crowd density", value=metrics.density, contribution=.32, description="Estimated occupied area in this simulated zone."),
            AIExplanation(signal="Queue growth", value=metrics.queue_growth, contribution=.24, description="Change in the simulated queue over time."),
            AIExplanation(signal="Direction conflict", value=metrics.direction_conflict, contribution=.20, description="Opposing simulated movement directions."),
            AIExplanation(signal="Ripple disturbance", value=metrics.ripple_score, contribution=.24, description="Simulated propagation of unusual movement."),
        ] if metrics else [])

    def get_zone_metrics(self, facility: Facility): return {z.id: z.metrics for z in facility.zones}
    def get_health(self): return {"provider": "MOCK", "online": True, "simulated": True}
