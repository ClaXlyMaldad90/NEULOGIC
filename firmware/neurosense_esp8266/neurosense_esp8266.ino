/*
 * ============================================================================
 * NEUROSENSE ESP8266 FIRMWARE v1.0.0
 * ============================================================================
 *
 * Firmware completo para ESP8266 (NodeMCU / Wemos D1 Mini).
 * Envía datos sensoriales simulados al backend NeuroSense vía HTTP POST.
 *
 * Funcionalidades:
 *   - Portal cautivo WiFiManager para configuración de red.
 *   - Token de autenticación persistente en EEPROM.
 *   - Máquina de estados: SETUP → WIFI_CONNECTED → PROVISIONED → SENDING_DATA.
 *   - Simulación local de sensores (GSR, sonido, aceleración).
 *   - Envío periódico vía HTTP POST a /api/v1/data.
 *   - Reconexión automática WiFi.
 *   - Logs detallados por Serial (115200 baud).
 *
 * Librerías requeridas (instalar desde Arduino IDE Library Manager):
 *   - ESP8266WiFi        (incluida con el board package)
 *   - ESP8266HTTPClient  (incluida con el board package)
 *   - WiFiManager        (by tzapu, v2.0+)
 *   - ArduinoJson        (by Benoit Blanchon, v7.x)
 *   - EEPROM             (incluida con el board package)
 *
 * Board: ESP8266 (NodeMCU 1.0 / Wemos D1 Mini)
 * Upload Speed: 115200
 * Flash Size: 4MB (FS:2MB OTA:~1019KB)
 *
 * Autor: NeuroSense Team
 * Licencia: MIT
 * ============================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiManager.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ============================================================================
// CONFIGURACIÓN — Modifica estos valores según tu despliegue
// ============================================================================

// URL base del backend NeuroSense (sin trailing slash)
// Para pruebas locales:  "http://192.168.1.100:3000"
// Para producción:       "https://tu-app.vercel.app"
#define BACKEND_URL       "https://tu-app.vercel.app"

// Endpoint de datos sensoriales
#define DATA_ENDPOINT     "/api/v1/data"

// Intervalo de envío de datos en milisegundos (2 segundos)
#define SEND_INTERVAL_MS  2000

// Intervalo de verificación de WiFi en milisegundos (10 segundos)
#define WIFI_CHECK_MS     10000

// Nombre del portal cautivo WiFiManager
#define AP_NAME           "NeuroSense-Setup"
#define AP_PASSWORD       "neurosense123"

// Timeout del portal cautivo en segundos (3 minutos)
#define PORTAL_TIMEOUT    180

// Timeout HTTP en milisegundos
#define HTTP_TIMEOUT_MS   10000

// EEPROM: dirección y tamaño para almacenar el auth_token
#define EEPROM_SIZE       128
#define TOKEN_ADDR        0
#define TOKEN_LENGTH      64
#define TOKEN_MAGIC_ADDR  (TOKEN_ADDR + TOKEN_LENGTH)
#define TOKEN_MAGIC_VALUE 0xAB  // Byte mágico para verificar que hay token guardado

// LED indicador (GPIO2 en la mayoría de ESP8266, LED_BUILTIN)
#define STATUS_LED        LED_BUILTIN

// ============================================================================
// ESTADOS DE LA MÁQUINA DE ESTADOS
// ============================================================================

enum DeviceState {
  STATE_SETUP,          // Inicialización
  STATE_WIFI_CONNECTING,// Conectando a WiFi
  STATE_WIFI_CONNECTED, // WiFi conectado, verificando token
  STATE_PROVISIONED,    // Token configurado, listo para enviar
  STATE_SENDING_DATA,   // Enviando datos activamente
  STATE_ERROR           // Estado de error (recuperable)
};

// ============================================================================
// VARIABLES GLOBALES
// ============================================================================

DeviceState currentState = STATE_SETUP;
DeviceState previousState = STATE_SETUP;

// Auth token almacenado en EEPROM
char authToken[TOKEN_LENGTH + 1] = {0};
bool tokenLoaded = false;

// Timers (millis-based, no blocking)
unsigned long lastSendTime = 0;
unsigned long lastWifiCheckTime = 0;
unsigned long lastBlinkTime = 0;
unsigned long stateEnteredAt = 0;

// Estadísticas de sesión
unsigned long packetsSent = 0;
unsigned long packetsOk = 0;
unsigned long packetsFailed = 0;
unsigned long totalAlerts = 0;
float lastStressIndex = 0.0;
int lastLatencyMs = 0;

// WiFiManager instance
WiFiManager wifiManager;

// ============================================================================
// FUNCIONES DE EEPROM — Persistencia del auth_token
// ============================================================================

/**
 * Guarda el auth_token en EEPROM con un byte mágico de verificación.
 */
