from backend.ai.base import AIProvider


class TeachableMachineProvider(AIProvider):
    """Integration boundary for a future exported model; intentionally not fake-loaded."""
    def predict(self, facility): raise RuntimeError("MODEL NOT LOADED")
    def get_zone_metrics(self, facility): return {}
    def get_health(self): return {"provider": "TEACHABLE_MACHINE", "online": False, "status": "MODEL NOT LOADED"}
