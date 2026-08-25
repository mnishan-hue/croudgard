from backend.ai.base import AIProvider
from backend.models import AIExplanation, AIPrediction, CrowdState, Facility


class CameraAIProvider(AIProvider):
    """Builds the operational prediction only from current camera observations."""

    def predict(self, facility: Facility) -> AIPrediction:
        observed = [zone for zone in facility.zones if zone.metrics.confidence > 0]
        affected = max(observed, key=lambda zone: zone.risk, default=None)
        if affected is None:
            return AIPrediction(crowd_state=CrowdState.NORMAL, risk=0, confidence=0)
        return AIPrediction(
            crowd_state=affected.crowd_state,
            affected_zone_id=affected.id,
            risk=affected.risk,
            confidence=affected.metrics.confidence,
            explanations=[
                AIExplanation(signal="Camera crowd classification", value=affected.risk, contribution=.7, description="Risk mapped from the current on-device crowd classification."),
                AIExplanation(signal="Detection confidence", value=affected.metrics.confidence, contribution=.3, description="Confidence reported by the current camera model."),
            ],
        )

    def get_zone_metrics(self, facility: Facility):
        return {zone.id: zone.metrics for zone in facility.zones}

    def get_health(self):
        return {"provider": "CAMERA_AI", "online": True}
