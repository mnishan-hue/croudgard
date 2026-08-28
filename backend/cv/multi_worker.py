from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import time


WORKER_OPTIONS = {
    "confidence": "--confidence",
    "counting_line_y": "--counting-line-y",
    "density_count_capacity": "--density-count-capacity",
    "frame_skip": "--frame-skip",
    "image_size": "--image-size",
    "inference_fps": "--inference-fps",
    "jpeg_quality": "--jpeg-quality",
    "model": "--model",
    "stream_fps": "--stream-fps",
    "stream_width": "--stream-width",
}


def worker_command(camera: dict, api: str) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "backend.cv.worker",
        "--camera-id",
        str(camera["camera_id"]),
        "--source",
        str(camera["source"]),
        "--api",
        api,
    ]
    for key, flag in WORKER_OPTIONS.items():
        if key in camera:
            command.extend([flag, str(camera[key])])
    if camera.get("preview"):
        command.append("--preview")
    if camera.get("stream") is False:
        command.append("--no-stream")
    return command


def run(config_path: Path, api: str) -> int:
    cameras = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(cameras, list) or not cameras:
        raise ValueError("Camera config must be a non-empty JSON list")
    if any(not isinstance(camera, dict) for camera in cameras):
        raise ValueError("Every camera config entry must be a JSON object")
    ids = [str(camera.get("camera_id", "")) for camera in cameras]
    if any(not camera_id for camera_id in ids) or len(ids) != len(set(ids)):
        raise ValueError("Every camera needs a unique camera_id")
    if any("source" not in camera for camera in cameras):
        raise ValueError("Every camera needs a source")

    processes: list[tuple[str, subprocess.Popen]] = []
    try:
        for camera in cameras:
            camera_id = str(camera["camera_id"])
            process = subprocess.Popen(worker_command(camera, api))
            processes.append((camera_id, process))
            print(f"Started {camera_id} as process {process.pid}")
        while True:
            for camera_id, process in processes:
                code = process.poll()
                if code is not None:
                    print(f"Camera worker {camera_id} stopped with exit code {code}")
                    return code or 1
            time.sleep(.5)
    except KeyboardInterrupt:
        print("Stopping camera workers...")
        return 0
    finally:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        for _, process in processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)


def main():
    parser = argparse.ArgumentParser(description="Start all CrowdGuard camera workers from one configuration file")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--api", default="http://127.0.0.1:8000/api")
    args = parser.parse_args()
    try:
        raise SystemExit(run(args.config, args.api.rstrip("/")))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
