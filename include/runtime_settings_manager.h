#pragma once

#include <Arduino.h>

void setupRuntimeSettings();

bool saveRuntimeLogLevel(int level);
int loadRuntimeLogLevel(int defaultLevel);

bool saveRuntimeMachineInputSource(const String& source);
String loadRuntimeMachineInputSource(const String& defaultSource);

String buildRuntimeSettingsJson();
