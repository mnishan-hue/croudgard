# ESP32 protocol

The frontend calls FastAPI; it never addresses ESP32. A future `ESP32Client` sends validated JSON over the local network.

```json
{"type":"SET_STATE","sentinel_id":"sentinel_01","action":"REDIRECT_TO_EXIT","recommended_exit_id":"exit_b","blocked_route_id":"route_a","display_message":"USE EXIT B","audio":"FOLLOW_ILLUMINATED_ROUTE"}
```

Acknowledgement:

```json
{"sentinel_id":"sentinel_01","connected":true,"arm_state":"BLOCK_ROUTE","display_message":"USE EXIT B","audio_state":"PLAYING","led_routes":{"exit_a":"RED_RESTRICTED","exit_b":"GREEN_GUIDANCE"}}
```

Allowed LED values are `NORMAL`, `GREEN_GUIDANCE`, `YELLOW_CAUTION`, `RED_RESTRICTED`, and `OFF`. The arm is stationary-base guidance with `NORMAL` or `BLOCK_ROUTE`; an exit/route ID supplies prototype-specific direction. Audio commands include `NONE`, `FOLLOW_ILLUMINATED_ROUTE`, `AREA_AHEAD_CONGESTED`, `PLEASE_WAIT`, and `THANK_YOU`.
