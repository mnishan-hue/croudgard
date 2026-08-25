# Demo mode policy

The production/live path contains no seeded operational values and starts with no data. To avoid mixing synthetic and real safety information, scenario data is not enabled in the deployed application.

For a competition demonstration without a live crowd, use local video files through the real YOLO/ByteTrack worker. This exercises the same detection, tracking, metric, decision, event, and hardware pathways as a webcam and is preferable to fabricated dashboard values.

If a synthetic scenario provider is added later, it must be opt-in, clearly labelled on every page, use separate in-memory state, and be unable to write into the live observation store.
