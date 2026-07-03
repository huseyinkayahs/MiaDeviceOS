#include "app.h"

#include <Arduino.h>

#include "alarm_manager.h"
#include "alarm_publisher.h"
#include "command_manager.h"
#include "config_manager.h"
#include "display_manager.h"
#include "heartbeat_manager.h"
#include "mqtt_manager.h"
#include "ota_manager.h"
#include "sensor_manager.h"
#include "storage_manager.h"
#include "telemetry_manager.h"
#include "wifi_manager.h"
#include "app_version.h"

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

        if (hasOtaStatusPayload())
        {
            String otaStatusPayload = takeOtaStatusPayload();
            publishOtaStatus(otaStatusPayload.c_str());
        }
    }
}

void appSetup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("==================================");
    Serial.print("      ");
    Serial.print(MIA_PROJECT_NAME);
    Serial.print(" v");
    Serial.println(MIA_FIRMWARE_VERSION);
    Serial.println("==================================");
    Serial.print("Model: ");
    Serial.println(MIA_DEVICE_MODEL);
    Serial.print("Build: ");
    Serial.println(MIA_BUILD_TYPE);
    Serial.print("Device ID: ");
    Serial.println(MIA_DEVICE_ID);

    connectWiFi();

    setupStorage();

    setupConfig();

    setupMQTT();

    setupCommand();

    setupOta();

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

    updateOta();

    processMqttMessages();

    if (isOtaInProgress())
    {
        return;
    }

    updateSensors();

    updateTelemetry();

    updateHeartbeat();

    processMqttMessages();

    updateAlarm();

    updateAlarmPublisher();

    updateDisplay();
}
