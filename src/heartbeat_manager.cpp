#include "heartbeat_manager.h"

#include "device_context.h"
#include "app_version.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
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

        doc["device_id"] = MIA_DEVICE_ID;
        doc["event"] = "HEARTBEAT";
        doc["device_model"] = MIA_DEVICE_MODEL;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["build_type"] = MIA_BUILD_TYPE;
        doc["platform_name"] = MIA_PLATFORM_NAME;
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
