import time
from collections import defaultdict, deque
from typing import Literal

from backend.models import Decision, Exit, Zone


RouteState = Literal["NEUTRAL", "REDIRECT_A", "REDIRECT_B", "BOTH_BUSY"]


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
    """Stable two-exit state machine with a backward-compatible command output."""

    def __init__(
        self,
        switch_margin: float = 10.0,
        min_dwell_seconds: float | None = None,
        free_threshold: float = 40.0,
        redirect_threshold: float = 45.0,
        critical_threshold: float = 70.0,
        emergency_threshold: float = 70.0,
        rolling_window_size: int = 5,
        persistence_seconds: float = 3.0,
        min_active_route_seconds: float = 8.0,
        cooldown_seconds: float = 5.0,
    ) -> None:
        if rolling_window_size < 1:
            raise ValueError("rolling_window_size must be at least 1")
        self.ranker = ExitRankingService()
        self.switch_margin = switch_margin
        self.free_threshold = free_threshold
        self.redirect_threshold = redirect_threshold
        # Retained for constructor compatibility; BOTH_BUSY now means both
        # exits meet the same congestion threshold used for redirection.
        self.critical_threshold = critical_threshold
        self.emergency_threshold = emergency_threshold
        self.rolling_window_size = rolling_window_size
        self.persistence_seconds = persistence_seconds
        self.min_active_route_seconds = (
            min_dwell_seconds
            if min_dwell_seconds is not None
            else min_active_route_seconds
        )
        self.cooldown_seconds = cooldown_seconds
        self._risk_history: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=self.rolling_window_size)
        )
        self._active_state: RouteState | None = None
        self._active_since = 0.0
        self._last_transition_time = 0.0
        self._candidate_state: RouteState | None = None
        self._candidate_since = 0.0

    @property
    def last_recommended_exit_id(self) -> str | None:
        return self._recommended_exit(self._active_state)

    @property
    def last_switch_time(self) -> float:
        return self._last_transition_time

    def reset_state(self) -> None:
        self._risk_history.clear()
        self._active_state = None
        self._active_since = 0.0
        self._last_transition_time = 0.0
        self._candidate_state = None
        self._candidate_since = 0.0

    @staticmethod
    def _recommended_exit(state: RouteState | None) -> str | None:
        if state == "REDIRECT_A":
            return "exit_a"
        if state == "REDIRECT_B":
            return "exit_b"
        return None

    def _rolling_risks(self, exits: list[Exit]) -> dict[str, float]:
        present = {exit_.id for exit_ in exits}
        for exit_id in list(self._risk_history):
            if exit_id not in present:
                del self._risk_history[exit_id]
        rolling = {}
        for exit_ in exits:
            history = self._risk_history[exit_.id]
            history.append(exit_.risk)
            rolling[exit_.id] = sum(history) / len(history)
        return rolling

    def _observed_state(self, risks: dict[str, float]) -> RouteState:
        risk_a = risks.get("exit_a")
        risk_b = risks.get("exit_b")
        if risk_a is None or risk_b is None:
            return (
                "BOTH_BUSY"
                if any(risk >= self.redirect_threshold for risk in risks.values())
                else "NEUTRAL"
            )
        if risk_a >= self.redirect_threshold and risk_b >= self.redirect_threshold:
            return "BOTH_BUSY"
        if (
            risk_b >= self.redirect_threshold
            and risk_b - risk_a >= self.switch_margin
        ):
            return "REDIRECT_A"
        if (
            risk_a >= self.redirect_threshold
            and risk_a - risk_b >= self.switch_margin
        ):
            return "REDIRECT_B"
        return "NEUTRAL"

    def _apply_hysteresis(
        self, observed: RouteState, risks: dict[str, float]
    ) -> RouteState:
        active = self._active_state
        if active not in {"REDIRECT_A", "REDIRECT_B"} or observed == "BOTH_BUSY":
            return observed
        congested_id = "exit_b" if active == "REDIRECT_A" else "exit_a"
        recommended_id = "exit_a" if active == "REDIRECT_A" else "exit_b"
        congested_risk = risks.get(congested_id, 0.0)
        recommended_risk = risks.get(recommended_id, 0.0)
        release_threshold = self.redirect_threshold - self.switch_margin / 2
        if observed in {"REDIRECT_A", "REDIRECT_B"}:
            return observed
        if (
            congested_risk < self.free_threshold
            and recommended_risk < self.free_threshold
        ):
            return "NEUTRAL"
        if congested_risk >= release_threshold or congested_risk > recommended_risk:
            return active
        return "NEUTRAL"

    def _stabilize(self, desired: RouteState, now: float) -> RouteState:
        if self._active_state is None:
            self._active_state = desired
            self._active_since = now
            self._last_transition_time = now
            return desired
        if desired == self._active_state:
            self._candidate_state = None
            return self._active_state

        # Enter the safety state immediately. Route changes and recovery use
        # persistence, minimum active time, and cooldown below.
        if desired == "BOTH_BUSY":
            self._active_state = desired
            self._active_since = now
            self._last_transition_time = now
            self._candidate_state = None
            return desired

        if desired != self._candidate_state:
            self._candidate_state = desired
            self._candidate_since = now
            return self._active_state

        candidate_persisted = now - self._candidate_since >= self.persistence_seconds
        minimum_active_met = (
            self._active_state not in {"REDIRECT_A", "REDIRECT_B"}
            or now - self._active_since >= self.min_active_route_seconds
        )
        cooldown_met = now - self._last_transition_time >= self.cooldown_seconds
        if candidate_persisted and minimum_active_met and cooldown_met:
            self._active_state = desired
            self._active_since = now
            self._last_transition_time = now
            self._candidate_state = None
        return self._active_state

    def decide(self, zones: list[Zone], exits: list[Exit]) -> Decision:
        enabled_zones = [zone for zone in zones if zone.enabled]
        affected_zone = max(enabled_zones, key=lambda zone: zone.risk, default=None)
        usable_exits = [
            exit_ for exit_ in exits
            if exit_.enabled and exit_.status not in {"CLOSED", "RESTRICTED"}
        ]
        ranking = self.ranker.rank(usable_exits, zones)
        if not ranking:
            self.reset_state()
            return Decision(
                action="CRITICAL",
                route_state="BOTH_BUSY",
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason="No usable exit route is available. Please walk slowly and await operator guidance.",
                exit_ranking=[],
            )

        rolling_risks = self._rolling_risks(usable_exits)
        observed = self._observed_state(rolling_risks)
        desired = self._apply_hysteresis(observed, rolling_risks)
        route_state = self._stabilize(desired, time.monotonic())
        recommended_exit_id = self._recommended_exit(route_state)

        if route_state == "NEUTRAL":
            return Decision(
                action="NORMAL",
                route_state=route_state,
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason="Both exits are okay. Crowd flow is normal.",
                exit_ranking=ranking,
            )
        if route_state == "BOTH_BUSY":
            reason = (
                "The only usable exit is congested. Please walk slowly."
                if len(usable_exits) == 1
                else "Both exits are congested. Please walk slowly."
            )
            return Decision(
                action="CRITICAL",
                route_state=route_state,
                affected_zone_id=affected_zone.id if affected_zone else None,
                reason=reason,
                exit_ranking=ranking,
            )

        congested_exit_id = "exit_b" if route_state == "REDIRECT_A" else "exit_a"
        exit_by_id = {exit_.id: exit_ for exit_ in usable_exits}
        congested = exit_by_id.get(congested_exit_id)
        recommended = exit_by_id.get(recommended_exit_id or "")
        return Decision(
            action="REDIRECT_TO_EXIT",
            route_state=route_state,
            recommended_exit_id=recommended_exit_id,
            affected_zone_id=affected_zone.id if affected_zone else None,
            reason=(
                f"{congested.name if congested else congested_exit_id} is clearly more congested. "
                f"Please proceed to {recommended.name if recommended else recommended_exit_id}."
            ),
            exit_ranking=ranking,
        )
