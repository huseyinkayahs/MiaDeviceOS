#include "storage_manager.h"

#include <Preferences.h>

#include "device_context.h"

Preferences preferences;

namespace
{
    const char* CAPABILITY_JSON_KEY = "capJson";
    const char* CAPABILITY_VERSION_KEY = "capVer";
    const char* CAPABILITY_COUNT_KEY = "capCount";
    const char* CAPABILITY_PROFILE_KEY = "capProfile";
    const char* CAPABILITY_SCHEMA_KEY = "capSchema";
}

void setupStorage()
{
    preferences.begin("config", false);
}

void saveConfigToStorage(
    int currentLimit,
    int temperatureLimit,
    int repeatIfContinuesMin,
    int normalSendIntervalSec,
    int overCurrentDelaySec,
    int heartbeatIntervalSec,
    int wifiConnectTimeoutSec,
    int wifiReconnectIntervalSec,
    int mqttReconnectIntervalSec
)
{
    preferences.putInt("curLim", currentLimit);
    preferences.putInt("tempLim", temperatureLimit);
    preferences.putInt("repMin", repeatIfContinuesMin);
    preferences.putInt("sendInt", normalSendIntervalSec);
    preferences.putInt("ocDelay", overCurrentDelaySec);
    preferences.putInt("hbInt", heartbeatIntervalSec);
    preferences.putInt("wifiTo", wifiConnectTimeoutSec);
    preferences.putInt("wifiRetry", wifiReconnectIntervalSec);
    preferences.putInt("mqttRetry", mqttReconnectIntervalSec);
}

void loadConfigFromStorage(
    int &currentLimit,
    int &temperatureLimit,
    int &repeatIfContinuesMin,
    int &normalSendIntervalSec,
    int &overCurrentDelaySec,
    int &heartbeatIntervalSec,
    int &wifiConnectTimeoutSec,
    int &wifiReconnectIntervalSec,
    int &mqttReconnectIntervalSec
)
{
    currentLimit = preferences.getInt("curLim", 20);
    temperatureLimit = preferences.getInt("tempLim", 50);
    repeatIfContinuesMin = preferences.getInt("repMin", 10);
    normalSendIntervalSec = preferences.getInt("sendInt", 60);
    overCurrentDelaySec = preferences.getInt("ocDelay", 10);
    heartbeatIntervalSec = preferences.getInt("hbInt", 30);
    wifiConnectTimeoutSec = preferences.getInt("wifiTo", 15);
    wifiReconnectIntervalSec = preferences.getInt("wifiRetry", 10);
    mqttReconnectIntervalSec = preferences.getInt("mqttRetry", 5);
}

bool saveCapabilityConfigurationToStorage(
    const String& configurationJson,
    int configVersion,
    int capabilityCount,
    const String& capabilityProfile,
    const String& schema
)
{
    const size_t jsonWritten = preferences.putBytes(
        CAPABILITY_JSON_KEY,
        configurationJson.c_str(),
        configurationJson.length());

    if (jsonWritten != configurationJson.length())
    {
        return false;
    }

    const size_t versionWritten = preferences.putInt(CAPABILITY_VERSION_KEY, configVersion);
    const size_t countWritten = preferences.putInt(CAPABILITY_COUNT_KEY, capabilityCount);
    const size_t profileWritten = preferences.putString(CAPABILITY_PROFILE_KEY, capabilityProfile);
    const size_t schemaWritten = preferences.putString(CAPABILITY_SCHEMA_KEY, schema);

    return versionWritten > 0 &&
           countWritten > 0 &&
           profileWritten == capabilityProfile.length() &&
           schemaWritten == schema.length();
}

String loadCapabilityConfigurationFromStorage()
{
    const size_t storedLength = preferences.getBytesLength(CAPABILITY_JSON_KEY);

    if (storedLength == 0)
    {
        return "";
    }

    char* buffer = static_cast<char*>(malloc(storedLength + 1));

    if (buffer == nullptr)
    {
        return "";
    }

    const size_t loadedLength = preferences.getBytes(
        CAPABILITY_JSON_KEY,
        buffer,
        storedLength);

    if (loadedLength != storedLength)
    {
        free(buffer);
        return "";
    }

    buffer[storedLength] = '\0';
    String configurationJson(buffer);
    free(buffer);

    return configurationJson;
}

int loadCapabilityConfigVersionFromStorage()
{
    return preferences.getInt(CAPABILITY_VERSION_KEY, 0);
}

int loadCapabilityCountFromStorage()
{
    return preferences.getInt(CAPABILITY_COUNT_KEY, 0);
}

String loadCapabilityProfileFromStorage()
{
    return preferences.getString(CAPABILITY_PROFILE_KEY, "custom");
}

String loadCapabilitySchemaFromStorage()
{
    return preferences.getString(CAPABILITY_SCHEMA_KEY, "");
}

bool hasCapabilityConfigurationInStorage()
{
    return preferences.isKey(CAPABILITY_JSON_KEY) &&
           preferences.getBytesLength(CAPABILITY_JSON_KEY) > 0;
}
