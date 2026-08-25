# Facility configuration

The default Competition Facility contains topology only: three cameras, three zones, two exits, one junction, and one unconfigured Sentinel. All counts, risks, flow values, events, and recommendations start empty.

Use Facility Configuration or the REST CRUD endpoints to add cameras, zones, exits, junctions, and Sentinels. Camera `zone_ids` and zone `camera_ids` support multiple cameras per zone and multiple zones per camera. An exit must reference an existing zone and its assigned cameras must exist.

Exit ranking excludes disabled, closed, and restricted exits. Route guidance is withheld until every enabled exit has at least one current camera classification. Once coverage is complete, lower scores are safer and combine observed exit risk with configured capacity and availability.
