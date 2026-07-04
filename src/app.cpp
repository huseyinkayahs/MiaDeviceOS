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
#include "ble_manager.h"
#include "platform/platform_system.h"
#include "log_manager.h"
#include "runtime_settings_manager.h"

namespace
{
    void processMqttMessages()
    {
        if (hasIncomingConfigPayload())
        {
            String configPayload = takeIncomingConfigPayload();

            if (applyConfigJson(configPayload.c_str()))
            {
                logPrintln(LOG_LEVEL_INFO, "Config basariyla uygulandi.");
            }
            else
            {
                logPrintln(LOG_LEVEL_WARN, "Config reddedildi.");
            }
        }

        if (hasConfigStatusPayload())
        {
            String configStatusPayload = takeConfigStatusPayload();
            publishConfigStatus(configStatusPayload.c_str());
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

    setupRuntimeSettings();

    setupLogManager();

    MiaPlatform::setup();

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
    Serial.print("Platform: ");
    Serial.println(MIA_PLATFORM_NAME);
    Serial.print("Device ID: ");
    Serial.println(MIA_DEVICE_ID);
    Serial.print("Log Level: ");
    Serial.println(currentLogLevelName());

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

    setupBLE();

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

    updateBLE();

    processMqttMessages();

    if (isOtaInProgress())
    {
        return;
    }

    updateSensors();

    updateTelemetry();

    updateHeartbeat();

    updateBLE();

    processMqttMessages();

    updateAlarm();

    updateAlarmPublisher();

    updateDisplay();
}
