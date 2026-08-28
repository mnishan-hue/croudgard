# ESP32 HTTP protocol

The frontend never addresses the ESP32. FastAPI is the only command sender.

Configure each Sentinel with a unique `device_id` and `ip_address`, then press **Test connection** on the Hardware page.

## Heartbeat

`GET /status`

```json
{"device_id":"cg-sentinel-01","status":"ready"}
```

The returned device ID must match configuration.

## Command

`POST /command`

```json
{"type":"SET_STATE","device_id":"cg-sentinel-01","state":"REDIRECT_B","command_id":"550e8400-e29b-41d4-a716-446655440000"}
```

Acknowledgement:

```json
{"acknowledged":true,"device_id":"cg-sentinel-01","state":"REDIRECT_B","command_id":"550e8400-e29b-41d4-a716-446655440000","hardware_state":{"arm_state":"REDIRECT_B","display_message":"USE EXIT B","audio":"PLEASE_USE_EXIT_B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}}
```

States are `NEUTRAL`, `REDIRECT_A`, `REDIRECT_B`, `BOTH_BUSY`, and `RESET`. Every logical command has a unique `command_id`. A retry reuses the same ID, so firmware acknowledges it without replaying movement or audio.

Recommended physical behavior:

- `REDIRECT_A`: discourage Exit B, Exit A green, Exit B red, display `USE EXIT A`, play “Please use Exit A” once.
- `REDIRECT_B`: discourage Exit A, Exit A red, Exit B green, display `USE EXIT B`, play “Please use Exit B” once.
- `NEUTRAL`: neutral arm and routes, display `THANK YOU`, no audio.
- `BOTH_BUSY`: neutral arm, both routes caution, display `PLEASE WALK SLOWLY`, play “Please walk slowly” once.
- `RESET`: safely apply the neutral baseline while remaining a distinct acknowledged command state.

FastAPI requires matching `acknowledged`, `device_id`, `state`, and `command_id` fields. It retries a failed logical command at most twice by default, with the same ID. It preserves the desired state while disconnected and sends that state once after a successful reconnect heartbeat.

Manual controls switch the backend to Manual mode and cannot be overwritten by AI. Automatic mode may remain enabled while hardware is unavailable; camera AI continues and the latest desired state is synchronized after reconnect.
