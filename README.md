# MiaDeviceOS

MiaDeviceOS is a modular ESP32 firmware platform for industrial IoT devices.

Current target device:

```text
Device model: MiaDeviceOS-LaserMonitor
Device ID: laser01
Firmware version: 2.8.1
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
- BLE service mode with service PIN authentication
- Reduced serial logging for production readability
- Diagnostics command for service checks
- Runtime log level persistence
- Production health monitor
- Boot count and reset reason diagnostics
- Remote health check command
- ESP32 task watchdog setup and feed tracking
- Boot diagnostics command
- Field reliability layer
- Remote reliability check command
- FactoryBox One machine runtime tracker
- Digital input runtime driver for DI1
- Persistent machine input source memory

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
├─ WatchdogManager
├─ FieldReliabilityManager
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
docs/BLE_SERVICE_MODE.md
docs/LOGGING_POLICY.md
docs/DIAGNOSTICS.md
docs/WATCHDOG_BOOT_DIAGNOSTICS.md
docs/FIELD_RELIABILITY.md
docs/FINAL_SMOKE_TEST.md
docs/FIELD_TEST_CHECKLIST.md
docs/INPUT_SOURCE_PERSISTENCE.md
docs/RELEASE_NOTES_v2.0.md
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
MiaDeviceOS v2.7.0
Model: MiaDeviceOS-LaserMonitor
Build: production
Device ID: laser01
Log Level: INFO
Reset Reason: POWER_ON
Boot Count: 1
Watchdog: ENABLED
Watchdog Timeout Sec: 30
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
mia/site01/laser01/machine/status
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

### get_diagnostics

```json
{
  "command": "get_diagnostics",
  "request_id": "diag-001"
}
```

### get_health

```json
{
  "command": "get_health",
  "request_id": "health-001"
}
```

Returns production health information such as boot count, reset reason, heap status, WiFi/MQTT status, alarm state, OTA state, watchdog state, and field reliability state.

### get_reliability

```json
{
  "command": "get_reliability",
  "request_id": "rel-001"
}
```

Returns field reliability status, score, active issue, WiFi/MQTT drop counters, offline duration and warning counters.


### get_watchdog

```json
{
  "command": "get_watchdog",
  "request_id": "wd-001"
}
```

Returns watchdog state, timeout and feed counter.

### get_boot_diagnostics

```json
{
  "command": "get_boot_diagnostics",
  "request_id": "boot-001"
}
```

Returns boot count, reset reason, memory summary and watchdog boot state.

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
  "version": "2.0.0-test"
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

## BLE Service Mode

MiaDeviceOS includes a local BLE service mode for field/service checks.

BLE device name:

```text
MiaDeviceOS-laser01
```

Initial BLE commands:

```text
get_status
auth
reset_alarm
logout
```

Protected BLE commands require `BLE_SERVICE_PIN` from local `include/secrets.h`.

Detailed BLE documentation:

```text
docs/BLE_SERVICE_MODE.md
```


## v1.5 Diagnostics / Log Level

- `get_log_level` komutu eklendi.
- `set_log_level` komutu eklendi.
- Serial Monitor çıktısı ERROR / WARN / INFO / DEBUG seviyelerine ayrıldı.
- `get_diagnostics` cevabına aktif log level bilgisi eklendi.
- Detaylı açıklama: `docs/LOG_LEVELS.md`


## v1.6 Persistent Runtime Settings

- `set_log_level` komutu artık log seviyesini kalıcı olarak kaydeder.
- Cihaz restart sonrası son kaydedilen log level ile açılır.
- Yeni komut: `get_runtime_settings`.
- Detaylı açıklama: `docs/RUNTIME_SETTINGS.md`

Example:

```json
{
  "command": "get_runtime_settings",
  "request_id": "runtime-001"
}
```


## v1.7 Production Hardening

- Production health monitor added.
- Boot count is stored persistently.
- Reset reason is shown at boot and returned in diagnostics.
- Heartbeat now includes health status, boot count, and reset reason.
- New command: `get_health`.
- Low heap warning tracking added.
- Detailed explanation: `docs/PRODUCTION_HARDENING.md`

Example:

```json
{
  "command": "get_health",
  "request_id": "health-001"
}
```


## v1.8 Watchdog + Boot Diagnostics

- ESP32 task watchdog setup added through platform abstraction.
- Watchdog is fed from the main app loop.
- New command: `get_watchdog`.
- New command: `get_boot_diagnostics`.
- Diagnostics and health outputs now include watchdog state.
- Heartbeat includes watchdog status and feed count.
- Detailed explanation: `docs/WATCHDOG_BOOT_DIAGNOSTICS.md`

Example:

```json
{
  "command": "get_boot_diagnostics",
  "request_id": "boot-001"
}
```


## v1.9 Field Reliability Layer

- Field reliability manager added.
- New command: `get_reliability`.
- Diagnostics, health and heartbeat outputs include field reliability state.
- Tracks WiFi/MQTT drop events, offline duration, active issue, warning count and reliability score.
- Detailed explanation: `docs/FIELD_RELIABILITY.md`

Example:

```json
{
  "command": "get_reliability",
  "request_id": "rel-001"
}
```


## v2.0 Field Prototype Release

- Firmware version bumped to `2.0.0`.
- Added final smoke test documentation.
- Added field test checklist.
- Added release notes for Field Prototype Release.
- This release freezes the current platform layer before real sensor driver work.

Important docs:

```text
docs/FINAL_SMOKE_TEST.md
docs/FIELD_TEST_CHECKLIST.md
docs/INPUT_SOURCE_PERSISTENCE.md
docs/RELEASE_NOTES_v2.0.md
```

Suggested release tag after final smoke test:

```powershell
git tag -a v2.0.0 -m "MiaDeviceOS v2.0.0 field prototype release"
git push origin v2.0.0
```

## v2.2.0 FactoryBox One MVP Core

v2.2.0 ile MiaDeviceOS, FactoryBox One ürün mantığına geçmeye başladı.

Eklenen ana özellikler:

```text
Machine Runtime Tracker
RUNNING / STOPPED state takibi
Günlük çalışma süresi
Günlük duruş süresi
Makine durum MQTT yayını
Günlük rapor datası
n8n daily report payload dokümanı
Pilot kurulum planı
```

Yeni MQTT topic:

```text
mia/site01/laser01/machine/status
```

Yeni komutlar:

```text
get_machine_runtime
get_daily_summary
set_machine_state
reset_machine_runtime
```

Bu sürümde gerçek sensör zorunlu değildir. Sensör hazır olana kadar `set_machine_state` komutu ile RUNNING / STOPPED simülasyonu yapılabilir.

Detaylar:

```text
docs/MACHINE_RUNTIME_TRACKER.md
docs/FACTORYBOX_ONE_MVP_CORE.md
docs/N8N_DAILY_REPORT_PAYLOAD.md
docs/PILOT_INSTALLATION_PLAN.md
```


## v2.2.1 Machine Runtime Counter Hotfix

`longest_run_sec` hesaplamasında manuel RUNNING / STOPPED testleri sırasında görülebilen taşma değeri engellendi.

Düzeltme:

```text
longest_run_sec overflow koruması
state geçişinde segment istatistiğini güvenli kapatma
last_state_change_ms için güvenli elapsed hesaplama
Firmware 2.2.1
```


## v2.7 Digital Input Runtime Driver

v2.7 ile FactoryBox One, makine çalışma bilgisini DI1 dijital girişinden alabilecek hale geldi.

Varsayılan güvenli davranış:

```text
Makine runtime giriş kaynağı başlangıçta AUTO_CURRENT olarak kalır.
DI1 test veya saha kurulumunda komutla aktif edilir.
```

Yeni altyapı:

```text
DigitalInputManager
DI1 debounce okuma
DI1 simulation test modu
Machine Runtime için DI1 input source
```

DI1 varsayılan pin:

```text
GPIO27
INPUT_PULLUP
Active LOW
```

Yani kuru kontak / röle çıkışı DI1'i GND'ye çekerse DI1 aktif sayılır.

Yeni komutlar:

```text
get_digital_inputs
set_di1_simulation
set_machine_input_source
```

### get_digital_inputs

```json
{
  "command": "get_digital_inputs",
  "request_id": "di-001"
}
```

### set_machine_input_source

DI1'i makine runtime kaynağı yapmak için:

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-src-001",
  "source": "DI1"
}
```

Tekrar akım simülasyonuna dönmek için:

```json
{
  "command": "set_machine_input_source",
  "request_id": "di-src-002",
  "source": "AUTO_CURRENT"
}
```

### set_di1_simulation

DI1 aktif simülasyonu:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-001",
  "enabled": true,
  "active": true
}
```

DI1 pasif simülasyonu:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-002",
  "enabled": true,
  "active": false
}
```

Simülasyonu kapatmak için:

```json
{
  "command": "set_di1_simulation",
  "request_id": "di-sim-003",
  "enabled": false
}
```

Detaylar:

```text
docs/DIGITAL_INPUT_RUNTIME_DRIVER.md
```
