#pragma once

#include <Arduino.h>

struct BleContext
{
    bool enabled = true;
    bool clientConnected = false;
    bool serviceAuthenticated = false;

    unsigned long lastStatusUpdateMs = 0;
    unsigned long statusIntervalMs = 5000;
    unsigned long commandCount = 0;
    unsigned long rejectedCommandCount = 0;
    unsigned long failedAuthCount = 0;

    String lastCommand = "";
    String lastCommandStatus = "idle";
    String lastCommandMessage = "";
};
