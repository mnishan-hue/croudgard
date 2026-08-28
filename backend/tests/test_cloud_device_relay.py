import importlib
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from backend.models import Decision


DEVICE_KEY = "test-device-key"
HEADERS = {"X-CrowdGuard-Device-Key": DEVICE_KEY}


def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CROWDGUARD_DB_PATH", str(tmp_path / "cloud-relay.db"))
    monkeypatch.setenv("CROWDGUARD_DEVICE_API_KEY", DEVICE_KEY)
    monkeypatch.setenv("CROWDGUARD_DEVICE_ID", "cg-cloud-test")
    monkeypatch.setenv("CROWDGUARD_DEVICE_TRANSPORT", "CLOUD_POLL")
    import backend.main

    importlib.reload(backend.main)
    return TestClient(backend.main.app), backend.main.service


def sentinel(api):
    return api.get("/api/system").json()["facility"]["sentinels"][0]


def hardware_state(state):
    if state == "REDIRECT_B":
        return {
            "arm_state": "REDIRECT_B",
            "display_message": "USE EXIT B",
            "audio": "PLEASE_USE_EXIT_B",
            "audio_state": "PLAYING",
            "led_routes": {
                "exit_a": "RED_RESTRICTED",
                "exit_b": "GREEN_GUIDANCE",
            },
        }
    return {
        "arm_state": "NEUTRAL",
        "display_message": "THANK YOU",
        "audio": "NONE",
        "audio_state": "IDLE",
        "led_routes": {"exit_a": "NEUTRAL", "exit_b": "NEUTRAL"},
    }


def test_cloud_relay_auth_heartbeat_command_ack_and_dedup(tmp_path, monkeypatch):
    api, _ = client(tmp_path, monkeypatch)
    assert sentinel(api)["protocol"] == "CLOUD_POLL"
    assert api.get("/api/health").json()["sentinel_hardware"] == "DISCONNECTED"

    heartbeat = {
        "state": "NEUTRAL",
        "uptime_ms": 100,
        "hardware_state": hardware_state("NEUTRAL"),
    }
    assert api.post("/api/device/cg-cloud-test/heartbeat", json=heartbeat).status_code == 401
    assert (
        api.post(
            "/api/device/cg-cloud-test/heartbeat", json=heartbeat, headers=HEADERS
        ).status_code
        == 200
    )
    assert sentinel(api)["connected"] is True

    command = api.get(
        "/api/device/cg-cloud-test/command", headers=HEADERS
    ).json()
    assert command["pending"] is True
    assert command["state"] == "NEUTRAL"
    command_id = command["command_id"]
    acknowledgement = {
        "acknowledged": True,
        "state": "NEUTRAL",
        "command_id": command_id,
        "hardware_state": hardware_state("NEUTRAL"),
    }
    assert (
        api.post(
            "/api/device/cg-cloud-test/ack",
            json=acknowledgement,
            headers=HEADERS,
        ).status_code
        == 200
    )
    no_command = api.get(
        f"/api/device/cg-cloud-test/command?last_command_id={command_id}",
        headers=HEADERS,
    ).json()
    assert no_command["pending"] is False

    manual = api.post(
        "/api/control/manual",
        json={"action": "REDIRECT_B", "sentinel_id": sentinel(api)["id"]},
    )
    assert manual.status_code == 200
    first_redirect_id = sentinel(api)["last_command_id"]

    # Repeated status reads and polls preserve one logical command ID.
    redirect = api.get(
        f"/api/device/cg-cloud-test/command?last_command_id={command_id}",
        headers=HEADERS,
    ).json()
    assert redirect["state"] == "REDIRECT_B"
    assert redirect["command_id"] == first_redirect_id
    repeated = api.get(
        f"/api/device/cg-cloud-test/command?last_command_id={command_id}",
        headers=HEADERS,
    ).json()
    assert repeated["command_id"] == first_redirect_id

    acknowledgement.update(
        state="REDIRECT_B",
        command_id=first_redirect_id,
        hardware_state=hardware_state("REDIRECT_B"),
    )
    assert (
        api.post(
            "/api/device/cg-cloud-test/ack",
            json=acknowledgement,
            headers=HEADERS,
        ).status_code
        == 200
    )
    current = sentinel(api)
    assert current["desired_state"] == current["acknowledged_state"] == "REDIRECT_B"
    assert current["hardware_state"]["display_message"] == "USE EXIT B"


