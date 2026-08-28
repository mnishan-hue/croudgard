import json

import pytest

from backend.hardware.esp32_client import ESP32Client
from backend.models import Sentinel


class Response:
    def __init__(self, body): self.body=body
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self): return json.dumps(self.body).encode()


def test_esp32_command_requires_acknowledgement(monkeypatch):
    sentinel=Sentinel(id="s1",name="Unit",junction_id="j1",device_id="cg-01",ip_address="192.168.1.80")
    def response(request, timeout):
        payload = json.loads(request.data)
        return Response({"acknowledged":True,"device_id":"cg-01","state":payload["state"],"command_id":payload["command_id"],"hardware_state":{"arm_state":"REDIRECT_B","display_message":"USE EXIT B","audio":"PLEASE_USE_EXIT_B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}})
    monkeypatch.setattr("backend.hardware.esp32_client.urlopen",response)
    state=ESP32Client().set_state(sentinel,{"action":"REDIRECT_B"})
    assert state.arm_state=="REDIRECT_B"
    assert state.led_routes["exit_b"]=="GREEN_GUIDANCE"
    assert sentinel.command_acknowledged is True


def test_acknowledgement_timeout_has_bounded_idempotent_retries(monkeypatch):
    sentinel=Sentinel(id="s1",name="Unit",junction_id="j1",device_id="cg-01",ip_address="192.168.1.80")
    payloads=[]
    def no_ack(request, timeout):
        payloads.append(json.loads(request.data))
        return Response({"acknowledged":False})
    monkeypatch.setattr("backend.hardware.esp32_client.urlopen",no_ack)
    with pytest.raises(ConnectionError, match="after 2 attempts"):
        ESP32Client(max_attempts=2).set_state(sentinel,{"action":"BOTH_BUSY","command_id":"logical-1"})
    assert len(payloads)==2
    assert {payload["command_id"] for payload in payloads}=={"logical-1"}
    assert sentinel.command_acknowledged is False


def test_esp32_heartbeat_verifies_device_id(monkeypatch):
    sentinel=Sentinel(id="s1",name="Unit",junction_id="j1",device_id="cg-01",ip_address="http://device.local")
    monkeypatch.setattr("backend.hardware.esp32_client.urlopen",lambda request,timeout:Response({"device_id":"cg-01"}))
    ESP32Client().heartbeat(sentinel)
    assert sentinel.connected is True
    assert sentinel.last_heartbeat is not None


def test_blank_address_is_not_mock_hardware():
    sentinel = Sentinel(
        id="s1",
        name="Unit",
        junction_id="j1",
        device_id="cg-01",
        ip_address="",
    )
    with pytest.raises(ConnectionError, match="not configured"):
        ESP32Client().heartbeat(sentinel)
    assert sentinel.connected is False


def test_mock_hardware_requires_explicit_mock_address():
    sentinel = Sentinel(
        id="s1",
        name="Unit",
        junction_id="j1",
        device_id="cg-01",
        ip_address="mock",
    )
    status = ESP32Client().heartbeat(sentinel)
    assert status["status"] == "ready"
    assert sentinel.connected is True
