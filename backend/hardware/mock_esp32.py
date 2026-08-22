from backend.hardware.base import HardwareClient
from backend.models import HardwareState, Sentinel


class MockESP32Client(HardwareClient):
    def set_state(self, sentinel: Sentinel, command: dict) -> HardwareState:
        exit_id = command.get("recommended_exit_id")
        action = command.get("action", "NORMAL")
        leds = {candidate: ("GREEN_GUIDANCE" if candidate == exit_id else "RED_RESTRICTED" if exit_id else "NORMAL") for candidate in sentinel.nearby_exit_ids}
        sentinel.hardware_state = HardwareState(
            arm_state="BLOCK_ROUTE" if exit_id else "NORMAL",
            display_message=f"USE {exit_id.replace('_', ' ').upper()}" if exit_id else "NORMAL",
            audio="FOLLOW_ILLUMINATED_ROUTE" if exit_id else "NONE",
            audio_state="PLAYING" if exit_id else "IDLE",
            led_routes=leds,
        )
        if action == "CRITICAL": sentinel.hardware_state.display_message = "FOLLOW SAFE ROUTE"
        return sentinel.hardware_state
