# MiaDeviceOS v2.0 Field Test Checklist

## Purpose

This document is used before placing the device into a field prototype environment.

## Hardware

```text
ESP32 board mounted safely
Power supply stable
OLED connected
WiFi antenna position acceptable
Laser monitor wiring not final until real sensor sprint
Enclosure ventilation checked
```

## Firmware

```text
Firmware version: 2.0.0
Build type: production
Device ID: laser01
Hardware revision: prototype
```

## Local Secrets

Confirm this file exists locally:

```text
include/secrets.h
```

Confirm it is not committed:

```powershell
git status
```

Expected:

```text
include/secrets.h must not be listed
```

## Network

```text
WiFi connects automatically
MQTT connects automatically
Config topic subscribed
Command topic subscribed
Telemetry is published
Heartbeat is published
Alarm topic is published
```

## MQTT Topics

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

## Service Commands

Minimum commands to verify:

```text
get_config
get_health
get_diagnostics
get_reliability
get_watchdog
get_boot_diagnostics
get_log_level
get_runtime_settings
restart
```

## BLE Service

```text
BLE device name: MiaDeviceOS-laser01
Service PIN required
auth works with local service PIN
reset_alarm protected by authentication
logout clears authentication
```

## Alarm Behavior

Current test condition:

```text
Sensor is simulated
Simulated current: 20
Default current limit: 12
Expected health/reliability status: ALARM
```

This is expected until the real sensor driver is implemented.

## Production Health

Check these values:

```text
boot_count increases after restart
reset_reason changes after software restart
low_heap_warning is false
watchdog setup_ok is true
field_reliability score is returned
WiFi/MQTT connected are true
```

## OTA Readiness

Minimum OTA safety check:

```text
ota_update without URL must be rejected
OTA status topic is available
No OTA update is in progress during normal field test
```

## Release Readiness

Before release tag:

```text
All smoke tests passed
Log level returned to INFO
No local secrets are staged
Git commit completed
Git push completed
Tag v2.0.0 created and pushed
```
