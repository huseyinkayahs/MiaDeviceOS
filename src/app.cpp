#include "app.h"

#include <Arduino.h>

#include "alarm_manager.h"
#include "alarm_publisher.h"
#include "command_manager.h"
#include "config_manager.h"
#include "display_manager.h"
#include "heartbeat_manager.h"
#include "mqtt_manager.h"
#include "sensor_manager.h"
#include "storage_manager.h"
#include "telemetry_manager.h"
#include "wifi_manager.h"

namespace
{
    void processMqttMessages()
    {
        if (hasIncomingConfigPayload())
        {
            String configPayload = takeIncomingConfigPayload();

            if (applyConfigJson(configPayload.c_str()))
            {
                Serial.println("Config basariyla uygulandi.");
            }
            else
            {
                Serial.println("Config uygulanamadi.");
            }
        }

        if (hasIncomingCommandPayload())
        {
            String commandPayload = takeIncomingCommandPayload();
            handleCommandJson(commandPayload.c_str());
        }

        if (hasCommandStatusPayload())
        {
            String statusPayload = takeCommandStatusPayload();
            publishCommandStatus(statusPayload.c_str());
        }

        if (hasHeartbeatPayload())
        {
            String heartbeatPayload = takeHeartbeatPayload();
            publishHeartbeat(heartbeatPayload.c_str());
        }
    }
}

void appSetup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("==================================");
    Serial.println("      MiaDeviceOS v0.7");
    Serial.println("==================================");

    connectWiFi();

    setupStorage();

    setupConfig();

    setupMQTT();

    setupCommand();

    setupSensors();

    setupDisplay();

    setupTelemetry();

    setupHeartbeat();

    setupAlarm();

    setupAlarmPublisher();
}

void appLoop()
{
    updateWiFi();

    loopMQTT();

    processMqttMessages();

    updateCommand();

    updateSensors();

    updateTelemetry();

    updateHeartbeat();

    processMqttMessages();

    updateAlarm();

    updateAlarmPublisher();

    updateDisplay();
}
