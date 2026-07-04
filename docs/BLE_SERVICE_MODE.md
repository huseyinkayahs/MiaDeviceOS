# MiaDeviceOS BLE Service Mode

## Purpose

BLE Service Mode provides a local, short-range service interface for technicians.
It is intended for commissioning, field checks, and simple service commands.

Primary control should remain MQTT. BLE is not the main cloud control channel.

## Device Name

```text
MiaDeviceOS-laser01
```

## Test App

Use a generic BLE client such as **nRF Connect**.

## BLE Service

```text
Service UUID: 6d696100-0000-4000-8000-000000000001
```

## Characteristics

### Device Info

```text
UUID: 6d696100-0000-4000-8000-000000000002
Mode: Read
```

Returns static device information:

- project
- device_id
- device_model
- firmware_version
- build_type
- hardware_revision
- platform_name
- ble_device_name

### Device Status

```text
UUID: 6d696100-0000-4000-8000-000000000003
Mode: Read / Notify
```

Returns live device state:

- wifi_connected
- mqtt_connected
- wifi_rssi
- alarm_active
- current
- temperature
- uptime_ms
- ble_command_count

### Service Command

```text
UUID: 6d696100-0000-4000-8000-000000000004
Mode: Write
```

Supported commands:

```text
get_status
reset_alarm
```

Commands can be sent as plain text:

```text
reset_alarm
```

or JSON:

```json
{
  "command": "reset_alarm"
}
```

## Safety Notes

BLE Service Mode should only expose low-risk service commands in the first version.
OTA and WiFi credential provisioning are intentionally not included yet.
