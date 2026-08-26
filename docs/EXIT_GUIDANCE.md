# Exit guidance state machine

CrowdGuard bases guidance on fresh observations from every enabled exit camera. It does not issue automatic route guidance until exit coverage is complete and a Sentinel has been connected and automatic control enabled.

## Competition behavior

| Live exit condition | Decision | ESP32 display | Route lights |
| --- | --- | --- | --- |
| Both exits below 40% risk | `NORMAL` | `THANK YOU VISIT AGAIN` | Both normal |
| Exit A reaches 45%+ while Exit B is safer | `REDIRECT_TO_EXIT: exit_b` | `PLEASE USE EXIT B` | A red, B green |
| Exit B reaches 45%+ while Exit A is safer | `REDIRECT_TO_EXIT: exit_a` | `PLEASE USE EXIT A` | A green, B red |
| Both usable exits reach 70%+ | `CRITICAL` | `PLEASE WALK SLOWLY / MAINTAIN SPACE` | Both caution |
| No usable route, or the only usable route is congested | `CRITICAL` | `PLEASE WALK SLOWLY / MAINTAIN SPACE` | Both caution |

## Stability for live people movement

Camera risk is smoothed over recent observations. A new high-risk camera requires multiple samples before crossing the redirect threshold.

After a route is selected:

- ordinary route changes require an 8-second dwell period;
- the alternative must be at least 10 score points safer;
- small count reversals retain the current route;
- an immediate switch is allowed only when the current route reaches 70% risk and the alternative is at least 10 points safer;
- stopping or restarting camera analysis resets connected automatic-control Sentinels to the neutral message.

These rules reduce rapid Exit A/Exit B flapping while preserving an emergency escape from a route that becomes clearly unsafe.

## Physical display requirement

The HTTP command, acknowledgement, display-message state, audio command, and route-light state are implemented in the backend and starter firmware. The starter sketch stores and reports those outputs and demonstrates state using the onboard LED.

A physical OLED, TFT, or LCD cannot be driven correctly until its exact controller, library, dimensions, I2C/SPI pins, and address are known. Add that hardware-specific rendering inside `applyHardwareState()` in `firmware/crowdguard_esp32/crowdguard_esp32.ino`. Do not guess a display driver or pinout: an incorrect choice can fail to compile or damage wiring.
