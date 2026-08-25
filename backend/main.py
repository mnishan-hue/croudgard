from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.models import AutoControlRequest, Camera, CrowdClassificationObservation, EventLog, Exit, Facility, Junction, ManualControlRequest, PersonCountObservation, Sentinel, Zone, utc_now
from backend.service import CrowdGuardService
from backend.store import SQLiteStore

DB_PATH = os.getenv("CROWDGUARD_DB_PATH", str(Path(__file__).parent / "crowdguard.db"))
store = SQLiteStore(DB_PATH)
service = CrowdGuardService(store)
app = FastAPI(title="CrowdGuard Sentinel API", version="1.0.0")
local_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
configured_origins = [origin.strip().rstrip("/") for origin in os.getenv("CROWDGUARD_CORS_ORIGINS", "").split(",") if origin.strip()]
origin_regex = os.getenv("CROWDGUARD_CORS_ORIGIN_REGEX", r"^https://[a-zA-Z0-9-]+\.vercel\.app$")
app.add_middleware(
    CORSMiddleware,
    allow_origins=local_origins + configured_origins,
    allow_origin_regex=origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/api/health")
def health():
    facility=service.facility
    connected = bool(facility and any(item.connected for item in facility.sentinels))
    return {"status": "ONLINE", "database": "ONLINE" if facility else "ERROR", "active_facility": facility.id if facility else None, "ai": service.ai.get_health(), "mode": "LIVE CAMERA", "sentinel_hardware": "CONNECTED" if connected else "NOT CONFIGURED"}


@app.get("/api/system")
@app.get("/api/crowd/snapshot")
def system(): return service.snapshot()


@app.get("/api/facilities")
def facilities(): return store.list_facilities()


@app.get("/api/facilities/{facility_id}")
def facility(facility_id: str):
    value = store.get_facility(facility_id)
    if not value: raise HTTPException(404, "Facility not found")
    return value


@app.post("/api/facilities")
def create_facility(value: Facility): return store.save_facility(value)


@app.post("/api/facilities/{facility_id}/activate")
def select_facility(facility_id: str):
    if not store.get_facility(facility_id): raise HTTPException(404, "Facility not found")
    service.cancel_transitions(); store.set_setting("active_facility", facility_id)
    store.add_event(EventLog(category="CONFIGURATION", message=f"Active facility changed to {facility_id}"))
    return service.snapshot()


@app.post("/api/system/clear-live-data")
def clear_live_data(): return service.clear_live_data()


@app.post("/api/events/acknowledge")
def acknowledge_events():
    timestamp=utc_now(); store.set_setting("events_acknowledged_at",timestamp)
    store.add_event(EventLog(category="SYSTEM",message="Operator acknowledged the event queue"))
    return {"acknowledged_at":timestamp}


def active():
    facility = service.facility
    if not facility: raise HTTPException(500, "FACILITY CONFIG ERROR")
    return facility


@app.post("/api/ai/person-count")
def person_count(observation: PersonCountObservation):
    try:
        return service.record_person_count(observation)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/ai/crowd-observation")
def crowd_observation(observation: CrowdClassificationObservation):
    try:
        return service.record_crowd_observation(observation)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/cameras")
def cameras(): return active().cameras


@app.post("/api/cameras", status_code=201)
def add_camera(camera: Camera):
    facility = active()
    if any(item.id == camera.id for item in facility.cameras): raise HTTPException(409, "Camera ID already exists")
    if camera.facility_id != facility.id: raise HTTPException(422, "Camera facility_id must match active facility")
    unknown=set(camera.zone_ids)-{zone.id for zone in facility.zones}
    if unknown: raise HTTPException(422,f"Unknown zones: {sorted(unknown)}")
    facility.cameras.append(camera)
    for zone in facility.zones:
        if zone.id in camera.zone_ids and camera.id not in zone.camera_ids: zone.camera_ids.append(camera.id)
    for exit_ in facility.exits:
        if exit_.zone_id in camera.zone_ids and camera.id not in exit_.camera_ids: exit_.camera_ids.append(camera.id)
    store.save_facility(facility); store.add_event(EventLog(category="CONFIGURATION", message=f"Camera {camera.name} added")); return camera


@app.patch("/api/cameras/{camera_id}")
def update_camera(camera_id: str, changes: dict):
    facility=active(); current=next((x for x in facility.cameras if x.id==camera_id),None)
    if not current: raise HTTPException(404,"Camera not found")
    updated=Camera.model_validate({**current.model_dump(),**changes,"id":camera_id,"facility_id":facility.id})
    unknown=set(updated.zone_ids)-{zone.id for zone in facility.zones}
    if unknown: raise HTTPException(422,f"Unknown zones: {sorted(unknown)}")
    facility.cameras=[updated if x.id==camera_id else x for x in facility.cameras]
    for zone in facility.zones:
        zone.camera_ids=[value for value in zone.camera_ids if value!=camera_id]
        if zone.id in updated.zone_ids: zone.camera_ids.append(camera_id)
    for exit_ in facility.exits:
        exit_.camera_ids=[value for value in exit_.camera_ids if value!=camera_id]
        if exit_.zone_id in updated.zone_ids: exit_.camera_ids.append(camera_id)
    store.save_facility(facility)
    store.add_event(EventLog(category="CONFIGURATION",message=f"Camera {updated.name} updated"))
    return updated


@app.delete("/api/cameras/{camera_id}", status_code=204)
def delete_camera(camera_id: str):
    facility=active()
    if not any(x.id==camera_id for x in facility.cameras): raise HTTPException(404,"Camera not found")
    facility.cameras=[x for x in facility.cameras if x.id!=camera_id]
    for zone in facility.zones: zone.camera_ids=[x for x in zone.camera_ids if x!=camera_id]
    for exit_ in facility.exits: exit_.camera_ids=[x for x in exit_.camera_ids if x!=camera_id]
    store.save_facility(facility)


@app.get("/api/zones")
def zones(): return active().zones


@app.post("/api/zones", status_code=201)
def add_zone(zone: Zone):
    facility=active()
    if any(x.id==zone.id for x in facility.zones): raise HTTPException(409,"Zone ID already exists")
    if zone.facility_id != facility.id: raise HTTPException(422,"Zone facility_id must match active facility")
    unknown=set(zone.camera_ids)-{camera.id for camera in facility.cameras}
    if unknown: raise HTTPException(422,f"Unknown cameras: {sorted(unknown)}")
    for camera in facility.cameras:
        if camera.id in zone.camera_ids and zone.id not in camera.zone_ids: camera.zone_ids.append(zone.id)
    facility.zones.append(zone); store.save_facility(facility); return zone


@app.patch("/api/zones/{zone_id}")
def update_zone(zone_id: str, changes: dict):
    facility=active(); current=next((x for x in facility.zones if x.id==zone_id),None)
    if not current: raise HTTPException(404,"Zone not found")
    updated=Zone.model_validate({**current.model_dump(),**changes,"id":zone_id,"facility_id":facility.id})
    unknown=set(updated.camera_ids)-{camera.id for camera in facility.cameras}
    if unknown: raise HTTPException(422,f"Unknown cameras: {sorted(unknown)}")
    facility.zones=[updated if x.id==zone_id else x for x in facility.zones]
    for camera in facility.cameras:
        camera.zone_ids=[value for value in camera.zone_ids if value!=zone_id]
        if camera.id in updated.camera_ids: camera.zone_ids.append(zone_id)
    for exit_ in facility.exits:
        if exit_.zone_id==zone_id: exit_.camera_ids=list(updated.camera_ids)

    store.save_facility(facility)
    store.add_event(EventLog(category="CONFIGURATION",message=f"Zone {updated.name} updated"))
    return updated


@app.delete("/api/zones/{zone_id}", status_code=204)
def delete_zone(zone_id: str):
    facility=active()
    if any(exit_.zone_id == zone_id for exit_ in facility.exits): raise HTTPException(409,"Remove or reassign exits using this zone first")
    if not any(zone.id == zone_id for zone in facility.zones): raise HTTPException(404,"Zone not found")
    facility.zones=[zone for zone in facility.zones if zone.id != zone_id]
    for camera in facility.cameras: camera.zone_ids=[value for value in camera.zone_ids if value != zone_id]
    store.save_facility(facility)


@app.get("/api/exits")
def exits(): return active().exits


@app.post("/api/exits", status_code=201)
def add_exit(exit_: Exit):
    facility=active()
    if any(x.id==exit_.id for x in facility.exits): raise HTTPException(409,"Exit ID already exists")
    unknown=set(exit_.camera_ids)-{camera.id for camera in facility.cameras}
    if unknown: raise HTTPException(422,f"Unknown cameras: {sorted(unknown)}")
    if exit_.facility_id != facility.id: raise HTTPException(422,"Exit facility_id must match active facility")
    if not any(z.id==exit_.zone_id for z in facility.zones): raise HTTPException(422,"Assigned zone does not exist")
    facility.exits.append(exit_); store.save_facility(facility); store.add_event(EventLog(category="CONFIGURATION",message=f"Exit {exit_.name} added")); return exit_


@app.patch("/api/exits/{exit_id}")
def update_exit(exit_id: str, changes: dict):
    facility=active(); current=next((x for x in facility.exits if x.id==exit_id),None)
    if not current: raise HTTPException(404,"Exit not found")
    updated=Exit.model_validate({**current.model_dump(),**changes,"id":exit_id,"facility_id":facility.id})
    if not any(zone.id==updated.zone_id for zone in facility.zones): raise HTTPException(422,"Assigned zone does not exist")
    unknown=set(updated.camera_ids)-{camera.id for camera in facility.cameras}
    if unknown: raise HTTPException(422,f"Unknown cameras: {sorted(unknown)}")
    facility.exits=[updated if x.id==exit_id else x for x in facility.exits]; store.save_facility(facility); store.add_event(EventLog(category="CONFIGURATION",message=f"Exit {updated.name} updated")); return updated


@app.delete("/api/exits/{exit_id}", status_code=204)
def delete_exit(exit_id: str):
    facility=active()
    if not any(x.id==exit_id for x in facility.exits): raise HTTPException(404,"Exit not found")
    facility.exits=[x for x in facility.exits if x.id!=exit_id]; facility.routes=[x for x in facility.routes if x.exit_id!=exit_id]
    for junction in facility.junctions: junction.connected_exit_ids=[x for x in junction.connected_exit_ids if x!=exit_id]
    store.save_facility(facility)


@app.get("/api/sentinels")
@app.get("/api/hardware")
def sentinels(): return active().sentinels


@app.post("/api/junctions", status_code=201)
def add_junction(junction: Junction):
    facility=active()
    if any(item.id == junction.id for item in facility.junctions): raise HTTPException(409,"Junction ID already exists")
    unknown=set(junction.connected_exit_ids)-{item.id for item in facility.exits}
    if unknown: raise HTTPException(422,f"Unknown exits: {sorted(unknown)}")
    facility.junctions.append(junction); store.save_facility(facility); return junction


@app.patch("/api/junctions/{junction_id}")
def update_junction(junction_id: str, changes: dict):
    facility=active(); current=next((item for item in facility.junctions if item.id==junction_id),None)
    if not current: raise HTTPException(404,"Junction not found")
    updated=Junction.model_validate({**current.model_dump(),**changes,"id":junction_id})
    facility.junctions=[updated if item.id==junction_id else item for item in facility.junctions]; store.save_facility(facility); return updated


@app.delete("/api/junctions/{junction_id}", status_code=204)
def delete_junction(junction_id: str):
    facility=active()
    if any(item.junction_id==junction_id for item in facility.sentinels): raise HTTPException(409,"Remove or reassign Sentinels at this junction first")
    if not any(item.id==junction_id for item in facility.junctions): raise HTTPException(404,"Junction not found")
    facility.junctions=[item for item in facility.junctions if item.id!=junction_id]; facility.routes=[item for item in facility.routes if item.from_junction_id!=junction_id]; store.save_facility(facility)


@app.post("/api/sentinels", status_code=201)
def add_sentinel(sentinel: Sentinel):
    facility=active()
    if any(item.id==sentinel.id for item in facility.sentinels): raise HTTPException(409,"Sentinel ID already exists")
    junction=next((item for item in facility.junctions if item.id==sentinel.junction_id),None)
    if not junction: raise HTTPException(422,"Assigned junction does not exist")
    facility.sentinels.append(sentinel); junction.sentinel_ids.append(sentinel.id); store.save_facility(facility); return sentinel


@app.patch("/api/sentinels/{sentinel_id}")
def update_sentinel(sentinel_id: str, changes: dict):
    facility=active(); current=next((item for item in facility.sentinels if item.id==sentinel_id),None)
    if not current: raise HTTPException(404,"Sentinel not found")
    updated=Sentinel.model_validate({**current.model_dump(),**changes,"id":sentinel_id})
    if not any(item.id==updated.junction_id for item in facility.junctions): raise HTTPException(422,"Assigned junction does not exist")
    for junction in facility.junctions:
        junction.sentinel_ids=[item for item in junction.sentinel_ids if item!=sentinel_id]
        if junction.id==updated.junction_id: junction.sentinel_ids.append(sentinel_id)
    facility.sentinels=[updated if item.id==sentinel_id else item for item in facility.sentinels]; store.save_facility(facility); return updated


@app.delete("/api/sentinels/{sentinel_id}", status_code=204)
def delete_sentinel(sentinel_id: str):
    facility=active()
    if not any(item.id==sentinel_id for item in facility.sentinels): raise HTTPException(404,"Sentinel not found")
    facility.sentinels=[item for item in facility.sentinels if item.id!=sentinel_id]
    for junction in facility.junctions: junction.sentinel_ids=[item for item in junction.sentinel_ids if item!=sentinel_id]
    store.save_facility(facility)


@app.get("/api/events")
def events(limit: int = 100): return store.events(min(500,max(1,limit)))


@app.post("/api/control/auto")
def auto_control(request: AutoControlRequest):
    if request.enabled and not any(sentinel.connected for sentinel in active().sentinels):
        raise HTTPException(422, "Automatic guidance requires at least one connected Sentinel")
    store.set_setting("automatic_control",str(request.enabled).lower())
    return service.snapshot()


@app.post("/api/control/manual")
def manual_control(request: ManualControlRequest):
    facility=active()
    sentinel=next((x for x in facility.sentinels if x.id==request.sentinel_id),None) if request.sentinel_id else (facility.sentinels[0] if facility.sentinels else None)
    if request.sentinel_id and not sentinel: raise HTTPException(404,"Sentinel not found")
    if sentinel and not sentinel.connected: raise HTTPException(422,"Selected Sentinel is not connected")
    if request.action=="REDIRECT_TO_EXIT" and not any(x.id==request.recommended_exit_id and x.enabled and x.status not in {"CLOSED","RESTRICTED"} for x in facility.exits): raise HTTPException(422,"Recommended exit is not available")
    if not sentinel: raise HTTPException(422,"No Sentinel configured")
    service.hardware.set_state(sentinel,request.model_dump()); store.set_setting("automatic_control","false"); store.save_facility(facility); store.add_event(EventLog(category="HARDWARE",severity="CRITICAL" if request.action=="CRITICAL" else "WARNING",message=f"Manual {request.action} command sent to {sentinel.name}")); return service.snapshot()




@app.websocket("/ws/live")
async def live_socket(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_text(service.snapshot().model_dump_json())
            await asyncio.sleep(1)
    except (WebSocketDisconnect, RuntimeError): pass


FRONTEND_DIR = Path(os.getenv("CROWDGUARD_FRONTEND_DIR", Path(__file__).parent.parent / "artifacts" / "crowdguard-sentinel" / "dist" / "public"))


@app.get("/{full_path:path}", include_in_schema=False)
def frontend(full_path: str):
    """Serve the production Vite build and fall back to index.html for SPA routes."""
    if not FRONTEND_DIR.exists():
        raise HTTPException(404, "Frontend build not found. Run the Vite build or use the frontend dev server.")
    candidate = (FRONTEND_DIR / full_path).resolve()
    try:
        candidate.relative_to(FRONTEND_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "Not found")
    if candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app",host="127.0.0.1",port=8000,reload=True)
