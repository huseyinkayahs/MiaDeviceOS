#pragma once

#include <Arduino.h>

#include "device_config.h"

void setupConfig();

void applyConfig(const DeviceConfig& config);

bool applyConfigJson(const char* json);

const DeviceConfig& getConfig();

void saveConfig();

void resetToDefaults();

bool hasConfigStatusPayload();
String takeConfigStatusPayload();
