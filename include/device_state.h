#pragma once

struct DeviceState {
    float current = 0.0;
    float temperature = 0.0;

    bool wifiConnected = false;
    bool mqttConnected = false;

    long wifiRSSI = 0;
    unsigned long uptimeMs = 0;

    bool alarmActive = false;
};