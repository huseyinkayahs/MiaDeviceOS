#include "telemetry_manager.h"

#include "device_context.h"
#include "mqtt_manager.h"
#include "app_version.h"

#include <Arduino.h>
#include <ArduinoJson.h>

unsigned long lastTelemetrySent = 0;

void setupTelemetry()
{
}

void updateTelemetry()
{
    unsigned long now = millis();

    unsigned long intervalMs =
    deviceContext.config.normalSendIntervalSec * 1000UL;

if (now - lastTelemetrySent < intervalMs)
{
    return;
}

    lastTelemetrySent = now;

    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["current"] = deviceContext.state.current;
    doc["temperature"] = deviceContext.state.temperature;
    doc["wifi_rssi"] = deviceContext.state.wifiRSSI;
    doc["uptime_ms"] = now;
    doc["wifi_connected"] = deviceContext.state.wifiConnected;
    doc["mqtt_connected"] = deviceContext.state.mqttConnected;

    char buffer[384];
    serializeJson(doc, buffer);

    publishTelemetry(buffer);

}