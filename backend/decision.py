import time
from backend.models import Decision, Exit, Zone


class ExitRankingService:
    """Ranks usable exits; lower score is safer and less crowded."""

    def rank(self, exits: list[Exit], zones: list[Zone]) -> list[dict[str, float | str]]:
        zone_by_id = {zone.id: zone for zone in zones}
        ranked = []
        for exit_ in exits:
            if not exit_.enabled or exit_.status in {"CLOSED", "RESTRICTED"}:
                continue
            zone = zone_by_id.get(exit_.zone_id)
            metrics = zone.metrics if zone else None
            density = metrics.density if metrics else 0
            people = metrics.people_count if metrics else 0
            capacity_pressure = (
                max(0, exit_.current_inflow - exit_.current_outflow)
                / max(exit_.capacity, 1)
                * 100
            )

            # Score composite: lower score = safer, less crowded exit
            score = (
                exit_.risk * 0.40
                + density * 0.30
                + (people / max(exit_.capacity, 1)) * 30.0
                + max(0, metrics.queue_growth if metrics else 0) * 7.0
                + capacity_pressure * 0.15
                + (1 - exit_.availability) * 25.0
            )
            ranked.append({
                "exit_id": exit_.id,
                "name": exit_.name,
                "risk": exit_.risk,
                "people_count": people,
                "score": round(min(100, score), 2),
            })
        return sorted(ranked, key=lambda item: float(item["score"]))


class DecisionEngine:
    def __init__(
        self,
        switch_margin: float = 10.0,
        min_dwell_seconds: float = 8.0,
        free_threshold: float = 40.0,
        redirect_threshold: float = 45.0,
        critical_threshold: float = 70.0,
        emergency_threshold: float = 70.0,
    ) -> None:
        self.ranker = ExitRankingService()
        self.switch_margin = switch_margin
        self.min_dwell_seconds = min_dwell_seconds
        self.free_threshold = free_threshold
        self.redirect_threshold = redirect_threshold
        self.critical_threshold = critical_threshold
        self.emergency_threshold = emergency_threshold
        self.last_recommended_exit_id: str | None = None
        self.last_switch_time: float = 0.0

    def reset_state(self) -> None:
        self.last_recommended_exit_id = None
        self.last_switch_time = 0.0

    def decide(self, zones: list[Zone], exits: list[Exit]) -> Decision:
        enabled_zones = [zone for zone in zones if zone.enabled]
        affected_zone = max(enabled_zones, key=lambda z: z.risk, default=None)
        usable_exits = [
            exit_
            for exit_ in exits
            if exit_.enabled and exit_.status not in {"CLOSED", "RESTRICTED"}
        ]
        exit_by_id = {exit_.id: exit_ for exit_ in usable_exits}
        ranking = self.ranker.rank(usable_exits, zones)

        if not ranking:
            self.last_recommended_exit_id = None
            self.last_switch_time = 0.0
            return Decision(
                action="CRITICAL",
                recommended_exit_id=None,
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason="No usable exit route is available. Please walk slowly and await operator guidance.",
                exit_ranking=[],
            )
        exit_risks = [exit_.risk for exit_ in usable_exits]
        all_exits_free = bool(exit_risks) and all(
            risk < self.free_threshold for risk in exit_risks
        )
        no_exit_needs_redirect = not any(
            risk >= self.redirect_threshold for risk in exit_risks
        )

        # Exit guidance is based on exit conditions. A busy main area alone
        # must not invent a preferred route while every exit remains clear.
        if all_exits_free or no_exit_needs_redirect:
            self.last_recommended_exit_id = None
            self.last_switch_time = 0.0
            return Decision(
                action="NORMAL",
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason=(
                    "Both exits are free. Crowd flow is normal."
                    if len(usable_exits) >= 2
                    else "The available exit is clear. Crowd flow is normal."
                ),
                exit_ranking=ranking,
            )

        # Only declare a critical no-route state when every usable exit is
        # heavily crowded. A single crowded exit should redirect to the other.
        both_congested = len(usable_exits) >= 2 and all(
            exit_.risk >= self.critical_threshold for exit_ in usable_exits
        )
        single_congested_route = (
            len(usable_exits) == 1
            and usable_exits[0].risk >= self.redirect_threshold
        )

        if both_congested or single_congested_route:
            self.last_recommended_exit_id = None
            self.last_switch_time = 0.0
            return Decision(
                action="CRITICAL",
                recommended_exit_id=None,
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason=(
                    "Both exits are heavily congested. Please walk slowly and maintain spacing."
                    if both_congested
                    else "The only usable exit is congested. Please walk slowly and await operator guidance."
                ),
                exit_ranking=ranking,
            )

        # Asymmetric congestion: guide the crowd to the clearer usable exit.

        best_candidate = ranking[0]
        chosen_exit_id = str(best_candidate["exit_id"])

        # Hysteresis & Stabilization: prevent sudden shifts on transient noise
        now = time.monotonic()
        if (
            self.last_recommended_exit_id
            and self.last_recommended_exit_id in exit_by_id
            and self.last_recommended_exit_id != chosen_exit_id
        ):
            current_entry = next(
                (
                    item
                    for item in ranking
                    if item["exit_id"] == self.last_recommended_exit_id
                ),
                None,
            )
            if current_entry:
                current_score = float(current_entry["score"])
                candidate_score = float(best_candidate["score"])
                current_exit_risk = exit_by_id[
                    self.last_recommended_exit_id
                ].risk

                candidate_exit_risk = exit_by_id[chosen_exit_id].risk
                emergency_switch = (
                    current_exit_risk >= self.emergency_threshold
                    and current_exit_risk - candidate_exit_risk
                    >= self.switch_margin
                )
                is_dwell_met = (
                    now - self.last_switch_time
                ) >= self.min_dwell_seconds
                is_significantly_better = (
                    current_score - candidate_score
                ) >= self.switch_margin

                if not emergency_switch and (
                    not is_dwell_met or not is_significantly_better
                ):
                    chosen_exit_id = self.last_recommended_exit_id

        if chosen_exit_id != self.last_recommended_exit_id:
            self.last_recommended_exit_id = chosen_exit_id
            self.last_switch_time = now

        chosen_exit = exit_by_id.get(chosen_exit_id)
        congested_exits = [
            e for e in usable_exits if e.id != chosen_exit_id and e.risk >= 40
        ]
        congested_names = (
            ", ".join(e.name for e in congested_exits)
            if congested_exits
            else "Primary route"
        )
        reason = f"{congested_names} congested. Please proceed to {chosen_exit.name if chosen_exit else chosen_exit_id}."

        return Decision(
            action="REDIRECT_TO_EXIT",
            recommended_exit_id=chosen_exit_id,
            affected_zone_id=affected_zone.id if affected_zone else None,
            reason=reason,
            exit_ranking=ranking,
        )
