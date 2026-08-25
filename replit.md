# CrowdGuard Sentinel

CrowdGuard is a React/Vite operations interface backed by FastAPI, SQLite configuration storage, and a WebSocket live snapshot stream.

Operational data comes only from current camera observations. No browser fallback dataset or scenario generator exists. Camera observations expire after 10 seconds, and route guidance requires current coverage of every enabled exit.

Key locations:

- `artifacts/crowdguard-sentinel/src/` — frontend
- `backend/` — API, live observation fusion, decisions, and hardware boundary
- `docs/` — configuration and integration guidance

Run verification with `python -m pytest backend/tests -q` and the frontend typecheck/build commands documented in `README.md`.
