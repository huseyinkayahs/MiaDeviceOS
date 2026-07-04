#pragma once

#include <Arduino.h>

namespace MiaPlatform
{
    const char* name();
    void setup();
    void restart();
    unsigned long uptimeMs();
    void delayMs(unsigned long durationMs);
}
