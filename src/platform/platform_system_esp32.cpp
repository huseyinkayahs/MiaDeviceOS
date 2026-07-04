#include "platform/platform_system.h"

#include <Arduino.h>
#include <esp_system.h>

namespace MiaPlatform
{
    const char* name()
    {
        return "esp32-arduino";
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
}
