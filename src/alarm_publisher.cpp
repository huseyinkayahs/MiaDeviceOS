#include "alarm_publisher.h"

#include "device_context.h"
#include "app_version.h"
#include "mqtt_manager.h"
#include "sensor_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
    bool lastAlarmActive = false;
    AlarmType lastAlarmType = AlarmType::None;
    unsigned long lastRepeatSentMs = 0;

    const char* alarmTypeToString(AlarmType type)
    {
        switch (type)
        {
            case AlarmType::OverCurrent:
                return "OVER_CURRENT";

            case AlarmType::OverTemperature:
                return "OVER_TEMPERATURE";

            case AlarmType::WiFiDisconnected:
                return "WIFI_DISCONNECTED";

            case AlarmType::MQTTDisconnected:
                return "MQTT_DISCONNECTED";

            case AlarmType::SensorError:
                return "SENSOR_ERROR";

            default:
                return "NONE";
        }
    }

    void publishAlarmEvent(const char* eventName, AlarmType alarmType)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;
        doc["event"] = eventName;
        doc["type"] = alarmTypeToString(alarmType);
        doc["current"] = deviceContext.state.current;
        doc["current_limit"] = deviceContext.config.currentLimit;

        const bool temperatureValid = temperatureSensorHasValidReading();
        if (temperatureValid)
        {
            doc["temperature"] = temperatureSensorValueC();
        }
        else
        {
            doc["temperature"] = nullptr;
        }

        doc["temperature_limit"] = deviceContext.config.temperatureLimit;
        doc["temperature_sensor_valid"] = temperatureValid;
        doc["notification_count"] = deviceContext.alarm.notificationCount;
        doc["uptime_ms"] = millis();

        char buffer[384];
        serializeJson(doc, buffer, sizeof(buffer));

        publishAlarm(buffer);

        Serial.print("Alarm event gonderildi: ");
        Serial.println(buffer);
    }
}

void setupAlarmPublisher()
{
    lastAlarmActive = false;
    lastAlarmType = AlarmType::None;
    lastRepeatSentMs = 0;
}

void updateAlarmPublisher()
{
    const unsigned long now = millis();
    const bool alarmActive = deviceContext.alarm.active;
    const AlarmType alarmType =
        alarmActive ? deviceContext.alarm.activeAlarm : AlarmType::None;

    if (alarmActive && !lastAlarmActive)
    {
        deviceContext.alarm.notificationCount = 1;
        deviceContext.alarm.lastNotificationMs = now;
        deviceContext.alarm.published = true;
        deviceContext.alarm.acknowledged = false;

        publishAlarmEvent("ALARM_STARTED", alarmType);

        lastRepeatSentMs = now;
    }
    else if (alarmActive &&
             lastAlarmActive &&
             alarmType != lastAlarmType)
    {
        // Tek alarm baglaminda oncelik degistiginde once eski alarmi kapat,
        // sonra yeni alarmi ayri bir baslangic olayi olarak yayinla.
        publishAlarmEvent("ALARM_CLEARED", lastAlarmType);

        deviceContext.alarm.notificationCount = 1;
        deviceContext.alarm.lastNotificationMs = now;
        deviceContext.alarm.published = true;
        deviceContext.alarm.acknowledged = false;

        publishAlarmEvent("ALARM_STARTED", alarmType);

        lastRepeatSentMs = now;
    }
    else if (alarmActive && lastAlarmActive)
    {
        const unsigned long repeatIntervalMs =
            deviceContext.config.repeatIfContinuesMin * 60UL * 1000UL;

        if (now - lastRepeatSentMs >= repeatIntervalMs)
        {
            deviceContext.alarm.notificationCount++;
            deviceContext.alarm.lastNotificationMs = now;

            publishAlarmEvent("ALARM_REPEAT", alarmType);

            lastRepeatSentMs = now;
        }
    }
    else if (!alarmActive && lastAlarmActive)
    {
        // Alarm manager aktif tipi None yaptiktan sonra bile kapanan alarm
        // tipini dogru yayinlamak icin son aktif tip kullanilir.
        publishAlarmEvent("ALARM_CLEARED", lastAlarmType);

        deviceContext.alarm.notificationCount = 0;
        deviceContext.alarm.lastNotificationMs = 0;
        deviceContext.alarm.published = false;
        deviceContext.alarm.acknowledged = false;

        lastRepeatSentMs = 0;
    }

    lastAlarmActive = alarmActive;
    lastAlarmType = alarmType;
}
