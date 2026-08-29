#include <Arduino.h>
#include <ESP32Servo.h>

// CrowdGuard servo-only test. Nothing else is controlled by this sketch.
const int SERVO_PIN = 13;
const int CENTER_ANGLE = 90;
const int EXIT_A_ANGLE = 30;
const int EXIT_B_ANGLE = 150;
const unsigned long STEP_INTERVAL_MS = 25;
const unsigned long HOLD_TIME_MS = 2500;

// Change to true if Exit A and Exit B point in the opposite directions.
const bool SERVO_REVERSED = false;

Servo testServo;
int currentAngle = CENTER_ANGLE;
int targetAngle = CENTER_ANGLE;
unsigned long lastStepAt = 0;

int angleForExit(bool exitA) {
  if (SERVO_REVERSED) exitA = !exitA;
  return exitA ? EXIT_A_ANGLE : EXIT_B_ANGLE;
}

void moveSlowlyTo(int angle, const char* label) {
  targetAngle = constrain(angle, EXIT_A_ANGLE, EXIT_B_ANGLE);
  Serial.print("Moving slowly to ");
  Serial.println(label);

  while (currentAngle != targetAngle) {
    const unsigned long now = millis();
    if (now - lastStepAt >= STEP_INTERVAL_MS) {
      lastStepAt = now;
      currentAngle += currentAngle < targetAngle ? 1 : -1;
      testServo.write(currentAngle);
    }
    delay(1);
  }

  Serial.print("Reached ");
  Serial.println(label);
  delay(HOLD_TIME_MS);
}

void runDirectionTest() {
  moveSlowlyTo(angleForExit(true), "EXIT A");
  moveSlowlyTo(CENTER_ANGLE, "CENTER");
  moveSlowlyTo(angleForExit(false), "EXIT B");
  moveSlowlyTo(CENTER_ANGLE, "CENTER");
  Serial.println("Test complete. Send A, B, or C in Serial Monitor.");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  testServo.setPeriodHertz(50);
  testServo.attach(SERVO_PIN, 500, 2400);
  testServo.write(CENTER_ANGLE);
  Serial.println("SERVO TEST: center -> Exit A -> center -> Exit B -> center");
  Serial.println("Keep fingers and wires away from the moving arm.");
  delay(HOLD_TIME_MS);
  runDirectionTest();
}

void loop() {
  if (!Serial.available()) return;
  const char command = Serial.read();
  if (command == 'A' || command == 'a') {
    moveSlowlyTo(angleForExit(true), "EXIT A");
  } else if (command == 'B' || command == 'b') {
    moveSlowlyTo(angleForExit(false), "EXIT B");
  } else if (command == 'C' || command == 'c') {
    moveSlowlyTo(CENTER_ANGLE, "CENTER");
  }
}
