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
- A production ESP32 transport still needs the device address, protocol, authentication, and firmware contract.
- Cross-camera person re-identification is not implemented; overlapping views use the strongest count instead of summing.
