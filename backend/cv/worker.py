from __future__ import annotations

import argparse
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend.cv.metrics import CrowdMetricExtractor, TrackedDetection


LOGGER = logging.getLogger("crowdguard.cv")


def parse_source(value: str):
    return int(value) if value.isdigit() else value


def post_json(url: str, payload: dict):
    request = Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=3) as response:
        return response.read()


def open_capture(cv2, source, width: int, height: int):
    capture = cv2.VideoCapture(source)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return capture


def run(args):
    try:
        import cv2
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install backend/requirements-ai.txt before running the camera worker") from exc
    source = parse_source(args.source)
    capture = open_capture(cv2, source, args.width, args.height)
    if not capture.isOpened():
        raise SystemExit(f"Unable to open camera source: {args.source}")
    model = YOLO(args.model)
    extractor = CrowdMetricExtractor(args.counting_line_y, density_count_capacity=args.density_count_capacity)
    frame_index = 0; last_report = 0.0; last_frame = time.perf_counter(); fps = 0.0
    consecutive_read_failures = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                consecutive_read_failures += 1
                if consecutive_read_failures < args.max_read_failures:
                    time.sleep(.05)
                    continue
                LOGGER.warning("Camera read failed; reconnecting to %s", args.source)
                capture.release()
                time.sleep(args.reconnect_delay)
                capture = open_capture(cv2, source, args.width, args.height)
                consecutive_read_failures = 0
                if not capture.isOpened():
                    LOGGER.warning("Camera source is still unavailable; retrying")
                continue
            consecutive_read_failures = 0
            frame_index += 1
            if frame_index % args.frame_skip: continue
            now = time.perf_counter(); elapsed = max(now-last_frame, 1e-3); last_frame = now; fps = fps*.8 + (1/elapsed)*.2
            result = model.track(frame, persist=True, tracker="bytetrack.yaml", classes=[0], conf=args.confidence, imgsz=args.image_size, verbose=False)[0]
            detections=[]
            if result.boxes is not None and result.boxes.id is not None:
                for box, track_id, confidence in zip(result.boxes.xyxy.cpu().tolist(), result.boxes.id.int().cpu().tolist(), result.boxes.conf.cpu().tolist()):
                    detections.append(TrackedDetection(track_id, confidence, *box))
            metrics = extractor.update(detections, time.time(), frame.shape[1], frame.shape[0], fps)
            if now-last_report >= args.report_interval:
                try:
                    post_json(f"{args.api.rstrip('/')}/ai/cv-observation", {"camera_id":args.camera_id, **metrics})
                except (HTTPError, URLError, TimeoutError, OSError) as exc:
                    LOGGER.warning("Could not report %s to CrowdGuard: %s", args.camera_id, exc)
                last_report = now
            if args.preview:
                annotated = result.plot()
                cv2.imshow(f"CrowdGuard — {args.camera_id}", annotated)
                if cv2.waitKey(1) & 0xFF in {27, ord('q')}: break
    finally:
        capture.release(); cv2.destroyAllWindows()


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser=argparse.ArgumentParser(description="CrowdGuard YOLO + ByteTrack camera worker")
    parser.add_argument("--camera-id", required=True); parser.add_argument("--source", required=True); parser.add_argument("--api", default="http://127.0.0.1:8000/api")
    parser.add_argument("--model", default="yolo11n.pt"); parser.add_argument("--image-size", type=int, default=640); parser.add_argument("--confidence", type=float, default=.35)
    parser.add_argument("--frame-skip", type=int, default=2); parser.add_argument("--report-interval", type=float, default=.5); parser.add_argument("--width", type=int, default=1280); parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--counting-line-y", type=float); parser.add_argument("--density-count-capacity", type=int, default=30)
    parser.add_argument("--max-read-failures", type=int, default=10); parser.add_argument("--reconnect-delay", type=float, default=2); parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    if args.frame_skip < 1 or args.report_interval <= 0 or args.max_read_failures < 1 or args.reconnect_delay < 0:
        parser.error("frame skip, report interval, read failures, and reconnect delay must be valid positive values")
    if args.counting_line_y is not None and not 0 <= args.counting_line_y <= 1:
        parser.error("--counting-line-y must be between 0 and 1")
    if args.density_count_capacity < 1:
        parser.error("--density-count-capacity must be at least 1")
    run(args)


if __name__ == "__main__": main()
