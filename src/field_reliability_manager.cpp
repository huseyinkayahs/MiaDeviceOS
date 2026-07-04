#include "field_reliability_manager.h"

#include "app_version.h"
#include "device_context.h"
#include "log_manager.h"
#include "platform/platform_system.h"

#include <ArduinoJson.h>

namespace
{
    const uint32_t DEFAULT_CHECK_INTERVAL_MS = 5000;
    const uint32_t DEFAULT_OFFLINE_WARNING_THRESHOLD_MS = 60000;

    unsigned long currentOfflineDuration(bool connected, unsigned long sinceMs)
    {
        if (connected || sinceMs == 0)
        {
            return 0;
        }

        return millis() - sinceMs;
    }

    int calculateReliabilityScore()
    {
        int score = 100;

        if (!deviceContext.state.wifiConnected)
        {
            score -= 50;
        }

        if (!deviceContext.state.mqttConnected)
        {
            score -= 25;
        }

        if (deviceContext.production.lowHeapWarningActive)
        {
            score -= 10;
        }

        if (deviceContext.watchdog.enabled && !deviceContext.watchdog.setupOk)
        {
            score -= 10;
        }

        if (deviceContext.alarm.active)
        {
            score -= 5;
        }

        unsigned int dropPenalty = deviceContext.fieldReliability.wifiDropEvents +
                                   deviceContext.fieldReliability.mqttDropEvents;

        if (dropPenalty > 10)
        {
            dropPenalty = 10;
        }

        score -= static_cast<int>(dropPenalty);

        if (score < 0)
        {
            score = 0;
        }

        return score;
    }

    void updateConnectionTracking(unsigned long now)
    {
        bool wifiConnected = deviceContext.state.wifiConnected;
        bool mqttConnected = deviceContext.state.mqttConnected;

        if (deviceContext.fieldReliability.firstSample)
        {
            deviceContext.fieldReliability.previousWifiConnected = wifiConnected;
            deviceContext.fieldReliability.previousMqttConnected = mqttConnected;

            if (!wifiConnected)
            {
                deviceContext.fieldReliability.wifiOfflineSinceMs = now;
            }

            if (!mqttConnected)
            {
                deviceContext.fieldReliability.mqttOfflineSinceMs = now;
            }

            deviceContext.fieldReliability.firstSample = false;
            return;
        }

        if (deviceContext.fieldReliability.previousWifiConnected && !wifiConnected)
        {
            deviceContext.fieldReliability.wifiDropEvents++;
            deviceContext.fieldReliability.wifiOfflineSinceMs = now;
            deviceContext.fieldReliability.wifiOfflineWarning = false;
            logPrintln(LOG_LEVEL_WARN, "Field reliability: WiFi drop detected.");
        }

        if (!deviceContext.fieldReliability.previousWifiConnected && wifiConnected)
        {
            deviceContext.fieldReliability.wifiOfflineSinceMs = 0;
            deviceContext.fieldReliability.wifiOfflineWarning = false;
            logPrintln(LOG_LEVEL_INFO, "Field reliability: WiFi recovered.");
        }

        if (deviceContext.fieldReliability.previousMqttConnected && !mqttConnected)
        {
            deviceContext.fieldReliability.mqttDropEvents++;
            deviceContext.fieldReliability.mqttOfflineSinceMs = now;
            deviceContext.fieldReliability.mqttOfflineWarning = false;
            logPrintln(LOG_LEVEL_WARN, "Field reliability: MQTT drop detected.");
        }

        if (!deviceContext.fieldReliability.previousMqttConnected && mqttConnected)
        {
            deviceContext.fieldReliability.mqttOfflineSinceMs = 0;
            deviceContext.fieldReliability.mqttOfflineWarning = false;
            logPrintln(LOG_LEVEL_INFO, "Field reliability: MQTT recovered.");
        }

        if (!wifiConnected && deviceContext.fieldReliability.wifiOfflineSinceMs == 0)
        {
            deviceContext.fieldReliability.wifiOfflineSinceMs = now;
        }

        if (!mqttConnected && deviceContext.fieldReliability.mqttOfflineSinceMs == 0)
        {
            deviceContext.fieldReliability.mqttOfflineSinceMs = now;
        }

        deviceContext.fieldReliability.previousWifiConnected = wifiConnected;
        deviceContext.fieldReliability.previousMqttConnected = mqttConnected;
    }

    void updateWarnings()
    {
        unsigned long wifiOfflineMs = fieldReliabilityWifiOfflineMs();
        unsigned long mqttOfflineMs = fieldReliabilityMqttOfflineMs();
        uint32_t threshold = deviceContext.fieldReliability.offlineWarningThresholdMs;

        if (wifiOfflineMs >= threshold && !deviceContext.fieldReliability.wifiOfflineWarning)
        {
            deviceContext.fieldReliability.wifiOfflineWarning = true;
            deviceContext.fieldReliability.warningCount++;
            logPrintln(LOG_LEVEL_WARN, "Field reliability warning: WiFi offline too long.");
        }

        if (mqttOfflineMs >= threshold && !deviceContext.fieldReliability.mqttOfflineWarning)
        {
            deviceContext.fieldReliability.mqttOfflineWarning = true;
            deviceContext.fieldReliability.warningCount++;
            logPrintln(LOG_LEVEL_WARN, "Field reliability warning: MQTT offline too long.");
        }
    }

