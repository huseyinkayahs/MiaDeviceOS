#include "alarm_manager.h"

#include "device_context.h"
#include "sensor_manager.h"

#include <Arduino.h>

namespace
{
    enum AlarmEngineState
    {
        ALARM_ENGINE_NORMAL,
        ALARM_ENGINE_WAITING,
        ALARM_ENGINE_ACTIVE
    };

    constexpr unsigned long TEMPERATURE_ALARM_DELAY_MS = 5000UL;

    AlarmEngineState overCurrentState = ALARM_ENGINE_NORMAL;
    AlarmEngineState overTemperatureState = ALARM_ENGINE_NORMAL;

    unsigned long overCurrentDetectedAtMs = 0;
    unsigned long overTemperatureDetectedAtMs = 0;

    void resetAlarmEngines()
    {
        overCurrentState = ALARM_ENGINE_NORMAL;
        overTemperatureState = ALARM_ENGINE_NORMAL;

        overCurrentDetectedAtMs = 0;
        overTemperatureDetectedAtMs = 0;
    }

    bool updateAlarmEngine(
        AlarmEngineState& state,
        unsigned long& firstDetectedAtMs,
        bool overLimit,
        unsigned long activationDelayMs,
        unsigned long now,
        const char* label)
    {
        switch (state)
        {
            case ALARM_ENGINE_NORMAL:
                if (overLimit)
                {
                    state = ALARM_ENGINE_WAITING;
                    firstDetectedAtMs = now;

                    Serial.print("Alarm izleme basladi: ");
                    Serial.println(label);
                }
                break;

            case ALARM_ENGINE_WAITING:
                if (!overLimit)
                {
                    state = ALARM_ENGINE_NORMAL;
                    firstDetectedAtMs = 0;

                    Serial.print("Alarm iptal: ");
                    Serial.print(label);
                    Serial.println(" normale dondu");
                }
                else if (now - firstDetectedAtMs >= activationDelayMs)
                {
                    state = ALARM_ENGINE_ACTIVE;

                    Serial.print("ALARM AKTIF: ");
                    Serial.println(label);
                }
                break;

            case ALARM_ENGINE_ACTIVE:
                if (!overLimit)
                {
                    state = ALARM_ENGINE_NORMAL;
                    firstDetectedAtMs = 0;

                    Serial.print("ALARM KAPANDI: ");
                    Serial.print(label);
                    Serial.println(" normale dondu");
                }
                break;
        }

        return state == ALARM_ENGINE_ACTIVE;
    }

    unsigned long firstDetectedAtFor(AlarmType type)
    {
        switch (type)
        {
            case AlarmType::OverTemperature:
                return overTemperatureDetectedAtMs;

            case AlarmType::OverCurrent:
                return overCurrentDetectedAtMs;

            default:
                return 0;
        }
    }
}

void resetAlarmContext()
{
    resetAlarmEngines();

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
    const bool overCurrentLimit =
        currentSensorHasValidReading() &&
        deviceContext.state.current > deviceContext.config.currentLimit;

    const bool overTemperatureLimit =
        temperatureSensorHasValidReading() &&
        temperatureSensorValueC() > deviceContext.config.temperatureLimit;

    const unsigned long now = millis();

    if (deviceContext.command.resetAlarmRequested)
    {
        deviceContext.command.resetAlarmRequested = false;
        resetAlarmContext();

        Serial.println("Alarm reset komutu uygulandi.");
    }

    const unsigned long overCurrentDelayMs =
        deviceContext.config.overCurrentDelaySec * 1000UL;

    const bool overCurrentActive = updateAlarmEngine(
        overCurrentState,
        overCurrentDetectedAtMs,
        overCurrentLimit,
        overCurrentDelayMs,
        now,
        "OverCurrent");

    const bool overTemperatureActive = updateAlarmEngine(
        overTemperatureState,
        overTemperatureDetectedAtMs,
        overTemperatureLimit,
        TEMPERATURE_ALARM_DELAY_MS,
        now,
        "OverTemperature");

    // Tek alarm baglami kullanildigi icin ayni anda iki alarm varsa
    // daha kritik saha riski olan sicaklik alarmi onceliklidir.
    AlarmType selectedAlarm = AlarmType::None;

    if (overTemperatureActive)
    {
        selectedAlarm = AlarmType::OverTemperature;
    }
    else if (overCurrentActive)
    {
        selectedAlarm = AlarmType::OverCurrent;
    }

    const bool wasActive = deviceContext.alarm.active;
    const AlarmType previousAlarm = deviceContext.alarm.activeAlarm;

    deviceContext.alarm.active = selectedAlarm != AlarmType::None;
    deviceContext.alarm.activeAlarm = selectedAlarm;
    deviceContext.alarm.firstDetectedMs = firstDetectedAtFor(selectedAlarm);

    if (deviceContext.alarm.active &&
        (!wasActive || previousAlarm != selectedAlarm))
    {
        deviceContext.alarm.published = false;
        deviceContext.alarm.acknowledged = false;
    }
}
