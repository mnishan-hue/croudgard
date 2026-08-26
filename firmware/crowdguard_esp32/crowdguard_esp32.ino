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

String armState = "NORMAL";
String displayMessage = "NORMAL";
String audioState = "IDLE";
String audioCommand = "NONE";
String exitAState = "NORMAL";
String exitBState = "NORMAL";

void applyHardwareState(const String& command, const String& exitId) {
  // Safe demonstration output. Replace or extend this function with the
  // project's servo, WS2812B, display and DFPlayer Mini drivers.
  if (command == "REDIRECT_TO_EXIT") {
    armState = "GUIDANCE";
    displayMessage = exitId == "exit_a" ? "USE EXIT A" : "USE EXIT B";
    audioCommand = exitId == "exit_a" ? "PLEASE_USE_EXIT_A" : "PLEASE_USE_EXIT_B";
    audioState = "PLAYING";
    exitAState = exitId == "exit_a" ? "GREEN_GUIDANCE" : "RED_RESTRICTED";
    exitBState = exitId == "exit_b" ? "GREEN_GUIDANCE" : "RED_RESTRICTED";
    digitalWrite(LED_BUILTIN, HIGH);
  } else if (command == "CRITICAL") {
    armState = "SAFE_NEUTRAL";
    displayMessage = "PLEASE WAIT / FOLLOW STAFF";
    audioCommand = "CAUTION";
    audioState = "PLAYING";
    exitAState = "CAUTION";
    exitBState = "CAUTION";
    digitalWrite(LED_BUILTIN, HIGH);
  } else {
    armState = "NORMAL";
    displayMessage = "NORMAL";
    audioCommand = "NONE";
    audioState = "IDLE";
    exitAState = "NORMAL";
    exitBState = "NORMAL";
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

  const String command = request["command"] | "NORMAL";
  const String exitId = request["recommended_exit_id"] | "";
  const bool valid =
      command == "NORMAL" || command == "REDIRECT_TO_EXIT" ||
      command == "CRITICAL" || command == "RESET";
  if (!valid) {
    server.send(422, "application/json", "{\"detail\":\"Unsupported command\"}");
    return;
  }
  if (command == "REDIRECT_TO_EXIT" && exitId != "exit_a" && exitId != "exit_b") {
    server.send(422, "application/json", "{\"detail\":\"Unknown exit ID\"}");
    return;
  }

  applyHardwareState(command, exitId);

  JsonDocument response;
  response["acknowledged"] = true;
  response["device_id"] = DEVICE_ID;
  response["command"] = command;
  addHardwareState(response["hardware_state"].to<JsonObject>());
  sendJson(200, response);
}

void handleNotFound() {
  JsonDocument response;
  response["detail"] = "Not found";
  response["path"] = server.uri();
  sendJson(404, response);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  const unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connection failed. Restarting in 5 seconds.");
    delay(5000);
    ESP.restart();
  }

  Serial.print("CrowdGuard ESP32 address: http://");
  Serial.println(WiFi.localIP());
  if (MDNS.begin(MDNS_NAME)) {
    Serial.print("mDNS address: http://");
    Serial.print(MDNS_NAME);
    Serial.println(".local");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  connectWifi();

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
    connectWifi();
  }
  server.handleClient();
  delay(2);
}

