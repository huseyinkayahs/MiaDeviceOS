# MiaDeviceOS / FactoryBox One V2 Release Notes

## Release

```text
Version: 2.10.0
Release type: FactoryBox Pilot Release
```

## V2 progression

```text
v2.0  Field Prototype Release
v2.1  FactoryBox One Product Definition
v2.2  FactoryBox One MVP Core
v2.2.1 Machine Runtime Counter Hotfix
v2.3  n8n Daily Report Flow
v2.4  Machine Stop Alert Flow
v2.5  Stop Alert Anti-Spam Logic
v2.6  FactoryBox Input Strategy
v2.7  Digital Input Runtime Driver
v2.8  Input Source Persistence
v2.8.1 NVS Key Hotfix
v2.9  Pilot Wiring Plan
v2.10 FactoryBox Pilot Release
```

## Product result

FactoryBox One is now ready for a controlled pilot installation.

The system can:

```text
Detect machine RUNNING / STOPPED state
Track runtime and stop time
Generate daily summary
Feed n8n daily report workflow
Send stop alert with anti-spam logic
Read DI1 digital input
Persist machine input source
Report health, diagnostics, reliability and watchdog state
Support OTA, BLE service and MQTT command operations
```

## Important limitation

The first pilot should be observation-only.

```text
No machine control output should be used in the first installation.
FactoryBox should only read signals and send reports/alerts.
```

## Next phase

After V2, the next track is V3.

Recommended V3 focus:

```text
Real hardware input module
Real DI1 field test
Real current sensor integration
Sensor calibration
Pilot enclosure
Pilot customer installation
SmartFlows packaging
```
