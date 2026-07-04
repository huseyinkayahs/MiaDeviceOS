#include "config_manager.h"

#include "app_version.h"
#include "device_context.h"
#include "storage_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
    bool configStatusPending = false;
    String configStatusPayload;

    void appendConfig(JsonObject configObject, const DeviceConfig& config)
    {
        configObject["current_limit"] = config.currentLimit;
        configObject["temperature_limit"] = config.temperatureLimit;
        configObject["repeat_if_continues_min"] = config.repeatIfContinuesMin;
        configObject["normal_send_interval_sec"] = config.normalSendIntervalSec;
        configObject["over_current_delay_sec"] = config.overCurrentDelaySec;
        configObject["heartbeat_interval_sec"] = config.heartbeatIntervalSec;
        configObject["wifi_connect_timeout_sec"] = config.wifiConnectTimeoutSec;
        configObject["wifi_reconnect_interval_sec"] = config.wifiReconnectIntervalSec;
        configObject["mqtt_reconnect_interval_sec"] = config.mqttReconnectIntervalSec;
    }

    void setConfigStatus(
        const String& requestId,
        const char* status,
        const String& message,
        bool includeConfig
    )
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["event"] = "CONFIG_STATUS";
        doc["request_id"] = requestId;
        doc["status"] = status;
        doc["message"] = message;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;
        doc["uptime_ms"] = millis();

        if (includeConfig)
        {
            JsonObject configObject = doc["config"].to<JsonObject>();
            appendConfig(configObject, deviceContext.config);
        }

        configStatusPayload = "";
        serializeJson(doc, configStatusPayload);
        configStatusPending = true;
    }

    String readOptionalString(JsonObject obj, const char* key)
    {
        if (obj.containsKey(key) && obj[key].is<const char*>())
        {
            return obj[key].as<String>();
        }

        return "";
    }

    bool validateDeviceId(JsonObject obj, String& errorMessage)
    {
        if (!obj.containsKey("device_id"))
        {
            return true;
        }

        if (!obj["device_id"].is<const char*>())
        {
            errorMessage = "device_id must be string";
            return false;
        }

        String receivedDeviceId = obj["device_id"].as<String>();

        if (receivedDeviceId != MIA_DEVICE_ID)
        {
            errorMessage = "device_id mismatch";
            return false;
        }

        return true;
    }

    bool applyIntField(
        JsonObject obj,
        const char* key,
        int minValue,
        int maxValue,
        int& target,
        String& errorMessage
    )
    {
        if (!obj.containsKey(key))
        {
            return true;
        }

        if (!obj[key].is<int>())
        {
            errorMessage = String(key) + " must be integer";
            return false;
        }

        int value = obj[key].as<int>();

        if (value < minValue || value > maxValue)
        {
            errorMessage = String(key) + " out of range " + String(minValue) + "-" + String(maxValue);
            return false;
        }

        target = value;
        return true;
    }

    bool validateAndApplyConfig(JsonObject obj, DeviceConfig& config, String& errorMessage)
    {
        if (!validateDeviceId(obj, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "current_limit", 1, 200, config.currentLimit, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "temperature_limit", 1, 120, config.temperatureLimit, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "repeat_if_continues_min", 1, 1440, config.repeatIfContinuesMin, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "normal_send_interval_sec", 5, 3600, config.normalSendIntervalSec, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "over_current_delay_sec", 1, 300, config.overCurrentDelaySec, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "heartbeat_interval_sec", 5, 3600, config.heartbeatIntervalSec, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "wifi_connect_timeout_sec", 3, 120, config.wifiConnectTimeoutSec, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "wifi_reconnect_interval_sec", 3, 300, config.wifiReconnectIntervalSec, errorMessage))
        {
            return false;
        }

        if (!applyIntField(obj, "mqtt_reconnect_interval_sec", 3, 300, config.mqttReconnectIntervalSec, errorMessage))
        {
            return false;
        }

        return true;
    }
}

void setupConfig()
{
    configStatusPending = false;
    configStatusPayload = "";

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
        setConfigStatus("", "rejected", "Invalid JSON", false);
        return false;
    }

    JsonObject obj = doc.as<JsonObject>();

    if (obj.isNull())
    {
        setConfigStatus("", "rejected", "Config must be JSON object", false);
        return false;
    }

    String requestId = readOptionalString(obj, "request_id");
    DeviceConfig config = deviceContext.config;
    String errorMessage;

    if (!validateAndApplyConfig(obj, config, errorMessage))
    {
        setConfigStatus(requestId, "rejected", errorMessage, false);
        return false;
    }

    applyConfig(config);
    setConfigStatus(requestId, "done", "Config applied", true);

    return true;
}

bool hasConfigStatusPayload()
{
    return configStatusPending;
}

String takeConfigStatusPayload()
{
    String payload = configStatusPayload;

    configStatusPayload = "";
    configStatusPending = false;

    return payload;
}
