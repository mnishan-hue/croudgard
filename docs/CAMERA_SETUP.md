# Camera setup

Configure a unique camera ID and assign it to one or more zones in Facility Configuration. Then start a worker with the same ID.

Sources:

- Laptop webcam: `--source 0`
- Second USB camera: `--source 1`
- Local video: `--source C:\videos\exit-a.mp4`
- RTSP: `--source rtsp://user:password@camera-address/stream`

Example:

```powershell
python -m backend.cv.worker --camera-id cam_exit_a --source 1 --api http://127.0.0.1:8000/api --preview
```

Use `--counting-line-y 0.55` to create a horizontal line at 55% of image height. Downward crossings count as inflow and upward crossings as outflow. Reverse the physical camera orientation or interpretation if your site uses the opposite direction.

For multiple cameras, run one worker process per source. This prevents tracker IDs from crossing between cameras. Keep camera credentials outside Git and prefer an isolated local network for RTSP.
