#pragma once

#include <Arduino.h>

void setupDigitalInputManager();
void updateDigitalInputManager();

bool digitalInputDi1Active();
bool digitalInputDi1SimulationEnabled();
const char* digitalInputDi1StateName();
const char* digitalInputDi1SourceName();

void setDigitalInputDi1Simulation(bool enabled, bool active);
String buildDigitalInputJson();

// Event payload published whenever the stable DI1 state changes.
bool hasDigitalInputStatusPayload();
String takeDigitalInputStatusPayload();
