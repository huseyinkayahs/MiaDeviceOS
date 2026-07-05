#pragma once

#include <Arduino.h>
#include "machine_runtime_context.h"

void setupMachineRuntimeManager();
void updateMachineRuntimeManager();

const char* machineRuntimeStateName();
const char* machineRuntimeStateName(MachineRuntimeState state);
const char* machineRuntimeSourceName();
const char* machineRuntimeLastReason();

bool setMachineRuntimeStateFromString(const String& state, const char* reason);
void clearMachineRuntimeManualOverride();
void resetMachineRuntimeCounters();

int machineRuntimeUtilizationPct();
unsigned long machineRuntimeCurrentSegmentMs();
uint32_t machineRuntimeObservedSec();

String buildMachineRuntimeJson();
String buildDailySummaryJson();

bool hasMachineStatusPayload();
String takeMachineStatusPayload();
