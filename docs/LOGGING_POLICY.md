# MiaDeviceOS Logging Policy

## Purpose

Serial Monitor output should stay readable during service and field testing.

MQTT, BLE, telemetry, heartbeat and alarm functions continue to run normally.
This policy only reduces repeated Serial output.

## Logged Events

Serial logs should focus on state changes and operator actions:

- Boot information
- WiFi connected / disconnected / timeout
- MQTT connected / failed
- MQTT command/config messages received
- Config accepted / rejected
- Alarm started / cleared / reset
- BLE client connected / disconnected
- BLE commands accepted / rejected
- OTA started / failed / completed

## Suppressed Repeated Logs

The following repeated status logs are intentionally not printed every cycle:

- Telemetry published payload
- Heartbeat published payload
- BLE status characteristic periodic update

## Rationale

Telemetry, heartbeat and BLE status can still be observed through MQTT, BLE, or external tooling.
Keeping Serial focused on changes makes debugging easier and reduces operator confusion.
