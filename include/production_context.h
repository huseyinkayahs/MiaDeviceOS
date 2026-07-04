#pragma once

#include <Arduino.h>

struct ProductionContext
{
    bool enabled = true;

    unsigned long bootCount = 0;
    const char* resetReason = "UNKNOWN";
    unsigned long startedAtMs = 0;

    uint32_t lowHeapThresholdBytes = 30000;
    bool lowHeapWarningActive = false;
    unsigned int lowHeapWarningCount = 0;

    unsigned long lastHealthCheckMs = 0;
};
