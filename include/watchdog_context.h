#pragma once

#include <Arduino.h>

struct WatchdogContext
{
    bool enabled = true;
    bool setupOk = false;
    bool supported = false;

    uint32_t timeoutSec = 30;
    uint32_t feedIntervalMs = 1000;

    unsigned long startedAtMs = 0;
    unsigned long lastFeedMs = 0;
    unsigned long feedCount = 0;
};
