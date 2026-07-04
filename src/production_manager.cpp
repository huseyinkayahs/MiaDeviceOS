#include "production_manager.h"

#include "app_version.h"
#include "device_context.h"
#include "log_manager.h"
#include "platform/platform_system.h"

#include <ArduinoJson.h>
#include <Preferences.h>

namespace
{
    Preferences productionPreferences;
    bool productionReady = false;

    const char* PRODUCTION_NAMESPACE = "production";
    const char* KEY_BOOT_COUNT = "bootCount";

    const unsigned long HEALTH_CHECK_INTERVAL_MS = 10000;

    void ensureProductionReady()
    {
        if (!productionReady)
        {
            productionPreferences.begin(PRODUCTION_NAMESPACE, false);
            productionReady = true;
        }
    }

    unsigned long incrementBootCount()
    {
        ensureProductionReady();

        unsigned long count = productionPreferences.getULong(KEY_BOOT_COUNT, 0);
        count++;
        productionPreferences.putULong(KEY_BOOT_COUNT, count);
        return count;
    }

    bool isLowHeap()
    {
        return MiaPlatform::freeHeapBytes() < deviceContext.production.lowHeapThresholdBytes;
    }
}

void setupProductionManager()
{
    ensureProductionReady();

    deviceContext.production.enabled = true;
    deviceContext.production.bootCount = incrementBootCount();
    deviceContext.production.resetReason = MiaPlatform::resetReason();
    deviceContext.production.startedAtMs = millis();
    deviceContext.production.lowHeapThresholdBytes = 30000;
    deviceContext.production.lowHeapWarningActive = false;
    deviceContext.production.lowHeapWarningCount = 0;
    deviceContext.production.lastHealthCheckMs = 0;

    logPrint(LOG_LEVEL_INFO, "Production health monitor basladi. Boot count: ");
    logPrint(LOG_LEVEL_INFO, String(deviceContext.production.bootCount));
    logPrint(LOG_LEVEL_INFO, " Reset reason: ");
    logPrintln(LOG_LEVEL_INFO, deviceContext.production.resetReason);
}

void updateProductionManager()
{
    if (!deviceContext.production.enabled)
    {
        return;
    }

    unsigned long now = millis();

    if (deviceContext.production.lastHealthCheckMs != 0 &&
        now - deviceContext.production.lastHealthCheckMs < HEALTH_CHECK_INTERVAL_MS)
    {
        return;
    }

    deviceContext.production.lastHealthCheckMs = now;

    bool lowHeap = isLowHeap();

    if (lowHeap && !deviceContext.production.lowHeapWarningActive)
    {
        deviceContext.production.lowHeapWarningActive = true;
        deviceContext.production.lowHeapWarningCount++;

        logPrint(LOG_LEVEL_WARN, "LOW HEAP WARNING. Free heap: ");
        logPrintln(LOG_LEVEL_WARN, String(MiaPlatform::freeHeapBytes()));
    }

    if (!lowHeap && deviceContext.production.lowHeapWarningActive)
    {
        deviceContext.production.lowHeapWarningActive = false;
        logPrintln(LOG_LEVEL_INFO, "Heap normale dondu.");
    }
}

const char* productionHealthStatus()
{
    if (!deviceContext.state.wifiConnected || !deviceContext.state.mqttConnected)
    {
        return "WARN";
    }

    if (deviceContext.production.lowHeapWarningActive)
    {
        return "WARN";
    }

    if (deviceContext.ota.inProgress)
    {
        return "OTA";
    }

    if (deviceContext.alarm.active)
    {
        return "ALARM";
    }

    return "OK";
}

String buildProductionHealthJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["health_status"] = productionHealthStatus();
    doc["uptime_ms"] = millis();
    doc["boot_count"] = deviceContext.production.bootCount;
    doc["reset_reason"] = deviceContext.production.resetReason;
    doc["free_heap"] = MiaPlatform::freeHeapBytes();
    doc["min_free_heap"] = MiaPlatform::minFreeHeapBytes();
    doc["low_heap_threshold"] = deviceContext.production.lowHeapThresholdBytes;
    doc["low_heap_warning"] = deviceContext.production.lowHeapWarningActive;
    doc["low_heap_warning_count"] = deviceContext.production.lowHeapWarningCount;
    doc["wifi_connected"] = deviceContext.state.wifiConnected;
    doc["mqtt_connected"] = deviceContext.state.mqttConnected;
    doc["alarm_active"] = deviceContext.alarm.active;
    doc["ota_in_progress"] = deviceContext.ota.inProgress;

    String payload;
    serializeJson(doc, payload);
    return payload;
}
