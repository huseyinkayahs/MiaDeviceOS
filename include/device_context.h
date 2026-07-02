#pragma once

#include "device_config.h"
#include "device_state.h"
#include "alarm_context.h"

struct DeviceContext
{
    DeviceConfig config;

    DeviceState state;

    AlarmContext alarm;
};

extern DeviceContext deviceContext;