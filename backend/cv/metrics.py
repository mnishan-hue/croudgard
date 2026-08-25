from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class TrackedDetection:
    track_id: int
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)


class CrowdMetricExtractor:
    """Extracts anonymous, temporally stable motion features from tracked boxes."""

    def __init__(
        self,
        counting_line_y: float | None = None,
        history_seconds: float = 12,
        density_count_capacity: int = 30,
        crossing_cooldown_seconds: float = 1.5,
    ):
        self.counting_line_y = counting_line_y
        self.history_seconds = history_seconds
        self.density_count_capacity = max(density_count_capacity, 1)
        self.crossing_cooldown_seconds = max(crossing_cooldown_seconds, 0)
        self.tracks: dict[int, deque[tuple[float, float, float]]] = {}
        self.last_crossing: dict[int, float] = {}
        self.count_history: deque[tuple[float, int]] = deque()
        self.inflow = 0
        self.outflow = 0

    def update(self, detections: list[TrackedDetection], timestamp: float, width: int, height: int, fps: float) -> dict:
        active_ids = {item.track_id for item in detections}
        vectors: list[tuple[float, float, float]] = []
        speeds: list[float] = []
        stopped_eligible_speeds: list[float] = []
        for item in detections:
            history = self.tracks.setdefault(item.track_id, deque())
            x, y = item.center
            if history:
                previous_t, previous_x, previous_y = history[-1]
                if self.counting_line_y is not None:
                    line_y = self.counting_line_y * height
                    last_crossing = self.last_crossing.get(item.track_id, -math.inf)
                    if timestamp - last_crossing >= self.crossing_cooldown_seconds:
                        if previous_y < line_y <= y:
                            self.inflow += 1
                            self.last_crossing[item.track_id] = timestamp
                        elif previous_y > line_y >= y:
                            self.outflow += 1
                            self.last_crossing[item.track_id] = timestamp
            history.append((timestamp, x, y))
            while history and timestamp - history[0][0] > self.history_seconds:
                history.popleft()
            motion = self._motion_over_window(history, timestamp, .5, 2)
            if motion is not None:
                dx, dy, elapsed = motion
                speed = math.hypot(dx, dy) / elapsed
                speeds.append(speed)
                vectors.append((dx, dy, speed))
            stopped_motion = self._motion_over_window(history, timestamp, 2, 4)
            if stopped_motion is not None:
                dx, dy, elapsed = stopped_motion
                stopped_eligible_speeds.append(math.hypot(dx, dy) / elapsed)
        for track_id in list(self.tracks):
            history = self.tracks[track_id]
            if track_id not in active_ids and history and timestamp - history[-1][0] > 2:
                del self.tracks[track_id]
                self.last_crossing.pop(track_id, None)

        self.count_history.append((timestamp, len(detections)))
        while self.count_history and timestamp - self.count_history[0][0] > self.history_seconds:
            self.count_history.popleft()
        elapsed = self.count_history[-1][0] - self.count_history[0][0] if len(self.count_history) > 1 else 0
        queue_growth = (self.count_history[-1][1] - self.count_history[0][1]) / elapsed if elapsed >= 2 else None
        trend = "UNAVAILABLE" if queue_growth is None else "RISING" if queue_growth > .25 else "FALLING" if queue_growth < -.25 else "STABLE"

        frame_area = max(width * height, 1)
        occupied = min(1, sum(max(0, item.x2-item.x1) * max(0, item.y2-item.y1) for item in detections) / frame_area)
        count_pressure = min(1, len(detections) / self.density_count_capacity)
        density = min(100, (occupied * .65 + count_pressure * .35) * 100)
        average_speed = sum(speeds) / len(speeds) if speeds else None
        diagonal = max(math.hypot(width, height), 1)
        normalized_speed = (average_speed / diagonal) if average_speed is not None else None
        speed_band = "UNAVAILABLE" if normalized_speed is None else "SLOW" if normalized_speed < .025 else "FAST" if normalized_speed > .12 else "NORMAL"
        stopped = None if not stopped_eligible_speeds else sum(speed / diagonal < .018 for speed in stopped_eligible_speeds) / len(stopped_eligible_speeds) * 100
        direction, variance, conflict = self._direction(vectors)
        growth_score = min(100, max(0, queue_growth or 0) * 30)
        congestion = density * .5 + (stopped or 0) * .25 + growth_score * .25
        risk = congestion * .7 + (conflict or 0) * .2 + min(100, max(0, (self.inflow-self.outflow)) * 5) * .1
        disturbance = self._disturbance(variance, conflict, normalized_speed)
        confidence = sum(item.confidence for item in detections) / len(detections) if detections else 1.0
        return {
            "people_count": len(detections), "tracked_people": len(active_ids), "detection_confidence": round(confidence, 4), "fps": round(max(fps, 0), 2),
            "density_score": round(density, 2), "occupied_area_ratio": round(occupied, 4), "average_speed_px_s": None if average_speed is None else round(average_speed, 2),
            "speed_band": speed_band, "movement_direction": direction, "direction_variance": variance, "direction_conflict": conflict,
            "inflow": self.inflow if self.counting_line_y is not None else None, "outflow": self.outflow if self.counting_line_y is not None else None,
            "stopped_percentage": None if stopped is None else round(stopped, 2), "queue_growth": None if queue_growth is None else round(queue_growth, 3),
            "crowd_accumulation": None if queue_growth is None else round(max(0, queue_growth), 3), "congestion_score": round(min(100, congestion), 2),
            "risk_score": round(min(100, risk), 2), "trend": trend, "disturbance": disturbance,
        }

    @staticmethod
    def _motion_over_window(
        history: deque[tuple[float, float, float]],
        timestamp: float,
        minimum_seconds: float,
        target_seconds: float,
    ) -> tuple[float, float, float] | None:
        if len(history) < 2:
            return None
        candidates = [point for point in history if timestamp - point[0] >= minimum_seconds]
        if not candidates:
            return None
        reference_t, reference_x, reference_y = min(
            candidates,
            key=lambda point: abs((timestamp - point[0]) - target_seconds),
        )
        _, current_x, current_y = history[-1]
        elapsed = timestamp - reference_t
        if elapsed <= 0:
            return None
        return current_x - reference_x, current_y - reference_y, elapsed

    @staticmethod
    def _direction(vectors: list[tuple[float, float, float]]) -> tuple[str, float | None, float | None]:
        moving = [(dx, dy) for dx, dy, speed in vectors if speed > 1]
        if not moving:
            return ("STATIONARY" if vectors else "UNAVAILABLE", None, None)
        unit = [(dx/max(math.hypot(dx,dy),1e-6), dy/max(math.hypot(dx,dy),1e-6)) for dx,dy in moving]
        mean_x = sum(x for x,_ in unit)/len(unit); mean_y = sum(y for _,y in unit)/len(unit)
        coherence = min(1, math.hypot(mean_x, mean_y)); variance = round(1-coherence, 3)
        conflict_pairs = 0; pairs = 0
        for index, first in enumerate(unit):
            for second in unit[index+1:]:
                pairs += 1
                conflict_pairs += first[0]*second[0] + first[1]*second[1] < -.35
        conflict = round(conflict_pairs/max(pairs,1)*100, 2)
        if coherence < .35: direction = "MIXED"
        elif abs(mean_x) >= abs(mean_y): direction = "RIGHT" if mean_x > 0 else "LEFT"
        else: direction = "DOWN" if mean_y > 0 else "UP"
        return direction, variance, conflict

    @staticmethod
    def _disturbance(variance: float | None, conflict: float | None, speed: float | None) -> str:
        if variance is None or conflict is None:
            return "UNAVAILABLE"
        score = variance * 55 + conflict * .45 + min(20, (speed or 0) * 100)
        return "HIGH" if score >= 70 else "SPREADING" if score >= 50 else "LOCAL" if score >= 30 else "NONE"
