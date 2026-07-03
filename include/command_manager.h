#pragma once

#include <Arduino.h>

void setupCommand();

void updateCommand();

void handleCommandJson(const char* json);

bool hasCommandStatusPayload();

String takeCommandStatusPayload();
