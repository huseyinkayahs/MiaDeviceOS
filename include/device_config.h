#pragma once

struct DeviceConfig {
    int currentLimit = 20;
    int temperatureLimit = 50;
    int repeatIfContinuesMin = 10;
    int normalSendIntervalSec = 60;
    int overCurrentDelaySec = 10;
    int heartbeatIntervalSec = 30;

    int wifiConnectTimeoutSec = 15;
    int wifiReconnectIntervalSec = 10;
    int mqttReconnectIntervalSec = 5;
};
