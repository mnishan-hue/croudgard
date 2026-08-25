from backend.hardware.base import HardwareClient
from backend.models import HardwareState, Sentinel


class UnconfiguredHardwareClient(HardwareClient):
    def set_state(self, sentinel: Sentinel, command: dict) -> HardwareState:
        raise ConnectionError("No physical Sentinel hardware connection is configured")