def test_cloud_relay_disconnect_preserves_state_and_reconnects(tmp_path, monkeypatch):
    api, service = client(tmp_path, monkeypatch)
    sentinel_id = sentinel(api)["id"]
    assert (
        api.post(
            "/api/device/cg-cloud-test/heartbeat",
            json={"state": "NEUTRAL"},
            headers=HEADERS,
        ).status_code
        == 200
    )
    assert (
        api.post(
            "/api/control/manual",
            json={"action": "BOTH_BUSY", "sentinel_id": sentinel_id},
        ).status_code
        == 200
    )
    command_id = sentinel(api)["last_command_id"]

    facility = service.facility
    facility.sentinels[0].last_heartbeat = (
        datetime.now(timezone.utc) - timedelta(seconds=60)
    ).isoformat()
    service.store.save_facility(facility)
    service.poll_hardware()
    offline = sentinel(api)
    assert offline["connected"] is False
    assert offline["desired_state"] == "BOTH_BUSY"
    assert offline["last_command_id"] == command_id

    reconnected = api.post(
        "/api/device/cg-cloud-test/heartbeat",
        json={"state": "NEUTRAL"},
        headers=HEADERS,
    )
    assert reconnected.status_code == 200
    current = api.get(
        "/api/device/cg-cloud-test/command", headers=HEADERS
    ).json()
    assert current["state"] == "BOTH_BUSY"
    assert current["command_id"] == command_id


def test_monitor_returns_stale_automatic_guidance_to_neutral(tmp_path, monkeypatch):
    api, service = client(tmp_path, monkeypatch)
    service.store.set_setting("automatic_control", "true")
    service.dispatch_decision(
        Decision(
            action="REDIRECT_TO_EXIT",
            route_state="REDIRECT_B",
            recommended_exit_id="exit_b",
            reason="Exit A is congested.",
        )
    )
    redirected = sentinel(api)
    redirect_command_id = redirected["last_command_id"]
    assert redirected["desired_state"] == "REDIRECT_B"

    # No fresh camera observation remains. The periodic monitor must synchronize
    # the already-neutral snapshot decision back to the physical display.
    service.poll_hardware()
    recovered = sentinel(api)
    assert recovered["desired_state"] == "NEUTRAL"
    assert recovered["last_command"] == "NEUTRAL"
    assert recovered["last_command_id"] != redirect_command_id

    command = api.get(
        "/api/device/cg-cloud-test/command",
        headers=HEADERS,
    ).json()
    assert command["pending"] is True
    assert command["state"] == "NEUTRAL"

    # Repeated maintenance polls must not create duplicate recovery commands.
    recovery_command_id = recovered["last_command_id"]
    service.poll_hardware()
    assert sentinel(api)["last_command_id"] == recovery_command_id


def test_monitor_preserves_manual_guidance_without_auto_mode(tmp_path, monkeypatch):
    api, service = client(tmp_path, monkeypatch)
    service.store.set_setting("automatic_control", "false")
    service.dispatch_decision(
        Decision(
            action="REDIRECT_TO_EXIT",
            route_state="REDIRECT_A",
            recommended_exit_id="exit_a",
            reason="Manual route selection.",
        )
    )

    service.poll_hardware()
    assert sentinel(api)["desired_state"] == "REDIRECT_A"


def test_cloud_command_delivers_wait_and_safest_exit_metadata(tmp_path, monkeypatch):
    api, service = client(tmp_path, monkeypatch)
    decision = Decision(
        action="CRITICAL",
        route_state="BOTH_BUSY",
        recommended_exit_id="exit_a",
        reason="Both exits are congested.",
    )
    service.dispatch_decision(
        decision,
        estimated_wait=16.2,
        estimated_wait_label="~15 min",
    )
    command = api.get(
        "/api/device/cg-cloud-test/command", headers=HEADERS
    ).json()
    assert command["state"] == "BOTH_BUSY"
    assert command["estimated_wait_minutes"] == 16.2
    assert command["estimated_wait_label"] == "~15 min"
    assert command["recommended_exit_id"] == "exit_a"

    command_id = command["command_id"]
    service.dispatch_decision(
        decision,
        estimated_wait=16.8,
        estimated_wait_label="~15 min",
    )
    assert sentinel(api)["last_command_id"] == command_id

    service.dispatch_decision(
        decision,
        estimated_wait=19.1,
        estimated_wait_label="~20 min",
    )
    assert sentinel(api)["last_command_id"] != command_id


def test_cloud_relay_rejects_wrong_acknowledgement(tmp_path, monkeypatch):
    api, _ = client(tmp_path, monkeypatch)
    command = api.get(
        "/api/device/cg-cloud-test/command", headers=HEADERS
    ).json()
    invalid = {
        "acknowledged": True,
        "state": "REDIRECT_A",
        "command_id": command["command_id"],
    }
    assert (
        api.post(
            "/api/device/cg-cloud-test/ack", json=invalid, headers=HEADERS
        ).status_code
        == 409
    )
