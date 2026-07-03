#pragma once

#include "device_config.h"
#include "device_state.h"
#include "alarm_context.h"
#include "command_context.h"
#include "heartbeat_context.h"

struct DeviceContext
{
    DeviceConfig config;

    DeviceState state;

    AlarmContext alarm;

    CommandContext command;

    HeartbeatContext heartbeat;
};

extern DeviceContext deviceContext;