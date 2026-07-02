#pragma once

enum class AlarmType
{
    None,
    OverCurrent,
    OverTemperature,
    WiFiDisconnected,
    MQTTDisconnected,
    SensorError
};

struct AlarmContext
{
    AlarmType activeAlarm = AlarmType::None;

    bool active = false;

    unsigned long firstDetectedMs = 0;
    unsigned long lastNotificationMs = 0;

    unsigned int notificationCount = 0;
};