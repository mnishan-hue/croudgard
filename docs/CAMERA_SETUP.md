# Camera setup

Configure a unique camera ID and assign it to one or more zones in Facility Configuration. Then start a worker with the same ID.

Sources:

- Laptop webcam: `--source 0`
- Second USB camera: `--source 1`
- Local video: `--source C:\videos\exit-a.mp4`
- RTSP: `--source rtsp://user:password@camera-address/stream`

Example:

```powershell
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.worker --camera-id cam_exit_a --source 1 --api http://127.0.0.1:8000/api --preview
```

Use `--counting-line-y 0.55` to create a horizontal line at 55% of image height. Downward crossings count as inflow and upward crossings as outflow. Reverse the physical camera orientation or interpretation if your site uses the opposite direction.

For all three cameras, copy `docs/cameras.example.json` to the ignored `cameras.local.json`, update the device indexes or RTSP sources, then launch the group:

```powershell
Copy-Item docs\cameras.example.json cameras.local.json
C:\cg-ai-venv\Scripts\python.exe -m backend.cv.multi_worker --config cameras.local.json --api http://127.0.0.1:8000/api
```

The launcher runs one independent process per source, so tracker IDs never cross between cameras. If one worker stops, the launcher stops the group instead of leaving the dashboard with a misleading partial system.

Each worker publishes rate-limited annotated JPEG frames at 4 FPS by default. FastAPI retains only the newest frame for each camera in memory and exposes it as a live MJPEG stream. It never writes footage to disk. Tune `stream_fps`, `stream_width`, and `jpeg_quality` in the JSON file for the available network and CPU. Set `"stream": false` for a metrics-only camera.

Keep camera credentials outside Git and prefer an isolated local network for RTSP. For a hosted backend, annotated frames travel to that backend; use HTTPS and protect the deployment before processing real venue footage.
