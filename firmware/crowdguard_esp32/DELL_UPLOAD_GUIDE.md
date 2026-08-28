# CrowdGuard ESP32 upload package

This folder contains the merged CrowdGuard hardware and Render cloud-relay
firmware. Keep the complete folder together; Arduino compiles the `.ino` sketch
and reads private configuration from `secrets.h` in the same directory.

## Before opening Arduino IDE

1. Copy `secrets.example.h` and rename the copy to exactly `secrets.h`.
2. Put the current Wi-Fi credentials, Render service URL, device ID and the
   matching Render device API key in `secrets.h`.
3. Never share or commit `secrets.h`.

The device ID must match `CROWDGUARD_DEVICE_ID` in Render. `BACKEND_URL` must be
the public HTTPS Render origin without `/api` at the end.

## Arduino libraries

Install these from Arduino IDE Library Manager:

- ArduinoJson 7
- Adafruit NeoPixel
- DFRobotDFPlayerMini
- ESP32Servo
- TFT_eSPI

Install **esp32 by Espressif Systems** from Boards Manager. Configure TFT_eSPI's
`User_Setup.h` for the exact TFT controller and wiring used by the prototype.

## Prototype pin mapping

- WS2812B data: GPIO 25, LEDs 0–14 Exit A, LEDs 15–29 Exit B
- Servo signal: GPIO 13; neutral 90°, Exit A 30°, Exit B 150°
- DFPlayer RX/TX: GPIO 16/GPIO 17
- TFT: configured through TFT_eSPI `User_Setup.h`

Adjust the constants near the top of `crowdguard_esp32.ino` if the physical
wiring or servo orientation differs.

## DFPlayer files

Place these files in the SD card's `MP3` directory:

- `0001.mp3`: Please use Exit A
- `0002.mp3`: Please use Exit B
- `0003.mp3`: Please walk slowly

Each track is triggered only once for a new backend command ID.

## Upload and verify

Open `crowdguard_esp32.ino`, select the ESP32 board and COM port, then Verify
and Upload. Open Serial Monitor at 115200 baud. A successful connection prints
the device ID, Render backend URL, Wi-Fi address, and applied cloud states.

HTTP 401 means the device API keys differ. HTTP 404 means the device IDs differ
or Render has not deployed the new relay endpoints. HTTP 503 means the device
API key is missing from Render. HTTP -1 normally indicates Wi-Fi, internet, or
backend URL connectivity failure.