void saveTokenToEEPROM(const char* token) {
  EEPROM.begin(EEPROM_SIZE);
  for (int i = 0; i < TOKEN_LENGTH; i++) {
    EEPROM.write(TOKEN_ADDR + i, token[i]);
  }
  EEPROM.write(TOKEN_MAGIC_ADDR, TOKEN_MAGIC_VALUE);
  EEPROM.commit();
  EEPROM.end();
  Serial.println("[EEPROM] Token guardado correctamente.");
}

/**
 * Carga el auth_token desde EEPROM.
 * Retorna true si se encontró un token válido.
 */
bool loadTokenFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  byte magic = EEPROM.read(TOKEN_MAGIC_ADDR);

  if (magic != TOKEN_MAGIC_VALUE) {
    EEPROM.end();
    Serial.println("[EEPROM] No se encontró token guardado (magic byte inválido).");
    return false;
  }

  for (int i = 0; i < TOKEN_LENGTH; i++) {
    authToken[i] = (char)EEPROM.read(TOKEN_ADDR + i);
  }
  authToken[TOKEN_LENGTH] = '\0';
  EEPROM.end();

  // Validar que el token contiene solo caracteres hex válidos
  for (int i = 0; i < TOKEN_LENGTH; i++) {
    char c = authToken[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
      Serial.println("[EEPROM] Token inválido (caracteres no hex). Limpiando...");
      clearTokenFromEEPROM();
      return false;
    }
  }

  Serial.print("[EEPROM] Token cargado: ");
  Serial.print(authToken[0]); Serial.print(authToken[1]);
  Serial.print(authToken[2]); Serial.print(authToken[3]);
  Serial.println("...[truncado por seguridad]");
  return true;
}

/**
 * Borra el token de EEPROM.
 */
void clearTokenFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  for (int i = 0; i < EEPROM_SIZE; i++) {
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  EEPROM.end();
  memset(authToken, 0, sizeof(authToken));
  tokenLoaded = false;
  Serial.println("[EEPROM] Token borrado.");
}

// ============================================================================
// SIMULACIÓN DE SENSORES
// ============================================================================

/**
 * Genera un valor GSR simulado (respuesta galvánica de la piel).
 * Rango: 0.0 - 1.0 (normalizado).
 * Simula variaciones naturales con ruido gaussiano aproximado.
 */
float simulateGSR() {
  // Base con variación sinusoidal lenta + ruido
  float base = 0.35 + 0.15 * sin(millis() / 10000.0);
  float noise = (random(-100, 100) / 1000.0);

  // Pico ocasional (10% de probabilidad)
  if (random(0, 100) < 10) {
    base += random(10, 30) / 100.0;
  }

  return constrain(base + noise, 0.0, 1.0);
}

/**
 * Genera un valor de sonido ambiental simulado.
 * Rango: 0 - 255 (raw ADC del micrófono analógico).
 * El backend normaliza a 0-1 dividiendo entre 255.
 */
float simulateSound() {
  // Ambiente normal: 40-120, con picos ocasionales
  float base = 60.0 + 30.0 * sin(millis() / 8000.0);
  float noise = random(-20, 20);

  // Pico de ruido ocasional (8% probabilidad)
  if (random(0, 100) < 8) {
    base += random(50, 150);
  }

  return constrain(base + noise, 0.0, 255.0);
}

/**
 * Genera valores de aceleración simulados (MPU6050).
 * Unidades: mg (miligravedad). 1g = ~1024mg.
 * x,y baseline ~0, z baseline ~1024 (gravedad).
 */
