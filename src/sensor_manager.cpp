#include "sensor_manager.h"
#include "device_context.h"

#include <Arduino.h>

float simulatedCurrent = 0.0f;

void setupSensors()
{
    simulatedCurrent = 0.0f;
}

void updateSensors()
{
    deviceContext.state.current = 20.0f;   // limit üstü sabit test
    deviceContext.state.temperature = 28.0f;
}