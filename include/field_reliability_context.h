#pragma once

#include <Arduino.h>

struct FieldReliabilityContext
{
    bool enabled = true;
    bool firstSample = true;

    const char* status = "UNKNOWN";
    const char* issue = "NONE";
    int score = 100;

    unsigned long startedAtMs = 0;
    unsigned long lastCheckMs = 0;
    uint32_t checkIntervalMs = 5000;
    uint32_t offlineWarningThresholdMs = 60000;

    bool previousWifiConnected = false;
    bool previousMqttConnected = false;

    unsigned long wifiOfflineSinceMs = 0;
    unsigned long mqttOfflineSinceMs = 0;

    unsigned int wifiDropEvents = 0;
    unsigned int mqttDropEvents = 0;

    bool wifiOfflineWarning = false;
    bool mqttOfflineWarning = false;
    unsigned int warningCount = 0;
};
