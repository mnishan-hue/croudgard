# ESP32 protocol

The frontend never controls the ESP32 directly. Both supported transports keep
the architecture **Decision Engine → FastAPI backend → ESP32 → hardware**.

## Render cloud relay

The ESP32 authenticates every request with:

```http
X-CrowdGuard-Device-Key: <CROWDGUARD_DEVICE_API_KEY>
```

### Heartbeat

`POST /api/device/{device_id}/heartbeat`

```json
{"state":"NEUTRAL","last_command_id":null,"uptime_ms":12000,"hardware_state":{"arm_state":"NEUTRAL","display_message":"THANK YOU","audio":"NONE","audio_state":"IDLE","led_routes":{"exit_a":"NEUTRAL","exit_b":"NEUTRAL"}}}
```

### Fetch current command

`GET /api/device/{device_id}/command?last_command_id={last_command_id}`

```json
{"pending":true,"type":"SET_STATE","device_id":"crowdguard-sentinel-01","state":"REDIRECT_B","command_id":"550e8400-e29b-41d4-a716-446655440000"}
```

When the device already has the acknowledged command, the backend returns
`{"pending":false,...}`. The backend creates a command only on a state change,
a manual command, reconnect synchronization, or a controlled retry.

### Acknowledge

`POST /api/device/{device_id}/ack`

```json
{"acknowledged":true,"state":"REDIRECT_B","command_id":"550e8400-e29b-41d4-a716-446655440000","hardware_state":{"arm_state":"REDIRECT_B","display_message":"USE EXIT B","audio":"PLEASE_USE_EXIT_B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}}
```

Command IDs make delivery idempotent: the firmware may retry an acknowledgement
without replaying servo movement, LEDs or audio. FastAPI preserves the desired
state while the device is offline and marks it disconnected after the configured
heartbeat timeout.

## Local LAN HTTP

FastAPI calls the ESP32 directly. `GET /status` returns the device ID and state;
`POST /command` receives the same `SET_STATE` command shown above and returns
the acknowledgement object. This mode requires both devices on the same LAN.

## State contract

- `NEUTRAL`: neutral arm/routes, TFT `THANK YOU`, no audio.
- `REDIRECT_A`: Exit A green, Exit B red, TFT `USE EXIT A`, audio once.
- `REDIRECT_B`: Exit A red, Exit B green, TFT `USE EXIT B`, audio once.
- `BOTH_BUSY`: neutral arm, both exits caution, TFT `PLEASE WALK SLOWLY`, audio once.
- `RESET`: safely apply the neutral baseline as a distinct acknowledged command.

Manual controls disable automatic control until Auto mode is restored. Missing
hardware never stops camera analysis or the decision engine.
