# CrowdGuard servo direction test

1. Keep the servo arm clear of wires and fingers.
2. Open `firmware/servo_smooth_test/servo_smooth_test.ino` in Arduino IDE.
3. Select **ESP32 Dev Module**, select the ESP32 port, and upload.
4. Open Serial Monitor at **115200 baud**.
5. Watch: center → Exit A → center → Exit B → center.
6. Send `A`, `B`, or `C` from Serial Monitor to repeat one movement.

Wiring: servo signal → GPIO 13, servo ground → ESP32 ground, and servo power →
a stable 5 V supply. Do not power the servo from the ESP32 3.3 V pin. When using
an external 5 V supply, its ground and the ESP32 ground must be connected.

If A points toward the physical Exit B, change `SERVO_REVERSED` to `true` in
both the test sketch and `firmware/crowdguard_esp32/crowdguard_esp32.ino`.

For an accurate arrow, let the test center the servo first. Then turn off power,
remove the plastic servo horn, refit it pointing straight ahead, and tighten the
screw. Upload the main CrowdGuard sketch only after A, B, and center are correct.

The servo has no position sensor that the ESP32 can read. Its first movement
after power-on may center the horn from an unknown position; every CrowdGuard
route change after that is limited to one degree every 25 milliseconds.
