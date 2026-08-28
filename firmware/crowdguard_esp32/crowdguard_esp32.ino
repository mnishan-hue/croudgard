#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <DFRobotDFPlayerMini.h>
#include <ESPmDNS.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "secrets.h"

const char* MDNS_NAME = "crowdguard-esp32";

// Use true when FastAPI is deployed on Render. The ESP32 then initiates every
// connection, because Render cannot reach a private 192.168.x.x address.
const bool USE_CLOUD_RELAY = true;
const unsigned long CLOUD_POLL_INTERVAL_MS = 2500;
const unsigned long CLOUD_HEARTBEAT_INTERVAL_MS = 5000;
const unsigned long AUDIO_STATUS_DURATION_MS = 4000;

// Hardware pins from the original CrowdGuard prototype.
const int RGB_PIN = 25;
const int NUM_LEDS = 30;
const int EXIT_A_FIRST_LED = 0;
const int EXIT_A_LED_COUNT = 15;
const int EXIT_B_FIRST_LED = 15;
const int EXIT_B_LED_COUNT = 15;
const int SERVO_PIN = 13;
const int SERVO_NEUTRAL_ANGLE = 90;
const int SERVO_EXIT_A_ANGLE = 30;
const int SERVO_EXIT_B_ANGLE = 150;
const int DFPLAYER_RX = 16;
const int DFPLAYER_TX = 17;

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

WebServer server(80);
Servo guidanceServo;
TFT_eSPI tft = TFT_eSPI();
HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfPlayer;
Adafruit_NeoPixel strip(NUM_LEDS, RGB_PIN, NEO_GRB + NEO_KHZ800);

String currentState = "NEUTRAL";
String lastCommandId = "";
String armState = "NEUTRAL";
String displayMessage = "THANK YOU";
String audioState = "IDLE";
String audioCommand = "NONE";
String exitAState = "NEUTRAL";
String exitBState = "NEUTRAL";
unsigned long lastWifiAttempt = 0;
unsigned long lastCloudPoll = 0;
unsigned long lastCloudHeartbeat = 0;
unsigned long audioStartedAt = 0;
bool mdnsStarted = false;
bool dfPlayerReady = false;

void showTFTMessage(const String& line1, const String& line2 = "") {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(3);
  tft.setCursor(18, 65);
  tft.println(line1);
  if (line2.length()) {
    tft.setTextSize(2);
    tft.setCursor(18, 125);
    tft.println(line2);
  }
}

void setLedSegment(int first, int count, uint32_t color) {
  const int last = min(NUM_LEDS, first + count);
  for (int index = max(0, first); index < last; index++) {
    strip.setPixelColor(index, color);
  }
}

void setRouteLeds(uint32_t exitAColor, uint32_t exitBColor) {
  strip.clear();
  setLedSegment(EXIT_A_FIRST_LED, EXIT_A_LED_COUNT, exitAColor);
  setLedSegment(EXIT_B_FIRST_LED, EXIT_B_LED_COUNT, exitBColor);
  strip.show();
}

void playGuidanceTrack(uint8_t track) {
  if (!dfPlayerReady) {
    audioState = "UNAVAILABLE";
    return;
  }
  // SD card: /MP3/0001.mp3 = use A, 0002 = use B, 0003 = walk slowly.
  dfPlayer.playMp3Folder(track);
  audioState = "PLAYING";
  audioStartedAt = millis();
}

void updateAudioStatus() {
  if (audioState == "PLAYING" &&
      millis() - audioStartedAt >= AUDIO_STATUS_DURATION_MS) {
    audioState = "IDLE";
    audioCommand = "NONE";
  }
}

void initializeHardware() {
  strip.begin();
  strip.setBrightness(80);
  strip.clear();
  strip.show();

  guidanceServo.setPeriodHertz(50);
  guidanceServo.attach(SERVO_PIN, 500, 2400);
  guidanceServo.write(SERVO_NEUTRAL_ANGLE);

  tft.init();
  tft.setRotation(1);
  showTFTMessage("THANK YOU");

  dfSerial.begin(9600, SERIAL_8N1, DFPLAYER_RX, DFPLAYER_TX);
  dfPlayerReady = dfPlayer.begin(dfSerial);
  if (dfPlayerReady) {
    dfPlayer.volume(25);
    Serial.println("DFPlayer ready");
  } else {
    Serial.println("DFPlayer not detected; guidance continues without audio");
  }
}

