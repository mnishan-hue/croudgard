import json
import os
import time
from urllib.request import Request, urlopen

from backend.hardware.base import HardwareClient
from backend.models import HardwareState, Sentinel, utc_now


def compute_hardware_state(action: str, exit_id: str | None) -> HardwareState:
    """Computes the hardware state matching ESP32 firmware rules."""
    if action == "REDIRECT_TO_EXIT":
        if exit_id not in {"exit_a", "exit_b"}:
            raise ValueError("Redirect commands require exit_a or exit_b")
        target = exit_id
        display = "PLEASE USE EXIT A" if target == "exit_a" else "PLEASE USE EXIT B"
        audio = "PLEASE_USE_EXIT_A" if target == "exit_a" else "PLEASE_USE_EXIT_B"
        return HardwareState(
            arm_state="GUIDANCE",
            display_message=display,
            audio=audio,
            audio_state="PLAYING",
            led_routes={
                "exit_a": "GREEN_GUIDANCE" if target == "exit_a" else "RED_RESTRICTED",
                "exit_b": "GREEN_GUIDANCE" if target == "exit_b" else "RED_RESTRICTED",
            },
        )
    elif action == "CRITICAL":
        return HardwareState(
            arm_state="SAFE_NEUTRAL",
            display_message="PLEASE WALK SLOWLY / MAINTAIN SPACE",
            audio="PLEASE_WALK_SLOWLY",
            audio_state="PLAYING",
            led_routes={"exit_a": "CAUTION", "exit_b": "CAUTION"},
        )
    else:
        return HardwareState(
            arm_state="NORMAL",
            display_message="THANK YOU VISIT AGAIN",
            audio="NONE",
            audio_state="IDLE",
            led_routes={"exit_a": "NORMAL", "exit_b": "NORMAL"},
        )


class ESP32Client(HardwareClient):
    def __init__(self, timeout: float = 2):
        self.timeout = timeout

    def _is_mock_target(self, sentinel: Sentinel) -> bool:
        provider = os.getenv("CROWDGUARD_HARDWARE_PROVIDER", "").lower()
        if provider == "mock":
            return True
        ip = (sentinel.ip_address or "").lower()
        return ip in {"mock", "simulated", "virtual", "local", "127.0.0.1", "localhost"}

    def _request(self, sentinel: Sentinel, path: str, payload: dict | None = None) -> dict:
        if not sentinel.ip_address:
            raise ConnectionError("Sentinel IP address is not configured")
        base = sentinel.ip_address.rstrip("/")
        if not base.startswith(("http://", "https://")):
            base = f"http://{base}"
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            f"{base}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST" if data else "GET",
        )
        started = time.perf_counter()
        with urlopen(request, timeout=self.timeout) as response:
            body = json.loads(response.read().decode() or "{}")
        sentinel.latency_ms = round((time.perf_counter() - started) * 1000, 1)
        return body

    def heartbeat(self, sentinel: Sentinel) -> dict:
        if self._is_mock_target(sentinel):
            sentinel.connected = True
            sentinel.last_heartbeat = utc_now()
            sentinel.latency_ms = 1.2
            return {
                "device_id": sentinel.device_id,
                "status": "ready",
                "ip_address": sentinel.ip_address or "127.0.0.1",
                "uptime_ms": 120000,
                "hardware_state": sentinel.hardware_state.model_dump(),
            }

        body = self._request(sentinel, "/status")
        if body.get("device_id") not in {None, sentinel.device_id}:
            raise ConnectionError("ESP32 device ID does not match configuration")
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        return body

    def set_state(self, sentinel: Sentinel, command: dict) -> HardwareState:
        action = command.get("action", "NORMAL")
        exit_id = command.get("recommended_exit_id")

        if self._is_mock_target(sentinel):
            sentinel.connected = True
            sentinel.last_heartbeat = utc_now()
            sentinel.last_command = action if not exit_id else f"{action}:{exit_id}"
            sentinel.command_acknowledged = True
            sentinel.hardware_state = compute_hardware_state(action, exit_id)
            return sentinel.hardware_state

        body = self._request(
            sentinel,
            "/command",
            {
                "type": "SET_STATE",
                "command": action,
                "device_id": sentinel.device_id,
                "recommended_exit_id": exit_id,
            },
        )
        if body.get("acknowledged") is not True:
            raise ConnectionError("ESP32 did not acknowledge the command")

        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.last_command = action if not exit_id else f"{action}:{exit_id}"
        sentinel.command_acknowledged = True
        state = body.get("hardware_state", body)
        sentinel.hardware_state = HardwareState.model_validate({
            "arm_state": state.get("arm_state", "NORMAL"),
            "display_message": state.get("display_message", "THANK YOU VISIT AGAIN"),
            "audio": state.get("audio", "NONE"),
            "audio_state": state.get("audio_state", "IDLE"),
            "led_routes": state.get("led_routes", {}),
        })
        return sentinel.hardware_state
