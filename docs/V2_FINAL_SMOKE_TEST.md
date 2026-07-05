# V2 Final Smoke Test

## Firmware

Expected firmware version:

```text
2.10.0
```

## Test order

Run these commands through MQTT Explorer.

Topic:

```text
mia/site01/laser01/command
```

---

## 1. get_config

```json
{ "command": "get_config", "request_id": "v210-config-001" }
```

Expected:

```text
firmware_version: 2.10.0
device_id: laser01
build_type: production
```

---

## 2. get_health

```json
{ "command": "get_health", "request_id": "v210-health-001" }
```

Expected sections:

```text
health
watchdog
field_reliability_score
```

---

## 3. get_diagnostics

```json
{ "command": "get_diagnostics", "request_id": "v210-diag-001" }
```

Expected sections:

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

---

## 4. get_reliability

```json
{ "command": "get_reliability", "request_id": "v210-rel-001" }
```

Expected:

```text
score
issue
wifi_drop_events
mqtt_drop_events
```

---

## 5. get_machine_runtime

```json
{ "command": "get_machine_runtime", "request_id": "v210-machine-001" }
```

Expected:

```text
state
input_source
today_runtime_sec
today_stop_sec
utilization_pct
```

---

## 6. get_daily_summary

```json
{ "command": "get_daily_summary", "request_id": "v210-daily-001" }
```

Expected:

```text
daily_summary
report_ready_for_n8n: true
ai_report_hint
```

---

## 7. get_digital_inputs

```json
{ "command": "get_digital_inputs", "request_id": "v210-di-001" }
```

Expected:

```text
di1.pin: 27
di1.source: GPIO or SIMULATION
di1.state: ACTIVE or INACTIVE
```

---

## 8. get_runtime_settings

```json
{ "command": "get_runtime_settings", "request_id": "v210-settings-001" }
```

Expected:

```text
log_level: INFO
log_level_persistent: true
machine_input_source
machine_input_source_persistent: true
```

---

## 9. Input source persistence

Set DI1:

```json
{ "command": "set_machine_input_source", "request_id": "v210-source-di1", "source": "DI1" }
```

Restart:

```json
{ "command": "restart", "request_id": "v210-restart-di1" }
```

Expected boot:

```text
Machine runtime input source: DI1
```

Set AUTO_CURRENT back:

```json
{ "command": "set_machine_input_source", "request_id": "v210-source-auto", "source": "AUTO_CURRENT" }
```

Restart again:

```json
{ "command": "restart", "request_id": "v210-restart-auto" }
```

Expected boot:

```text
Machine runtime input source: AUTO_CURRENT
```

---

## 10. OTA reject safety test

```json
{ "command": "ota_update", "request_id": "v210-ota-reject" }
```

Expected:

```text
status: rejected
message: Missing OTA URL
```

## Final result

If all tests pass, tag the release as v2.10.0.
