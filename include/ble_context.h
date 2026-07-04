#pragma once

struct BleContext
{
    bool enabled = true;
    bool clientConnected = false;
    unsigned long lastStatusUpdateMs = 0;
    unsigned long statusIntervalMs = 5000;
    unsigned long commandCount = 0;
};
