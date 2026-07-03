#pragma once

#include "app_version.h"

// Central MQTT topic definitions.
// Keep all firmware MQTT topic strings in this file.
// Format: mia/<site_id>/<device_id>/<topic>

#define MIA_SITE_ID "site01"
#define MIA_TOPIC_BASE "mia/" MIA_SITE_ID "/" MIA_DEVICE_ID

namespace MiaTopics
{
    constexpr const char* CONFIG = MIA_TOPIC_BASE "/config";
    constexpr const char* GET_CONFIG = MIA_TOPIC_BASE "/getconfig";
    constexpr const char* TELEMETRY = MIA_TOPIC_BASE "/telemetry";
    constexpr const char* ALARM = MIA_TOPIC_BASE "/alarm";
    constexpr const char* COMMAND = MIA_TOPIC_BASE "/command";
    constexpr const char* COMMAND_STATUS = MIA_TOPIC_BASE "/command/status";
    constexpr const char* HEARTBEAT = MIA_TOPIC_BASE "/heartbeat";
    constexpr const char* OTA_STATUS = MIA_TOPIC_BASE "/ota/status";

    constexpr const char* TEST = "mia/test";
}
