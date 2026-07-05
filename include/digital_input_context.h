#pragma once

#include <Arduino.h>

struct DigitalInputContext
{
    bool enabled = true;

    // FactoryBox One DI1 default pin.
    // GPIO27 is safe on common ESP32 DevKit boards.
    int di1Pin = 27;

    // Default wiring assumption: dry contact closes DI1 to GND.
    // INPUT_PULLUP keeps the input HIGH when open, LOW when active.
    bool di1UsePullup = true;
    bool di1ActiveHigh = false;

    bool di1RawLevel = false;
    bool di1StableLevel = false;
    bool di1Active = false;
    bool di1PreviousActive = false;

    bool di1SimulationEnabled = false;
    bool di1SimulatedActive = false;

    unsigned long debounceMs = 50;
    unsigned long sampleIntervalMs = 20;
    unsigned long lastSampleMs = 0;
    unsigned long lastCandidateChangeMs = 0;
    unsigned long lastStableChangeMs = 0;

    unsigned int di1ChangeCount = 0;
    const char* lastReason = "BOOT";
};
