import json
import os
import time
from uuid import uuid4
from urllib.request import Request, urlopen

from backend.hardware.base import HardwareClient
from backend.models import HardwareState, Sentinel, utc_now


HARDWARE_STATES = {"NEUTRAL", "REDIRECT_A", "REDIRECT_B", "BOTH_BUSY", "RESET"}


def canonical_hardware_state(action: str, exit_id: str | None = None, route_state: str | None = None) -> str:
    """Translate decision-engine and legacy API values at the backend boundary."""
    if action == "RESET":
        return "RESET"
    if action in HARDWARE_STATES:
        return action
    if route_state in HARDWARE_STATES:
        return route_state
    if action in {"NORMAL", "RECOVERY"}:
        return "NEUTRAL"
    if action == "CRITICAL":
        return "BOTH_BUSY"
    if action == "REDIRECT_TO_EXIT" and exit_id in {"exit_a", "exit_b"}:
        return "REDIRECT_A" if exit_id == "exit_a" else "REDIRECT_B"
    if action == "REDIRECT_TO_EXIT":
        raise ValueError("Redirect commands require exit_a or exit_b")
    raise ValueError(f"Cannot map {action!r} to an ESP32 state")


def compute_hardware_state(action: str, exit_id: str | None = None) -> HardwareState:
    """Computes the hardware state matching ESP32 firmware rules."""
    state = canonical_hardware_state(action, exit_id)
    if state in {"REDIRECT_A", "REDIRECT_B"}:
        target = "exit_a" if state == "REDIRECT_A" else "exit_b"
        display = "USE EXIT A" if target == "exit_a" else "USE EXIT B"
        audio = "PLEASE_USE_EXIT_A" if target == "exit_a" else "PLEASE_USE_EXIT_B"
        return HardwareState(
            arm_state=state,
            display_message=display,
            audio=audio,
            audio_state="PLAYING",
            led_routes={
                "exit_a": "GREEN_GUIDANCE" if target == "exit_a" else "RED_RESTRICTED",
                "exit_b": "GREEN_GUIDANCE" if target == "exit_b" else "RED_RESTRICTED",
            },
        )
    if state == "BOTH_BUSY":
        return HardwareState(
            arm_state="NEUTRAL",
            display_message="PLEASE WALK SLOWLY",
            audio="PLEASE_WALK_SLOWLY",
            audio_state="PLAYING",
            led_routes={"exit_a": "CAUTION", "exit_b": "CAUTION"},
        )
    else:
        return HardwareState(
            arm_state="NEUTRAL",
            display_message="THANK YOU",
            audio="NONE",
            audio_state="IDLE",
            led_routes={"exit_a": "NEUTRAL", "exit_b": "NEUTRAL"},
        )


class ESP32Client(HardwareClient):
    def __init__(self, timeout: float = 2, max_attempts: int | None = None):
        self.timeout = timeout
        configured = int(os.getenv("CROWDGUARD_ESP32_MAX_ATTEMPTS", "2"))
        self.max_attempts = max(1, min(max_attempts or configured, 3))

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
        action = command.get("action", "NEUTRAL")
        exit_id = command.get("recommended_exit_id")
        state_name = canonical_hardware_state(action, exit_id, command.get("route_state"))
        command_id = command.get("command_id") or str(uuid4())

        if self._is_mock_target(sentinel):
            sentinel.connected = True
            sentinel.last_heartbeat = utc_now()
            sentinel.last_command = state_name
            sentinel.last_command_id = command_id
            sentinel.acknowledged_state = state_name
            sentinel.command_acknowledged = True
            sentinel.last_error = None
            sentinel.hardware_state = compute_hardware_state(state_name)
            return sentinel.hardware_state

        payload = {"type": "SET_STATE", "device_id": sentinel.device_id, "state": state_name, "command_id": command_id}
        last_error: Exception | None = None
        body: dict = {}
        for attempt in range(self.max_attempts):
            try:
                body = self._request(sentinel, "/command", payload)
                if body.get("acknowledged") is not True:
                    raise TimeoutError("ESP32 acknowledgement was missing")
                if body.get("device_id") not in {None, sentinel.device_id}:
                    raise ConnectionError("ESP32 device ID does not match configuration")
                if body.get("command_id") != command_id or body.get("state") != state_name:
                    raise ConnectionError("ESP32 acknowledgement does not match the command")
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                if attempt + 1 < self.max_attempts:
                    time.sleep(.05 * (attempt + 1))
        if last_error is not None:
            sentinel.command_acknowledged = False
            sentinel.last_error = str(last_error)
            raise ConnectionError(f"ESP32 command failed after {self.max_attempts} attempts: {last_error}") from last_error

        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.last_command = state_name
        sentinel.last_command_id = command_id
        sentinel.acknowledged_state = state_name
        sentinel.command_acknowledged = True
        sentinel.last_error = None
        state = body.get("hardware_state", body)
        sentinel.hardware_state = HardwareState.model_validate({
            "arm_state": state.get("arm_state", "NEUTRAL"),
            "display_message": state.get("display_message", "THANK YOU"),
            "audio": state.get("audio", "NONE"),
            "audio_state": state.get("audio_state", "IDLE"),
            "led_routes": state.get("led_routes", {}),
        })
        return sentinel.hardware_state