void simulateAccel(float &ax, float &ay, float &az) {
  // Baseline: reposo (0, 0, 1024mg)
  ax = random(-50, 50) + 10.0 * sin(millis() / 5000.0);
  ay = random(-50, 50) + 10.0 * cos(millis() / 7000.0);
  az = 1024.0 + random(-30, 30);

  // Movimiento brusco ocasional (5% probabilidad)
  if (random(0, 100) < 5) {
    ax += random(200, 800);
    ay += random(200, 800);
    az += random(100, 500);
  }
}

// ============================================================================
// ENVÍO DE DATOS AL BACKEND
// ============================================================================

/**
 * Construye y envía un paquete JSON con datos sensoriales al backend.
 * Retorna true si el servidor respondió con éxito (HTTP 200).
 */
bool sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Error: WiFi no conectado. Saltando envío.");
    return false;
  }

  if (!tokenLoaded || strlen(authToken) == 0) {
    Serial.println("[HTTP] Error: No hay auth_token configurado.");
    return false;
  }

  // Generar datos simulados
  float gsr = simulateGSR();
  float sound = simulateSound();
  float accelX, accelY, accelZ;
  simulateAccel(accelX, accelY, accelZ);

  // Construir JSON con ArduinoJson
  JsonDocument doc;
  doc["auth_token"] = authToken;
  doc["gsr"] = round(gsr * 1000.0) / 1000.0;
  doc["sound"] = round(sound * 10.0) / 10.0;
  doc["accel_x"] = round(accelX * 10.0) / 10.0;
  doc["accel_y"] = round(accelY * 10.0) / 10.0;
  doc["accel_z"] = round(accelZ * 10.0) / 10.0;
  doc["sent_at"] = (unsigned long)millis(); // Timestamp relativo para latencia

  String payload;
  serializeJson(doc, payload);

  // Logging del paquete
  Serial.println("─────────────────────────────────────");
  Serial.print("[DATA] Paquete #"); Serial.println(packetsSent + 1);
  Serial.print("[DATA] GSR="); Serial.print(gsr, 3);
  Serial.print(" | Sound="); Serial.print(sound, 1);
  Serial.print(" | Accel=("); Serial.print(accelX, 1);
  Serial.print(", "); Serial.print(accelY, 1);
  Serial.print(", "); Serial.print(accelZ, 1);
  Serial.println(")");

  // Envío HTTP POST
  WiFiClient client;
  HTTPClient http;

  String url = String(BACKEND_URL) + String(DATA_ENDPOINT);

  Serial.print("[HTTP] POST → "); Serial.println(url);

  http.begin(client, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(HTTP_TIMEOUT_MS);

  unsigned long sendStart = millis();
  int httpCode = http.POST(payload);
  unsigned long sendDuration = millis() - sendStart;

  packetsSent++;

  if (httpCode > 0) {
    String response = http.getString();
    Serial.print("[HTTP] Código: "); Serial.println(httpCode);
    Serial.print("[HTTP] Tiempo de respuesta: "); Serial.print(sendDuration); Serial.println("ms");

    if (httpCode == 200) {
      packetsOk++;

      // Parsear respuesta
      JsonDocument resDoc;
      DeserializationError err = deserializeJson(resDoc, response);

      if (!err) {
        lastStressIndex = resDoc["stress_index"] | 0.0f;
        int alerts = resDoc["alerts"] | 0;
        lastLatencyMs = resDoc["latency_ms"] | 0;

        totalAlerts += alerts;

        Serial.print("[RESP] Estrés: "); Serial.print(lastStressIndex * 100, 1); Serial.println("%");
        Serial.print("[RESP] Alertas nuevas: "); Serial.println(alerts);
        Serial.print("[RESP] Latencia servidor: "); Serial.print(lastLatencyMs); Serial.println("ms");
      } else {
        Serial.print("[RESP] Error al parsear respuesta: "); Serial.println(err.c_str());
      }

      return true;
    } else if (httpCode == 401) {
      Serial.println("[HTTP] ERROR 401: Token inválido. Verificar auth_token.");
      Serial.println("[HTTP] El token puede haber sido revocado desde el dashboard.");
    } else if (httpCode == 400) {
      Serial.println("[HTTP] ERROR 400: Campos requeridos faltantes.");
      Serial.print("[HTTP] Respuesta: "); Serial.println(response);
    } else {
      Serial.print("[HTTP] ERROR "); Serial.print(httpCode);
      Serial.print(": "); Serial.println(response);
    }
  } else {
    Serial.print("[HTTP] Error de conexión: "); Serial.println(http.errorToString(httpCode));
  }

  packetsFailed++;
  http.end();
  return false;
}

