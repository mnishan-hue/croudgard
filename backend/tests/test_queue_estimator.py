import importlib
import os

from fastapi.testclient import TestClient

from backend.models import Decision, Exit, Zone, ZoneMetrics
from backend.queue import MainAreaQueueEstimator


def scenario(
    *,
    main_risk: float,
    detections: int,
    density: float,
    stopped: float,
    growth: float,
    metric_trend: str,
    exit_a_risk: float,
    exit_b_risk: float,
    route_state: str,
    outflow: float = 0,
):
    main = Zone(
        id="zone_main",
        facility_id="facility",
        name="Main Area",
        type="MAIN_AREA",
        risk=main_risk,
        metrics=ZoneMetrics(
            people_count=detections,
            density=density,
            congestion_score=main_risk,
            stopped_percentage=stopped,
            queue_growth=growth,
            trend=metric_trend,
            available_metrics=[
                "people_count",
                "density_score",
                "stopped_percentage",
                "queue_growth",
            ],
        ),
    )
    exit_zones = [
        Zone(
            id="zone_exit_a",
            facility_id="facility",
            name="Exit A",
            metrics=ZoneMetrics(outflow=outflow, available_metrics=["outflow"]),
        ),
        Zone(
            id="zone_exit_b",
            facility_id="facility",
            name="Exit B",
            metrics=ZoneMetrics(outflow=outflow, available_metrics=["outflow"]),
        ),
    ]
    exits = [
        Exit(
            id="exit_a",
            facility_id="facility",
            name="Exit A",
            zone_id="zone_exit_a",
            risk=exit_a_risk,
            current_outflow=outflow,
        ),
        Exit(
            id="exit_b",
            facility_id="facility",
            name="Exit B",
            zone_id="zone_exit_b",
            risk=exit_b_risk,
            current_outflow=outflow,
        ),
    ]
    action = (
        "CRITICAL"
        if route_state == "BOTH_BUSY"
        else "REDIRECT_TO_EXIT"
        if route_state.startswith("REDIRECT")
        else "NORMAL"
    )
    recommended = (
        "exit_a"
        if route_state == "REDIRECT_A"
        else "exit_b"
        if route_state == "REDIRECT_B"
        else None
    )
    decision = Decision(
        action=action,
        route_state=route_state,
        recommended_exit_id=recommended,
        reason="Queue estimator test",
    )
    return main, exits, [main, *exit_zones], decision


def estimate_once(**values):
    return MainAreaQueueEstimator().estimate(*scenario(**values), sample_id="sample")


def test_required_queue_and_wait_scenarios():
    low = estimate_once(
        main_risk=20,
        detections=4,
        density=18,
        stopped=5,
        growth=0,
        metric_trend="STABLE",
        exit_a_risk=20,
        exit_b_risk=20,
        route_state="NEUTRAL",
    )
    assert low.queue_level == "LOW"
    assert low.estimated_wait_label == "<2 min"

    moderate_one_clear = estimate_once(
        main_risk=42,
        detections=12,
        density=42,
        stopped=30,
        growth=0.2,
        metric_trend="STABLE",
        exit_a_risk=70,
        exit_b_risk=20,
        route_state="REDIRECT_B",
    )
    assert moderate_one_clear.queue_level == "MODERATE"
    assert moderate_one_clear.estimated_wait_label == "~3 min"

    high_one_clear = estimate_once(
        main_risk=65,
        detections=20,
        density=68,
        stopped=55,
        growth=0.5,
        metric_trend="RISING",
        exit_a_risk=70,
        exit_b_risk=20,
        route_state="REDIRECT_B",
    )
    assert high_one_clear.queue_level == "HIGH"
    assert high_one_clear.estimated_wait_label == "~5 min"

    high_both_busy = estimate_once(
        main_risk=68,
        detections=24,
        density=72,
        stopped=65,
        growth=0.8,
        metric_trend="RISING",
        exit_a_risk=75,
        exit_b_risk=78,
        route_state="BOTH_BUSY",
    )
    assert high_both_busy.queue_level in {"HIGH", "VERY HIGH"}
    assert high_both_busy.estimated_wait_label in {"~8 min", "10+ min"}


def test_clearing_reduces_level_and_wait_gradually():
    estimator = MainAreaQueueEstimator()
    busy = scenario(
        main_risk=80,
        detections=28,
        density=80,
        stopped=80,
        growth=1,
        metric_trend="RISING",
        exit_a_risk=80,
        exit_b_risk=80,
        route_state="BOTH_BUSY",
    )
    first = estimator.estimate(*busy, sample_id="busy")
    estimates = [first]
    for index in range(1, 11):
        clearing = scenario(
            main_risk=20,
            detections=4,
            density=20,
            stopped=8,
            growth=-1,
            metric_trend="FALLING",
            exit_a_risk=70,
            exit_b_risk=20,
            route_state="REDIRECT_B",
            outflow=4,
        )
        estimates.append(estimator.estimate(*clearing, sample_id=f"clear-{index}"))

    waits = [item.estimated_wait for item in estimates]
    assert all(previous - current <= 1.0 for previous, current in zip(waits, waits[1:]))
    assert waits[-1] < waits[0]
    assert estimates[-1].queue_level == "LOW"
    assert any(item.queue_trend == "FALLING" for item in estimates)


def test_duplicate_snapshot_does_not_advance_smoothing():
    estimator = MainAreaQueueEstimator()
    values = scenario(
        main_risk=65,
        detections=20,
        density=68,
        stopped=55,
        growth=0.5,
        metric_trend="RISING",
        exit_a_risk=70,
        exit_b_risk=20,
        route_state="REDIRECT_B",
    )
    first = estimator.estimate(*values, sample_id="same-observation")
    repeated = estimator.estimate(*values, sample_id="same-observation")
    assert repeated is first
    assert len(estimator.score_history) == 1


def test_queue_fields_reach_api_and_websocket(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "queue.db")
    import backend.main

    importlib.reload(backend.main)
    api = TestClient(backend.main.app)

    def publish(camera_id: str, risk: float, people: int):
        response = api.post(
            "/api/ai/cv-observation",
            json={
                "camera_id": camera_id,
                "people_count": people,
                "tracked_people": people,
                "detection_confidence": 0.9,
                "fps": 10,
                "density_score": risk,
                "occupied_area_ratio": risk / 100,
                "average_speed_px_s": 8 if camera_id == "cam_main" else 16,
                "stopped_percentage": 55 if camera_id == "cam_main" else 20,
                "queue_growth": 0.5 if camera_id == "cam_main" else 0,
                "congestion_score": risk,
                "risk_score": risk,
                "trend": "RISING" if camera_id == "cam_main" else "STABLE",
                "disturbance": "NONE",
            },
        )
        assert response.status_code == 200

    publish("cam_main", 65, 20)
    publish("cam_exit_a", 70, 12)
    publish("cam_exit_b", 20, 3)

    snapshot = api.get("/api/system").json()
    assert snapshot["queue_level"] in {"MODERATE", "HIGH"}
    assert snapshot["queue_trend"] in {"RISING", "STABLE"}
    assert isinstance(snapshot["estimated_wait"], float)
    assert snapshot["estimated_wait_label"] in {"~3 min", "~5 min"}

    with api.websocket_connect("/ws/live") as websocket:
        live = websocket.receive_json()
    assert live["queue_level"] == snapshot["queue_level"]
    assert live["estimated_wait_label"] == snapshot["estimated_wait_label"]
