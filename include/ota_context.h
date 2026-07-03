#pragma once

#include <Arduino.h>

struct OtaContext
{
    bool updateRequested = false;
    bool inProgress = false;
    bool downloadingStatusPrepared = false;
    bool restartPending = false;

    String requestId = "";
    String url = "";
    String targetVersion = "";

    unsigned long requestedAtMs = 0;
    unsigned long downloadStartAtMs = 0;
    unsigned long restartAtMs = 0;
};
