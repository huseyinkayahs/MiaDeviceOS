# MiaDeviceOS v1.7 Production Hardening

## Purpose

This sprint adds a small production health layer for field prototype usage.
The goal is to make the device easier to inspect after a restart or during remote support.

## Added Features

### Production Health Monitor

The firmware now keeps a lightweight production health state in `DeviceContext`.

Tracked values:

```text
boot_count
reset_reason
health_status
free_heap
min_free_heap
low_heap_warning
low_heap_warning_count
wifi_connected
mqtt_connected
alarm_active
ota_in_progress
```

### Boot Count

`boot_count` is stored persistently.
It increases by 1 at every boot.

This helps identify whether the device is restarting unexpectedly in the field.

### Reset Reason

The device records the ESP32 reset reason at boot.

Examples:

```text
POWER_ON
SOFTWARE_RESET
BROWNOUT
TASK_WATCHDOG
PANIC_RESET
UNKNOWN
```

### get_health Command

Publish to:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_health",
  "request_id": "health-001"
}
```

Response comes from:

```text
mia/site01/laser01/command/status
```

Example response:

```json
{
  "device_id": "laser01",
  "request_id": "health-001",
  "command": "get_health",
  "status": "done",
  "message": "Health returned",
  "firmware_version": "1.7.0",
  "platform_name": "esp32-arduino",
  "health": {
    "status": "ALARM",
    "boot_count": 4,
    "reset_reason": "SOFTWARE_RESET",
    "free_heap": 63000,
    "min_free_heap": 33000,
    "low_heap_threshold": 30000,
    "low_heap_warning": false,
    "low_heap_warning_count": 0,
    "wifi_connected": true,
    "mqtt_connected": true,
    "alarm_active": true,
    "ota_in_progress": false
  }
}
```

## Health Status Values

```text
OK       No major issue detected
WARN     WiFi/MQTT disconnected or low heap warning active
OTA      OTA update is in progress
ALARM    Alarm is currently active
```

In the current simulated sensor setup, `ALARM` is expected when simulated current is above the configured current limit.

## Diagnostics Integration

`get_diagnostics` now includes production health fields under `runtime`:

```json
"runtime": {
  "boot_count": 4,
  "reset_reason": "SOFTWARE_RESET",
  "health_status": "ALARM",
  "low_heap_threshold": 30000,
  "low_heap_warning": false,
  "low_heap_warning_count": 0
}
```

## Heartbeat Integration

Heartbeat now includes:

```text
health_status
boot_count
reset_reason
```

## Notes

- v1.8 adds watchdog support and boot diagnostics on top of this production health layer.
- Sensor is still simulated.
