#pragma once

#include "device_config.h"
#include "device_state.h"

struct DeviceContext {
    DeviceConfig config;
    DeviceState state;
};

extern DeviceContext deviceContext;