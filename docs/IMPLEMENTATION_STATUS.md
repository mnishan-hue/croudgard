# Implementation status

This checklist distinguishes implemented prototype behavior from deliberate future integration boundaries.

## Implemented

- React/Vite control-room interface with Live Control, Camera Analysis, AI Intelligence, Hardware, Event Log, and Facility Configuration routes.
- FastAPI/Pydantic REST API, SQLite facility/event persistence, and `/ws/live` streaming with frontend reconnection.
- Typed N-camera, N-zone, N-exit, N-route, N-junction, and N-Sentinel facilities; Competition Prototype and Large Venue Demo seeds.
- Camera, zone, exit, junction, and Sentinel creation/update APIs; deletion with reference protection; enable/disable controls for cameras and exits.
- Many-to-many camera/zone contracts and transparent demo metric aggregation at the configured-zone level.
- Replaceable `AIProvider`, working `MockAIProvider`, explicit simulated-output labels, and unloaded Teachable Machine boundary.
- Generic exit ranking, route decisions, automatic/manual control, critical confirmation, and dynamic redirect buttons.
- Mock ESP32 state for servo arm, per-route WS2812B guidance, display, and audio. No removed sensors or mobile base are modeled.
- Dynamic facility map driven by zone/junction coordinates and routes; selected route and restricted/closed route states.
- Timed demo transitions, risk history, intervention effectiveness/not-improving/resolved classification, ripple visualization, explanations, and event export.
- Tests for APIs, dynamic additions, ranking, mock AI/hardware, manual override, critical state, reference integrity, facility switching, and intervention state.

## Deliberate future boundaries

- Real camera stream capture and CV overlays require an actual camera/provider; current visuals say demo visualization.
- Teachable Machine loading depends on the eventual export format. No fake model is loaded.
- ESP32 network transport is represented by `ESP32Client` but remains unconfigured until device address/protocol firmware exists.
- Cross-camera person re-identification is not implemented.
- Junction/Sentinel editing beyond creation and backend PATCH calls is intentionally basic in the prototype UI; complete assignments remain available through typed APIs.

These boundaries match the agenda’s requirement to prepare real integrations without presenting simulated measurements as real.

## August 2026 verification follow-up

The detailed verification pass completed the previously identified UI gaps:

- Camera Grid now includes search, zone/status filters, responsive layouts, a 9+ scroll boundary, honest stream labels, and a routed Camera Detail page.
- Facility Configuration now exposes camera source/type/status/AI/zone assignment and exit status/capacity/availability/camera assignment for create and edit flows.
- Offline frontend state is explicit NO DATA; scenarios and telemetry use FastAPI rather than a browser-only fake mode.
- Live Control renders all configured Sentinels and every backend-provided LED route.
- The backend publishes timestamped risk samples with intervention markers, and Live Control renders the marker on the chart.
- Routes are lazy-loaded to keep page modules out of the initial application chunk.

Backend relationship validation, exit ranking, facility maps, manual controls, mock hardware, and WebSocket snapshots remain dynamic and covered by the API test suite.
