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
    const char* KEY_MACHINE_INPUT_SOURCE = "machSrc";

    void ensureRuntimeSettingsReady()
    {
        if (!runtimeSettingsReady)
        {
            runtimePreferences.begin(RUNTIME_NAMESPACE, false);
            runtimeSettingsReady = true;
        }
    }

    String normalizeMachineInputSource(const String& source)
    {
        String normalized = source;
        normalized.toUpperCase();
        normalized.trim();

        if (normalized == "DI1" || normalized == "DIGITAL_INPUT_1" || normalized == "DIGITAL_INPUT")
        {
            return "DI1";
        }

        if (normalized == "AUTO_CURRENT" || normalized == "CURRENT" || normalized == "CURRENT_SENSOR")
        {
            return "AUTO_CURRENT";
        }

        return "";
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

bool saveRuntimeMachineInputSource(const String& source)
{
    String normalized = normalizeMachineInputSource(source);

    if (normalized.length() == 0)
    {
        return false;
    }

    ensureRuntimeSettingsReady();
    return runtimePreferences.putString(KEY_MACHINE_INPUT_SOURCE, normalized) > 0;
}

String loadRuntimeMachineInputSource(const String& defaultSource)
{
    ensureRuntimeSettingsReady();

    String normalizedDefault = normalizeMachineInputSource(defaultSource);

    if (normalizedDefault.length() == 0)
    {
        normalizedDefault = "AUTO_CURRENT";
    }

    String value = runtimePreferences.getString(KEY_MACHINE_INPUT_SOURCE, normalizedDefault);
    String normalizedValue = normalizeMachineInputSource(value);

    if (normalizedValue.length() == 0)
    {
        return normalizedDefault;
    }

    return normalizedValue;
}

String buildRuntimeSettingsJson()
{
    ensureRuntimeSettingsReady();

    JsonDocument doc;
    doc["log_level_value"] = loadRuntimeLogLevel(2);
    doc["machine_input_source"] = loadRuntimeMachineInputSource("AUTO_CURRENT");

    String payload;
    serializeJson(doc, payload);
    return payload;
}
