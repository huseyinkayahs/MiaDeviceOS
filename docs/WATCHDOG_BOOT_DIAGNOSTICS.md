# MiaDeviceOS v1.8 Watchdog + Boot Diagnostics

## Purpose

This sprint adds a lightweight watchdog layer and a boot diagnostics command.
The goal is to make the field prototype safer when the firmware loop gets stuck and easier to inspect after restarts.

## Added Features

### Watchdog Manager

New files:

```text
include/watchdog_context.h
include/watchdog_manager.h
src/watchdog_manager.cpp
```

The watchdog manager:

```text
sets up the ESP32 task watchdog
feeds it from the main app loop
tracks feed count
returns watchdog status over MQTT
```

Default values:

```text
timeout_sec: 30
feed_interval_ms: 1000
```

### Platform Abstraction

Watchdog operations are placed behind `MiaPlatform`.

New platform functions:

```text
watchdogSupported()
setupWatchdog(timeoutSec)
feedWatchdog()
```

This keeps ESP32-specific watchdog code inside the platform layer.

### Boot Output

Serial boot output now includes:

```text
Watchdog: ENABLED
Watchdog Timeout Sec: 30
```

### get_watchdog Command

Publish to:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_watchdog",
  "request_id": "wd-001"
}
```

Expected response includes:

```text
enabled
supported
setup_ok
timeout_sec
feed_interval_ms
feed_count
last_feed_ms
```

### get_boot_diagnostics Command

Publish to:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_boot_diagnostics",
  "request_id": "boot-001"
}
```

Expected response includes:

```text
boot_count
reset_reason
free_heap
min_free_heap
sketch_size
free_sketch
health_status
watchdog setup state
```

### Diagnostics Integration

`get_diagnostics` now includes a `watchdog` section:

```json
"watchdog": {
  "enabled": true,
  "supported": true,
  "setup_ok": true,
  "timeout_sec": 30,
  "feed_interval_ms": 1000,
  "feed_count": 10,
  "last_feed_ms": 25000
}
```

### Heartbeat Integration

Heartbeat now includes:

```text
watchdog_enabled
watchdog_setup_ok
watchdog_feed_count
```

## Test Plan

1. Build firmware.
2. Upload firmware.
3. Confirm boot output shows `MiaDeviceOS v1.8.1`.
4. Confirm boot output shows `Watchdog: ENABLED`.
5. Send `get_watchdog` command.
6. Send `get_boot_diagnostics` command.
7. Send `get_diagnostics` and confirm watchdog section exists.
8. Send `restart`, then `get_boot_diagnostics` again.
9. Confirm `boot_count` increased and `reset_reason` is `SOFTWARE_RESET`.

## Notes

- Do not intentionally hang the device during normal testing.
- If the application loop blocks longer than the watchdog timeout, ESP32 should reset.
- Current sensor is still simulated.

## MQTT Publish Buffer

Diagnostics payloads grew after watchdog and boot diagnostics were added.
MQTT publish buffer is set to 4096 bytes so large command status payloads such as `get_diagnostics` can be published reliably.
