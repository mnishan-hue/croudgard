import importlib
import os

from fastapi.testclient import TestClient

from backend.hardware.esp32_client import compute_hardware_state
from backend.models import Decision


def client(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "hardware_reliability.db")
    import backend.main

    importlib.reload(backend.main)
    return TestClient(backend.main.app), backend.main.service


def configure_mock(api):
    sentinel = api.get("/api/system").json()["facility"]["sentinels"][0]
    assert api.patch(f"/api/sentinels/{sentinel['id']}", json={"device_id": "cg-test", "ip_address": "mock"}).status_code == 200
    assert api.post(f"/api/hardware/{sentinel['id']}/heartbeat").status_code == 200
    return sentinel["id"]


def current_sentinel(api):
    return api.get("/api/system").json()["facility"]["sentinels"][0]


def test_required_hardware_state_mapping():
    neutral = compute_hardware_state("NEUTRAL")
    assert (neutral.arm_state, neutral.display_message, neutral.audio) == ("NEUTRAL", "THANK YOU", "NONE")
    assert neutral.led_routes == {"exit_a": "NEUTRAL", "exit_b": "NEUTRAL"}

    redirect_a = compute_hardware_state("REDIRECT_A")
    assert redirect_a.display_message == "USE EXIT A"
    assert redirect_a.led_routes == {"exit_a": "GREEN_GUIDANCE", "exit_b": "RED_RESTRICTED"}

    redirect_b = compute_hardware_state("REDIRECT_B")
    assert redirect_b.display_message == "USE EXIT B"
    assert redirect_b.led_routes == {"exit_a": "RED_RESTRICTED", "exit_b": "GREEN_GUIDANCE"}

    busy = compute_hardware_state("BOTH_BUSY")
    assert busy.arm_state == "NEUTRAL"
    assert busy.display_message == "PLEASE WALK SLOWLY"
    assert busy.led_routes == {"exit_a": "CAUTION", "exit_b": "CAUTION"}

    reset = compute_hardware_state("RESET")
    assert reset == neutral


def test_dedup_disconnect_reconnect_manual_auto_and_reset(tmp_path):
    api, service = client(tmp_path)
    sentinel_id = configure_mock(api)

    # 1. NEUTRAL -> REDIRECT_B and 5. manual override.
    response = api.post("/api/control/manual", json={"action": "REDIRECT_B", "sentinel_id": sentinel_id})
    assert response.status_code == 200
    sentinel = current_sentinel(api)
    assert sentinel["desired_state"] == sentinel["acknowledged_state"] == "REDIRECT_B"
    assert response.json()["automatic_control"] is False

    # 2. Identical AI frames/decisions do not produce another command.
    before = len([event for event in api.get("/api/events").json() if "acknowledged REDIRECT_B" in event["message"]])
    decision = Decision(action="REDIRECT_TO_EXIT", route_state="REDIRECT_B", recommended_exit_id="exit_b", reason="test")
    service.dispatch_decision(decision)
    service.dispatch_decision(decision)
    after = len([event for event in api.get("/api/events").json() if "acknowledged REDIRECT_B" in event["message"]])
    assert after == before

    # 3. REDIRECT_B -> BOTH_BUSY.
    assert api.post("/api/control/manual", json={"action": "BOTH_BUSY", "sentinel_id": sentinel_id}).status_code == 200
    assert current_sentinel(api)["hardware_state"]["display_message"] == "PLEASE WALK SLOWLY"

    # 4. Preserve a new desired state while offline, then synchronize it once.
    assert api.patch(f"/api/sentinels/{sentinel_id}", json={"connected": False}).status_code == 200
    queued = api.post("/api/control/manual", json={"action": "REDIRECT_A", "sentinel_id": sentinel_id})
    assert queued.status_code == 200
    assert current_sentinel(api)["desired_state"] == "REDIRECT_A"
    assert current_sentinel(api)["command_acknowledged"] is False
    assert api.post(f"/api/hardware/{sentinel_id}/heartbeat").status_code == 200
    synced = current_sentinel(api)
    assert synced["acknowledged_state"] == "REDIRECT_A"
    command_id = synced["last_command_id"]
    assert api.post(f"/api/hardware/{sentinel_id}/heartbeat").status_code == 200
    assert current_sentinel(api)["last_command_id"] == command_id

    # 6. Auto mode can resume and remains safe without requiring hardware.
    auto = api.post("/api/control/auto", json={"enabled": True})
    assert auto.status_code == 200
    assert auto.json()["automatic_control"] is True

    # 8. RESET is an acknowledged neutral baseline and returns to manual mode.
    reset = api.post("/api/control/manual", json={"action": "RESET", "sentinel_id": sentinel_id})
    assert reset.status_code == 200
    sentinel = current_sentinel(api)
    assert sentinel["desired_state"] == sentinel["acknowledged_state"] == "RESET"
    assert sentinel["hardware_state"]["display_message"] == "THANK YOU"
    assert reset.json()["automatic_control"] is False
