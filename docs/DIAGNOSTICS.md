# MiaDeviceOS Diagnostics

## Purpose

The diagnostics command gives a compact service report over MQTT.
It is intended for field checks, debugging, and remote support.

## MQTT Command

Publish to:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_diagnostics",
  "request_id": "diag-001"
}
```

## Response Topic

Diagnostics are returned on the normal command status topic:

```text
mia/site01/laser01/command/status
```

## Response Content

The response includes:

- device id
- firmware version
- platform name
- WiFi status and RSSI
- MQTT status and reconnect counters
- runtime memory information
- alarm status
- BLE service status
- OTA state
- current simulated sensor values

## Example Response

```json
{
  "device_id": "laser01",
  "request_id": "diag-001",
  "command": "get_diagnostics",
  "status": "done",
  "message": "Diagnostics returned",
  "firmware_version": "1.4.0",
  "platform_name": "esp32-arduino",
  "wifi": {
    "connected": true,
    "rssi": -55,
    "reconnects": 1
  },
  "mqtt": {
    "connected": true,
    "reconnects": 1,
    "failures": 0
  },
  "alarm": {
    "active": true,
    "type": "OVER_CURRENT"
  }
}
```

## Notes

The payload is kept compact so it fits the MQTT buffer.
It is not a continuous telemetry stream; it is requested only when needed.