// ============================================================================
// INDICADOR LED
// ============================================================================

/**
 * Parpadeo del LED según el estado actual.
 * LED_BUILTIN en ESP8266 es activo bajo (LOW = encendido).
 */
void updateStatusLED() {
  unsigned long now = millis();
  int interval;

  switch (currentState) {
    case STATE_SETUP:           interval = 100;  break;  // Parpadeo rápido
    case STATE_WIFI_CONNECTING: interval = 250;  break;  // Parpadeo medio
    case STATE_WIFI_CONNECTED:  interval = 500;  break;  // Parpadeo lento
    case STATE_PROVISIONED:     interval = 1000; break;  // Parpadeo muy lento
    case STATE_SENDING_DATA:    interval = 2000; break;  // Destello breve cada 2s
    case STATE_ERROR:           interval = 150;  break;  // Parpadeo rápido error
    default:                    interval = 500;  break;
  }

  if (now - lastBlinkTime >= (unsigned long)interval) {
    lastBlinkTime = now;
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
  }
}

// ============================================================================
// TRANSICIÓN DE ESTADOS
// ============================================================================

/**
 * Cambia al siguiente estado e imprime log.
 */
void transitionTo(DeviceState newState) {
  if (newState == currentState) return;

  previousState = currentState;
  currentState = newState;
  stateEnteredAt = millis();

  const char* stateNames[] = {
    "SETUP", "WIFI_CONNECTING", "WIFI_CONNECTED",
    "PROVISIONED", "SENDING_DATA", "ERROR"
  };

  Serial.println("═══════════════════════════════════════");
  Serial.print("[STATE] ");
  Serial.print(stateNames[previousState]);
  Serial.print(" → ");
  Serial.println(stateNames[currentState]);
  Serial.println("═══════════════════════════════════════");
}

// ============================================================================
// IMPRESIÓN DE ESTADÍSTICAS
// ============================================================================

/**
 * Imprime estadísticas periódicas de la sesión.
 */
void printStats() {
  Serial.println("┌─────────────────────────────────────┐");
  Serial.println("│       ESTADÍSTICAS DE SESIÓN         │");
  Serial.println("├─────────────────────────────────────┤");
  Serial.print("│ Paquetes enviados:    "); Serial.println(packetsSent);
  Serial.print("│ Paquetes exitosos:    "); Serial.println(packetsOk);
  Serial.print("│ Paquetes fallidos:    "); Serial.println(packetsFailed);
  Serial.print("│ Alertas generadas:    "); Serial.println(totalAlerts);
  Serial.print("│ Último estrés:        "); Serial.print(lastStressIndex * 100, 1); Serial.println("%");
  Serial.print("│ RSSI WiFi:            "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  Serial.print("│ IP local:             "); Serial.println(WiFi.localIP());
  Serial.print("│ Uptime:               "); Serial.print(millis() / 1000); Serial.println("s");
  if (packetsSent > 0) {
    float successRate = (packetsOk * 100.0) / packetsSent;
    Serial.print("│ Tasa de éxito:        "); Serial.print(successRate, 1); Serial.println("%");
  }
  Serial.println("└─────────────────────────────────────┘");
}

// ============================================================================
// CONFIGURACIÓN DEL PORTAL CAUTIVO (WiFiManager)
// ============================================================================

/**
 * Callback cuando WiFiManager entra en modo AP (portal cautivo).
 */
void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("[WIFI] Modo configuración activado.");
  Serial.print("[WIFI] Conéctate a la red: "); Serial.println(AP_NAME);
  Serial.print("[WIFI] Contraseña: "); Serial.println(AP_PASSWORD);
  Serial.print("[WIFI] IP del portal: "); Serial.println(WiFi.softAPIP());
  Serial.println("[WIFI] Abre http://192.168.4.1 en tu navegador.");
}

// ============================================================================
// SETUP — Inicialización del firmware
// ============================================================================

