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
- ble_security

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
- ble_client_connected
- ble_service_authenticated
- ble_command_count
- ble_rejected_command_count
- ble_failed_auth_count
- last_command
- last_command_status
- last_command_message

### Service Command

```text
UUID: 6d696100-0000-4000-8000-000000000004
Mode: Write
```

## Security Model

BLE Service Mode uses a local service PIN for protected commands.

The PIN should be configured locally in `include/secrets.h`:

```cpp
#define BLE_SERVICE_PIN "123456"
#define BLE_MAX_FAILED_AUTH 5
```

`include/secrets.h` must not be committed to GitHub.

## Supported Commands

### get_status

Allowed without PIN.

Plain text:

```text
get_status
```

JSON:

```json
{
  "command": "get_status"
}
```

### auth

Authenticates the current BLE session.

```json
{
  "command": "auth",
  "pin": "123456"
}
```

After successful auth, protected commands can be sent without including the PIN until BLE disconnect.

### reset_alarm

Protected command.

Option 1: send with PIN:

```json
{
  "command": "reset_alarm",
  "pin": "123456"
}
```

Option 2: authenticate first with `auth`, then send:

```json
{
  "command": "reset_alarm"
}
```

### logout

Closes the authenticated BLE service session.

```json
{
  "command": "logout"
}
```

## Expected Rejections

Wrong PIN:

```json
{
  "command": "reset_alarm",
  "pin": "000000"
}
```

Expected status fields:

```text
last_command_status: rejected
last_command_message: Service PIN required or invalid
```

## Safety Notes

BLE Service Mode should only expose low-risk service commands.
OTA and WiFi credential provisioning are intentionally not included yet.
