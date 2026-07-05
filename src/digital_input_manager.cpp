#include "digital_input_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

#include "app_version.h"
#include "device_context.h"
#include "log_manager.h"

namespace
{
    bool activeFromLevel(bool level)
    {
        if (deviceContext.digitalInput.di1ActiveHigh)
        {
            return level;
        }

        return !level;
    }

    bool readDi1RawLevel()
    {
        if (deviceContext.digitalInput.di1SimulationEnabled)
        {
            // Convert simulated active state back to the logical raw level.
            if (deviceContext.digitalInput.di1ActiveHigh)
            {
                return deviceContext.digitalInput.di1SimulatedActive;
            }

            return !deviceContext.digitalInput.di1SimulatedActive;
        }

        return digitalRead(deviceContext.digitalInput.di1Pin) == HIGH;
    }

    void applyStableLevel(bool stableLevel, const char* reason)
    {
        bool active = activeFromLevel(stableLevel);

        deviceContext.digitalInput.di1PreviousActive = deviceContext.digitalInput.di1Active;
        deviceContext.digitalInput.di1StableLevel = stableLevel;
        deviceContext.digitalInput.di1Active = active;
        deviceContext.digitalInput.lastStableChangeMs = millis();
        deviceContext.digitalInput.lastReason = reason;

        if (deviceContext.digitalInput.di1PreviousActive != deviceContext.digitalInput.di1Active)
        {
            deviceContext.digitalInput.di1ChangeCount++;

            if (shouldLog(LOG_LEVEL_INFO))
            {
                Serial.print("DI1 state: ");
                Serial.println(digitalInputDi1StateName());
            }
        }
    }
}

void setupDigitalInputManager()
{
    deviceContext.digitalInput.enabled = true;
    deviceContext.digitalInput.di1Pin = 27;
    deviceContext.digitalInput.di1UsePullup = true;
    deviceContext.digitalInput.di1ActiveHigh = false;
    deviceContext.digitalInput.debounceMs = 50;
    deviceContext.digitalInput.sampleIntervalMs = 20;
    deviceContext.digitalInput.lastSampleMs = 0;
    deviceContext.digitalInput.lastCandidateChangeMs = 0;
    deviceContext.digitalInput.lastStableChangeMs = 0;
    deviceContext.digitalInput.di1ChangeCount = 0;
    deviceContext.digitalInput.lastReason = "BOOT";

    pinMode(
        deviceContext.digitalInput.di1Pin,
        deviceContext.digitalInput.di1UsePullup ? INPUT_PULLUP : INPUT
    );

    bool rawLevel = readDi1RawLevel();
    deviceContext.digitalInput.di1RawLevel = rawLevel;
    deviceContext.digitalInput.di1StableLevel = rawLevel;
    deviceContext.digitalInput.di1Active = activeFromLevel(rawLevel);
    deviceContext.digitalInput.di1PreviousActive = deviceContext.digitalInput.di1Active;

    logPrint(LOG_LEVEL_INFO, "Digital input manager basladi. DI1 pin: ");
    logPrintln(LOG_LEVEL_INFO, String(deviceContext.digitalInput.di1Pin));
}

void updateDigitalInputManager()
{
    if (!deviceContext.digitalInput.enabled)
    {
        return;
    }

    unsigned long now = millis();

    if (deviceContext.digitalInput.lastSampleMs != 0 &&
        now - deviceContext.digitalInput.lastSampleMs < deviceContext.digitalInput.sampleIntervalMs)
    {
        return;
    }

    deviceContext.digitalInput.lastSampleMs = now;

    bool rawLevel = readDi1RawLevel();

    if (rawLevel != deviceContext.digitalInput.di1RawLevel)
    {
        deviceContext.digitalInput.di1RawLevel = rawLevel;
        deviceContext.digitalInput.lastCandidateChangeMs = now;
        return;
    }

    if (rawLevel != deviceContext.digitalInput.di1StableLevel &&
        deviceContext.digitalInput.lastCandidateChangeMs != 0 &&
        now - deviceContext.digitalInput.lastCandidateChangeMs >= deviceContext.digitalInput.debounceMs)
    {
        applyStableLevel(rawLevel, deviceContext.digitalInput.di1SimulationEnabled ? "DI1_SIMULATION" : "DI1_DEBOUNCED");
    }
}

bool digitalInputDi1Active()
{
    return deviceContext.digitalInput.di1Active;
}

bool digitalInputDi1SimulationEnabled()
{
    return deviceContext.digitalInput.di1SimulationEnabled;
}

const char* digitalInputDi1StateName()
{
    return deviceContext.digitalInput.di1Active ? "ACTIVE" : "INACTIVE";
}

const char* digitalInputDi1SourceName()
{
    return deviceContext.digitalInput.di1SimulationEnabled ? "SIMULATION" : "GPIO";
}

void setDigitalInputDi1Simulation(bool enabled, bool active)
{
    deviceContext.digitalInput.di1SimulationEnabled = enabled;
    deviceContext.digitalInput.di1SimulatedActive = active;

    bool rawLevel = readDi1RawLevel();
    deviceContext.digitalInput.di1RawLevel = rawLevel;
    applyStableLevel(rawLevel, enabled ? "DI1_SIMULATION_SET" : "DI1_SIMULATION_DISABLED");
}

String buildDigitalInputJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["uptime_ms"] = millis();

    JsonObject digitalInputs = doc["digital_inputs"].to<JsonObject>();
    JsonObject di1 = digitalInputs["di1"].to<JsonObject>();
    di1["pin"] = deviceContext.digitalInput.di1Pin;
    di1["raw_level"] = deviceContext.digitalInput.di1StableLevel ? "HIGH" : "LOW";
    di1["active"] = deviceContext.digitalInput.di1Active;
    di1["state"] = digitalInputDi1StateName();
    di1["source"] = digitalInputDi1SourceName();
    di1["active_high"] = deviceContext.digitalInput.di1ActiveHigh;
    di1["pullup"] = deviceContext.digitalInput.di1UsePullup;
    di1["debounce_ms"] = deviceContext.digitalInput.debounceMs;
    di1["change_count"] = deviceContext.digitalInput.di1ChangeCount;
    di1["last_change_ms"] = deviceContext.digitalInput.lastStableChangeMs;
    di1["simulation_enabled"] = deviceContext.digitalInput.di1SimulationEnabled;
    di1["simulated_active"] = deviceContext.digitalInput.di1SimulatedActive;
    di1["last_reason"] = deviceContext.digitalInput.lastReason;

    String payload;
    serializeJson(doc, payload);
    return payload;
}
