# Implementation status

## Working end-to-end

- Browser camera inference produces person-count and crowd-classification observations.
- FastAPI validates timestamps, confidence, camera assignments, and enabled state.
- Observations are fused by zone without summing overlapping camera views.
- Operational readings expire after 10 seconds and are never persisted as current data.
- Exit guidance requires current observations for every enabled exit.
- Live Control, Camera Analysis, AI Intelligence, Event Log, and the facility map consume the same backend snapshot.
- Configuration is persisted separately from live measurements.
- Hardware commands are rejected until a physical Sentinel reports as connected.
- API, data-quality, routing, expiry, CRUD, and production frontend behavior are covered by tests.

## Physical integration boundary

- Each real camera or edge process must post observations using its configured camera ID.
- The ESP32 HTTP transport, heartbeat validation, command acknowledgement, in-app setup flow, starter firmware, and local-network guide are implemented.
- The supplied firmware provides the protocol and a safe onboard-LED demonstration; project-specific servo, WS2812B, display, and DFPlayer pin mappings remain hardware-dependent.
- Private ESP32 addresses require the FastAPI backend to run on the same local network; a cloud backend cannot route directly to a private LAN device.
- Cross-camera person re-identification is not implemented; overlapping views use the strongest count instead of summing.
