#include "alarm_publisher.h"

#include "device_context.h"
#include "app_version.h"
#include "mqtt_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

bool lastAlarmActive = false;
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

void setupAlarmPublisher()
{
    lastAlarmActive = false;
}

void publishAlarmEvent(const char* eventName)
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["event"] = eventName;
    doc["type"] = alarmTypeToString(deviceContext.alarm.activeAlarm);
    doc["current"] = deviceContext.state.current;
    doc["current_limit"] = deviceContext.config.currentLimit;
    doc["notification_count"] = deviceContext.alarm.notificationCount;
    doc["uptime_ms"] = millis();

    char buffer[256];
    serializeJson(doc, buffer);

    publishAlarm(buffer);

    Serial.print("Alarm event gonderildi: ");
    Serial.println(buffer);
}

void updateAlarmPublisher()
{
    unsigned long now = millis();

    if (deviceContext.alarm.active && !lastAlarmActive)
    {
        deviceContext.alarm.notificationCount = 1;
        deviceContext.alarm.lastNotificationMs = now;
        deviceContext.alarm.published = true;

        publishAlarmEvent("ALARM_STARTED");

        lastRepeatSentMs = now;
    }

    if (deviceContext.alarm.active && lastAlarmActive)
    {
        unsigned long repeatIntervalMs =
            deviceContext.config.repeatIfContinuesMin * 60UL * 1000UL;

        if (now - lastRepeatSentMs >= repeatIntervalMs)
        {
            deviceContext.alarm.notificationCount++;
            deviceContext.alarm.lastNotificationMs = now;

            publishAlarmEvent("ALARM_REPEAT");

            lastRepeatSentMs = now;
        }
    }

    if (!deviceContext.alarm.active && lastAlarmActive)
    {
        publishAlarmEvent("ALARM_CLEARED");

        deviceContext.alarm.notificationCount = 0;
        deviceContext.alarm.lastNotificationMs = 0;
        deviceContext.alarm.published = false;
        deviceContext.alarm.acknowledged = false;

        lastRepeatSentMs = 0;
    }

    lastAlarmActive = deviceContext.alarm.active;
}