#include "watchdog_manager.h"

#include "app_version.h"
#include "device_context.h"
#include "log_manager.h"
#include "platform/platform_system.h"

#include <ArduinoJson.h>

namespace
{
    const uint32_t DEFAULT_WATCHDOG_TIMEOUT_SEC = 30;
    const uint32_t DEFAULT_WATCHDOG_FEED_INTERVAL_MS = 1000;
}

void setupWatchdogManager()
{
    deviceContext.watchdog.enabled = true;
    deviceContext.watchdog.timeoutSec = DEFAULT_WATCHDOG_TIMEOUT_SEC;
    deviceContext.watchdog.feedIntervalMs = DEFAULT_WATCHDOG_FEED_INTERVAL_MS;
    deviceContext.watchdog.startedAtMs = millis();
    deviceContext.watchdog.lastFeedMs = 0;
    deviceContext.watchdog.feedCount = 0;

    deviceContext.watchdog.supported = MiaPlatform::watchdogSupported();
    deviceContext.watchdog.setupOk = MiaPlatform::setupWatchdog(deviceContext.watchdog.timeoutSec);

    if (deviceContext.watchdog.setupOk)
    {
        logPrint(LOG_LEVEL_INFO, "Watchdog basladi. Timeout sec: ");
        logPrintln(LOG_LEVEL_INFO, String(deviceContext.watchdog.timeoutSec));
    }
    else
    {
        logPrintln(LOG_LEVEL_WARN, "Watchdog baslatilamadi veya platform desteklemiyor.");
    }
}

void updateWatchdogManager()
{
    if (!deviceContext.watchdog.enabled || !deviceContext.watchdog.setupOk)
    {
        return;
    }

    unsigned long now = millis();

    if (deviceContext.watchdog.lastFeedMs != 0 &&
        now - deviceContext.watchdog.lastFeedMs < deviceContext.watchdog.feedIntervalMs)
    {
        return;
    }

    if (MiaPlatform::feedWatchdog())
    {
        deviceContext.watchdog.lastFeedMs = now;
        deviceContext.watchdog.feedCount++;
    }
}

String buildWatchdogJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["enabled"] = deviceContext.watchdog.enabled;
    doc["supported"] = deviceContext.watchdog.supported;
    doc["setup_ok"] = deviceContext.watchdog.setupOk;
    doc["timeout_sec"] = deviceContext.watchdog.timeoutSec;
    doc["feed_interval_ms"] = deviceContext.watchdog.feedIntervalMs;
    doc["feed_count"] = deviceContext.watchdog.feedCount;
    doc["last_feed_ms"] = deviceContext.watchdog.lastFeedMs;
    doc["uptime_ms"] = millis();

    String payload;
    serializeJson(doc, payload);
    return payload;
}
