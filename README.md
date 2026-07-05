# MiaDeviceOS / FactoryBox One

MiaDeviceOS is a modular ESP32 firmware platform for industrial IoT devices.
FactoryBox One is the first product built on top of this platform.

Current release:

```text
Firmware version: 2.10.0
Release type: FactoryBox Pilot Release
Build type: production
Device model: MiaDeviceOS-LaserMonitor
Device ID: laser01
Platform: esp32-arduino
```

## Product direction

```text
MiaDeviceOS       → Device operating system
FactoryBox One    → First commercial product for laser/CNC workshops
SmartBox Platform → Long-term modular industrial IoT platform
SmartFlows        → n8n automation packs
SmartAI           → Natural-language operational reporting
SmartDashboard    → Future web/mobile control panel
```

## Current capabilities

- WiFi and MQTT connection management
- Remote configuration and validation
- Telemetry, heartbeat, alarm lifecycle
- MQTT Command Engine
- OTA update flow
- BLE service mode with service PIN authentication
- Runtime log level control and persistence
- Production health monitoring
- Watchdog and boot diagnostics
- Field reliability layer
- Machine runtime tracker
- Daily runtime summary for n8n reporting
- Digital input runtime driver for DI1
- Persistent machine input source selection
- n8n daily report flow
- n8n stop alert flow with one-time anti-spam logic
- Pilot wiring and panel safety documentation

## FactoryBox One MVP scope

The first pilot product focuses on only four core outcomes:

```text
1. Is the machine running?
2. Did the machine stop?
3. How long did it run today?
4. Send Telegram / WhatsApp-ready operational reports.
```

## MQTT base topic

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

## Main commands for pilot test

Publish commands to:

```text
mia/site01/laser01/command
```

```json
{ "command": "get_config", "request_id": "pilot-config-001" }
```

```json
{ "command": "get_health", "request_id": "pilot-health-001" }
```

```json
{ "command": "get_diagnostics", "request_id": "pilot-diag-001" }
```

```json
{ "command": "get_reliability", "request_id": "pilot-rel-001" }
```

```json
{ "command": "get_machine_runtime", "request_id": "pilot-machine-001" }
```

```json
{ "command": "get_daily_summary", "request_id": "pilot-daily-001" }
```

```json
{ "command": "get_digital_inputs", "request_id": "pilot-di-001" }
```

```json
{ "command": "get_runtime_settings", "request_id": "pilot-settings-001" }
```

## Pilot input strategy

FactoryBox One will detect machine runtime in this order:

```text
1. DI1 machine RUN signal, when available
2. AUTO_CURRENT / current threshold detection, when RUN signal is not available
3. Modbus / PLC integration in later versions
```

Safety rule:

```text
Never connect 220V / 380V / 24V panel voltage directly to ESP32 GPIO.
Use dry contact, relay contact, optocoupler, or an isolated input module.
```

## Local secrets

Real WiFi and MQTT credentials must stay local in:

```text
include/secrets.h
```

Use `include/secrets.example.h` as the template.

## Build

```text
PlatformIO > esp32dev > General > Build
```

## Upload

```text
PlatformIO > esp32dev > General > Upload
```

## Monitor

```text
PlatformIO > esp32dev > Platform > Monitor
```

Expected boot identifiers:

```text
MiaDeviceOS v2.10.0
Machine runtime input source: AUTO_CURRENT or DI1
Digital input manager basladi. DI1 pin: 27
MQTT baglaniyor... BAGLANDI
Command topic dinleniyor.
```

## Key documentation

```text
docs/FACTORYBOX_PILOT_RELEASE.md
docs/V2_FINAL_SMOKE_TEST.md
docs/V2_RELEASE_NOTES.md
docs/SMARTFLOWS_N8N_WORKFLOWS.md
docs/FACTORYBOX_PILOT_WIRING_PLAN.md
docs/DI1_WIRING_GUIDE.md
docs/PILOT_PANEL_SAFETY_CHECKLIST.md
docs/FACTORYBOX_IO_TERMINAL_PLAN.md
```
