#include "alarm_manager.h"

#include "device_context.h"

#include <Arduino.h>

enum AlarmEngineState
{
    ALARM_ENGINE_NORMAL,
    ALARM_ENGINE_WAITING,
    ALARM_ENGINE_ACTIVE
};

AlarmEngineState overCurrentState = ALARM_ENGINE_NORMAL;

void resetAlarmContext()
{
    overCurrentState = ALARM_ENGINE_NORMAL;

    deviceContext.alarm.active = false;
    deviceContext.alarm.activeAlarm = AlarmType::None;
    deviceContext.alarm.published = false;
    deviceContext.alarm.acknowledged = true;
    deviceContext.alarm.firstDetectedMs = 0;
    deviceContext.alarm.lastNotificationMs = 0;
    deviceContext.alarm.notificationCount = 0;
}

void setupAlarm()
{
    resetAlarmContext();
    deviceContext.alarm.acknowledged = false;
}

void updateAlarm()
{
    bool overLimit =
        deviceContext.state.current > deviceContext.config.currentLimit;

    unsigned long now = millis();

    if (deviceContext.command.resetAlarmRequested)
    {
        deviceContext.command.resetAlarmRequested = false;
        resetAlarmContext();

        Serial.println("Alarm reset komutu uygulandi.");
    }

    switch (overCurrentState)
    {
        case ALARM_ENGINE_NORMAL:
            deviceContext.alarm.active = false;
            deviceContext.alarm.activeAlarm = AlarmType::None;

            if (overLimit)
            {
                overCurrentState = ALARM_ENGINE_WAITING;
                deviceContext.alarm.firstDetectedMs = now;

                Serial.println("Alarm izleme basladi: OverCurrent");
            }
            break;

        case ALARM_ENGINE_WAITING:
        {
            unsigned long overCurrentDelayMs =
                deviceContext.config.overCurrentDelaySec * 1000UL;

            if (!overLimit)
            {
                overCurrentState = ALARM_ENGINE_NORMAL;

                deviceContext.alarm.active = false;
                deviceContext.alarm.activeAlarm = AlarmType::None;
                deviceContext.alarm.firstDetectedMs = 0;

                Serial.println("Alarm iptal: current normale dondu");
            }
            else if (now - deviceContext.alarm.firstDetectedMs >= overCurrentDelayMs)
            {
                overCurrentState = ALARM_ENGINE_ACTIVE;

                deviceContext.alarm.active = true;
                deviceContext.alarm.activeAlarm = AlarmType::OverCurrent;
                deviceContext.alarm.lastNotificationMs = now;
                deviceContext.alarm.notificationCount++;

                Serial.println("ALARM AKTIF: OverCurrent");
            }

            break;
        }

        case ALARM_ENGINE_ACTIVE:
            deviceContext.alarm.active = true;
            deviceContext.alarm.activeAlarm = AlarmType::OverCurrent;

            if (!overLimit)
            {
                overCurrentState = ALARM_ENGINE_NORMAL;

                deviceContext.alarm.active = false;
                deviceContext.alarm.activeAlarm = AlarmType::None;
                deviceContext.alarm.firstDetectedMs = 0;

                Serial.println("ALARM KAPANDI: current normale dondu");
            }
            break;
    }
}