void applyHardwareState(const String& state) {
  currentState = state;
  if (state == "REDIRECT_A" || state == "REDIRECT_B") {
    const bool useExitA = state == "REDIRECT_A";
    armState = state;
    displayMessage = useExitA ? "USE EXIT A" : "USE EXIT B";
    audioCommand = useExitA ? "PLEASE_USE_EXIT_A" : "PLEASE_USE_EXIT_B";
    audioState = "PLAYING";
    exitAState = useExitA ? "GREEN_GUIDANCE" : "RED_RESTRICTED";
    exitBState = useExitA ? "RED_RESTRICTED" : "GREEN_GUIDANCE";
    guidanceServo.write(useExitA ? SERVO_EXIT_A_ANGLE : SERVO_EXIT_B_ANGLE);
    showTFTMessage(useExitA ? "USE EXIT A" : "USE EXIT B");
    setRouteLeds(
        useExitA ? strip.Color(0, 255, 0) : strip.Color(255, 0, 0),
        useExitA ? strip.Color(255, 0, 0) : strip.Color(0, 255, 0));
    playGuidanceTrack(useExitA ? 1 : 2);
    digitalWrite(LED_BUILTIN, HIGH);
  } else if (state == "BOTH_BUSY") {
    armState = "NEUTRAL";
    displayMessage = "PLEASE WALK SLOWLY";
    audioCommand = "PLEASE_WALK_SLOWLY";
    audioState = "PLAYING";
    exitAState = "CAUTION";
    exitBState = "CAUTION";
    guidanceServo.write(SERVO_NEUTRAL_ANGLE);
    showTFTMessage("PLEASE WALK", "SLOWLY");
    setRouteLeds(strip.Color(255, 150, 0), strip.Color(255, 150, 0));
    playGuidanceTrack(3);
    digitalWrite(LED_BUILTIN, HIGH);
  } else {
    armState = "NEUTRAL";
    displayMessage = "THANK YOU";
    audioCommand = "NONE";
    audioState = "IDLE";
    exitAState = "NEUTRAL";
    exitBState = "NEUTRAL";
    guidanceServo.write(SERVO_NEUTRAL_ANGLE);
    showTFTMessage("THANK YOU");
    setRouteLeds(0, 0);
    digitalWrite(LED_BUILTIN, LOW);
  }
}

void addHardwareState(JsonObject state) {
  state["arm_state"] = armState;
  state["display_message"] = displayMessage;
  state["audio"] = audioCommand;
  state["audio_state"] = audioState;
  JsonObject routes = state["led_routes"].to<JsonObject>();
  routes["exit_a"] = exitAState;
  routes["exit_b"] = exitBState;
}

void sendJson(int statusCode, JsonDocument& document) {
  String body;
  serializeJson(document, body);
  server.send(statusCode, "application/json", body);
}

void handleStatus() {
  JsonDocument response;
  response["device_id"] = DEVICE_ID;
  response["status"] = "ready";
  response["ip_address"] = WiFi.localIP().toString();
  response["uptime_ms"] = millis();
  response["state"] = currentState;
  response["last_command_id"] = lastCommandId;
  addHardwareState(response["hardware_state"].to<JsonObject>());
  sendJson(200, response);
}

void handleCommand() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"detail\":\"JSON body required\"}");
    return;
  }

  JsonDocument request;
  DeserializationError error = deserializeJson(request, server.arg("plain"));
  if (error) {
    server.send(400, "application/json", "{\"detail\":\"Invalid JSON\"}");
    return;
  }

  const String requestedDevice = request["device_id"] | "";
  if (requestedDevice != DEVICE_ID) {
    server.send(409, "application/json", "{\"detail\":\"Device ID mismatch\"}");
    return;
  }

  const String state = request["state"] | "";
  const String commandId = request["command_id"] | "";
  const bool valid =
      state == "NEUTRAL" || state == "REDIRECT_A" || state == "REDIRECT_B" ||
      state == "BOTH_BUSY" || state == "RESET";
  if (!valid || commandId.length() == 0) {
    server.send(422, "application/json", "{\"detail\":\"Unsupported state or missing command_id\"}");
    return;
  }

  // A retry carries the same ID. Acknowledge it without replaying servo/audio.
  if (commandId != lastCommandId) {
    applyHardwareState(state);
    lastCommandId = commandId;
  }

  JsonDocument response;
  response["acknowledged"] = true;
  response["device_id"] = DEVICE_ID;
  response["state"] = currentState;
  response["command_id"] = commandId;
  addHardwareState(response["hardware_state"].to<JsonObject>());
  sendJson(200, response);
}

void handleNotFound() {
  JsonDocument response;
  response["detail"] = "Not found";
  response["path"] = server.uri();
  sendJson(404, response);
}

bool validState(const String& state) {
  return state == "NEUTRAL" || state == "REDIRECT_A" ||
         state == "REDIRECT_B" || state == "BOTH_BUSY" || state == "RESET";
}

String cloudUrl(const String& path) {
  String base = BACKEND_URL;
  while (base.endsWith("/")) base.remove(base.length() - 1);
  return base + path;
}

