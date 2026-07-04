#pragma once

#include <Arduino.h>

namespace MiaPlatform
{
    const char* name();
    const char* resetReason();
    void setup();
    void restart();
    unsigned long uptimeMs();
    void delayMs(unsigned long durationMs);
    uint32_t freeHeapBytes();
    uint32_t minFreeHeapBytes();
    uint32_t flashChipSizeBytes();
    uint32_t sketchSizeBytes();
    uint32_t freeSketchSpaceBytes();
}
