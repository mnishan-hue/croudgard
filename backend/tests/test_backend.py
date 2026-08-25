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
    assert api.get("/api/health").json()["mode"]=="LIVE CAMERA"
    snapshot=api.get("/api/system").json()
    assert snapshot["decision"]["recommended_exit_id"] is None
    assert snapshot["prediction"]["risk"] == 0
    assert snapshot["camera_ai_active"] is False
    assert snapshot["risk_timeline"] == snapshot["risk_history"] == []

def test_person_count_updates_assigned_zone(tmp_path):
    api = client(tmp_path)
    response = api.post("/api/ai/person-count", json={"camera_id": "cam_main", "count": 7, "confidence": .91})
    assert response.status_code == 200
    assert response.json()["zone_ids"] == ["zone_main"]
    snapshot = api.get("/api/crowd/snapshot").json()
    zone = next(item for item in snapshot["facility"]["zones"] if item["id"] == "zone_main")
    assert zone["metrics"]["people_count"] == 7


def test_person_count_rejects_unknown_camera(tmp_path):
    api = client(tmp_path)
    response = api.post("/api/ai/person-count", json={"camera_id": "missing", "count": 1, "confidence": .8})
    assert response.status_code == 422


def test_person_count_rejects_low_confidence_and_stale_observations(tmp_path):
    from datetime import datetime, timedelta, timezone
    api = client(tmp_path)
    assert api.post("/api/ai/person-count", json={"camera_id":"cam_main","count":9,"confidence":.3}).status_code == 422
    stale=(datetime.now(timezone.utc)-timedelta(minutes=2)).isoformat()
    assert api.post("/api/ai/person-count", json={"camera_id":"cam_main","count":9,"confidence":.9,"captured_at":stale}).status_code == 422


def test_overlapping_camera_counts_are_smoothed_without_double_counting(tmp_path):
    api = client(tmp_path)
    facility=api.get("/api/system").json()["facility"]
    camera={"id":"cam_overlap","facility_id":facility["id"],"name":"Overlap Camera","zone_ids":["zone_main"]}
    assert api.post("/api/cameras",json=camera).status_code==201
    assert api.post("/api/ai/person-count",json={"camera_id":"cam_main","count":12,"confidence":.9}).status_code==200
    assert api.post("/api/ai/person-count",json={"camera_id":"cam_overlap","count":10,"confidence":.8}).status_code==200
    zone=next(item for item in api.get("/api/system").json()["facility"]["zones"] if item["id"]=="zone_main")
    assert zone["metrics"]["people_count"]==12
    assert zone["metrics"]["confidence"]==85


def test_camera_classification_updates_zone_risk_and_exit_decision(tmp_path):
    api=client(tmp_path)
    response=api.post("/api/ai/crowd-observation",json={"camera_id":"cam_exit_a","classification":"HIGH_CONGESTION","confidence":.92})
    assert response.status_code==200
    assert response.json()["smoothed_risk"]==86
    snapshot=api.get("/api/system").json()
    zone=next(item for item in snapshot["facility"]["zones"] if item["id"]=="zone_exit_a")
    assert zone["risk"]==86 and zone["metrics"]["confidence"]==92
    assert snapshot["decision"]["recommended_exit_id"] is None
    assert snapshot["exit_coverage_complete"] is False
    api.post("/api/ai/crowd-observation",json={"camera_id":"cam_exit_b","classification":"LOW_OR_EMPTY","confidence":.95})
    snapshot=api.get("/api/system").json()
    assert snapshot["exit_coverage_complete"] is True
    assert snapshot["decision"]["recommended_exit_id"]=="exit_b"


def test_camera_classification_rejects_weak_and_unknown_observations(tmp_path):
    api=client(tmp_path)
    assert api.post("/api/ai/crowd-observation",json={"camera_id":"cam_main","classification":"NORMAL_FLOW","confidence":.4}).status_code==422
    assert api.post("/api/ai/crowd-observation",json={"camera_id":"missing","classification":"NORMAL_FLOW","confidence":.9}).status_code==422


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


def test_only_configured_live_facility_is_available(tmp_path):
    api=client(tmp_path)
    facilities=api.get("/api/facilities").json()
    assert [item["id"] for item in facilities]==["competition_prototype"]
    assert api.post("/api/facilities/competition_prototype/activate").status_code==200
    assert api.post("/api/facilities/missing/activate").status_code==404


def test_exit_ranking_ignores_closed():
    from backend.decision import ExitRankingService
    from backend.facilities import competition_facility
    facility=competition_facility(); facility.exits[1].status="CLOSED"
    ranking=ExitRankingService().rank(facility.exits,facility.zones)
    assert [item["exit_id"] for item in ranking]==["exit_a"]


def test_unconfigured_hardware_does_not_fake_commands():
    from backend.hardware.unconfigured import UnconfiguredHardwareClient
    from backend.facilities import competition_facility
    import pytest
    with pytest.raises(ConnectionError):
        UnconfiguredHardwareClient().set_state(competition_facility().sentinels[0],{"action":"NORMAL"})


