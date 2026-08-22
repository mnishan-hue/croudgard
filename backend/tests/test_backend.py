import importlib
import os

from fastapi.testclient import TestClient


def client(tmp_path):
    os.environ["CROWDGUARD_DB_PATH"] = str(tmp_path / "test.db")
    import backend.main
    importlib.reload(backend.main)
    return TestClient(backend.main.app)


def test_health_and_snapshot(tmp_path):
    api=client(tmp_path)
    assert api.get("/api/health").json()["mode"]=="DEMO MODE"
    snapshot=api.get("/api/system").json()
    assert snapshot["decision"]["recommended_exit_id"]=="exit_b"
    assert snapshot["prediction"]["simulated"] is True


def test_dynamic_camera_and_exit(tmp_path):
    api=client(tmp_path); facility=api.get("/api/system").json()["facility"]
    camera={"id":"cam_extra","facility_id":facility["id"],"name":"Extra Camera","zone_ids":["zone_main"]}
    assert api.post("/api/cameras",json=camera).status_code==201
    zone={"id":"zone_extra","facility_id":facility["id"],"name":"Extra Exit Zone","type":"EXIT"}
    assert api.post("/api/zones",json=zone).status_code==201
    exit_={"id":"exit_extra","facility_id":facility["id"],"name":"Extra Exit","zone_id":"zone_extra","capacity":90}
    assert api.post("/api/exits",json=exit_).status_code==201
    assert len(api.get("/api/cameras").json())==4
    assert len(api.get("/api/exits").json())==3


def test_facility_switch_scenario_and_manual_override(tmp_path):
    api=client(tmp_path)
    large=api.post("/api/demo/facility/large_venue_demo").json()
    assert len(large["facility"]["cameras"])==8 and len(large["facility"]["exits"])==4
    state=api.post("/api/demo/scenario",json={"scenario":"CRITICAL_STATE"}).json()
    assert state["prediction"]["crowd_state"]=="CRITICAL_CROWD_RISK"
    best=state["decision"]["recommended_exit_id"]
    controlled=api.post("/api/control/manual",json={"action":"REDIRECT_TO_EXIT","recommended_exit_id":best}).json()
    assert controlled["automatic_control"] is False


def test_exit_ranking_ignores_closed():
    from backend.decision import ExitRankingService
    from backend.facilities import competition_facility
    facility=competition_facility(); facility.exits[1].status="CLOSED"
    ranking=ExitRankingService().rank(facility.exits,facility.zones)
    assert [item["exit_id"] for item in ranking]==["exit_a"]


def test_mock_hardware_and_intervention():
    from backend.facilities import competition_facility
    from backend.hardware.mock_esp32 import MockESP32Client
    facility=competition_facility(); state=MockESP32Client().set_state(facility.sentinels[0],{"action":"REDIRECT_TO_EXIT","recommended_exit_id":"exit_b"})
    assert state.led_routes["exit_b"]=="GREEN_GUIDANCE"
    assert state.arm_state=="BLOCK_ROUTE"


def test_junction_and_sentinel_crud(tmp_path):
    api=client(tmp_path)
    junction={"id":"junction_extra","name":"Extra Junction","connected_exit_ids":["exit_a"],"sentinel_ids":[],"map_x":40,"map_y":40}
    assert api.post("/api/junctions",json=junction).status_code==201
    sentinel={"id":"sentinel_extra","name":"Extra Sentinel","junction_id":"junction_extra","nearby_exit_ids":["exit_a"],"device_id":"mock-extra"}
    assert api.post("/api/sentinels",json=sentinel).status_code==201
    assert any(item["id"]=="sentinel_extra" for item in api.get("/api/sentinels").json())
    assert api.delete("/api/junctions/junction_extra").status_code==409
    assert api.delete("/api/sentinels/sentinel_extra").status_code==204
    assert api.delete("/api/junctions/junction_extra").status_code==204


def test_automatic_control_and_intervention_effectiveness(tmp_path):
    api=client(tmp_path)
    assert api.post("/api/control/auto",json={"enabled":False}).json()["automatic_control"] is False
    assert api.post("/api/control/auto",json={"enabled":True}).json()["automatic_control"] is True
    critical=api.post("/api/demo/scenario",json={"scenario":"CRITICAL_STATE"}).json()
    assert critical["intervention"]["status"]=="ACTIVE"
    recovery=api.post("/api/demo/scenario",json={"scenario":"RECOVERY"}).json()
    assert recovery["intervention"]["status"]=="RESOLVED"
    assert recovery["risk_history"][-1] < recovery["risk_history"][-2]


def test_zone_delete_protects_exit_references(tmp_path):
    api=client(tmp_path)
    assert api.delete("/api/zones/zone_exit_a").status_code==409
    zone={"id":"zone_temporary","facility_id":"competition_prototype","name":"Temporary Zone"}
    assert api.post("/api/zones",json=zone).status_code==201
    assert api.delete("/api/zones/zone_temporary").status_code==204


def test_manual_control_rejects_closed_exit(tmp_path):
    api=client(tmp_path)
    assert api.patch("/api/exits/exit_b",json={"status":"CLOSED"}).status_code==200
    response=api.post("/api/control/manual",json={"action":"REDIRECT_TO_EXIT","recommended_exit_id":"exit_b"})
    assert response.status_code==422


def test_timed_transition_reaches_not_improving_state(tmp_path):
    from backend.service import CrowdGuardService
    from backend.store import SQLiteStore
    service=CrowdGuardService(SQLiteStore(tmp_path/"transition.db"))
    transition_id=service.begin_transition()
    service.run_transition("CRITICAL_STATE",delay=0,transition_id=transition_id)
    snapshot=service.snapshot()
    assert snapshot.prediction.risk==95
    assert snapshot.intervention.status=="NOT_IMPROVING"


def test_production_spa_and_health_routes(tmp_path):
    api=client(tmp_path)
    health=api.get("/api/health")
    assert health.status_code==200 and health.json()["database"]=="ONLINE"
    root=api.get("/")
    assert root.status_code==200 and "text/html" in root.headers["content-type"]
    spa=api.get("/facility")
    assert spa.status_code==200 and "text/html" in spa.headers["content-type"]


def test_vercel_cors_preflight(tmp_path):
    api=client(tmp_path)
    response=api.options("/api/health",headers={"Origin":"https://crowdguard-demo.vercel.app","Access-Control-Request-Method":"GET"})
    assert response.status_code==200
    assert response.headers["access-control-allow-origin"]=="https://crowdguard-demo.vercel.app"
