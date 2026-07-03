#pragma once

struct CommandContext
{
    bool resetAlarmRequested = false;

    bool restartRequested = false;
    unsigned long restartRequestedAtMs = 0;
};
