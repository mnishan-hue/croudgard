# ESP32 quick start

This guide connects one CrowdGuard Sentinel ESP32 to the local FastAPI backend.

## Important network rule

Run CrowdGuard locally on a computer connected to the same Wi-Fi or Ethernet network as the ESP32. A cloud service such as Render cannot directly reach an ESP32 at a private address such as `192.168.1.80`.

Start local mode from the repository root:

```powershell
pnpm offline:start
```

Then open the local CrowdGuard address shown in PowerShell and go to **Devices**.

## 1. Install the firmware tools

Install Arduino IDE and add the ESP32 board package. The supplied starter firmware uses:

- ESP32 Arduino core
- `WiFi.h`
- `WebServer.h`
- ArduinoJson 7

Install **ArduinoJson** from Arduino IDE → Library Manager.

## 2. Configure the sketch

Open:

`firmware/crowdguard_esp32/crowdguard_esp32.ino`

Change these three values:

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID = "crowdguard-sentinel-01";
```

The `DEVICE_ID` must exactly match the value entered on the CrowdGuard Devices page.

## 3. Upload and find the address

1. Connect the ESP32 by USB.
2. Select the correct ESP32 board and port in Arduino IDE.
3. Upload the sketch.
4. Open Serial Monitor at **115200 baud**.
5. Copy the printed address, for example `192.168.1.80`.

If the router changes device addresses frequently, reserve the ESP32 address in the router's DHCP settings.

## 4. Connect CrowdGuard

On **Devices**:

1. Enter the firmware `DEVICE_ID`.
2. Enter the ESP32 IP address or mDNS hostname.
3. Select **Save and test**.

CrowdGuard calls `GET /status`. A successful response is:

```json
{ "device_id": "crowdguard-sentinel-01", "status": "ready" }
```

The device is marked connected only when the returned ID matches.

## 5. Test commands safely

Use the manual controls on the Devices page. Commands are preserved if the device is offline. Each delivered command must return matching `acknowledged`, `device_id`, `state`, and `command_id` fields; otherwise CrowdGuard performs only its bounded retry and marks the device disconnected.

The starter firmware implements the complete HTTP contract and a safe onboard-LED demonstration. Replace `applyHardwareState()` with the required servo, WS2812B, display and DFPlayer code for the physical prototype.

Never use a servo or guidance arm to block a legally required emergency exit. The system provides guidance only.

## Troubleshooting

### ESP32 does not appear online

- Confirm the computer and ESP32 are on the same network.
- Disable Wi-Fi client isolation or guest-network isolation.
- Test `http://ESP32_ADDRESS/status` from the computer.
- Confirm Serial Monitor prints the same address entered in CrowdGuard.
- Confirm the device IDs match exactly.
- Allow local-network access through Windows Firewall.

### Cloud dashboard cannot connect

Use local mode. Private ESP32 addresses are not routable from Vercel or Render.

### Heartbeat works but commands fail

- Confirm `POST /command` accepts JSON.
- Confirm the response contains `"acknowledged": true`.
- Confirm the response includes `hardware_state`.
- Review the FastAPI console for the detailed error.
