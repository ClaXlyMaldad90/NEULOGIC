**
 * Generates a pre-configured .ino firmware file for ESP8266.
 * Minimal test firmware: connect WiFi, send JSON to server, show phases in Serial.
 * Uses HTTPS (WiFiClientSecure) for Vercel deployment.
 * WiFi password stays in the browser -- never sent to the server.
 */
export function generateFirmwareINO({
  wifiSsid,
  wifiPassword,
  serverHost,
  deviceName,
  deviceCode,
}: {
  wifiSsid: string
  wifiPassword: string
  serverHost: string
  deviceName: string
  deviceCode: string
}): string {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")

  return `/*
 * ============================================================
 *  NEUROSENSE ESP8266  --  Firmware de verificacion v3.0
 * ============================================================
 *  Dispositivo : ${esc(deviceName)} (${esc(deviceCode)})
 *  Red WiFi    : ${esc(wifiSsid)}
 *  Servidor    : ${esc(serverHost)}
 *
 *  INSTRUCCIONES:
 *   1. Abre este archivo en Arduino IDE.
 *   2. Instala el board "ESP8266" (Boards Manager).
 *   3. Instala la libreria ArduinoJson v7 (Administrar Bibliotecas).
 *   4. Selecciona tu placa (NodeMCU 1.0 / Wemos D1 Mini).
 *   5. Conecta por USB, haz clic en Subir.
 *   6. Abre Monitor Serial a 115200 baud para ver las fases.
 * ============================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// =====================  CONFIGURACION  =====================
const char* WIFI_SSID     = "${esc(wifiSsid)}";
const char* WIFI_PASS     = "${esc(wifiPassword)}";
const char* SERVER_HOST   = "${esc(serverHost)}";
const char* DEVICE_CODE   = "${esc(deviceCode)}";
const char* DEVICE_NAME   = "${esc(deviceName)}";

// Intervalo entre envios (ms)
#define SEND_INTERVAL  5000
// Maximo de intentos WiFi (x 500 ms)
#define WIFI_RETRIES   40

// ====================  VARIABLES GLOBALES  ==================
enum Phase {
  PHASE_INIT,
  PHASE_WIFI_CONNECTING,
  PHASE_WIFI_OK,
  PHASE_SENDING,
  PHASE_CONFIRMED,
  PHASE_ERROR
};

Phase phase = PHASE_INIT;
unsigned long lastSend   = 0;
unsigned long sendCount  = 0;
unsigned long okCount    = 0;
unsigned long failCount  = 0;

// ========================  HELPERS  =========================
void printPhase(const char* msg) {
  Serial.println();
  Serial.println("--------------------------------------------");
  Serial.print("  FASE -> ");
  Serial.println(msg);
  Serial.println("--------------------------------------------");
}

// ========================  SETUP  ===========================
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("============================================");
  Serial.println("   NEUROSENSE ESP8266  v3.0");
  Serial.print("   Dispositivo: "); Serial.println(DEVICE_NAME);
  Serial.print("   Codigo:      "); Serial.println(DEVICE_CODE);
  Serial.print("   Servidor:    https://"); Serial.println(SERVER_HOST);
  Serial.println("============================================");

  // ---- FASE 1: INIT ----
  phase = PHASE_INIT;
  printPhase("INICIALIZACION");
  Serial.println("  LED configurado.");
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // apagado (activo bajo)

  // ---- FASE 2: WIFI CONNECTING ----
  phase = PHASE_WIFI_CONNECTING;
  printPhase("CONECTANDO WiFi");
  Serial.print("  SSID: "); Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < WIFI_RETRIES) {
    delay(500);
    Serial.print(".");
    tries++;
    // parpadeo rapido
    digitalWrite(LED_BUILTIN, tries % 2 == 0 ? LOW : HIGH);
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    phase = PHASE_ERROR;
    printPhase("ERROR WiFi");
    Serial.println("  No se pudo conectar a la red WiFi.");
    Serial.println("  Verifica SSID y contrasena.");
    Serial.println("  Reiniciando en 10 s ...");
    delay(10000);
    ESP.restart();
    return;
  }

  // ---- FASE 3: WIFI OK ----
  phase = PHASE_WIFI_OK;
  printPhase("WiFi CONECTADO");
  Serial.print("  IP local : "); Serial.println(WiFi.localIP());
  Serial.print("  RSSI     : "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  Serial.print("  Gateway  : "); Serial.println(WiFi.gatewayIP());
  Serial.println();
  Serial.println("  Listo para enviar datos al servidor.");
  Serial.print("  Intervalo: "); Serial.print(SEND_INTERVAL / 1000); Serial.println(" s");

  digitalWrite(LED_BUILTIN, LOW); // encendido fijo = wifi ok
}

// ========================  LOOP  ============================
void loop() {
  unsigned long now = millis();

  // Revisar WiFi
  if (WiFi.status() != WL_CONNECTED) {
    phase = PHASE_ERROR;
    printPhase("WiFi PERDIDO - reconectando");
    WiFi.reconnect();
    int t = 0;
    while (WiFi.status() != WL_CONNECTED && t < 20) { delay(500); Serial.print("."); t++; }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      phase = PHASE_WIFI_OK;
      printPhase("WiFi RECONECTADO");
      Serial.print("  IP: "); Serial.println(WiFi.localIP());
    } else {
      Serial.println("  Reconexion fallida. Reintentando ...");
      delay(5000);
      return;
    }
  }

  // Enviar datos cada SEND_INTERVAL
  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;
    sendCount++;

    phase = PHASE_SENDING;
    Serial.println();
    Serial.print("[ENVIO #"); Serial.print(sendCount); Serial.println("]");

    // Construir JSON con valores fijos de prueba
    JsonDocument doc;
    doc["device_code"] = DEVICE_CODE;
    doc["gsr"]         = 0.35;
    doc["sound"]       = 65.0;
    doc["accel_x"]     = 10.0;
    doc["accel_y"]     = -5.0;
    doc["accel_z"]     = 1024.0;
    doc["sent_at"]     = (unsigned long)millis();

    String payload;
    serializeJson(doc, payload);

    Serial.print("  JSON: "); Serial.println(payload);

    // HTTPS request
    WiFiClientSecure client;
    client.setInsecure();  // skip cert verify (ok for dev/test)

    HTTPClient http;
    String url = "https://" + String(SERVER_HOST) + "/api/v1/data";
    Serial.print("  POST -> "); Serial.println(url);

    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(15000);

    unsigned long t0 = millis();
    int code = http.POST(payload);
    unsigned long dur = millis() - t0;

    if (code > 0) {
      String body = http.getString();
      Serial.print("  HTTP "); Serial.print(code);
      Serial.print("  ("); Serial.print(dur); Serial.println(" ms)");
      Serial.print("  Resp: "); Serial.println(body);

      if (code == 200) {
        okCount++;
        phase = PHASE_CONFIRMED;
        printPhase("DATOS CONFIRMADOS POR SERVIDOR");
        Serial.print("  Paquetes OK: "); Serial.print(okCount);
        Serial.print(" / "); Serial.println(sendCount);

        // Parse response
        JsonDocument res;
        if (!deserializeJson(res, body)) {
          float stress = res["stress_index"] | 0.0f;
          int alerts   = res["alerts"] | 0;
          Serial.print("  Estres: "); Serial.print(stress * 100, 1); Serial.println(" %");
          Serial.print("  Alertas: "); Serial.println(alerts);
        }
      } else {
        failCount++;
        Serial.print("  ERROR del servidor: "); Serial.println(body);
      }
    } else {
      failCount++;
      Serial.print("  ERROR conexion: "); Serial.println(http.errorToString(code));
    }

    http.end();

    // Resumen cada 5 envios
    if (sendCount % 5 == 0) {
      Serial.println();
      Serial.println("========== RESUMEN ==========");
      Serial.print("  Enviados : "); Serial.println(sendCount);
      Serial.print("  OK       : "); Serial.println(okCount);
      Serial.print("  Fallidos : "); Serial.println(failCount);
      Serial.print("  WiFi RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
      Serial.print("  Uptime   : "); Serial.print(millis() / 1000); Serial.println(" s");
      Serial.println("=============================");
    }
  }

  yield();
}
`
}
