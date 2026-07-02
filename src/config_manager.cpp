#include "config_manager.h"
#include "device_context.h"
#include "storage_manager.h"
#include <ArduinoJson.h>

void setupConfig()
{
    loadConfigFromStorage(
        deviceContext.config.currentLimit,
        deviceContext.config.temperatureLimit,
        deviceContext.config.repeatIfContinuesMin,
        deviceContext.config.normalSendIntervalSec
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
        deviceContext.config.normalSendIntervalSec
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
    config.currentLimit = doc["current_limit"];

if (doc["temperature_limit"].is<int>())
    config.temperatureLimit = doc["temperature_limit"];

if (doc["repeat_if_continues_min"].is<int>())
    config.repeatIfContinuesMin = doc["repeat_if_continues_min"];

if (doc["normal_send_interval_sec"].is<int>())
    config.normalSendIntervalSec = doc["normal_send_interval_sec"];
    applyConfig(config);

    return true;
}