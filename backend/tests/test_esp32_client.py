import json

from backend.hardware.esp32_client import ESP32Client
from backend.models import Sentinel


class Response:
    def __init__(self, body): self.body=body
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self): return json.dumps(self.body).encode()


def test_esp32_command_requires_acknowledgement(monkeypatch):
    sentinel=Sentinel(id="s1",name="Unit",junction_id="j1",device_id="cg-01",ip_address="192.168.1.80")
    monkeypatch.setattr("backend.hardware.esp32_client.urlopen",lambda request,timeout:Response({"acknowledged":True,"hardware_state":{"arm_state":"BLOCK_ROUTE","display_message":"USE EXIT B","audio":"PLEASE_USE_EXIT_B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}}))
    state=ESP32Client().set_state(sentinel,{"action":"REDIRECT_TO_EXIT","recommended_exit_id":"exit_b"})
    assert state.arm_state=="BLOCK_ROUTE"
    assert state.led_routes["exit_b"]=="GREEN_GUIDANCE"
    assert sentinel.command_acknowledged is True


def test_esp32_heartbeat_verifies_device_id(monkeypatch):
    sentinel=Sentinel(id="s1",name="Unit",junction_id="j1",device_id="cg-01",ip_address="http://device.local")
    monkeypatch.setattr("backend.hardware.esp32_client.urlopen",lambda request,timeout:Response({"device_id":"cg-01"}))
    ESP32Client().heartbeat(sentinel)
    assert sentinel.connected is True
    assert sentinel.last_heartbeat is not None
