from backend.models import Camera, Exit, Facility, Junction, Route, Sentinel, Zone


def competition_facility() -> Facility:
    """Physical topology only; all operational values start empty."""
    facility_id = "competition_prototype"
    cameras = [
        Camera(id="cam_main", facility_id=facility_id, name="Main Camera", source="", zone_ids=["zone_main"], camera_type="MAIN_CROWD", description="Main crowd and junction view"),
        Camera(id="cam_exit_a", facility_id=facility_id, name="Exit A Camera", source="", zone_ids=["zone_exit_a"], camera_type="EXIT"),
        Camera(id="cam_exit_b", facility_id=facility_id, name="Exit B Camera", source="", zone_ids=["zone_exit_b"], camera_type="EXIT"),
    ]
    zones = [
        Zone(id="zone_main", facility_id=facility_id, name="Main Crowd Area", type="MAIN_AREA", camera_ids=["cam_main"], map_x=50, map_y=24),
        Zone(id="zone_exit_a", facility_id=facility_id, name="Exit A Zone", type="EXIT", camera_ids=["cam_exit_a"], map_x=20, map_y=78),
        Zone(id="zone_exit_b", facility_id=facility_id, name="Exit B Zone", type="EXIT", camera_ids=["cam_exit_b"], map_x=80, map_y=78),
    ]
    exits = [
        Exit(id="exit_a", facility_id=facility_id, name="Exit A", zone_id="zone_exit_a", capacity=120, camera_ids=["cam_exit_a"]),
        Exit(id="exit_b", facility_id=facility_id, name="Exit B", zone_id="zone_exit_b", capacity=120, camera_ids=["cam_exit_b"]),
    ]
    routes = [
        Route(id="route_a", name="Main Junction to Exit A", from_junction_id="junction_main", exit_id="exit_a"),
        Route(id="route_b", name="Main Junction to Exit B", from_junction_id="junction_main", exit_id="exit_b"),
    ]
    junctions = [Junction(id="junction_main", name="Main Junction", connected_exit_ids=["exit_a", "exit_b"], sentinel_ids=["sentinel_01"], map_x=50, map_y=55)]
    sentinels = [Sentinel(id="sentinel_01", name="CrowdGuard Sentinel 01", junction_id="junction_main", nearby_exit_ids=["exit_a", "exit_b"], device_id="unconfigured", connected=False)]
    return Facility(id=facility_id, name="Competition Facility", description="Three-camera crowd monitoring topology with two monitored exits.", cameras=cameras, zones=zones, exits=exits, routes=routes, junctions=junctions, sentinels=sentinels)


def default_facilities() -> list[Facility]:
    return [competition_facility()]
