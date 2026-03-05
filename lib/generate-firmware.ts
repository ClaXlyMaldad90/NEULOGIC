/**
 * Generates a pre-configured .ino firmware file for ESP8266 with
 * WiFi credentials, server URL, and auth token hardcoded.
 * The WiFi password never leaves the browser - it's embedded directly
 * into the .ino file that the user downloads.
 */
export function generateFirmwareINO({
  wifiSsid,
  wifiPassword,
  serverUrl,
  authToken,
  deviceName,
  deviceCode,
}: {
  wifiSsid: string
  wifiPassword: string
  serverUrl: string
  authToken: string
  deviceName: string
  deviceCode: string
}): string {
  // Escape special characters for C strings
  const escapeC = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")

  return `/*
 * ============================================================================
 * NEUROSENSE ESP8266 FIRMWARE v2.0.0 — PRE-CONFIGURADO
 * ============================================================================
 *
 * Dispositivo: ${escapeC(deviceName)} (${escapeC(deviceCode)})
 * Red WiFi:    ${escapeC(wifiSsid)}
 * Servidor:    ${escapeC(serverUrl)}
 *
 * INSTRUCCIONES:
 *   1. Abre este archivo en Arduino IDE.
 *   2. Instala el board "ESP8266" desde Boards Manager.
 *   3. Instala las librerias: ArduinoJson (v7.x).
 *   4. Selecciona tu placa (NodeMCU 1.0 o Wemos D1 Mini).
 *   5. Conecta el ESP8266 por USB y haz clic en "Subir".
 *   6. Abre el Monitor Serial (115200 baud) para ver los logs.
 *
 * Librerias requeridas (Arduino IDE > Herramientas > Administrar Bibliotecas):
 *   - ArduinoJson  (by Benoit Blanchon, v7.x)
 *   - ESP8266WiFi   (incluida con el board package)
 *   - ESP8266HTTPClient (incluida con el board package)
 *
 * Board: ESP8266 (NodeMCU 1.0 / Wemos D1 Mini)
 * Upload Speed: 115200
 *
 * Autor: NeuroSense Team
 * Licencia: MIT
 * ============================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>

// ============================================================================
// CONFIGURACION PRE-CARGADA — No necesitas modificar nada
// ============================================================================

const char* WIFI_SSID     = "${escapeC(wifiSsid)}";
const char* WIFI_PASSWORD = "${escapeC(wifiPassword)}";
const char* SERVER_URL    = "${escapeC(serverUrl)}";
const char* DATA_ENDPOINT = "/api/v1/data";
const char* AUTH_TOKEN    = "${escapeC(authToken)}";
const char* DEVICE_NAME   = "${escapeC(deviceName)}";
const char* DEVICE_CODE   = "${escapeC(deviceCode)}";

// Intervalo de envio (milisegundos)
#define SEND_INTERVAL_MS  2000

// Timeout HTTP (milisegundos)
#define HTTP_TIMEOUT_MS   10000

// LED indicador (GPIO2 en ESP8266, activo bajo)
#define STATUS_LED        LED_BUILTIN

// ============================================================================
// ESTADOS
// ============================================================================

enum DeviceState {
  STATE_WIFI_CONNECTING,
  STATE_WIFI_CONNECTED,
  STATE_SENDING_DATA,
  STATE_ERROR
};

DeviceState currentState = STATE_WIFI_CONNECTING;

// Timers
unsigned long lastSendTime = 0;
unsigned long lastWifiCheckTime = 0;
unsigned long lastBlinkTime = 0;

// Estadisticas
unsigned long packetsSent = 0;
unsigned long packetsOk = 0;
unsigned long packetsFailed = 0;
unsigned long totalAlerts = 0;
float lastStressIndex = 0.0;

// ============================================================================
// SIMULACION DE SENSORES
// ============================================================================

float simulateGSR() {
  float base = 0.35 + 0.15 * sin(millis() / 10000.0);
  float noise = (random(-100, 100) / 1000.0);
  if (random(0, 100) < 10) {
    base += random(10, 30) / 100.0;
  }
  return constrain(base + noise, 0.0, 1.0);
}

float simulateSound() {
  float base = 60.0 + 30.0 * sin(millis() / 8000.0);
  float noise = random(-20, 20);
  if (random(0, 100) < 8) {
    base += random(50, 150);
  }
  return constrain(base + noise, 0.0, 255.0);
}

void simulateAccel(float &ax, float &ay, float &az) {
  ax = random(-50, 50) + 10.0 * sin(millis() / 5000.0);
  ay = random(-50, 50) + 10.0 * cos(millis() / 7000.0);
  az = 1024.0 + random(-30, 30);
  if (random(0, 100) < 5) {
    ax += random(200, 800);
    ay += random(200, 800);
    az += random(100, 500);
  }
}

// ============================================================================
// ENVIO DE DATOS
// ============================================================================

bool sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi no conectado. Saltando envio.");
    return false;
  }

  float gsr = simulateGSR();
  float sound = simulateSound();
  float accelX, accelY, accelZ;
  simulateAccel(accelX, accelY, accelZ);

  JsonDocument doc;
  doc["auth_token"] = AUTH_TOKEN;
  doc["gsr"] = round(gsr * 1000.0) / 1000.0;
  doc["sound"] = round(sound * 10.0) / 10.0;
  doc["accel_x"] = round(accelX * 10.0) / 10.0;
  doc["accel_y"] = round(accelY * 10.0) / 10.0;
  doc["accel_z"] = round(accelZ * 10.0) / 10.0;
  doc["sent_at"] = (unsigned long)millis();

  String payload;
  serializeJson(doc, payload);

  Serial.println("-------------------------------------");
  Serial.print("[DATA] Paquete #"); Serial.println(packetsSent + 1);
  Serial.print("[DATA] GSR="); Serial.print(gsr, 3);
  Serial.print(" | Sound="); Serial.print(sound, 1);
  Serial.print(" | Accel=("); Serial.print(accelX, 1);
  Serial.print(", "); Serial.print(accelY, 1);
  Serial.print(", "); Serial.print(accelZ, 1);
  Serial.println(")");

  WiFiClient client;
  HTTPClient http;

  String url = String(SERVER_URL) + String(DATA_ENDPOINT);
  Serial.print("[HTTP] POST -> "); Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(HTTP_TIMEOUT_MS);

  unsigned long sendStart = millis();
  int httpCode = http.POST(payload);
  unsigned long sendDuration = millis() - sendStart;

  packetsSent++;

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("[HTTP] Codigo: "); Serial.print(httpCode);
    Serial.print(" | Tiempo: "); Serial.print(sendDuration); Serial.println("ms");

    if (httpCode == 200) {
      packetsOk++;

      JsonDocument resDoc;
      DeserializationError err = deserializeJson(resDoc, response);

      if (!err) {
        lastStressIndex = resDoc["stress_index"] | 0.0f;
        int alerts = resDoc["alerts"] | 0;
        int latency = resDoc["latency_ms"] | 0;
        totalAlerts += alerts;

        Serial.print("[RESP] Estres: "); Serial.print(lastStressIndex * 100, 1); Serial.println("%");
        Serial.print("[RESP] Alertas: "); Serial.println(alerts);
        Serial.print("[RESP] Latencia: "); Serial.print(latency); Serial.println("ms");
      }

      http.end();
      return true;
    } else if (httpCode == 401) {
      Serial.println("[HTTP] ERROR 401: Token invalido.");
    } else {
      Serial.print("[HTTP] ERROR "); Serial.print(httpCode);
      Serial.print(": "); Serial.println(response);
    }
  } else {
    Serial.print("[HTTP] Error conexion: "); Serial.println(http.errorToString(httpCode));
  }

  packetsFailed++;
  http.end();
  return false;
}

// ============================================================================
// LED
// ============================================================================

void updateStatusLED() {
  unsigned long now = millis();
  int interval;
  switch (currentState) {
    case STATE_WIFI_CONNECTING: interval = 250;  break;
    case STATE_WIFI_CONNECTED:  interval = 500;  break;
    case STATE_SENDING_DATA:    interval = 2000; break;
    case STATE_ERROR:           interval = 150;  break;
    default:                    interval = 500;  break;
  }
  if (now - lastBlinkTime >= (unsigned long)interval) {
    lastBlinkTime = now;
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
  }
}

// ============================================================================
// ESTADISTICAS
// ============================================================================

void printStats() {
  Serial.println("=====================================");
  Serial.println("  ESTADISTICAS DE SESION");
  Serial.println("=====================================");
  Serial.print("  Dispositivo:     "); Serial.println(DEVICE_NAME);
  Serial.print("  Codigo:          "); Serial.println(DEVICE_CODE);
  Serial.print("  Enviados:        "); Serial.println(packetsSent);
  Serial.print("  Exitosos:        "); Serial.println(packetsOk);
  Serial.print("  Fallidos:        "); Serial.println(packetsFailed);
  Serial.print("  Alertas:         "); Serial.println(totalAlerts);
  Serial.print("  Ultimo estres:   "); Serial.print(lastStressIndex * 100, 1); Serial.println("%");
  Serial.print("  WiFi RSSI:       "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  Serial.print("  IP:              "); Serial.println(WiFi.localIP());
  Serial.print("  Uptime:          "); Serial.print(millis() / 1000); Serial.println("s");
  if (packetsSent > 0) {
    float rate = (packetsOk * 100.0) / packetsSent;
    Serial.print("  Tasa exito:      "); Serial.print(rate, 1); Serial.println("%");
  }
  Serial.println("=====================================");
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("=====================================");
  Serial.println("  NEUROSENSE ESP8266 v2.0.0");
  Serial.print("  Dispositivo: "); Serial.println(DEVICE_NAME);
  Serial.print("  Codigo:      "); Serial.println(DEVICE_CODE);
  Serial.println("=====================================");
  Serial.println();

  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH);

  randomSeed(analogRead(A0) + micros());

  // Conectar WiFi
  Serial.print("[WIFI] Conectando a: "); Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 60) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    currentState = STATE_SENDING_DATA;
    Serial.println("[WIFI] Conectado!");
    Serial.print("[WIFI] IP: "); Serial.println(WiFi.localIP());
    Serial.print("[WIFI] RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
    Serial.println("[READY] Enviando datos al servidor...");
  } else {
    currentState = STATE_ERROR;
    Serial.println("[WIFI] ERROR: No se pudo conectar.");
    Serial.println("[WIFI] Verifica el nombre y contrasena de la red.");
    Serial.println("[WIFI] Reiniciando en 10 segundos...");
    delay(10000);
    ESP.restart();
  }

  Serial.println();
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {
  unsigned long now = millis();
  updateStatusLED();

  // Verificar WiFi cada 10s
  if (now - lastWifiCheckTime >= 10000) {
    lastWifiCheckTime = now;

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] Conexion perdida. Reconectando...");
      currentState = STATE_ERROR;
      WiFi.reconnect();

      int retries = 0;
      while (WiFi.status() != WL_CONNECTED && retries < 30) {
        delay(500);
        Serial.print(".");
        retries++;
      }
      Serial.println();

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[WIFI] Reconectado.");
        currentState = STATE_SENDING_DATA;
      } else {
        Serial.println("[WIFI] Reconexion fallida. Reintentando...");
      }
    }
  }

  // Enviar datos cada SEND_INTERVAL_MS
  if (currentState == STATE_SENDING_DATA && now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    sendSensorData();

    // Estadisticas cada 10 paquetes
    if (packetsSent > 0 && packetsSent % 10 == 0) {
      printStats();
    }
  }

  // Comandos Serial
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\\n');
    input.trim();

    if (input.equalsIgnoreCase("STATUS")) {
      printStats();
    } else if (input.equalsIgnoreCase("RESET")) {
      Serial.println("[CMD] Reiniciando...");
      delay(1000);
      ESP.restart();
    } else {
      Serial.println("[CMD] Comandos: STATUS, RESET");
    }
  }

  yield();
}
`
}
