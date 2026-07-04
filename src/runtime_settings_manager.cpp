#include "runtime_settings_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>

namespace
{
    Preferences runtimePreferences;
    bool runtimeSettingsReady = false;

    const char* RUNTIME_NAMESPACE = "runtime";
    const char* KEY_LOG_LEVEL = "logLevel";

    void ensureRuntimeSettingsReady()
    {
        if (!runtimeSettingsReady)
        {
            runtimePreferences.begin(RUNTIME_NAMESPACE, false);
            runtimeSettingsReady = true;
        }
    }
}

void setupRuntimeSettings()
{
    ensureRuntimeSettingsReady();
}

bool saveRuntimeLogLevel(int level)
{
    if (level < 0 || level > 3)
    {
        return false;
    }

    ensureRuntimeSettingsReady();
    return runtimePreferences.putInt(KEY_LOG_LEVEL, level) > 0;
}

int loadRuntimeLogLevel(int defaultLevel)
{
    ensureRuntimeSettingsReady();
    int value = runtimePreferences.getInt(KEY_LOG_LEVEL, defaultLevel);

    if (value < 0 || value > 3)
    {
        return defaultLevel;
    }

    return value;
}

String buildRuntimeSettingsJson()
{
    ensureRuntimeSettingsReady();

    JsonDocument doc;
    doc["log_level_value"] = loadRuntimeLogLevel(2);

    String payload;
    serializeJson(doc, payload);
    return payload;
}
