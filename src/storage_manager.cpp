#include "storage_manager.h"
#include <Preferences.h>

Preferences preferences;

void setupStorage() {
    preferences.begin("config", false);
}

void saveConfigToStorage(
    int currentLimit,
    int temperatureLimit,
    int repeatIfContinuesMin,
    int normalSendIntervalSec
) {
    preferences.putInt("curLim", currentLimit);
    preferences.putInt("tempLim", temperatureLimit);
    preferences.putInt("repMin", repeatIfContinuesMin);
    preferences.putInt("sendInt", normalSendIntervalSec);
}

void loadConfigFromStorage(
    int &currentLimit,
    int &temperatureLimit,
    int &repeatIfContinuesMin,
    int &normalSendIntervalSec
) {
    currentLimit = preferences.getInt("curLim", 20);
    temperatureLimit = preferences.getInt("tempLim", 50);
    repeatIfContinuesMin = preferences.getInt("repMin", 10);
    normalSendIntervalSec = preferences.getInt("sendInt", 60);
}