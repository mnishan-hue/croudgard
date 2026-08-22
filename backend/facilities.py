from backend.models import Camera, Exit, Facility, Junction, Route, Sentinel, Zone, ZoneMetrics


def _metrics(risk: float, people: int = 80) -> ZoneMetrics:
    return ZoneMetrics(density=risk, people_count=people, average_speed=max(.25, 1.7-risk/80), direction_conflict=max(4, risk/4), inflow=40+risk/4, outflow=max(8, 48-risk/3), inflow_outflow_ratio=round((40+risk/4)/max(8, 48-risk/3), 2), queue_growth=max(-.5, (risk-35)/15), stopped_percentage=risk*.55, ripple_score=max(0, risk-35), risk=risk, confidence=87)


def competition_facility() -> Facility:
    fid = "competition_prototype"
    cameras = [
        Camera(id="cam_main", facility_id=fid, name="Main Camera", zone_ids=["zone_main"], camera_type="MAIN_CROWD", description="Main crowd and junction view"),
        Camera(id="cam_exit_a", facility_id=fid, name="Exit A Camera", zone_ids=["zone_exit_a"], camera_type="EXIT"),
        Camera(id="cam_exit_b", facility_id=fid, name="Exit B Camera", zone_ids=["zone_exit_b"], camera_type="EXIT"),
    ]
    zones = [
        Zone(id="zone_main", facility_id=fid, name="Main Crowd Area", type="MAIN_AREA", camera_ids=["cam_main"], risk=42, crowd_state="CONGESTION_BUILDING", metrics=_metrics(42, 145), map_x=50, map_y=24),
        Zone(id="zone_exit_a", facility_id=fid, name="Exit A Zone", type="EXIT", camera_ids=["cam_exit_a"], risk=78, crowd_state="FLOW_INSTABILITY", metrics=_metrics(78, 132), map_x=20, map_y=78),
        Zone(id="zone_exit_b", facility_id=fid, name="Exit B Zone", type="EXIT", camera_ids=["cam_exit_b"], risk=24, metrics=_metrics(24, 55), map_x=80, map_y=78),
    ]
    exits = [
        Exit(id="exit_a", facility_id=fid, name="Exit A", zone_id="zone_exit_a", risk=78, status="CONGESTED", capacity=120, camera_ids=["cam_exit_a"], current_inflow=66, current_outflow=22),
        Exit(id="exit_b", facility_id=fid, name="Exit B", zone_id="zone_exit_b", risk=24, capacity=120, camera_ids=["cam_exit_b"], current_inflow=30, current_outflow=51),
    ]
    routes = [Route(id="route_a", name="Main Junction to Exit A", from_junction_id="junction_main", exit_id="exit_a"), Route(id="route_b", name="Main Junction to Exit B", from_junction_id="junction_main", exit_id="exit_b")]
    junctions = [Junction(id="junction_main", name="Main Junction", connected_exit_ids=["exit_a", "exit_b"], sentinel_ids=["sentinel_01"], map_x=50, map_y=55)]
    sentinels = [Sentinel(id="sentinel_01", name="CrowdGuard Sentinel 01", junction_id="junction_main", nearby_exit_ids=["exit_a", "exit_b"], device_id="esp32-demo-01")]
    return Facility(id=fid, name="Competition Prototype", description="Current physical prototype: 3 cameras, 2 exits, 1 stationary Sentinel.", cameras=cameras, zones=zones, exits=exits, routes=routes, junctions=junctions, sentinels=sentinels)


def large_venue_facility() -> Facility:
    fid = "large_venue_demo"
    exit_names = ["North", "East", "South", "West"]
    zones = [Zone(id="zone_central", facility_id=fid, name="Central Concourse", type="MAIN_AREA", risk=52, crowd_state="CONGESTION_BUILDING", metrics=_metrics(52, 310), camera_ids=["cam_central_overhead", "cam_central_side"], map_x=50, map_y=50)]
    cameras = [Camera(id="cam_central_overhead", facility_id=fid, name="Central Overhead", zone_ids=["zone_central"], camera_type="MAIN_CROWD"), Camera(id="cam_central_side", facility_id=fid, name="Central Side View", zone_ids=["zone_central"], camera_type="JUNCTION")]
    exits = []
    routes = []
    coords = [(50, 8), (90, 50), (50, 92), (10, 50)]
    for index, (name, (x, y)) in enumerate(zip(exit_names, coords), 1):
        zid, eid, cid = f"zone_exit_{name.lower()}", f"exit_{name.lower()}", f"cam_exit_{name.lower()}"
        risk = [36, 21, 63, 44][index-1]
        zones.append(Zone(id=zid, facility_id=fid, name=f"{name} Exit Zone", type="EXIT", risk=risk, metrics=_metrics(risk, 60+index*15), camera_ids=[cid], map_x=x, map_y=y))
        cameras.append(Camera(id=cid, facility_id=fid, name=f"{name} Exit Camera", zone_ids=[zid], camera_type="EXIT"))
        exits.append(Exit(id=eid, facility_id=fid, name=f"{name} Exit", zone_id=zid, risk=risk, status="CONGESTED" if risk>60 else "AVAILABLE", capacity=180, camera_ids=[cid], current_inflow=30+risk/3, current_outflow=55-risk/4))
        routes.append(Route(id=f"route_{name.lower()}", name=f"Central to {name} Exit", from_junction_id="junction_east" if name in {"East", "South"} else "junction_west", exit_id=eid))
    cameras += [Camera(id="cam_corridor_east", facility_id=fid, name="East Corridor Camera", zone_ids=["zone_central", "zone_exit_east"], camera_type="CORRIDOR"), Camera(id="cam_queue_south", facility_id=fid, name="South Queue Camera", zone_ids=["zone_exit_south"], camera_type="QUEUE_AREA")]
    junctions = [Junction(id="junction_west", name="West Decision Point", connected_exit_ids=["exit_west", "exit_north"], sentinel_ids=["sentinel_west"], map_x=35, map_y=50), Junction(id="junction_east", name="East Decision Point", connected_exit_ids=["exit_east", "exit_south"], sentinel_ids=["sentinel_east"], map_x=65, map_y=50)]
    sentinels = [Sentinel(id="sentinel_west", name="West Concourse Sentinel", junction_id="junction_west", nearby_exit_ids=["exit_west", "exit_north"], device_id="mock-west"), Sentinel(id="sentinel_east", name="East Concourse Sentinel", junction_id="junction_east", nearby_exit_ids=["exit_east", "exit_south"], device_id="mock-east")]
    return Facility(id=fid, name="Large Venue Demo", description="Scalability demonstration with 8 cameras, 5 zones, 4 exits, 2 junctions, and 2 mock Sentinels.", cameras=cameras, zones=zones, exits=exits, routes=routes, junctions=junctions, sentinels=sentinels)


def default_facilities(): return [competition_facility(), large_venue_facility()]
