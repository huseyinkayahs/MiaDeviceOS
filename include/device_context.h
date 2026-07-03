#pragma once

#include "device_config.h"
#include "device_state.h"
#include "alarm_context.h"
#include "command_context.h"

struct DeviceContext
{
    DeviceConfig config;

    DeviceState state;

    AlarmContext alarm;

    CommandContext command;
};

extern DeviceContext deviceContext;