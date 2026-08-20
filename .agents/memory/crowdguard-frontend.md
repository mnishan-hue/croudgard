---
name: CrowdGuard frontend integration seam
description: The CrowdGuard Sentinel app is intentionally mock-first and keeps future FastAPI/WebSocket replacement behind small service adapters.
---

The initial CrowdGuard Sentinel build treats demo scenarios as the local source of truth and keeps API, WebSocket, camera, crowd, and hardware access behind service adapters. Future live-backend work should replace those adapters rather than couple fetch or socket details to page components.

**Why:** The project is a frontend-only robotics demonstration today, but a separate FastAPI backend is planned later.

**How to apply:** Preserve the mock/live switch and typed snapshot shapes when adding real backend endpoints or realtime subscriptions.