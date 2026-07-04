#pragma once

#include "device_config.h"
#include "device_state.h"
#include "alarm_context.h"
#include "command_context.h"
#include "heartbeat_context.h"
#include "ota_context.h"
#include "ble_context.h"
#include "production_context.h"

struct DeviceContext
{
    DeviceConfig config;

    DeviceState state;

    AlarmContext alarm;

    CommandContext command;

    HeartbeatContext heartbeat;

    OtaContext ota;

    BleContext ble;

    ProductionContext production;
};

extern DeviceContext deviceContext;