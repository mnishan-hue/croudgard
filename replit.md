# CrowdGuard Sentinel

CrowdGuard Sentinel is a frontend-only emergency operations console for visualising crowd risk, AI explanations, safe-exit guidance, and robot hardware response in a local demo mode.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/crowdguard-sentinel run build` — build the static frontend bundle for Vercel
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/crowdguard-sentinel/src/pages/` — Live Control, Camera Analysis, AI Intelligence, Hardware, and Event Log screens
- `artifacts/crowdguard-sentinel/src/lib/sentinel.ts` — typed scenario presets and mock state generator
- `artifacts/crowdguard-sentinel/src/services/` — API, WebSocket, camera, crowd, and hardware seams for the future FastAPI backend
- `artifacts/crowdguard-sentinel/src/data/mockData.ts` — mock snapshot adapter
- `artifacts/crowdguard-sentinel/src/components/` — shared control-room shell and visual components
- `artifacts/crowdguard-sentinel/src/index.css` — control-room theme tokens and motion

## Architecture decisions

- The first build is intentionally frontend-only; mock scenarios are the source of truth until the FastAPI/WebSocket service is available.
- The UI models anonymous crowd tracks and aggregate movement signals only; it does not perform face identification.
- Demo scenarios change the complete operational story, not just one number: risks, decisions, map state, robot response, charts, and events.

## Product

Operators can inspect live crowd risk, camera analysis, explainable AI signals, thermal inputs, hardware health, event history, and manual override states. Demo Controls make the full Detect → Respond → Verify Improvement narrative available without a backend.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- `vercel.json` — Vercel install, build, static output, and SPA fallback configuration
