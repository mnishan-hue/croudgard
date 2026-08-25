from backend.models import CrowdState, Decision, Exit, Zone


class ExitRankingService:
    """Ranks any number of usable exits; lower score is safer."""

    def rank(self, exits: list[Exit], zones: list[Zone]) -> list[dict[str, float | str]]:
        zone_by_id = {zone.id: zone for zone in zones}
        ranked = []
        for exit_ in exits:
            if not exit_.enabled or exit_.status in {"CLOSED", "RESTRICTED"}:
                continue
            zone = zone_by_id.get(exit_.zone_id)
            metrics = zone.metrics if zone else None
            capacity_pressure = max(0, exit_.current_inflow - exit_.current_outflow) / max(exit_.capacity, 1) * 100
            score = (
                exit_.risk * .35
                + (metrics.density if metrics else 0) * .25
                + max(0, metrics.queue_growth if metrics else 0) * 7
                + capacity_pressure * .15
                + (1 - exit_.availability) * 20
            )
            ranked.append({"exit_id": exit_.id, "name": exit_.name, "score": round(min(100, score), 2)})
        return sorted(ranked, key=lambda item: float(item["score"]))


class DecisionEngine:
    def __init__(self) -> None:
        self.ranker = ExitRankingService()

    def decide(self, zones: list[Zone], exits: list[Exit]) -> Decision:
        enabled = [zone for zone in zones if zone.enabled]
        affected = max(enabled, key=lambda zone: zone.risk, default=None)
        ranking = self.ranker.rank(exits, zones)
        risk = affected.risk if affected else 0
        usable_exits = [exit_ for exit_ in exits if exit_.enabled and exit_.status not in {"CLOSED", "RESTRICTED"}]
        no_clear_route = bool(usable_exits) and all(exit_.risk >= 75 for exit_ in usable_exits)
        if risk < 45:
            return Decision(action="NORMAL", affected_zone_id=affected.id if affected else None, reason="Crowd flow is within configured operating thresholds.", exit_ranking=ranking)
        if risk >= 90 or no_clear_route:
            return Decision(action="CRITICAL", recommended_exit_id=None if no_clear_route else ranking[0]["exit_id"] if ranking else None, affected_zone_id=affected.id, reason="No clear monitored route is available; operator and venue safety response is required." if no_clear_route else "Critical crowd risk requires operator and venue safety response.", exit_ranking=ranking)
        return Decision(action="REDIRECT_TO_EXIT", recommended_exit_id=ranking[0]["exit_id"] if ranking else None, affected_zone_id=affected.id, reason=f"{affected.name} has the highest developing risk; the lowest-scoring available exit is recommended.", exit_ranking=ranking)
