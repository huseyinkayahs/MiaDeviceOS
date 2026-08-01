#pragma once

#include <Arduino.h>

void setupStorage();

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
);

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
);

bool saveCapabilityConfigurationToStorage(
    const String& configurationJson,
    int configVersion,
    int capabilityCount,
    const String& capabilityProfile,
    const String& schema
);

String loadCapabilityConfigurationFromStorage();
int loadCapabilityConfigVersionFromStorage();
int loadCapabilityCountFromStorage();
String loadCapabilityProfileFromStorage();
String loadCapabilitySchemaFromStorage();
bool hasCapabilityConfigurationInStorage();
