#include "config_manager.h"

#include "device_context.h"
#include "storage_manager.h"

#include <ArduinoJson.h>

namespace
{
    int clampMin(int value, int minValue)
    {
        if (value < minValue)
        {
            return minValue;
        }

        return value;
    }
}

void setupConfig()
{
    loadConfigFromStorage(
        deviceContext.config.currentLimit,
        deviceContext.config.temperatureLimit,
        deviceContext.config.repeatIfContinuesMin,
        deviceContext.config.normalSendIntervalSec,
        deviceContext.config.overCurrentDelaySec,
        deviceContext.config.heartbeatIntervalSec,
        deviceContext.config.wifiConnectTimeoutSec,
        deviceContext.config.wifiReconnectIntervalSec,
        deviceContext.config.mqttReconnectIntervalSec
    );
}

void applyConfig(const DeviceConfig& config)
{
    deviceContext.config = config;
    saveConfig();
}

const DeviceConfig& getConfig()
{
    return deviceContext.config;
}

void saveConfig()
{
    saveConfigToStorage(
        deviceContext.config.currentLimit,
        deviceContext.config.temperatureLimit,
        deviceContext.config.repeatIfContinuesMin,
        deviceContext.config.normalSendIntervalSec,
        deviceContext.config.overCurrentDelaySec,
        deviceContext.config.heartbeatIntervalSec,
        deviceContext.config.wifiConnectTimeoutSec,
        deviceContext.config.wifiReconnectIntervalSec,
        deviceContext.config.mqttReconnectIntervalSec
    );
}

void resetToDefaults()
{
    DeviceConfig defaultConfig;
    applyConfig(defaultConfig);
}

bool applyConfigJson(const char* json)
{
    JsonDocument doc;

    DeserializationError error = deserializeJson(doc, json);

    if (error)
    {
        return false;
    }

    DeviceConfig config = deviceContext.config;

    if (doc["current_limit"].is<int>())
    {
        config.currentLimit = doc["current_limit"];
    }

    if (doc["temperature_limit"].is<int>())
    {
        config.temperatureLimit = doc["temperature_limit"];
    }

    if (doc["repeat_if_continues_min"].is<int>())
    {
        config.repeatIfContinuesMin = doc["repeat_if_continues_min"];
    }

    if (doc["normal_send_interval_sec"].is<int>())
    {
        config.normalSendIntervalSec = clampMin(doc["normal_send_interval_sec"], 5);
    }

    if (doc["over_current_delay_sec"].is<int>())
    {
        config.overCurrentDelaySec = clampMin(doc["over_current_delay_sec"], 1);
    }

    if (doc["heartbeat_interval_sec"].is<int>())
    {
        config.heartbeatIntervalSec = clampMin(doc["heartbeat_interval_sec"], 5);
    }

    if (doc["wifi_connect_timeout_sec"].is<int>())
    {
        config.wifiConnectTimeoutSec = clampMin(doc["wifi_connect_timeout_sec"], 3);
    }

    if (doc["wifi_reconnect_interval_sec"].is<int>())
    {
        config.wifiReconnectIntervalSec = clampMin(doc["wifi_reconnect_interval_sec"], 3);
    }

    if (doc["mqtt_reconnect_interval_sec"].is<int>())
    {
        config.mqttReconnectIntervalSec = clampMin(doc["mqtt_reconnect_interval_sec"], 3);
    }

    applyConfig(config);

    return true;
}
