# AI pipeline

CrowdGuard runs computer vision in a local edge worker, not in the hosted backend:

`camera → YOLO person detection → ByteTrack IDs → motion metrics → temporal smoothing → FastAPI → exit ranking → ESP32`

The worker uses the YOLO nano model by default and requests only class `0` (person). ByteTrack identifiers are temporary anonymous track IDs. No facial recognition, identity matching, or face storage exists.

Install once:

```powershell
python -m venv C:\cg-ai-venv
C:\cg-ai-venv\Scripts\python.exe -m pip install -r backend/requirements-ai.txt
```

The short Windows path avoids PyTorch installation failures caused by the legacy maximum-path limit.

The first YOLO run downloads `yolo11n.pt`. Later runs work offline while that model remains in the local model cache. The AI requirements explicitly include the linear-assignment package used by ByteTrack, so it does not need to install a dependency when a camera starts.

Run one independent worker per camera. Each process has independent ByteTrack state:

```powershell
python -m backend.cv.worker --camera-id cam_main --source 0 --preview
python -m backend.cv.worker --camera-id cam_exit_a --source 1 --counting-line-y 0.55 --preview
python -m backend.cv.worker --camera-id cam_exit_b --source 2 --counting-line-y 0.55 --preview
```

Important performance controls are `--model`, `--image-size`, `--frame-skip`, `--confidence`, `--width`, and `--height`. Start with `yolo11n.pt`, 640 pixels, and frame skip 2.

The worker reconnects after interrupted camera reads and continues running when the API is temporarily unreachable. Use `--density-count-capacity` to calibrate count pressure for each view. Counting-line crossings have a per-track cooldown to reduce repeated counts near the line.

The backend smooths the last 20 observations. A high-risk state needs at least three consecutive observations before it may cross the intervention threshold, and hysteresis prevents rapid toggling near the threshold.

The browser Teachable Machine classifier remains an optional secondary input. The local YOLO/tracking worker is the primary path and works without it.