void setup() {
  // Iniciar Serial
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("╔═════════════════════════════════════════╗");
  Serial.println("║   NEUROSENSE ESP8266 FIRMWARE v1.0.0    ║");
  Serial.println("║   Sensor Data Transmitter               ║");
  Serial.println("╚═════════════════════════════════════════╝");
  Serial.println();

  // Configurar LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH); // Apagado (activo bajo)

  // Iniciar semilla aleatoria con ruido analógico
  randomSeed(analogRead(A0) + micros());

  // ---- Estado: SETUP ----
  transitionTo(STATE_SETUP);

  // Cargar token desde EEPROM
  tokenLoaded = loadTokenFromEEPROM();
  if (tokenLoaded) {
    Serial.println("[SETUP] Token encontrado en EEPROM.");
  } else {
    Serial.println("[SETUP] No hay token en EEPROM. Necesitas configurarlo.");
    Serial.println("[SETUP] Envía el token por Serial (64 caracteres hex) para configurar.");
  }

  // ---- Estado: WIFI_CONNECTING ----
  transitionTo(STATE_WIFI_CONNECTING);

  // Configurar WiFiManager
  wifiManager.setAPCallback(configModeCallback);
  wifiManager.setConfigPortalTimeout(PORTAL_TIMEOUT);
  wifiManager.setConnectTimeout(30);

  // Intentar conectar con credenciales guardadas o abrir portal
  Serial.println("[WIFI] Intentando conectar a la red guardada...");
  bool connected = wifiManager.autoConnect(AP_NAME, AP_PASSWORD);

  if (connected) {
    transitionTo(STATE_WIFI_CONNECTED);
    Serial.print("[WIFI] Conectado a: "); Serial.println(WiFi.SSID());
    Serial.print("[WIFI] IP asignada: "); Serial.println(WiFi.localIP());
    Serial.print("[WIFI] RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
    Serial.print("[WIFI] Gateway: "); Serial.println(WiFi.gatewayIP());
    Serial.print("[WIFI] DNS: "); Serial.println(WiFi.dnsIP());

    // Verificar si hay token
    if (tokenLoaded) {
      transitionTo(STATE_PROVISIONED);
      Serial.println("[SETUP] Dispositivo listo para enviar datos.");
      transitionTo(STATE_SENDING_DATA);
    } else {
      Serial.println("[SETUP] Esperando configuración del auth_token...");
      Serial.println("[SETUP] Envía el token (64 hex chars) por la consola Serial.");
    }
  } else {
    Serial.println("[WIFI] No se pudo conectar. Reiniciando en 5 segundos...");
    delay(5000);
    ESP.restart();
  }

  Serial.println();
  Serial.println("[SETUP] Inicialización completada.");
  Serial.println("─────────────────────────────────────");
}

// ============================================================================
// LOOP — Bucle principal con máquina de estados
// ============================================================================

void loop() {
  unsigned long now = millis();

  // Actualizar LED indicador
  updateStatusLED();

  // ---- Verificación periódica de WiFi ----
  if (now - lastWifiCheckTime >= WIFI_CHECK_MS) {
    lastWifiCheckTime = now;

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] Conexión perdida. Intentando reconectar...");

      if (currentState == STATE_SENDING_DATA) {
        transitionTo(STATE_WIFI_CONNECTING);
      }

      WiFi.reconnect();

      // Esperar reconexión (máximo 15 segundos, non-blocking check)
      int retries = 0;
      while (WiFi.status() != WL_CONNECTED && retries < 30) {
        delay(500);
        Serial.print(".");
        retries++;
      }
      Serial.println();

      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[WIFI] Reconectado exitosamente.");
        Serial.print("[WIFI] IP: "); Serial.println(WiFi.localIP());

        if (tokenLoaded) {
          transitionTo(STATE_SENDING_DATA);
        } else {
          transitionTo(STATE_WIFI_CONNECTED);
        }
      } else {
        Serial.println("[WIFI] Reconexión fallida. Se reintentará...");
        transitionTo(STATE_ERROR);
      }
    }
  }

  // ---- Lectura de Serial para configurar token ----
  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n');
    input.trim();

    // Comando: RESET — Borra WiFi y token, reinicia
    if (input.equalsIgnoreCase("RESET")) {
      Serial.println("[CMD] Reseteando dispositivo...");
      clearTokenFromEEPROM();
      wifiManager.resetSettings();
      delay(1000);
      ESP.restart();
      return;
    }

    // Comando: STATUS — Muestra estadísticas
    if (input.equalsIgnoreCase("STATUS")) {
      printStats();
      return;
    }

    // Comando: TOKEN — Muestra el token actual (parcial)
    if (input.equalsIgnoreCase("TOKEN")) {
      if (tokenLoaded) {
        Serial.print("[TOKEN] Actual: ");
        Serial.print(authToken[0]); Serial.print(authToken[1]);
        Serial.print(authToken[2]); Serial.print(authToken[3]);
        Serial.println("...[truncado]");
      } else {
        Serial.println("[TOKEN] No hay token configurado.");
      }
      return;
    }

    // Comando: CLEAR — Borra solo el token
    if (input.equalsIgnoreCase("CLEAR")) {
      clearTokenFromEEPROM();
      if (currentState == STATE_SENDING_DATA) {
        transitionTo(STATE_WIFI_CONNECTED);
      }
      Serial.println("[CMD] Token borrado. Envía un nuevo token para continuar.");
      return;
    }

    // Si el input tiene 64 caracteres hex, tratarlo como token
    if (input.length() == TOKEN_LENGTH) {
      bool validHex = true;
      for (unsigned int i = 0; i < input.length(); i++) {
        char c = input.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
          validHex = false;
          break;
        }
      }

      if (validHex) {
        input.toCharArray(authToken, TOKEN_LENGTH + 1);
        saveTokenToEEPROM(authToken);
        tokenLoaded = true;

        Serial.println("[TOKEN] Token configurado exitosamente.");
        Serial.print("[TOKEN] Guardado: ");
        Serial.print(authToken[0]); Serial.print(authToken[1]);
        Serial.print(authToken[2]); Serial.print(authToken[3]);
        Serial.println("...[truncado]");

        if (WiFi.status() == WL_CONNECTED) {
          transitionTo(STATE_PROVISIONED);
          Serial.println("[TOKEN] WiFi conectado. Iniciando transmisión de datos...");
          transitionTo(STATE_SENDING_DATA);
        }
        return;
      }
    }

    Serial.println("[CMD] Comando no reconocido. Comandos disponibles:");
    Serial.println("  <token_64_hex>  — Configurar auth_token (64 caracteres hex)");
    Serial.println("  STATUS          — Mostrar estadísticas de sesión");
    Serial.println("  TOKEN           — Mostrar token actual (parcial)");
    Serial.println("  CLEAR           — Borrar auth_token");
    Serial.println("  RESET           — Reset completo (WiFi + token + reinicio)");
  }

  // ---- Envío periódico de datos ----
  if (currentState == STATE_SENDING_DATA && now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;

    bool success = sendSensorData();

    if (!success && packetsFailed > 10 && packetsFailed > packetsOk) {
      Serial.println("[ERROR] Demasiados errores consecutivos. Verificar backend y token.");
      // No transicionar a error, seguir intentando
    }

    // Imprimir estadísticas cada 10 paquetes
    if (packetsSent > 0 && packetsSent % 10 == 0) {
      printStats();
    }
  }

  // ---- Heartbeat en estados de espera ----
  if (currentState == STATE_WIFI_CONNECTED && !tokenLoaded) {
    static unsigned long lastReminder = 0;
    if (now - lastReminder >= 15000) {
      lastReminder = now;
      Serial.println("[WAIT] Esperando auth_token por Serial...");
      Serial.println("[WAIT] Envía tu token de 64 caracteres hex desde el dashboard.");
    }
  }

  // ---- Recuperación de error ----
  if (currentState == STATE_ERROR) {
    static unsigned long lastRetry = 0;
    if (now - lastRetry >= 5000) {
      lastRetry = now;
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("[RECOVER] WiFi restaurado.");
        if (tokenLoaded) {
          transitionTo(STATE_SENDING_DATA);
        } else {
          transitionTo(STATE_WIFI_CONNECTED);
        }
      }
    }
  }

  // Yield para el watchdog del ESP8266
  yield();
}
