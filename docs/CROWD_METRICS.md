# Crowd metrics

- `people_count`: current person detections; overlapping cameras in one zone use the strongest view rather than summing.
- `density_score`: normalized 0–100 score combining occupied image area and count pressure. It is not people per square metre.
- `average_speed`: anonymous tracker displacement in pixels per second. It is not m/s without camera calibration.
- `movement_direction`: dominant image direction or mixed/stationary.
- `direction_conflict`: share of track-vector pairs moving in opposing directions.
- `inflow` / `outflow`: cumulative crossings of the configured counting line.
- `stopped_percentage`: share of tracks that remain below a normalized pixel-speed threshold for at least two seconds. It stays unavailable until sufficient history exists.
- `queue_growth`: people-count change per second over a rolling history.
- `congestion_score`: weighted density, stopped percentage, and queue growth.
- `risk_score`: congestion plus direction conflict and net inflow pressure.
- `trend`: rising, stable, falling, or unavailable.
- `movement disturbance`: experimental combination of direction variance, conflict, and speed change. It is not a validated stampede detector.

Unavailable values are returned and displayed as unavailable; CrowdGuard does not convert pixels to real-world measurements without calibration.

Set `--density-count-capacity` per camera to the approximate person count that visually fills that camera's monitored area. This makes count pressure venue-specific without pretending to measure people per square metre.
