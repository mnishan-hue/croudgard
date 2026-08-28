from collections import deque
from dataclasses import dataclass
from typing import Hashable, Literal

from backend.models import Decision, Exit, Zone


QueueLevel = Literal["LOW", "MODERATE", "HIGH", "VERY HIGH"]
QueueTrend = Literal["RISING", "STABLE", "FALLING"]


@dataclass(frozen=True)
class QueueEstimate:
    queue_level: QueueLevel
    queue_trend: QueueTrend
    estimated_wait: float
    estimated_wait_label: str


class MainAreaQueueEstimator:
    """Produces calm, coarse queue guidance from current measured conditions."""

    def __init__(
        self,
        history_size: int = 8,
        ema_alpha: float = 0.35,
        level_persistence_samples: int = 3,
        trend_persistence_samples: int = 2,
        max_score_change: float = 12.0,
        max_wait_change: float = 1.0,
    ) -> None:
        self.score_history: deque[float] = deque(maxlen=history_size)
        self.wait_history: deque[float] = deque(maxlen=history_size)
        self.ema_alpha = ema_alpha
        self.level_persistence_samples = level_persistence_samples
        self.trend_persistence_samples = trend_persistence_samples
        self.max_score_change = max_score_change
        self.max_wait_change = max_wait_change
        self._smoothed_score: float | None = None
        self._smoothed_wait: float | None = None
        self._level: QueueLevel | None = None
        self._level_candidate: QueueLevel | None = None
        self._level_candidate_samples = 0
        self._trend: QueueTrend = "STABLE"
        self._trend_candidate: QueueTrend | None = None
        self._trend_candidate_samples = 0
        self._last_sample_id: Hashable | None = None
        self._last_result: QueueEstimate | None = None

    def reset(self) -> None:
        self.__init__(
            history_size=self.score_history.maxlen or 8,
            ema_alpha=self.ema_alpha,
            level_persistence_samples=self.level_persistence_samples,
            trend_persistence_samples=self.trend_persistence_samples,
            max_score_change=self.max_score_change,
            max_wait_change=self.max_wait_change,
        )

    @staticmethod
    def _clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
        return min(maximum, max(minimum, value))

    def _queue_score(self, main: Zone) -> float:
        metrics = main.metrics
        available = set(metrics.available_metrics)
        signals: list[tuple[float, float]] = [(main.risk, 0.25)]

        if "density_score" in available or metrics.density > 0:
            signals.append((metrics.density, 0.25))
        if "people_count" in available or metrics.people_count > 0:
            signals.append((self._clamp(metrics.people_count / 30 * 100), 0.10))
        if metrics.congestion_score > 0:
            signals.append((metrics.congestion_score, 0.15))
        if "stopped_percentage" in available:
            signals.append((metrics.stopped_percentage, 0.15))
        if "queue_growth" in available:
            signals.append((self._clamp(metrics.queue_growth * 25), 0.10))
        if "movement" in available:
            slow_pressure = self._clamp((30 - metrics.average_speed) / 30 * 100)
            signals.append((slow_pressure, 0.05))

        weighted = sum(value * weight for value, weight in signals)
        score = weighted / sum(weight for _, weight in signals)
        if metrics.trend == "RISING":
            score += 5
        elif metrics.trend == "FALLING":
            score -= 5
        return self._clamp(score)

    @staticmethod
    def _level_for_score(score: float) -> QueueLevel:
        if score < 30:
            return "LOW"
        if score < 50:
            return "MODERATE"
        if score < 75:
            return "HIGH"
        return "VERY HIGH"

    def _stable_level(self, observed: QueueLevel) -> QueueLevel:
        if self._level is None:
            self._level = observed
            return observed
        if observed == self._level:
            self._level_candidate = None
            self._level_candidate_samples = 0
            return self._level
        if observed != self._level_candidate:
            self._level_candidate = observed
            self._level_candidate_samples = 1
            return self._level
        self._level_candidate_samples += 1
        if self._level_candidate_samples >= self.level_persistence_samples:
            self._level = observed
            self._level_candidate = None
            self._level_candidate_samples = 0
        return self._level

    def _observed_trend(self, main: Zone) -> QueueTrend:
        if len(self.score_history) >= 4:
            values = list(self.score_history)
            delta = sum(values[-2:]) / 2 - sum(values[:2]) / 2
            if delta >= 3:
                return "RISING"
            if delta <= -3:
                return "FALLING"
            return "STABLE"
        return main.metrics.trend if main.metrics.trend != "UNAVAILABLE" else "STABLE"

    def _stable_trend(self, observed: QueueTrend) -> QueueTrend:
        if observed == self._trend:
            self._trend_candidate = None
            self._trend_candidate_samples = 0
            return self._trend
        if observed != self._trend_candidate:
            self._trend_candidate = observed
            self._trend_candidate_samples = 1
            return self._trend
        self._trend_candidate_samples += 1
        if self._trend_candidate_samples >= self.trend_persistence_samples:
            self._trend = observed
            self._trend_candidate = None
            self._trend_candidate_samples = 0
        return self._trend

    @staticmethod
    def _wait_label(minutes: float) -> str:
        if minutes < 6.5:
            return "~5 min"
        if minutes < 9:
            return "~8 min"
        if minutes < 12.5:
            return "~10 min"
        if minutes < 17.5:
            return "~15 min"
        if minutes < 22.5:
            return "~20 min"
        return "25+ min"

    def _raw_wait(
        self,
        level: QueueLevel,
        trend: QueueTrend,
        main: Zone,
        exits: list[Exit],
        exit_zones: dict[str, Zone],
        decision: Decision,
    ) -> float:
        # A calm, realistic baseline: even a normal crowd needs roughly five
        # minutes to reach and clear the exits. Congestion then increases the
        # estimate instead of starting from an unrealistically tiny value.
        wait = {"LOW": 5.0, "MODERATE": 7.0, "HIGH": 10.0, "VERY HIGH": 14.0}[level]
        usable = [
            exit_
            for exit_ in exits
            if exit_.enabled and exit_.status not in {"CLOSED", "RESTRICTED"}
        ]
        both_busy = decision.route_state == "BOTH_BUSY" or (
            len(usable) >= 2
            and all(exit_.risk >= 45 for exit_ in usable)
        )
        one_clear = decision.route_state in {"REDIRECT_A", "REDIRECT_B"} or (
            any(exit_.risk < 40 for exit_ in usable)
            and any(exit_.risk >= 45 for exit_ in usable)
        )
        if both_busy:
            wait += 5
        elif one_clear:
            wait += 2

        measured_outflow = 0.0
        for exit_ in usable:
            zone = exit_zones.get(exit_.zone_id)
            if zone and "outflow" in zone.metrics.available_metrics:
                measured_outflow += max(0, exit_.current_outflow)
        wait -= min(2.0, measured_outflow / 8)

        if trend == "RISING":
            wait += 1.5
        elif trend == "FALLING":
            wait -= 1
            if decision.route_state in {"REDIRECT_A", "REDIRECT_B"}:
                wait -= 0.5
        if "queue_growth" in main.metrics.available_metrics:
            wait += min(1.0, max(0, main.metrics.queue_growth) / 2)
        return self._clamp(wait, 3, 25)

    def estimate(
        self,
        main: Zone,
        exits: list[Exit],
        zones: list[Zone],
        decision: Decision,
        sample_id: Hashable,
    ) -> QueueEstimate:
        if sample_id == self._last_sample_id and self._last_result is not None:
            return self._last_result
        self._last_sample_id = sample_id
        raw_score = self._queue_score(main)
        self.score_history.append(raw_score)
        rolling_score = sum(self.score_history) / len(self.score_history)
        ema_score = (
            rolling_score
            if self._smoothed_score is None
            else self.ema_alpha * rolling_score
            + (1 - self.ema_alpha) * self._smoothed_score
        )
        if self._smoothed_score is not None:
            delta = self._clamp(
                ema_score - self._smoothed_score,
                -self.max_score_change,
                self.max_score_change,
            )
            ema_score = self._smoothed_score + delta
        self._smoothed_score = ema_score

        level = self._stable_level(self._level_for_score(ema_score))
        trend = self._stable_trend(self._observed_trend(main))
        exit_zones = {zone.id: zone for zone in zones}
        raw_wait = self._raw_wait(level, trend, main, exits, exit_zones, decision)
        self.wait_history.append(raw_wait)
        rolling_wait = sum(self.wait_history) / len(self.wait_history)
        ema_wait = (
            rolling_wait
            if self._smoothed_wait is None
            else self.ema_alpha * rolling_wait
            + (1 - self.ema_alpha) * self._smoothed_wait
        )
        if self._smoothed_wait is not None:
            delta = self._clamp(
                ema_wait - self._smoothed_wait,
                -self.max_wait_change,
                self.max_wait_change,
            )
            ema_wait = self._smoothed_wait + delta
        self._smoothed_wait = ema_wait
        result = QueueEstimate(
            queue_level=level,
            queue_trend=trend,
            estimated_wait=round(ema_wait, 1),
            estimated_wait_label=self._wait_label(ema_wait),
        )
        self._last_result = result
        return result