def test_junction_and_sentinel_crud(tmp_path):
    api=client(tmp_path)
    junction={"id":"junction_extra","name":"Extra Junction","connected_exit_ids":["exit_a"],"sentinel_ids":[],"map_x":40,"map_y":40}
    assert api.post("/api/junctions",json=junction).status_code==201
    sentinel={"id":"sentinel_extra","name":"Extra Sentinel","junction_id":"junction_extra","nearby_exit_ids":["exit_a"],"device_id":"unconfigured","connected":False}
    assert api.post("/api/sentinels",json=sentinel).status_code==201
    assert any(item["id"]=="sentinel_extra" for item in api.get("/api/sentinels").json())
    assert api.delete("/api/junctions/junction_extra").status_code==409
    assert api.delete("/api/sentinels/sentinel_extra").status_code==204
    assert api.delete("/api/junctions/junction_extra").status_code==204


def test_automatic_control_and_intervention_effectiveness(tmp_path):
    api=client(tmp_path)
    assert api.post("/api/control/auto",json={"enabled":False}).json()["automatic_control"] is False
    assert api.post("/api/control/auto",json={"enabled":True}).status_code==422
    api.post("/api/ai/crowd-observation",json={"camera_id":"cam_exit_a","classification":"HIGH_CONGESTION","confidence":.95})
    active=api.post("/api/ai/crowd-observation",json={"camera_id":"cam_exit_b","classification":"LOW_OR_EMPTY","confidence":.95}).json()["snapshot"]
    assert active["intervention"]["status"]=="ACTIVE"
    cleared=api.post("/api/system/clear-live-data").json()
    assert cleared["intervention"]["status"]=="RESOLVED"
    assert cleared["risk_history"]==[]


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


def test_camera_zone_patch_keeps_relationships_consistent(tmp_path):
    api=client(tmp_path)
    assert api.patch("/api/cameras/cam_main",json={"zone_ids":["zone_exit_b"]}).status_code==200
    facility=api.get("/api/system").json()["facility"]
    camera=next(item for item in facility["cameras"] if item["id"]=="cam_main")
    exit_zone=next(item for item in facility["zones"] if item["id"]=="zone_exit_b")
    exit_=next(item for item in facility["exits"] if item["id"]=="exit_b")
    assert "cam_main" in exit_["camera_ids"]
    old_zone=next(item for item in facility["zones"] if item["id"]=="zone_main")
    assert camera["zone_ids"]==["zone_exit_b"]
    assert "cam_main" in exit_zone["camera_ids"]
    assert "cam_main" not in old_zone["camera_ids"]
    assert api.patch("/api/cameras/cam_main",json={"zone_ids":["missing"]}).status_code==422


def test_zone_and_exit_patch_validate_references(tmp_path):
    api=client(tmp_path)
    assert api.patch("/api/zones/zone_main",json={"camera_ids":["cam_exit_a"]}).status_code==200
    facility=api.get("/api/system").json()["facility"]
    camera=next(item for item in facility["cameras"] if item["id"]=="cam_exit_a")
    assert "zone_main" in camera["zone_ids"]
    assert api.patch("/api/zones/zone_main",json={"camera_ids":["missing"]}).status_code==422
    assert api.patch("/api/exits/exit_a",json={"zone_id":"missing"}).status_code==422


def test_create_and_control_reject_invalid_references(tmp_path):
    api=client(tmp_path)
    camera={"id":"bad_camera","facility_id":"competition_prototype","name":"Bad Camera","zone_ids":["missing"]}
    assert api.post("/api/cameras",json=camera).status_code==422
    zone={"id":"bad_zone","facility_id":"other","name":"Bad Zone"}
    assert api.post("/api/zones",json=zone).status_code==422
    exit_={"id":"bad_exit","facility_id":"other","name":"Bad Exit","zone_id":"zone_main"}
    assert api.post("/api/exits",json=exit_).status_code==422
    command={"action":"NORMAL","sentinel_id":"missing"}
    assert api.post("/api/control/manual",json=command).status_code==404


def test_removed_scenario_endpoint_is_unavailable(tmp_path):
    api=client(tmp_path)
    assert api.post("/api/demo/scenario",json={"scenario":"ZONE_CONGESTION"}).status_code in {404,405}


def test_live_data_can_be_cleared(tmp_path):
    api=client(tmp_path)
    api.post("/api/ai/person-count",json={"camera_id":"cam_main","count":9,"confidence":.9})
    assert api.get("/api/system").json()["camera_ai_active"] is True
    cleared=api.post("/api/system/clear-live-data").json()
    assert cleared["camera_ai_active"] is False
    assert sum(zone["metrics"]["people_count"] for zone in cleared["facility"]["zones"])==0


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
    response=api.options("/api/health",headers={"Origin":"https://crowdgard.vercel.app","Access-Control-Request-Method":"GET"})
    assert response.status_code==200
    assert response.headers["access-control-allow-origin"]=="https://crowdgard.vercel.app"


def test_events_are_live_and_acknowledged(tmp_path):
    api=client(tmp_path)
    api.post("/api/ai/crowd-observation",json={"camera_id":"cam_main","classification":"NORMAL_FLOW","confidence":.9})
    assert api.get("/api/system").json()["events"][0]["category"]=="CAMERA_AI"
    acknowledged=api.post("/api/events/acknowledge").json()["acknowledged_at"]
    assert api.get("/api/system").json()["events_acknowledged_at"]==acknowledged
