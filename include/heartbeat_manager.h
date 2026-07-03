#pragma once

#include <Arduino.h>

void setupHeartbeat();

void updateHeartbeat();

bool hasHeartbeatPayload();

String takeHeartbeatPayload();
