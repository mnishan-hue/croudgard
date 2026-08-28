import importlib
import os

from fastapi.testclient import TestClient


def client(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "websocket.db")
    import backend.main

    importlib.reload(backend.main)
    return TestClient(backend.main.app)


def test_live_websocket_delivers_snapshot_and_disconnects_cleanly(tmp_path):
    api = client(tmp_path)
    with api.websocket_connect("/ws/live") as socket:
        snapshot = socket.receive_json()
        assert snapshot["backend_connected"] is True
        assert snapshot["facility"]["id"] == "competition_prototype"
        assert snapshot["decision"]["route_state"] == "NEUTRAL"

    # A client closing the WebSocket must not damage subsequent API requests.
    response = api.get("/api/system")
    assert response.status_code == 200
    assert response.json()["backend_connected"] is True
