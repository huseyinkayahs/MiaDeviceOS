#pragma once

struct DeviceState {
    float current = 0.0;
    float temperature = 0.0;

    bool wifiConnected = false;
    bool mqttConnected = false;

    long wifiRSSI = 0;
    unsigned long uptimeMs = 0;

    bool alarmActive = false;

    unsigned long lastWifiReconnectMs = 0;
    unsigned long lastMqttReconnectMs = 0;

    unsigned int wifiReconnectCount = 0;
    unsigned int mqttReconnectCount = 0;
    unsigned int mqttConnectFailCount = 0;
};
