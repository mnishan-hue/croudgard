from backend.ai.base import AIProvider
from backend.models import AIExplanation, AIPrediction, CrowdState, Facility


class CameraAIProvider(AIProvider):
    """Builds the operational prediction only from current camera observations."""

    def predict(self, facility: Facility) -> AIPrediction:
        observed = [zone for zone in facility.zones if zone.metrics.confidence > 0]
        affected = max(observed, key=lambda zone: zone.risk, default=None)
        if affected is None:
            return AIPrediction(crowd_state=CrowdState.NORMAL, risk=0, confidence=0)
        explanations = self._explanations(affected)
        ripple_state = "NONE"
        if affected.metrics.ripple_score >= 80:
            ripple_state = "HIGH"
        elif affected.metrics.ripple_score >= 55:
            ripple_state = "SPREADING"
        elif affected.metrics.ripple_score >= 25:
            ripple_state = "LOCAL"
        return AIPrediction(
            crowd_state=affected.crowd_state,
            affected_zone_id=affected.id,
            risk=affected.risk,
            confidence=affected.metrics.confidence,
            explanations=explanations,
            ripple_state=ripple_state,
        )

    @staticmethod
    def _explanations(zone):
        metrics = zone.metrics
        if "density_score" not in metrics.available_metrics:
            return [
                AIExplanation(signal="Camera crowd classification", value=zone.risk, contribution=.7, description="Risk mapped from the current camera classification."),
                AIExplanation(signal="Detection confidence", value=metrics.confidence, contribution=.3, description="Confidence reported by the current camera model."),
            ]
        explanations = [
            AIExplanation(signal="Density score", value=metrics.density, contribution=.35, description="Normalized image occupancy and configured count pressure; not people per square metre."),
            AIExplanation(signal="Congestion score", value=metrics.congestion_score, contribution=.30, description="Combined density, sustained stopping, and queue-growth signal."),
        ]
        if "direction_conflict" in metrics.available_metrics:
            explanations.append(AIExplanation(signal="Direction conflict", value=metrics.direction_conflict, contribution=.20, description="Share of anonymous track pairs moving in opposing image directions."))
        if "inflow" in metrics.available_metrics:
            net_flow = max(0, metrics.inflow - metrics.outflow)
            explanations.append(AIExplanation(signal="Net line crossings", value=net_flow, contribution=.15, description="Cumulative inbound minus outbound crossings at the configured line."))
        total = sum(item.contribution for item in explanations)
        for item in explanations:
            item.contribution = round(item.contribution / total, 3)
        return explanations

    def get_zone_metrics(self, facility: Facility):
        return {zone.id: zone.metrics for zone in facility.zones}

    def get_health(self):
        return {"provider": "CAMERA_AI", "online": True}
