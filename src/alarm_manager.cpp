#include "alarm_manager.h"
#include "device_context.h"

#include <Arduino.h>

enum AlarmState {
    ALARM_STATE_NORMAL,
    ALARM_STATE_LIMIT_EXCEEDED_WAITING,
    ALARM_STATE_ACTIVE
};

AlarmState overCurrentState = ALARM_STATE_NORMAL;

unsigned long overCurrentStartTime = 0;

const unsigned long OVER_CURRENT_DELAY_MS = 10000; // test için 10 saniye

void setupAlarm()
{
    overCurrentState = ALARM_STATE_NORMAL;
    overCurrentStartTime = 0;
    deviceContext.state.alarmActive = false;
}

void updateAlarm()
{
    bool overLimit =
        deviceContext.state.current > deviceContext.config.currentLimit;

    switch (overCurrentState)
    {
        case ALARM_STATE_NORMAL:
            deviceContext.state.alarmActive = false;

            if (overLimit)
            {
                overCurrentStartTime = millis();
                overCurrentState = ALARM_STATE_LIMIT_EXCEEDED_WAITING;

                Serial.println("Alarm izleme basladi: Over current");
            }
            break;

        case ALARM_STATE_LIMIT_EXCEEDED_WAITING:
            if (!overLimit)
            {
                overCurrentState = ALARM_STATE_NORMAL;
                overCurrentStartTime = 0;
                deviceContext.state.alarmActive = false;

                Serial.println("Alarm iptal: current normale dondu");
            }
            else if (millis() - overCurrentStartTime >= OVER_CURRENT_DELAY_MS)
            {
                overCurrentState = ALARM_STATE_ACTIVE;
                deviceContext.state.alarmActive = true;

                Serial.println("ALARM AKTIF: Over current");
            }
            break;

        case ALARM_STATE_ACTIVE:
            deviceContext.state.alarmActive = true;

            if (!overLimit)
            {
                overCurrentState = ALARM_STATE_NORMAL;
                overCurrentStartTime = 0;
                deviceContext.state.alarmActive = false;

                Serial.println("ALARM KAPANDI: current normale dondu");
            }
            break;
    }
}