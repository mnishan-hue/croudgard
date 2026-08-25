import json
import time
from urllib.request import Request, urlopen

from backend.hardware.base import HardwareClient
from backend.models import HardwareState, Sentinel, utc_now


class ESP32Client(HardwareClient):
    def __init__(self, timeout: float = 2):
        self.timeout = timeout

    def _request(self, sentinel: Sentinel, path: str, payload: dict | None = None) -> dict:
        if not sentinel.ip_address:
            raise ConnectionError("Sentinel IP address is not configured")
        base = sentinel.ip_address.rstrip("/")
        if not base.startswith(("http://", "https://")):
            base = f"http://{base}"
        data = json.dumps(payload).encode() if payload is not None else None
        request = Request(f"{base}{path}", data=data, headers={"Content-Type":"application/json"}, method="POST" if data else "GET")
        started = time.perf_counter()
        with urlopen(request, timeout=self.timeout) as response:
            body = json.loads(response.read().decode() or "{}")
        sentinel.latency_ms = round((time.perf_counter()-started)*1000, 1)
        return body

    def heartbeat(self, sentinel: Sentinel) -> dict:
        body = self._request(sentinel, "/status")
        if body.get("device_id") not in {None, sentinel.device_id}:
            raise ConnectionError("ESP32 device ID does not match configuration")
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        return body

    def set_state(self, sentinel: Sentinel, command: dict) -> HardwareState:
        action = command.get("action", "NORMAL")
        exit_id = command.get("recommended_exit_id")
        body = self._request(sentinel, "/command", {"type":"SET_STATE","command":action,"device_id":sentinel.device_id,"recommended_exit_id":exit_id})
        if body.get("acknowledged") is not True:
            raise ConnectionError("ESP32 did not acknowledge the command")
        sentinel.connected = True
        sentinel.last_heartbeat = utc_now()
        sentinel.last_command = action if not exit_id else f"{action}:{exit_id}"
        sentinel.command_acknowledged = True
        state = body.get("hardware_state", body)
        sentinel.hardware_state = HardwareState.model_validate({"arm_state":state.get("arm_state","NORMAL"),"display_message":state.get("display_message","NORMAL"),"audio":state.get("audio","NONE"),"audio_state":state.get("audio_state","IDLE"),"led_routes":state.get("led_routes",{})})
        return sentinel.hardware_state
