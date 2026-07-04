#include "platform/platform_system.h"

#include <Arduino.h>
#include <esp_system.h>
#include <esp_err.h>
#include <esp_task_wdt.h>
#include <esp_idf_version.h>

namespace MiaPlatform
{
    const char* name()
    {
        return "esp32-arduino";
    }

    const char* resetReason()
    {
        switch (esp_reset_reason())
        {
            case ESP_RST_POWERON:
                return "POWER_ON";

            case ESP_RST_EXT:
                return "EXTERNAL_RESET";

            case ESP_RST_SW:
                return "SOFTWARE_RESET";

            case ESP_RST_PANIC:
                return "PANIC_RESET";

            case ESP_RST_INT_WDT:
                return "INTERRUPT_WATCHDOG";

            case ESP_RST_TASK_WDT:
                return "TASK_WATCHDOG";

            case ESP_RST_WDT:
                return "OTHER_WATCHDOG";

            case ESP_RST_DEEPSLEEP:
                return "DEEP_SLEEP";

            case ESP_RST_BROWNOUT:
                return "BROWNOUT";

            case ESP_RST_SDIO:
                return "SDIO_RESET";

            default:
                return "UNKNOWN";
        }
    }

    void setup()
    {
        // Reserved for platform-level startup hooks.
        // Keep empty until a board-specific initialization is required.
    }

    void restart()
    {
        ESP.restart();
    }

    unsigned long uptimeMs()
    {
        return millis();
    }

    void delayMs(unsigned long durationMs)
    {
        delay(durationMs);
    }

    uint32_t freeHeapBytes()
    {
        return ESP.getFreeHeap();
    }

    uint32_t minFreeHeapBytes()
    {
        return ESP.getMinFreeHeap();
    }

    uint32_t flashChipSizeBytes()
    {
        return ESP.getFlashChipSize();
    }

    uint32_t sketchSizeBytes()
    {
        return ESP.getSketchSize();
    }

    uint32_t freeSketchSpaceBytes()
    {
        return ESP.getFreeSketchSpace();
    }

    bool watchdogSupported()
    {
        return true;
    }

    bool setupWatchdog(uint32_t timeoutSec)
    {
        if (timeoutSec < 5)
        {
            timeoutSec = 5;
        }

#if ESP_IDF_VERSION_MAJOR >= 5
        esp_task_wdt_config_t config = {};
        config.timeout_ms = timeoutSec * 1000U;
        config.idle_core_mask = (1 << portNUM_PROCESSORS) - 1;
        config.trigger_panic = true;

        esp_err_t initResult = esp_task_wdt_init(&config);
#else
        esp_err_t initResult = esp_task_wdt_init(timeoutSec, true);
#endif

        if (initResult != ESP_OK && initResult != ESP_ERR_INVALID_STATE)
        {
            return false;
        }

        esp_err_t addResult = esp_task_wdt_add(NULL);

        return addResult == ESP_OK || addResult == ESP_ERR_INVALID_STATE;
    }

    bool feedWatchdog()
    {
        return esp_task_wdt_reset() == ESP_OK;
    }

}
