#pragma once

struct DeviceConfig {
    int currentLimit = 20;
    int temperatureLimit = 50;
    int repeatIfContinuesMin = 10;
    int normalSendIntervalSec = 60;
};