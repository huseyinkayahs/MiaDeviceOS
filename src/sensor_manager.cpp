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
    simulatedCurrent += 0.25f;

    if (simulatedCurrent > 30.0f)
    {
        simulatedCurrent = 0.0f;
    }

    deviceContext.state.current = simulatedCurrent;
    deviceContext.state.temperature = 28.0f;
}