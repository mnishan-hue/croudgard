import importlib
import os
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from backend.decision import DecisionEngine
from backend.hardware.esp32_client import compute_hardware_state
from backend.models import Exit, Zone, ZoneMetrics


def client(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "test_sync.db")
    import backend.main
    importlib.reload(backend.main)
    return TestClient(backend.main.app)


def test_three_cameras_ingest_independent_people_counts(tmp_path):
    api = client(tmp_path)
    now = datetime.now(timezone.utc).isoformat()

    # 1. Post CV observation for Main Camera (15 people)
    obs_main = {
        "camera_id": "cam_main",
        "captured_at": now,
        "people_count": 15,
        "tracked_people": 15,
        "detection_confidence": 0.88,
        "fps": 12.5,
        "density_score": 50.0,
        "occupied_area_ratio": 0.18,
        "congestion_score": 45.0,
        "risk_score": 48.0,
        "trend": "RISING",
        "disturbance": "NONE",
    }
    res_main = api.post("/api/ai/cv-observation", json=obs_main)
    assert res_main.status_code == 200

    # 2. Post CV observation for Exit A (4 people)
    obs_exit_a = {
        "camera_id": "cam_exit_a",
        "captured_at": now,
        "people_count": 4,
        "tracked_people": 4,
        "detection_confidence": 0.92,
        "fps": 11.8,
        "density_score": 22.2,
        "occupied_area_ratio": 0.05,
        "congestion_score": 20.0,
        "risk_score": 21.0,
        "trend": "STABLE",
        "disturbance": "NONE",
    }
    res_exit_a = api.post("/api/ai/cv-observation", json=obs_exit_a)
    assert res_exit_a.status_code == 200

    # 3. Post CV observation for Exit B (8 people)
    obs_exit_b = {
        "camera_id": "cam_exit_b",
        "captured_at": now,
        "people_count": 8,
        "tracked_people": 8,
        "detection_confidence": 0.85,
        "fps": 12.0,
        "density_score": 44.4,
        "occupied_area_ratio": 0.10,
        "congestion_score": 42.0,
        "risk_score": 43.0,
        "trend": "STABLE",
        "disturbance": "NONE",
    }
    res_exit_b = api.post("/api/ai/cv-observation", json=obs_exit_b)
    assert res_exit_b.status_code == 200

    # Verify snapshot
    snapshot = api.get("/api/system").json()
    assert snapshot["camera_ai_active"] is True
    assert set(snapshot["reporting_camera_ids"]) == {"cam_main", "cam_exit_a", "cam_exit_b"}

    zones = {z["id"]: z for z in snapshot["facility"]["zones"]}
    assert zones["zone_main"]["metrics"]["people_count"] == 15
    assert zones["zone_exit_a"]["metrics"]["people_count"] == 4
    assert zones["zone_exit_b"]["metrics"]["people_count"] == 8

    # Sum of all monitored zones = 15 + 4 + 8 = 27
    total_people = sum(z["metrics"]["people_count"] for z in snapshot["facility"]["zones"])
    assert total_people == 27


def test_demo_video_control_lifecycle(tmp_path):
    api = client(tmp_path)
    camera_ids = ["cam_main", "cam_exit_a", "cam_exit_b"]

    # Start demo
    res_start = api.post("/api/demo/video-control", json={"action": "START", "camera_ids": camera_ids})
    assert res_start.status_code == 200
    assert res_start.json()["action"] == "START"

    # Ingest observation
    now = datetime.now(timezone.utc).isoformat()
    api.post("/api/ai/cv-observation", json={
        "camera_id": "cam_main",
        "captured_at": now,
        "people_count": 10,
        "tracked_people": 10,
        "detection_confidence": 0.9,
        "fps": 12.0,
        "density_score": 30.0,
        "occupied_area_ratio": 0.1,
        "congestion_score": 30.0,
        "risk_score": 30.0,
        "trend": "STABLE",
        "disturbance": "NONE",
    })

    snap_before = api.get("/api/system").json()
    assert "cam_main" in snap_before["reporting_camera_ids"]

    # Pause demo
    res_pause = api.post("/api/demo/video-control", json={"action": "PAUSE", "camera_ids": camera_ids})
    assert res_pause.status_code == 200

    # Restart demo - should reset state
    res_restart = api.post("/api/demo/video-control", json={"action": "RESTART", "camera_ids": camera_ids})
    assert res_restart.status_code == 200

    snap_after = api.get("/api/system").json()
    assert "cam_main" not in snap_after["reporting_camera_ids"]
    assert snap_after["risk_history"] == []


def test_camera_frame_upload_and_stream(tmp_path):
    api = client(tmp_path)
    # Valid minimal JPEG (SOI 0xFFD8 ... EOI 0xFFD9)
    valid_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\xff\xd9"

    res = api.post(
        "/api/cameras/cam_main/frame",
        content=valid_jpeg,
        headers={"Content-Type": "image/jpeg"},
    )
    assert res.status_code == 202
    assert res.json()["camera_id"] == "cam_main"
    assert res.json()["sequence"] >= 1

    # Fetch latest frame
    frame_res = api.get("/api/cameras/cam_main/frame.jpg")
    assert frame_res.status_code == 200
    assert frame_res.headers["content-type"] == "image/jpeg"
    assert frame_res.content == valid_jpeg


