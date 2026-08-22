# Architecture

CrowdGuard separates observation, analysis, decisions, operator presentation, and physical guidance. `AIProvider` produces a typed `AIPrediction`; `DecisionEngine` ranks every usable exit without assuming names or counts; `HardwareClient` applies a validated decision to one or more stationary Sentinels. The live snapshot is the single frontend contract and `/ws/live` publishes it once per second.

Facilities contain N cameras, zones, exits, routes, junctions, and Sentinels. Camera↔zone membership is many-to-many. Routes connect junctions to exits; Sentinels belong to junctions and reference nearby exits. SQLite stores complete facility documents, settings, and chronological events to keep the competition setup light and offline-capable.

The closed loop does not end with a redirect. New provider metrics update risk history, the decision is reassessed, and intervention state moves among `PENDING`, `ACTIVE`, `EFFECTIVE`, `NOT_IMPROVING`, and `RESOLVED`.
