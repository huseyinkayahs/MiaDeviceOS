#pragma once

#include <Arduino.h>

void setupRuntimeSettings();

bool saveRuntimeLogLevel(int level);
int loadRuntimeLogLevel(int defaultLevel);

String buildRuntimeSettingsJson();
