# MiaDeviceOS

MiaDeviceOS is a modular ESP32 firmware platform for industrial IoT devices.

Current target device:

```text
Device model: MiaDeviceOS-LaserMonitor
Device ID: laser01
Firmware version: 1.0.0
Build type: production
Hardware revision: prototype
```

## Current capabilities

- WiFi connection management
- MQTT connection management
- Remote configuration over MQTT
- Config validation and config status reporting
- Telemetry publishing
- Heartbeat publishing
- Alarm lifecycle and alarm publishing
- MQTT Command Engine
- MQTT-triggered OTA update
- OLED boot/status display
- Persistent configuration storage
- Local secrets file for WiFi/MQTT credentials
- Centralized MQTT topic definitions

## Architecture principle

The firmware follows a manager-based structure.

```text
App Layer
├─ WiFiManager
├─ MQTTManager
├─ ConfigManager
├─ StorageManager
├─ SensorManager
├─ TelemetryManager
├─ AlarmManager
├─ AlarmPublisher
├─ HeartbeatManager
├─ CommandManager
├─ OTAManager
└─ DisplayManager
        ↓
  DeviceContext
```

Main rule:

```text
Managers do not call each other directly.
Shared state is kept in DeviceContext.
```

## Project structure

```text
include/
  app_version.h
  device_context.h
  device_config.h
  device_state.h
  mqtt_topics.h
  secrets.example.h
  *_manager.h

src/
  app.cpp
  main.cpp
  *_manager.cpp

platformio.ini
README.md
docs/OPERATING_GUIDE.md
```

## Local secrets setup

The real WiFi and MQTT credentials must not be committed to GitHub.

Create this file locally:

```text
include/secrets.h
```

Use this template:

```cpp
#pragma once

#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define MQTT_SERVER "broker.emqx.io"
#define MQTT_PORT 1883

#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
```

`include/secrets.h` is ignored by Git.

## Build

Use PlatformIO.

```powershell
pio run
```

Or from VS Code:

```text
PlatformIO > esp32dev > General > Build
```

## Upload

```text
PlatformIO > esp32dev > General > Upload
```

## Serial monitor

```text
PlatformIO > esp32dev > Platform > Monitor
```

Expected boot output:

```text
MiaDeviceOS v1.0.0
Model: MiaDeviceOS-LaserMonitor
Build: production
Device ID: laser01
WiFi baglandi
MQTT baglaniyor... BAGLANDI
Config topic dinleniyor.
Command topic dinleniyor.
```

## MQTT topics

Base topic:

```text
mia/site01/laser01
```

Important topics:

```text
mia/site01/laser01/config
mia/site01/laser01/config/status
mia/site01/laser01/command
mia/site01/laser01/command/status
mia/site01/laser01/telemetry
mia/site01/laser01/heartbeat
mia/site01/laser01/alarm
mia/site01/laser01/ota/status
```

All topic definitions are centralized in:

```text
include/mqtt_topics.h
```

## Commands

Publish commands to:

```text
mia/site01/laser01/command
```

### get_config

```json
{
  "command": "get_config",
  "request_id": "cmd-001"
}
```

### reset_alarm

```json
{
  "command": "reset_alarm",
  "request_id": "cmd-002"
}
```

### restart

```json
{
  "command": "restart",
  "request_id": "cmd-003"
}
```

### ota_update

```json
{
  "command": "ota_update",
  "request_id": "ota-001",
  "url": "http://192.168.1.2:8000/firmware.bin",
  "version": "1.0.0-test"
}
```

## Remote config

Publish config messages to:

```text
mia/site01/laser01/config
```

Example:

```json
{
  "device_id": "laser01",
  "current_limit": 12,
  "temperature_limit": 30,
  "repeat_if_continues_min": 1,
  "normal_send_interval_sec": 10,
  "over_current_delay_sec": 5,
  "heartbeat_interval_sec": 30,
  "wifi_connect_timeout_sec": 15,
  "wifi_reconnect_interval_sec": 10,
  "mqtt_reconnect_interval_sec": 5
}
```

Config result is published to:

```text
mia/site01/laser01/config/status
```

## Config validation ranges

```text
current_limit: 1-200
temperature_limit: 1-120
repeat_if_continues_min: 1-1440
normal_send_interval_sec: 5-3600
over_current_delay_sec: 1-300
heartbeat_interval_sec: 5-3600
wifi_connect_timeout_sec: 3-120
wifi_reconnect_interval_sec: 3-300
mqtt_reconnect_interval_sec: 3-300
```

Invalid config is rejected and the previous config remains active.

## OTA update

Local OTA test flow:

```text
1. Build firmware.
2. Start local HTTP server from .pio/build/esp32dev.
3. Send ota_update command with firmware.bin URL.
4. ESP32 downloads firmware.bin over WiFi.
5. ESP32 writes firmware and restarts.
```

Start HTTP server using PlatformIO Python:

```powershell
cd ".pio\build\esp32dev"
& "$env:USERPROFILE\.platformio\penv\Scripts\python.exe" -m http.server 8000 --bind 0.0.0.0
```

Example OTA URL:

```text
http://192.168.1.2:8000/firmware.bin
```

## Current known limitations

- Current sensor is still simulated.
- SCT013 / real sensor driver will be implemented later.
- OTA has been tested on local network only.
- BLE Service Mode is planned for future service/setup operations.
- Hardware revision is currently `prototype`.

## Development workflow

```text
Sprint
↓
Build
↓
Upload
↓
Monitor test
↓
MQTT regression test
↓
Commit
↓
Push
```

Commit style examples:

```text
feat(...)
fix(...)
refactor(...)
chore(...)
docs(...)
```

## Platform Abstraction

MiaDeviceOS is prepared for future hardware targets with a small platform boundary.
See `docs/PLATFORM_ABSTRACTION.md`.
