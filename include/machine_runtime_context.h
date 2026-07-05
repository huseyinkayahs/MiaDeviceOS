#pragma once

#include <Arduino.h>

enum class MachineRuntimeState
{
    Unknown,
    Stopped,
    Running
};

struct MachineRuntimeContext
{
    bool enabled = true;

    MachineRuntimeState state = MachineRuntimeState::Unknown;
    MachineRuntimeState previousState = MachineRuntimeState::Unknown;

    bool manualOverride = false;
    bool useDigitalInput1ForRuntime = false;
    const char* stateSource = "AUTO_CURRENT";
    const char* lastStateReason = "BOOT";

    unsigned long startedAtMs = 0;
    unsigned long lastUpdateMs = 0;
    unsigned long lastAccumulatorMs = 0;
    unsigned long lastStateChangeMs = 0;
    unsigned long lastStatusPublishMs = 0;

    uint32_t statusPublishIntervalSec = 30;
    float runningCurrentThreshold = 3.0f;

    uint32_t uptimeDayIndex = 0;
    uint32_t todayRuntimeSec = 0;
    uint32_t todayStopSec = 0;
    uint32_t currentSegmentSec = 0;
    uint32_t longestRunSec = 0;
    uint32_t longestStopSec = 0;

    unsigned int stateChangeCount = 0;
    unsigned int runStartCount = 0;
    unsigned int stopStartCount = 0;
};
