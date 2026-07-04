# MiaDeviceOS Platform Abstraction Notes

## Purpose

MiaDeviceOS is designed so core device behavior can survive future hardware changes.
The application layer should keep business/device logic separate from board-specific code.

## Current Platform

Current target platform:

```text
esp32-arduino
```

The first abstraction layer is intentionally small. It introduces a central platform system API for operations that are hardware/runtime specific.

## Added Platform API

```text
include/platform/platform_system.h
src/platform/platform_system_esp32.cpp
```

Current functions:

```cpp
MiaPlatform::name();
MiaPlatform::setup();
MiaPlatform::restart();
MiaPlatform::uptimeMs();
MiaPlatform::delayMs(ms);
```

## Why This Matters

Before this sprint, restart operations directly called ESP32 APIs from feature modules.
Now feature modules call the MiaPlatform API instead.

Example:

```cpp
MiaPlatform::restart();
```

This keeps restart behavior behind a platform boundary.
If the hardware changes later, the application modules should not need to know the new board's restart API.

## What Is Still ESP32-Specific

These modules still contain ESP32/Arduino-specific implementation details:

```text
wifi_manager.cpp      WiFi.h
mqtt_manager.cpp      WiFiClient / PubSubClient
storage_manager.cpp   Preferences
ota_manager.cpp       HTTPClient / Update
sensor/display drivers
```

That is acceptable for this sprint. The goal is preparation, not a risky full rewrite.

## Future Target Structure

Long term, the project can move toward this structure:

```text
core/
  alarm
  config
  command
  heartbeat

platform/esp32/
  wifi
  mqtt
  ota
  storage
  display
  pins

platform/custom_board/
  wifi
  mqtt
  ota
  storage
  display
  pins
```

## Porting Rule

New feature modules should not directly call board-specific APIs when a MiaPlatform wrapper exists.

Good:

```cpp
MiaPlatform::restart();
```

Avoid:

```cpp
ESP.restart();
```

## Next Recommended Abstractions

Suggested future work:

```text
PlatformNetwork: WiFi connection status and RSSI
PlatformMqttTransport: publish / subscribe wrapper
PlatformStorage: config persistence
PlatformOta: update transport
PlatformPins: hardware pin map
```

Do these gradually. Avoid rewriting every module at once.
