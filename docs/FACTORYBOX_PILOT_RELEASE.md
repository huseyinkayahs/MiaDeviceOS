# FactoryBox One Pilot Release

## Release

```text
Version: 2.10.0
Release name: FactoryBox Pilot Release
Target product: FactoryBox One
Target sector: Laser cutting and CNC workshops
```

## Goal

Prepare the current MiaDeviceOS / FactoryBox One stack for the first controlled pilot installation.

This is not a mass production release. It is a controlled field prototype release.

## What is ready

```text
MQTT command layer
Remote config
Heartbeat
Alarm lifecycle
OTA command handling
BLE service mode
Diagnostics
Runtime settings persistence
Production health monitor
Watchdog
Boot diagnostics
Field reliability reporting
Machine runtime tracker
Daily summary output
DI1 digital input driver
Persistent machine input source
n8n daily report flow
n8n stop alert flow
Stop alert anti-spam logic
Pilot wiring documentation
```

## Pilot operating modes

### AUTO_CURRENT

Used when machine state is inferred from current measurement.

Current implementation still uses simulated current until the real sensor is connected.

### DI1

Used when a machine RUN signal is available.

```text
DI1 ACTIVE   → RUNNING
DI1 INACTIVE → STOPPED
```

DI1 is configured as GPIO27, INPUT_PULLUP, active LOW.

## Pilot rule

Start the first real installation in observation mode. Do not control the machine.

FactoryBox One should first only observe, report, and alert.

## Not included yet

```text
Real current sensor calibration
Modbus / PLC integration
Web dashboard
WhatsApp production integration
Mass production enclosure design
Certified electrical input module
```

## Pilot success criteria

```text
Device boots reliably
MQTT connects reliably
Machine state is detected correctly
Daily summary is generated
Stop alert is sent only once per stop event
Input source remains persistent after restart
Diagnostics can be requested remotely
Watchdog remains healthy
No unsafe electrical connection is used
```
