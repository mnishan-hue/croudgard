from abc import ABC, abstractmethod
from backend.models import HardwareState, Sentinel


class HardwareClient(ABC):
    @abstractmethod
    def set_state(self, sentinel: Sentinel, command: dict) -> HardwareState: ...