int cloudRequest(const String& method, const String& path,
                 const String& body, String& responseBody) {
  WiFiClientSecure client;
  // For competition deployment this avoids certificate-expiry maintenance on
  // the ESP32. Pin Render's CA certificate for a long-lived production unit.
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(5000);
  if (!http.begin(client, cloudUrl(path))) return -1;
  http.addHeader("X-CrowdGuard-Device-Key", DEVICE_API_KEY);
  http.addHeader("Content-Type", "application/json");
  const int status = method == "GET" ? http.GET() : http.POST(body);
  if (status > 0) responseBody = http.getString();
  http.end();
  return status;
}

void addCloudHardwareState(JsonObject state) {
  addHardwareState(state);
}

void sendCloudHeartbeat() {
  JsonDocument report;
  report["state"] = currentState;
  if (lastCommandId.length()) report["last_command_id"] = lastCommandId;
  report["uptime_ms"] = millis();
  addCloudHardwareState(report["hardware_state"].to<JsonObject>());
  String body;
  serializeJson(report, body);
  String response;
  const int status = cloudRequest(
      "POST", "/api/device/" + String(DEVICE_ID) + "/heartbeat", body,
      response);
  if (status < 200 || status >= 300) {
    Serial.printf("Cloud heartbeat failed: HTTP %d\n", status);
  }
}

bool acknowledgeCloudCommand(const String& state, const String& commandId) {
  JsonDocument acknowledgement;
  acknowledgement["acknowledged"] = true;
  acknowledgement["state"] = state;
  acknowledgement["command_id"] = commandId;
  addCloudHardwareState(
      acknowledgement["hardware_state"].to<JsonObject>());
  String body;
  serializeJson(acknowledgement, body);
  String response;
  const int status = cloudRequest(
      "POST", "/api/device/" + String(DEVICE_ID) + "/ack", body, response);
  if (status < 200 || status >= 300) {
    Serial.printf("Cloud acknowledgement failed: HTTP %d\n", status);
    return false;
  }
  return true;
}

void pollCloudCommand() {
  String path = "/api/device/" + String(DEVICE_ID) + "/command";
  if (lastCommandId.length()) path += "?last_command_id=" + lastCommandId;
  String response;
  const int status = cloudRequest("GET", path, "", response);
  if (status < 200 || status >= 300) {
    Serial.printf("Cloud command poll failed: HTTP %d\n", status);
    return;
  }

  JsonDocument command;
  if (deserializeJson(command, response)) {
    Serial.println("Cloud command response was not valid JSON");
    return;
  }
  if (!(command["pending"] | false)) return;
  const String commandDevice = command["device_id"] | "";
  const String commandType = command["type"] | "";
  const String state = command["state"] | "";
  const String commandId = command["command_id"] | "";
  if (commandDevice != DEVICE_ID || commandType != "SET_STATE" ||
      !validState(state) || commandId.length() == 0) {
    Serial.println("Rejected invalid cloud command");
    return;
  }

  // A repeated poll or acknowledgement retry never replays servo/audio.
  if (commandId != lastCommandId) {
    applyHardwareState(state);
    lastCommandId = commandId;
    Serial.printf("Applied cloud state %s\n", state.c_str());
  }
  acknowledgeCloudCommand(state, commandId);
}

void maintainWifi() {
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiAttempt >= 5000) {
    lastWifiAttempt = millis();
    Serial.println("Connecting to Wi-Fi...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
  if (WiFi.status() == WL_CONNECTED && !mdnsStarted) {
    Serial.print("CrowdGuard ESP32 address: http://");
    Serial.println(WiFi.localIP());
    mdnsStarted = MDNS.begin(MDNS_NAME);
    if (mdnsStarted) {
    Serial.print("mDNS address: http://");
    Serial.print(MDNS_NAME);
    Serial.println(".local");
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  initializeHardware();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  lastWifiAttempt = millis() - 5000;
  maintainWifi();

  server.on("/status", HTTP_GET, handleStatus);
  server.on("/command", HTTP_POST, handleCommand);
  server.onNotFound(handleNotFound);
  server.begin();

  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.println("CrowdGuard HTTP service ready.");
  if (USE_CLOUD_RELAY) {
    Serial.print("Cloud relay backend: ");
    Serial.println(BACKEND_URL);
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    maintainWifi();
  }
  server.handleClient();
  updateAudioStatus();
  if (USE_CLOUD_RELAY && WiFi.status() == WL_CONNECTED) {
    const unsigned long now = millis();
    if (now - lastCloudHeartbeat >= CLOUD_HEARTBEAT_INTERVAL_MS) {
      lastCloudHeartbeat = now;
      sendCloudHeartbeat();
    }
    if (now - lastCloudPoll >= CLOUD_POLL_INTERVAL_MS) {
      lastCloudPoll = now;
      pollCloudCommand();
    }
  }
  delay(2);
}