    void updateStatus()
    {
        if (deviceContext.ota.inProgress)
        {
            deviceContext.fieldReliability.status = "OTA";
            deviceContext.fieldReliability.issue = "OTA_IN_PROGRESS";
            return;
        }

        if (!deviceContext.state.wifiConnected)
        {
            deviceContext.fieldReliability.status = "OFFLINE";
            deviceContext.fieldReliability.issue = "WIFI_OFFLINE";
            return;
        }

        if (!deviceContext.state.mqttConnected)
        {
            deviceContext.fieldReliability.status = "DEGRADED";
            deviceContext.fieldReliability.issue = "MQTT_OFFLINE";
            return;
        }

        if (deviceContext.production.lowHeapWarningActive)
        {
            deviceContext.fieldReliability.status = "DEGRADED";
            deviceContext.fieldReliability.issue = "LOW_HEAP";
            return;
        }

        if (deviceContext.watchdog.enabled && !deviceContext.watchdog.setupOk)
        {
            deviceContext.fieldReliability.status = "DEGRADED";
            deviceContext.fieldReliability.issue = "WATCHDOG_SETUP_FAILED";
            return;
        }

        if (deviceContext.alarm.active)
        {
            deviceContext.fieldReliability.status = "ALARM";
            deviceContext.fieldReliability.issue = "ALARM_ACTIVE";
            return;
        }

        deviceContext.fieldReliability.status = "OK";
        deviceContext.fieldReliability.issue = "NONE";
    }
}

void setupFieldReliabilityManager()
{
    deviceContext.fieldReliability.enabled = true;
    deviceContext.fieldReliability.firstSample = true;
    deviceContext.fieldReliability.status = "STARTING";
    deviceContext.fieldReliability.issue = "STARTUP";
    deviceContext.fieldReliability.score = 100;
    deviceContext.fieldReliability.startedAtMs = millis();
    deviceContext.fieldReliability.lastCheckMs = 0;
    deviceContext.fieldReliability.checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS;
    deviceContext.fieldReliability.offlineWarningThresholdMs = DEFAULT_OFFLINE_WARNING_THRESHOLD_MS;
    deviceContext.fieldReliability.previousWifiConnected = false;
    deviceContext.fieldReliability.previousMqttConnected = false;
    deviceContext.fieldReliability.wifiOfflineSinceMs = 0;
    deviceContext.fieldReliability.mqttOfflineSinceMs = 0;
    deviceContext.fieldReliability.wifiDropEvents = 0;
    deviceContext.fieldReliability.mqttDropEvents = 0;
    deviceContext.fieldReliability.wifiOfflineWarning = false;
    deviceContext.fieldReliability.mqttOfflineWarning = false;
    deviceContext.fieldReliability.warningCount = 0;

    logPrintln(LOG_LEVEL_INFO, "Field reliability layer basladi.");
}

void updateFieldReliabilityManager()
{
    if (!deviceContext.fieldReliability.enabled)
    {
        return;
    }

    unsigned long now = millis();

    if (deviceContext.fieldReliability.lastCheckMs != 0 &&
        now - deviceContext.fieldReliability.lastCheckMs < deviceContext.fieldReliability.checkIntervalMs)
    {
        return;
    }

    deviceContext.fieldReliability.lastCheckMs = now;

    updateConnectionTracking(now);
    updateWarnings();
    updateStatus();
    deviceContext.fieldReliability.score = calculateReliabilityScore();
}

const char* fieldReliabilityStatus()
{
    return deviceContext.fieldReliability.status;
}

const char* fieldReliabilityIssue()
{
    return deviceContext.fieldReliability.issue;
}

int fieldReliabilityScore()
{
    return deviceContext.fieldReliability.score;
}

unsigned long fieldReliabilityWifiOfflineMs()
{
    return currentOfflineDuration(
        deviceContext.state.wifiConnected,
        deviceContext.fieldReliability.wifiOfflineSinceMs
    );
}

unsigned long fieldReliabilityMqttOfflineMs()
{
    return currentOfflineDuration(
        deviceContext.state.mqttConnected,
        deviceContext.fieldReliability.mqttOfflineSinceMs
    );
}

String buildFieldReliabilityJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["uptime_ms"] = millis();
    doc["status"] = fieldReliabilityStatus();
    doc["issue"] = fieldReliabilityIssue();
    doc["score"] = fieldReliabilityScore();
    doc["wifi_connected"] = deviceContext.state.wifiConnected;
    doc["mqtt_connected"] = deviceContext.state.mqttConnected;
    doc["wifi_drop_events"] = deviceContext.fieldReliability.wifiDropEvents;
    doc["mqtt_drop_events"] = deviceContext.fieldReliability.mqttDropEvents;
    doc["wifi_offline_ms"] = fieldReliabilityWifiOfflineMs();
    doc["mqtt_offline_ms"] = fieldReliabilityMqttOfflineMs();
    doc["wifi_offline_warning"] = deviceContext.fieldReliability.wifiOfflineWarning;
    doc["mqtt_offline_warning"] = deviceContext.fieldReliability.mqttOfflineWarning;
    doc["warning_count"] = deviceContext.fieldReliability.warningCount;
    doc["offline_warning_threshold_ms"] = deviceContext.fieldReliability.offlineWarningThresholdMs;
    doc["low_heap_warning"] = deviceContext.production.lowHeapWarningActive;
    doc["alarm_active"] = deviceContext.alarm.active;
    doc["ota_in_progress"] = deviceContext.ota.inProgress;
    doc["watchdog_setup_ok"] = deviceContext.watchdog.setupOk;

    String payload;
    serializeJson(doc, payload);
    return payload;
}
