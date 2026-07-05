# MiaDeviceOS v2.0.0 Release Notes

## Release Name

Field Prototype Release

## Release Type

```text
Prototype firmware release
Production-style architecture
Real sensor driver not included yet
```

## Summary

MiaDeviceOS v2.0.0 is the first field prototype release of the firmware platform.

This release consolidates the work completed from v0.5 to v1.9 and provides a stable baseline for real-world prototype testing.

## Included Capabilities

```text
WiFi manager
MQTT manager
Remote config
Config validation
Telemetry
Heartbeat
Alarm lifecycle
MQTT command engine
OTA update flow
BLE service mode
BLE service PIN security
Runtime log level control
Persistent runtime settings
Diagnostics engine
Production health monitor
Boot count and reset reason tracking
Watchdog setup and feed tracking
Boot diagnostics
Field reliability monitoring
MQTT large payload buffer fix
```

## Important Commands

```text
get_config
get_health
get_diagnostics
get_reliability
get_watchdog
get_boot_diagnostics
get_log_level
set_log_level
get_runtime_settings
reset_alarm
restart
ota_update
```

## Known Prototype Limitations

```text
Sensor is still simulated
Real SCT013/current sensor driver is not implemented yet
Sensor calibration is not implemented yet
OTA has been tested on local network
MQTT Explorer UI may not always refresh the topic tree
Hardware revision is prototype
```

## Expected Test Status With Simulated Sensor

Because the simulated current is above the default current limit, these values are expected:

```text
alarm.active: true
health.status: ALARM
field_reliability.issue: ALARM_ACTIVE
field_reliability.score: 95
```

This is not a release failure.

## Release Validation

Release validation is documented in:

```text
docs/FINAL_SMOKE_TEST.md
docs/FIELD_TEST_CHECKLIST.md
```

## Suggested Git Tag

```powershell
git tag -a v2.0.0 -m "MiaDeviceOS v2.0.0 field prototype release"
git push origin v2.0.0
```

## Next Development Direction

After v2.0.0, the next major work should be real hardware integration:

```text
Real sensor driver
Sensor calibration
Electrical noise testing
Field enclosure testing
Multi-device management
Dashboard / n8n monitoring
```
