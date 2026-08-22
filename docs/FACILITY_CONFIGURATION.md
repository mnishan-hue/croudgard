# Facility configuration

The seeded Competition Prototype represents the physical demonstration. Large Venue Demo proves that software logic accepts larger arrays. Use Facility Configuration or REST CRUD endpoints to add cameras, zones, and exits. IDs must be unique within the active facility; an exit must reference an existing zone. Camera `zone_ids` and zone `camera_ids` permit multiple cameras per zone and multiple zones per camera.

Exit ranking excludes disabled, closed, and restricted exits. Scores combine risk, density, queue growth, flow/capacity pressure, and availability; lower is safer. Adding exits therefore requires no A/B conditional logic.
