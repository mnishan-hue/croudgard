from abc import ABC, abstractmethod
from backend.models import AIPrediction, Facility


class AIProvider(ABC):
    @abstractmethod
    def predict(self, facility: Facility) -> AIPrediction: ...

    @abstractmethod
    def get_zone_metrics(self, facility: Facility): ...

    @abstractmethod
    def get_health(self) -> dict[str, str | bool]: ...
