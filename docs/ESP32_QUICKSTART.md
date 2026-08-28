# ESP32 quick start

CrowdGuard supports two ESP32 connection methods. Use **Render cloud relay**
for a deployed backend. Use **Local LAN** only when FastAPI and the ESP32 are
on the same network.

## Why the private IP does not work on Render

An address such as `192.168.1.80` exists only inside your Wi-Fi network. Render
cannot open a connection to it. In cloud-relay mode the direction is reversed:
the ESP32 makes authenticated outbound HTTPS requests to Render for heartbeat,
commands and acknowledgements. The frontend still talks only to FastAPI.

## 1. Configure Render

In the Render service dashboard add these environment variables:

```text
CROWDGUARD_DEVICE_ID=crowdguard-sentinel-01
CROWDGUARD_DEVICE_TRANSPORT=CLOUD_POLL
CROWDGUARD_DEVICE_API_KEY=<a long random secret>
CROWDGUARD_DEVICE_STALE_SECONDS=20
```

Generate a secret in PowerShell:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Keep the secret private. Redeploy the service after saving the variables.

If the frontend is deployed separately (for example on Vercel), configure:

```text
VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com/api
```

The frontend automatically derives the matching secure WebSocket URL. You may
also set `VITE_WS_URL=wss://YOUR-SERVICE.onrender.com/ws/live` explicitly.

## 2. Configure and upload the firmware

Install the ESP32 Arduino core and **ArduinoJson 7** in Arduino IDE. Open
`firmware/crowdguard_esp32`, copy `secrets.example.h` to `secrets.h`, and set:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID = "crowdguard-sentinel-01";
const char* BACKEND_URL = "https://YOUR-SERVICE.onrender.com";
const char* DEVICE_API_KEY = "THE_SAME_RENDER_SECRET";
```

`BACKEND_URL` is the public Render service URL without `/api` at the end.
`DEVICE_ID` and `DEVICE_API_KEY` must exactly match Render.
The real `secrets.h` is gitignored so Wi-Fi credentials and the device key are
not pushed to GitHub. Cloud relay is enabled by default in the main sketch.

The merged prototype firmware also requires **Adafruit NeoPixel**,
**DFRobotDFPlayerMini**, **ESP32Servo**, and **TFT_eSPI**. Configure TFT_eSPI's
`User_Setup.h` for the prototype display. Hardware pins and DFPlayer filenames
are listed in `firmware/crowdguard_esp32/DELL_UPLOAD_GUIDE.md`.

Upload the sketch, then open Serial Monitor at **115200 baud**. The ESP32 will
automatically reconnect to Wi-Fi, send a heartbeat, poll for the current desired
state, apply each command ID once, and acknowledge it.

## 3. Configure the Devices page

On **Devices**:

1. Enter the matching ESP32 device ID.
2. Select **Render cloud relay**.
3. Select **Save and test**.
4. Power the ESP32 and wait a few seconds for **ESP32 connected**.

Do not enter the ESP32 private IP in Render cloud-relay mode.

## 4. Local LAN alternative

Set `USE_CLOUD_RELAY = false`, run CrowdGuard locally with `pnpm offline:start`,
select **Local LAN (direct HTTP)** on Devices, and enter the ESP32 IP or mDNS
name. FastAPI then uses `GET /status` and `POST /command` directly.

## 5. Verify safely

Use the manual controls on Devices and verify NEUTRAL, REDIRECT A, REDIRECT B,
BOTH BUSY and RESET. A repeated command ID is acknowledged without replaying
servo movement or audio. If the ESP32 disconnects, camera AI continues and the
latest desired state remains queued for one-time synchronization after reconnect.

The supplied sketch demonstrates the state using the onboard LED. Connect your
servo, route LEDs, TFT and audio implementation inside `applyHardwareState()`.
Never physically block a required emergency exit.

## Troubleshooting

- **401 Invalid device key:** firmware and Render secrets do not match.
- **404 Device ID is not configured:** firmware and Render device IDs do not match.
- **503 Cloud device relay is not configured:** set `CROWDGUARD_DEVICE_API_KEY` and redeploy.
- **Frontend loads but live state does not update:** verify `VITE_API_BASE_URL` points to Render and redeploy the frontend.
- **ESP32 stays disconnected:** check Serial Monitor, Wi-Fi internet access, the HTTPS Render URL, and whether the free Render service is waking up.
- **Local mode fails:** verify FastAPI and ESP32 are on the same LAN and client isolation is disabled.
