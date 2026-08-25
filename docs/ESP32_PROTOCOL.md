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
{"type":"SET_STATE","device_id":"cg-sentinel-01","command":"REDIRECT_TO_EXIT","recommended_exit_id":"exit_b"}
```

Acknowledgement:

```json
{"acknowledged":true,"hardware_state":{"arm_state":"BLOCK_ROUTE","display_message":"USE EXIT B →","audio":"PLEASE_USE_EXIT_B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}}
```

Commands are `NORMAL`, `REDIRECT_TO_EXIT`, `CRITICAL`, and `RESET`. Exit IDs are dynamic; firmware maps configured exit IDs to servo positions, WS2812B routes, display arrows, and DFPlayer tracks.

Recommended physical behavior:

- Redirect: block the congested-side guidance arm position, restricted exit LEDs red, recommended route green/animated, display the recommended exit, then play the matching guidance audio.
- Normal: neutral arm, soft normal LEDs, normal-flow display, no audio.
- Critical: neutral safe arm, caution pattern, “PLEASE WAIT / FOLLOW STAFF”, caution audio. Never physically close emergency egress.

FastAPI requires `acknowledged: true`. It records latency, heartbeat, last command, acknowledgement, and returned hardware state. A missing acknowledgement fails the command rather than pretending it succeeded.

Manual tests use the Hardware page after a successful heartbeat. Automatic mode can be enabled only when at least one Sentinel is connected.
