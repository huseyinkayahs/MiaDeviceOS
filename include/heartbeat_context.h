#pragma once

struct HeartbeatContext
{
    bool enabled = true;

    unsigned long lastSentMs = 0;

    unsigned long sequence = 0;
};
