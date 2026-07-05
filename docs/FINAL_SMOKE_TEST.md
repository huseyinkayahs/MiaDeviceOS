# MiaDeviceOS v2.0 Final Smoke Test

## Purpose

This checklist validates the Field Prototype Release before tagging `v2.0.0`.

The goal is not to add a new feature. The goal is to confirm that the firmware is stable enough for field prototype use.

## Firmware

```text
Expected firmware_version: 2.0.0
Expected build_type: production
Expected device_id: laser01
Expected platform_name: esp32-arduino
```

## MQTT Command Topic

Publish all commands to:

```text
mia/site01/laser01/command
```

## Test 1 — get_config

Payload:

```json
{
  "command": "get_config",
  "request_id": "v20-config-001"
}
```

Expected:

```text
status: done
firmware_version: 2.0.0
config returned
```

## Test 2 — get_health

Payload:

```json
{
  "command": "get_health",
  "request_id": "v20-health-001"
}
```

Expected fields:

```text
health.status
health.boot_count
health.reset_reason
health.free_heap
health.wifi_connected
health.mqtt_connected
health.field_reliability_score
health.watchdog.setup_ok
```

## Test 3 — get_diagnostics

Payload:

```json
{
  "command": "get_diagnostics",
  "request_id": "v20-diag-001"
}
```

Expected fields:

```text
wifi
mqtt
runtime
watchdog
field_reliability
alarm
ble
ota
log
sensor
```

Expected result:

```text
Command status gonderildi
```

If the monitor says `Command status gonderilemedi`, MQTT buffer size must be checked.

## Test 4 — get_reliability

Payload:

```json
{
  "command": "get_reliability",
  "request_id": "v20-rel-001"
}
```

Expected fields:

```text
status
issue
score
wifi_drop_events
mqtt_drop_events
wifi_offline_ms
mqtt_offline_ms
watchdog_setup_ok
```

Note: `status: ALARM` and `issue: ALARM_ACTIVE` are expected while the simulated current value is above the current limit.

## Test 5 — get_watchdog

Payload:

```json
{
  "command": "get_watchdog",
  "request_id": "v20-watchdog-001"
}
```

Expected fields:

```text
enabled: true
supported: true
setup_ok: true
timeout_sec: 30
feed_count increasing
```

## Test 6 — get_boot_diagnostics

Payload:

```json
{
  "command": "get_boot_diagnostics",
  "request_id": "v20-boot-001"
}
```

Expected fields:

```text
boot_count
reset_reason
started_at_ms
free_heap
min_free_heap
health_status
watchdog
```

## Test 7 — get_log_level

Payload:

```json
{
  "command": "get_log_level",
  "request_id": "v20-log-001"
}
```

Expected:

```text
log_level: INFO
persistent: true
```

## Test 8 — set_log_level DEBUG then INFO

Payload:

```json
{
  "command": "set_log_level",
  "request_id": "v20-log-002",
  "level": "DEBUG"
}
```

Expected:

```text
log_level: DEBUG
persistent: true
```

Return to production setting:

```json
{
  "command": "set_log_level",
  "request_id": "v20-log-003",
  "level": "INFO"
}
```

Expected:

```text
log_level: INFO
persistent: true
```

## Test 9 — get_runtime_settings

Payload:

```json
{
  "command": "get_runtime_settings",
  "request_id": "v20-runtime-001"
}
```

Expected:

```text
log_level: INFO
log_level_persistent: true
```

## Test 10 — OTA reject safety test

Payload:

```json
{
  "command": "ota_update",
  "request_id": "v20-ota-reject-001"
}
```

Expected:

```text
status: rejected
message: Missing OTA URL
```

## Test 11 — restart and health verification

Payload:

```json
{
  "command": "restart",
  "request_id": "v20-restart-001"
}
```

After reboot, run:

```json
{
  "command": "get_health",
  "request_id": "v20-health-002"
}
```

Expected:

```text
boot_count increased
reset_reason: SOFTWARE_RESET
```

## Pass Criteria

The release can be tagged only when these are true:

```text
Build success
Upload success
Boot success
MQTT connected
All command responses returned
Diagnostics MQTT payload sent successfully
Log level returned to INFO
Restart verified
secrets.h not visible in git status
```
