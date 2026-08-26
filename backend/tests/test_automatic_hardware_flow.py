import importlib
import os

from fastapi.testclient import TestClient


def client(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "hardware_flow.db")
    import backend.main

    importlib.reload(backend.main)
    return TestClient(backend.main.app)


def publish_cv(api, camera_id: str, risk: float, repeats: int = 1):
    observation = {
        "camera_id": camera_id,
        "people_count": round(risk / 4),
        "tracked_people": round(risk / 4),
        "detection_confidence": 0.9,
        "fps": 4,
        "density_score": risk,
        "occupied_area_ratio": min(risk / 100, 1),
        "congestion_score": risk,
        "risk_score": risk,
        "trend": "STABLE",
        "disturbance": "NONE",
    }
    response = None
    for _ in range(repeats):
        response = api.post("/api/ai/cv-observation", json=observation)
        assert response.status_code == 200
    return response.json()["snapshot"]


def hardware_state(api):
    sentinel = api.get("/api/system").json()["facility"]["sentinels"][0]
    return sentinel["hardware_state"]


def restart_analysis(api):
    response = api.post(
        "/api/demo/video-control",
        json={
            "action": "RESTART",
            "camera_ids": ["cam_main", "cam_exit_a", "cam_exit_b"],
        },
    )
    assert response.status_code == 200


def test_automatic_decisions_reach_mock_esp32_for_all_four_scenarios(tmp_path):
    api = client(tmp_path)
    sentinel = api.get("/api/system").json()["facility"]["sentinels"][0]
    sentinel_id = sentinel["id"]

    assert api.patch(
        f"/api/sentinels/{sentinel_id}",
        json={"ip_address": "mock"},
    ).status_code == 200
    assert api.post(f"/api/hardware/{sentinel_id}/heartbeat").status_code == 200
    assert api.post("/api/control/auto", json={"enabled": True}).status_code == 200

    # Both exits clear.
    publish_cv(api, "cam_exit_a", 20)
    publish_cv(api, "cam_exit_b", 20)
    assert hardware_state(api)["display_message"] == "THANK YOU VISIT AGAIN"

    # Exit A builds up; send people to Exit B.
    restart_analysis(api)
    publish_cv(api, "cam_exit_b", 18)
    publish_cv(api, "cam_exit_a", 85, repeats=3)
    state = hardware_state(api)
    assert state["display_message"] == "PLEASE USE EXIT B"
    assert state["led_routes"] == {
        "exit_a": "RED_RESTRICTED",
        "exit_b": "GREEN_GUIDANCE",
    }

    # Stopping sources must clear stale guidance on the physical unit.
    stopped = api.post(
        "/api/demo/video-control",
        json={
            "action": "STOP",
            "camera_ids": ["cam_main", "cam_exit_a", "cam_exit_b"],
        },
    )
    assert stopped.status_code == 200
    assert hardware_state(api)["display_message"] == "THANK YOU VISIT AGAIN"

    # Exit B builds up; send people to Exit A.
    restart_analysis(api)
    publish_cv(api, "cam_exit_a", 18)
    publish_cv(api, "cam_exit_b", 85, repeats=3)
    state = hardware_state(api)
    assert state["display_message"] == "PLEASE USE EXIT A"
    assert state["led_routes"] == {
        "exit_a": "GREEN_GUIDANCE",
        "exit_b": "RED_RESTRICTED",
    }

    # Both exits become heavily crowded.
    restart_analysis(api)
    publish_cv(api, "cam_exit_a", 85, repeats=3)
    publish_cv(api, "cam_exit_b", 85, repeats=3)
    state = hardware_state(api)
    assert state["display_message"] == "PLEASE WALK SLOWLY / MAINTAIN SPACE"
    assert state["audio"] == "PLEASE_WALK_SLOWLY"
    assert state["led_routes"] == {
        "exit_a": "CAUTION",
        "exit_b": "CAUTION",
    }
