# NeuroSense ESP8266 Firmware — Guía Completa

## Requisitos de Hardware

- **ESP8266** (NodeMCU v1.0, Wemos D1 Mini, o compatible)
- Cable USB Micro-B (datos, no solo carga)

## Opción A: Flashear con Arduino IDE

### 1. Instalar el Board Package ESP8266

1. Abre Arduino IDE → **Archivo** → **Preferencias**
2. En "Gestor de URLs Adicionales de Tarjetas", agrega:
   ```
   https://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Ve a **Herramientas** → **Placa** → **Gestor de Tarjetas**
4. Busca "ESP8266" e instala **esp8266 by ESP8266 Community**

### 2. Instalar Librerías

Ve a **Herramientas** → **Administrar Bibliotecas** e instala:

| Librería       | Autor           | Versión  |
|----------------|-----------------|----------|
| WiFiManager    | tzapu           | 2.0.17+  |
| ArduinoJson    | Benoit Blanchon | 7.x      |

### 3. Configurar

1. Abre `firmware/neurosense_esp8266/neurosense_esp8266.ino`
2. **Edita `BACKEND_URL`** con la URL de tu backend:
   - Local: `http://192.168.1.100:3000`
   - Producción: `https://tu-app.vercel.app`

### 4. Subir

1. Conecta el ESP8266 por USB
2. Selecciona:
   - **Placa**: NodeMCU 1.0 (ESP-12E Module)
   - **Puerto**: El COM/tty correspondiente
   - **Upload Speed**: 115200
3. Click en **Subir** (→)

### 5. Verificar

1. Abre **Monitor Serie** (115200 baud)
2. Deberás ver:
   ```
   ╔═════════════════════════════════════════╗
   ║   NEUROSENSE ESP8266 FIRMWARE v1.0.0    ║
   ║   Sensor Data Transmitter               ║
   ╚═════════════════════════════════════════╝
   ```

---

## Opción B: Flashear con PlatformIO

```bash
cd firmware/

# Compilar y subir (NodeMCU)
pio run -e nodemcu -t upload

# O para Wemos D1 Mini
pio run -e d1_mini -t upload

# Monitor Serial
pio device monitor -b 115200
```

---

## Configuración WiFi (Primera vez)

1. Al encender por primera vez, el ESP crea una red WiFi:
   - **SSID**: `NeuroSense-Setup`
   - **Contraseña**: `neurosense123`
2. Conéctate desde tu teléfono/PC
3. Se abrirá automáticamente un portal cautivo (o ve a `http://192.168.4.1`)
4. Selecciona tu red WiFi e ingresa la contraseña
5. El ESP se reiniciará y conectará a tu red

---

## Configuración del Auth Token

El token se obtiene al provisionar un dispositivo desde el dashboard de NeuroSense.

### Desde Serial Monitor:

1. Abre el Monitor Serie (115200 baud)
2. Pega el token de 64 caracteres hex que obtuviste del dashboard
3. Presiona Enter
4. Verás: `[TOKEN] Token configurado exitosamente.`
5. El ESP comenzará a enviar datos automáticamente

### Comandos Serial disponibles:

| Comando  | Descripción                                   |
|----------|-----------------------------------------------|
| `<token>`| Configura el auth_token (64 caracteres hex)   |
| `STATUS` | Muestra estadísticas de la sesión             |
| `TOKEN`  | Muestra el token actual (parcial, seguro)     |
| `CLEAR`  | Borra el token de la EEPROM                   |
| `RESET`  | Borra WiFi + token y reinicia el dispositivo  |

---

## Verificar Envío de Datos

### En el Serial Monitor verás:

```
─────────────────────────────────────
[DATA] Paquete #1
[DATA] GSR=0.352 | Sound=78.3 | Accel=(12.5, -8.3, 1031.0)
[HTTP] POST → https://tu-app.vercel.app/api/v1/data
[HTTP] Código: 200
[HTTP] Tiempo de respuesta: 245ms
[RESP] Estrés: 32.1%
[RESP] Alertas nuevas: 0
[RESP] Latencia servidor: 12ms
```

### Cada 10 paquetes se muestran estadísticas:

```
┌─────────────────────────────────────┐
│       ESTADÍSTICAS DE SESIÓN         │
├─────────────────────────────────────┤
│ Paquetes enviados:    10
│ Paquetes exitosos:    10
│ Paquetes fallidos:    0
│ Alertas generadas:    0
│ Último estrés:        32.1%
│ RSSI WiFi:            -45 dBm
│ IP local:             192.168.1.105
│ Uptime:               22s
│ Tasa de éxito:        100.0%
└─────────────────────────────────────┘
```

---

## Probar contra el Backend Next.js

### Opción 1: Backend local

```bash
# En el directorio del proyecto Next.js
pnpm dev
# → http://localhost:3000
```

Edita `BACKEND_URL` en el firmware:
```cpp
#define BACKEND_URL "http://TU_IP_LOCAL:3000"
```

### Opción 2: Backend en Vercel

Edita `BACKEND_URL`:
```cpp
#define BACKEND_URL "https://tu-proyecto.vercel.app"
```

### Verificar en el Dashboard

1. Inicia sesión en tu app NeuroSense
2. Ve a **Dashboard** → **Dispositivos**
3. El dispositivo debería aparecer como "En línea"
4. Los datos aparecerán en tiempo real en las gráficas

### Verificar con curl (debug)

```bash
curl -X POST https://tu-app.vercel.app/api/v1/data \
  -H "Content-Type: application/json" \
  -d '{
    "auth_token": "TU_TOKEN_AQUI",
    "gsr": 0.45,
    "sound": 85.0,
    "accel_x": 10.5,
    "accel_y": -5.2,
    "accel_z": 1024.0,
    "sent_at": 1700000000000
  }'
```

---

## Indicador LED

| Patrón LED              | Estado                           |
|-------------------------|----------------------------------|
| Parpadeo muy rápido     | Inicializando                    |
| Parpadeo rápido (250ms) | Conectando a WiFi                |
| Parpadeo medio (500ms)  | WiFi OK, esperando token         |
| Parpadeo lento (1s)     | Provisionado, preparando envío   |
| Destello cada 2s        | Enviando datos activamente       |
| Parpadeo rápido (150ms) | Error (reconectando)             |

---

## Solución de Problemas

| Problema                          | Solución                                                    |
|-----------------------------------|-------------------------------------------------------------|
| No aparece el puerto COM/tty      | Instala drivers CH340G o CP2102 según tu board              |
| Portal cautivo no aparece         | Envía `RESET` por Serial o mantén FLASH 10s                 |
| Error 401 (Token inválido)        | Verifica el token en el dashboard, envía uno nuevo           |
| Error de conexión HTTP            | Verifica `BACKEND_URL`, asegúrate de que el backend esté up  |
| WiFi se desconecta frecuentemente | Acerca el ESP al router, verifica RSSI con `STATUS`          |
| No compila en Arduino IDE         | Verifica versiones de librerías y board package              |
