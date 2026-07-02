#include "app.h"
#include <Arduino.h>
#include "wifi_manager.h"
#include "storage_manager.h"
#include "config_manager.h"
#include "mqtt_manager.h"
#include "sensor_manager.h"
#include "display_manager.h"
#include "telemetry_manager.h"
#include "alarm_manager.h"
#include "alarm_publisher.h"

void appSetup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("==================================");
    Serial.println("      MiaDeviceOS v0.2");
    Serial.println("==================================");

    connectWiFi();

    setupStorage();

    setupConfig();

    setupMQTT();

    setupSensors();

    setupDisplay();

    setupTelemetry();

    setupAlarm();

    setupAlarmPublisher();
}

void appLoop()
{
    updateWiFi();

    loopMQTT();

    updateSensors();

    updateTelemetry();

    updateAlarm();

    updateAlarmPublisher();

    updateDisplay();
}