def test_esp32_exit_preference_scenarios():
    """Validates all user-specified exit guidance and screen display scenarios."""
    engine = DecisionEngine(switch_margin=10.0, min_dwell_seconds=3.0)

    # 1. Both exits free -> NORMAL -> Screen shows "THANK YOU VISIT AGAIN"
    zones_free = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=20, metrics=ZoneMetrics(people_count=5, density=15)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=10, metrics=ZoneMetrics(people_count=2, density=10)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=12, metrics=ZoneMetrics(people_count=3, density=12)),
    ]
    exits_free = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=10),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=12),
    ]
    dec_normal = engine.decide(zones_free, exits_free)
    assert dec_normal.action == "NORMAL"
    hw_normal = compute_hardware_state(dec_normal.action, dec_normal.recommended_exit_id)
    assert hw_normal.display_message == "THANK YOU VISIT AGAIN"
    assert hw_normal.audio == "NONE"
    assert hw_normal.led_routes["exit_a"] == "NORMAL"
    assert hw_normal.led_routes["exit_b"] == "NORMAL"

    # 2. Exit A full / crowded -> Advise people to go to Exit B
    zones_exit_a_full = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=55, metrics=ZoneMetrics(people_count=18, density=50)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=65, metrics=ZoneMetrics(people_count=16, density=65)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=15, metrics=ZoneMetrics(people_count=3, density=15)),
    ]
    exits_a_full = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=65),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=15),
    ]
    dec_a_full = engine.decide(zones_exit_a_full, exits_a_full)
    assert dec_a_full.action == "REDIRECT_TO_EXIT"
    assert dec_a_full.recommended_exit_id == "exit_b"
    hw_a_full = compute_hardware_state(dec_a_full.action, dec_a_full.recommended_exit_id)
    assert hw_a_full.display_message == "PLEASE USE EXIT B"
    assert hw_a_full.audio == "PLEASE_USE_EXIT_B"
    assert hw_a_full.led_routes["exit_a"] == "RED_RESTRICTED"
    assert hw_a_full.led_routes["exit_b"] == "GREEN_GUIDANCE"

    # 3. Exit B full / crowded -> Advise people to go to Exit A
    zones_exit_b_full = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=58, metrics=ZoneMetrics(people_count=19, density=55)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=18, metrics=ZoneMetrics(people_count=4, density=18)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=70, metrics=ZoneMetrics(people_count=17, density=70)),
    ]
    exits_b_full = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=18),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=70),
    ]
    dec_b_full = engine.decide(zones_exit_b_full, exits_b_full)
    assert dec_b_full.action == "REDIRECT_TO_EXIT"
    assert dec_b_full.recommended_exit_id == "exit_a"
    hw_b_full = compute_hardware_state(dec_b_full.action, dec_b_full.recommended_exit_id)
    assert hw_b_full.display_message == "PLEASE USE EXIT A"
    assert hw_b_full.audio == "PLEASE_USE_EXIT_A"
    assert hw_b_full.led_routes["exit_a"] == "GREEN_GUIDANCE"
    assert hw_b_full.led_routes["exit_b"] == "RED_RESTRICTED"

    # 4. Both exits fully crowded -> CRITICAL -> Advise people to walk slowly
    zones_both_full = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=88, metrics=ZoneMetrics(people_count=35, density=88)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=80, metrics=ZoneMetrics(people_count=20, density=80)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=78, metrics=ZoneMetrics(people_count=20, density=78)),
    ]
    exits_both_full = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=80),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=78),
    ]
    dec_both = engine.decide(zones_both_full, exits_both_full)
    assert dec_both.action == "CRITICAL"
    hw_both = compute_hardware_state(dec_both.action, dec_both.recommended_exit_id)
    assert hw_both.display_message == "PLEASE WALK SLOWLY / MAINTAIN SPACE"
    assert hw_both.audio == "PLEASE_WALK_SLOWLY"
    assert hw_both.arm_state == "SAFE_NEUTRAL"
    assert hw_both.led_routes["exit_a"] == "CAUTION"
    assert hw_both.led_routes["exit_b"] == "CAUTION"


def test_hysteresis_prevents_sudden_flapping():
    """Verifies that transient camera count noise does not cause sudden flapping between Exit A and B."""
    engine = DecisionEngine(switch_margin=10.0, min_dwell_seconds=3.0)

    # Initial state: Exit A is crowded (55%), Exit B is clearer (35%) -> Recommends Exit B
    zones1 = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=50, metrics=ZoneMetrics(people_count=15, density=45)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=55, metrics=ZoneMetrics(people_count=12, density=55)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=35, metrics=ZoneMetrics(people_count=8, density=35)),
    ]
    exits1 = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=55),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=35),
    ]
    dec1 = engine.decide(zones1, exits1)
    assert dec1.recommended_exit_id == "exit_b"

    # Transient noise: Exit A drops to 44%, Exit B goes to 45% (difference only 1%)
    # Without hysteresis this would flap, but with hysteresis Exit B is maintained.
    zones2 = [
        Zone(id="z_main", facility_id="f1", name="Main Area", risk=50, metrics=ZoneMetrics(people_count=15, density=45)),
        Zone(id="z_exit_a", facility_id="f1", name="Exit A Zone", risk=44, metrics=ZoneMetrics(people_count=9, density=44)),
        Zone(id="z_exit_b", facility_id="f1", name="Exit B Zone", risk=45, metrics=ZoneMetrics(people_count=10, density=45)),
    ]
    exits2 = [
        Exit(id="exit_a", facility_id="f1", name="Exit A", zone_id="z_exit_a", risk=44),
        Exit(id="exit_b", facility_id="f1", name="Exit B", zone_id="z_exit_b", risk=45),
    ]
    dec2 = engine.decide(zones2, exits2)
    assert dec2.recommended_exit_id == "exit_b", "Hysteresis should keep Exit B stable on minor noise"
