# CrowdGuard Sentinel

**Predict • Guide • Protect**

CrowdGuard Sentinel is a local-first crowd-safety prototype that monitors developing congestion and flow instability, ranks available exits, and drives a stationary ESP32-based guidance unit. Demo values are always identified as simulated; the project does not claim to detect or guarantee a stampede.

## Architecture

`cameras → AI provider → typed crowd metrics → decision engine → web control interface + backend hardware service → stationary Sentinel → continued observation`

- `artifacts/crowdguard-sentinel`: preserved React/Vite/TypeScript control-room frontend
- `backend`: FastAPI, Pydantic, WebSocket, SQLite, demo provider, decision engine, and hardware abstraction
- `backend/ai/models`: future exported model files
- `docs`: architecture, AI, facility, demo, and ESP32 guides

See `docs/IMPLEMENTATION_STATUS.md` for the agenda coverage checklist and deliberate physical-integration boundaries.

## Run locally

Use Python 3.11+ and Node 20+.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

In a second terminal:

```powershell
pnpm install
pnpm --filter @workspace/crowdguard-sentinel dev
```

Open `http://localhost:5173`. API documentation is at `http://localhost:8000/docs`. Configuration defaults to `VITE_API_BASE_URL=/api` for a reverse proxy; for separate local servers set `VITE_API_BASE_URL=http://localhost:8000/api`. WebSocket defaults to `ws://localhost:8000/ws/live`.

## Demo and facilities

Scenario controls call the backend mock provider; none of their values are real camera measurements. Switch between **Competition Prototype** (3 cameras, 2 exits, 1 Sentinel) and **Large Venue Demo** (8 cameras, 4 exits, 2 junctions, 2 Sentinels). Facility Configuration can add, enable, disable, and remove cameras and exits. SQLite retains facility configuration and recent event records.

Set `CROWDGUARD_AI_PROVIDER=mock` for the current local mode. Future providers implement the same `AIProvider` contract. The browser never contacts ESP32 directly; all validated commands pass through FastAPI and the hardware service.

## Verification

```powershell
python -m pytest backend/tests -q
pnpm --filter @workspace/crowdguard-sentinel run typecheck
pnpm --filter @workspace/crowdguard-sentinel run build
```

## Deploy: Render backend + Vercel frontend

Deploy the backend first so its public URL is available to the Vercel build.

### 1. Backend on Render

The root `Dockerfile` is backend-only and `render.yaml` defines the service.

1. In Render, select **New → Blueprint** and connect this repository.
2. Deploy the detected `crowdguard-sentinel` service.
3. Verify `https://YOUR-SERVICE.onrender.com/api/health` returns `ONLINE`.
4. Record the exact Render URL. Render supports the FastAPI `/ws/live` WebSocket on the same service.

The free plan stores SQLite at `/tmp/crowdguard.db`, so configuration and events reset after a service restart and seed data is recreated. For persistence, use a paid service, attach a disk at `/var/data`, and set `CROWDGUARD_DB_PATH=/var/data/crowdguard.db`.

### 2. Frontend on Vercel

The root `vercel.json` builds only `artifacts/crowdguard-sentinel` and provides SPA route fallback.

1. Import the same GitHub repository into Vercel and leave the project Root Directory at the repository root.
2. Add these Vercel variables for Production, Preview, and Development:

   - `VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com/api`
   - `VITE_WS_URL=wss://YOUR-SERVICE.onrender.com/ws/live`
   - `VITE_USE_MOCK_DATA=false`

3. Deploy. The build intentionally fails with a clear message if either backend URL is absent.
4. If using a custom Vercel domain, set `CROWDGUARD_CORS_ORIGINS=https://your-domain.example` on Render and redeploy the backend. Standard `*.vercel.app` production and preview URLs are accepted by the configured origin regex.

Do not use `http://` or `ws://` for the public connection. Vercel is HTTPS and Render public WebSockets should use `wss://`.
