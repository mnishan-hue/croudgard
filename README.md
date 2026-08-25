# CrowdGuard Sentinel

**Predict • Guide • Protect**

CrowdGuard Sentinel is a local-first crowd-safety system that receives current camera observations, monitors developing congestion, ranks sufficiently monitored exits, and can drive a stationary ESP32-based guidance unit. It does not claim to detect or guarantee a stampede.

## Architecture

`cameras → AI provider → typed crowd metrics → decision engine → web control interface + backend hardware service → stationary Sentinel → continued observation`

- `artifacts/crowdguard-sentinel`: preserved React/Vite/TypeScript control-room frontend
- `backend`: FastAPI, Pydantic, WebSocket, SQLite, live camera observation provider, decision engine, and hardware abstraction
- `backend/ai/models`: future exported model files
- `docs`: architecture, AI, facility, and ESP32 guides

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

For an operator-controlled setup, open **Live Control → Connect cameras** on the
HTTPS website, allow camera access, assign one to three different devices, and
start the browser station. CrowdGuard analyzes every connected feed while the tab
remains open. See `docs/CAMERA_SETUP.md` for browser and unattended edge-worker options.

## Run real computer vision

Install the optional local AI dependencies once:

```powershell
python -m venv C:\cg-ai-venv
C:\cg-ai-venv\Scripts\python.exe -m pip install -r backend\requirements-ai.txt
```

Then run one independent YOLO + ByteTrack worker per configured camera:

```powershell
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.worker --camera-id cam_main --source 0 --preview
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.worker --camera-id cam_exit_a --source 1 --counting-line-y 0.55 --preview
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.worker --camera-id cam_exit_b --source 2 --counting-line-y 0.55 --preview
```

Or start all three from one configuration file:

```powershell
Copy-Item docs\cameras.example.json cameras.local.json
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.multi_worker --config cameras.local.json --api http://127.0.0.1:8000/api
```

Every worker publishes annotated footage and current metrics. Live Control displays all active feeds simultaneously; FastAPI keeps only the newest JPEG per camera in memory and does not write video to disk. Decisions are finalized only when all enabled exits have fresh camera observations.

Sources may be webcam/USB indices, RTSP URLs, or local video paths. See [AI pipeline](docs/AI_PIPELINE.md), [camera setup](docs/CAMERA_SETUP.md), [crowd metrics](docs/CROWD_METRICS.md), and [ESP32 protocol](docs/ESP32_PROTOCOL.md).

## Live data and facilities

The system starts with an empty operational state. Browser camera inference posts person counts and crowd classifications to FastAPI; readings expire after 10 seconds without a new observation. Exit guidance is withheld until every enabled exit has a current assigned-camera observation. Facility Configuration can add, enable, disable, and remove cameras and exits. SQLite retains topology, while live measurements stay in memory and are never restored as current after a restart.

The browser never contacts ESP32 directly. Validated commands pass through FastAPI and are rejected until a physical Sentinel reports as connected.

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

The free plan stores SQLite at `/tmp/crowdguard.db`, so configuration and events reset after a service restart. For persistence, use a paid service, attach a disk at `/var/data`, and set `CROWDGUARD_DB_PATH=/var/data/crowdguard.db`.

### 2. Frontend on Vercel

The root `vercel.json` builds only `artifacts/crowdguard-sentinel` and provides SPA route fallback.

1. Import the same GitHub repository into Vercel and leave the project Root Directory at the repository root.
2. Add these Vercel variables for Production, Preview, and Development:

   - `VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com/api`
   - `VITE_WS_URL=wss://YOUR-SERVICE.onrender.com/ws/live`

3. Deploy. The build intentionally fails with a clear message if either backend URL is absent.
4. If using a custom Vercel domain, set `CROWDGUARD_CORS_ORIGINS=https://your-domain.example` on Render and redeploy the backend. Standard `*.vercel.app` production and preview URLs are accepted by the configured origin regex.

Do not use `http://` or `ws://` for the public connection. Vercel is HTTPS and Render public WebSockets should use `wss://`.
