# Implementation status

## Working end-to-end

- Browser camera inference produces person-count and crowd-classification observations.
- FastAPI validates timestamps, confidence, camera assignments, and enabled state.
- Observations are fused by zone without summing overlapping camera views.
- Operational readings expire after 10 seconds and are never persisted as current data.
- Exit guidance requires current observations for every enabled exit.
- Live Control, Camera Analysis, AI Intelligence, Event Log, and the facility map consume the same backend snapshot.
- Configuration is persisted separately from live measurements.
- Hardware commands are preserved while a physical Sentinel is disconnected and delivered after it reports as connected.
- API, data-quality, routing, expiry, CRUD, and production frontend behavior are covered by tests.

## Physical integration boundary

- Each real camera or edge process must post observations using its configured camera ID.
- Local HTTP and authenticated Render cloud-relay transports, heartbeat validation, command acknowledgement, reconnect synchronization, in-app setup, and starter firmware are implemented.
- The supplied firmware provides the protocol and a safe onboard-LED demonstration; project-specific servo, WS2812B, display, and DFPlayer pin mappings remain hardware-dependent.
- Private ESP32 addresses still require a local backend. A Render deployment uses the outbound ESP32 cloud-relay mode instead.
- Cross-camera person re-identification is not implemented; overlapping views use the strongest count instead of summing.
