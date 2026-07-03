#include "heartbeat_manager.h"

#include "device_context.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
    const char* DEVICE_ID = "laser01";

    bool heartbeatPayloadPending = false;
    String heartbeatPayload;

    unsigned long intervalSecToMs(int intervalSec)
    {
        if (intervalSec < 5)
        {
            intervalSec = 5;
        }

        return intervalSec * 1000UL;
    }

    void prepareHeartbeatPayload(unsigned long now)
    {
        JsonDocument doc;

        doc["device_id"] = DEVICE_ID;
        doc["event"] = "HEARTBEAT";
        doc["status"] = "online";
        doc["sequence"] = deviceContext.heartbeat.sequence;
        doc["uptime_ms"] = now;
        doc["wifi_connected"] = deviceContext.state.wifiConnected;
        doc["mqtt_connected"] = deviceContext.state.mqttConnected;
        doc["wifi_rssi"] = deviceContext.state.wifiRSSI;
        doc["alarm_active"] = deviceContext.alarm.active;
        doc["current"] = deviceContext.state.current;
        doc["temperature"] = deviceContext.state.temperature;
        doc["wifi_reconnect_count"] = deviceContext.state.wifiReconnectCount;
        doc["mqtt_reconnect_count"] = deviceContext.state.mqttReconnectCount;
        doc["mqtt_connect_fail_count"] = deviceContext.state.mqttConnectFailCount;

        heartbeatPayload = "";
        serializeJson(doc, heartbeatPayload);
        heartbeatPayloadPending = true;
    }
}

void setupHeartbeat()
{
    deviceContext.heartbeat.enabled = true;
    deviceContext.heartbeat.lastSentMs = 0;
    deviceContext.heartbeat.sequence = 0;

    heartbeatPayloadPending = false;
    heartbeatPayload = "";
}

void updateHeartbeat()
{
    if (!deviceContext.heartbeat.enabled)
    {
        return;
    }

    unsigned long now = millis();
    unsigned long intervalMs = intervalSecToMs(deviceContext.config.heartbeatIntervalSec);

    if (deviceContext.heartbeat.lastSentMs != 0 && now - deviceContext.heartbeat.lastSentMs < intervalMs)
    {
        return;
    }

    deviceContext.heartbeat.lastSentMs = now;
    deviceContext.heartbeat.sequence++;

    prepareHeartbeatPayload(now);
}

bool hasHeartbeatPayload()
{
    return heartbeatPayloadPending;
}

String takeHeartbeatPayload()
{
    String payload = heartbeatPayload;

    heartbeatPayload = "";
    heartbeatPayloadPending = false;

    return payload;
}
