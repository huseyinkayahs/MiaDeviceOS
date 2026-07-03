#pragma once

#include <Arduino.h>

void setupOta();
void updateOta();

bool isOtaInProgress();

bool hasOtaStatusPayload();
String takeOtaStatusPayload();
