#pragma once

#include <stdint.h>

void setupSensors();
void updateSensors();

bool temperatureSensorConnected();
bool temperatureSensorHasValidReading();
float temperatureSensorValueC();
const char* temperatureSensorTypeName();
uint8_t temperatureSensorDataPin();
uint8_t temperatureSensorResolutionBits();
unsigned long temperatureSensorReadIntervalMs();
unsigned long temperatureSensorLastReadMs();
unsigned int temperatureSensorReadCount();
unsigned int temperatureSensorErrorCount();
