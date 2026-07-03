#pragma once

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
