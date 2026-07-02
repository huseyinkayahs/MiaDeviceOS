#include "telemetry_manager.h"

#include "device_context.h"
#include "mqtt_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

unsigned long lastTelemetrySent = 0;

void setupTelemetry()
{
}

void updateTelemetry()
{
    unsigned long now = millis();

    if (now - lastTelemetrySent < 5000)
    {
        return;
    }

    lastTelemetrySent = now;

    JsonDocument doc;

    doc["device_id"] = "laser01";
    doc["current"] = deviceContext.state.current;
    doc["temperature"] = deviceContext.state.temperature;
    doc["wifi_rssi"] = deviceContext.state.wifiRSSI;
    doc["uptime_ms"] = now;
    doc["wifi_connected"] = deviceContext.state.wifiConnected;
    doc["mqtt_connected"] = deviceContext.state.mqttConnected;

    char buffer[256];
    serializeJson(doc, buffer);

    publishTelemetry(buffer);

    Serial.print("Telemetry gonderildi: ");
    Serial.println(buffer);
}