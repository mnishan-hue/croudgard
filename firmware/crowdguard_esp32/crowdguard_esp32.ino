#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <WiFi.h>

// Change these values before uploading.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID = "crowdguard-sentinel-01";
const char* MDNS_NAME = "crowdguard-esp32";

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

WebServer server(80);

String currentState = "NEUTRAL";
String lastCommandId = "";
String armState = "NEUTRAL";
String displayMessage = "THANK YOU";
String audioState = "IDLE";
String audioCommand = "NONE";
String exitAState = "NEUTRAL";
String exitBState = "NEUTRAL";
unsigned long lastWifiAttempt = 0;
bool mdnsStarted = false;

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
    digitalWrite(LED_BUILTIN, HIGH);
  } else if (state == "BOTH_BUSY") {
    armState = "NEUTRAL";
    displayMessage = "PLEASE WALK SLOWLY";
    audioCommand = "PLEASE_WALK_SLOWLY";
    audioState = "PLAYING";
    exitAState = "CAUTION";
    exitBState = "CAUTION";
    digitalWrite(LED_BUILTIN, HIGH);
  } else {
    armState = "NEUTRAL";
    displayMessage = "THANK YOU";
    audioCommand = "NONE";
    audioState = "IDLE";
    exitAState = "NEUTRAL";
    exitBState = "NEUTRAL";
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
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    maintainWifi();
  }
  server.handleClient();
  delay(2);
}

