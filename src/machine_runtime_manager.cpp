#include "machine_runtime_manager.h"

#include "app_version.h"
#include "device_context.h"
#include "log_manager.h"

#include <ArduinoJson.h>

namespace
{
    bool machineStatusPayloadPending = false;
    String machineStatusPayload;

    const uint32_t MILLIS_PER_DAY = 86400000UL;

    MachineRuntimeState desiredStateFromSensor()
    {
        if (deviceContext.state.current >= deviceContext.machineRuntime.runningCurrentThreshold)
        {
            return MachineRuntimeState::Running;
        }

        return MachineRuntimeState::Stopped;
    }

    uint32_t currentDayIndex(unsigned long now)
    {
        return static_cast<uint32_t>(now / MILLIS_PER_DAY);
    }

    void resetDailyCounters(uint32_t dayIndex)
    {
        deviceContext.machineRuntime.uptimeDayIndex = dayIndex;
        deviceContext.machineRuntime.todayRuntimeSec = 0;
        deviceContext.machineRuntime.todayStopSec = 0;
        deviceContext.machineRuntime.currentSegmentSec = 0;
        deviceContext.machineRuntime.longestRunSec = 0;
        deviceContext.machineRuntime.longestStopSec = 0;
        deviceContext.machineRuntime.stateChangeCount = 0;
        deviceContext.machineRuntime.runStartCount = 0;
        deviceContext.machineRuntime.stopStartCount = 0;
    }

    uint32_t elapsedSecondsSince(unsigned long startMs, unsigned long nowMs)
    {
        if (startMs == 0 || nowMs < startMs)
        {
            return 0;
        }

        return static_cast<uint32_t>((nowMs - startMs) / 1000UL);
    }

    void updateSegmentStats(unsigned long now)
    {
        uint32_t segmentSec = elapsedSecondsSince(deviceContext.machineRuntime.lastStateChangeMs, now);
        deviceContext.machineRuntime.currentSegmentSec = segmentSec;

        if (deviceContext.machineRuntime.state == MachineRuntimeState::Running &&
            segmentSec > deviceContext.machineRuntime.longestRunSec)
        {
            deviceContext.machineRuntime.longestRunSec = segmentSec;
        }

        if (deviceContext.machineRuntime.state == MachineRuntimeState::Stopped &&
            segmentSec > deviceContext.machineRuntime.longestStopSec)
        {
            deviceContext.machineRuntime.longestStopSec = segmentSec;
        }
    }

    void accumulateRuntime(unsigned long now)
    {
        if (deviceContext.machineRuntime.lastAccumulatorMs == 0)
        {
            deviceContext.machineRuntime.lastAccumulatorMs = now;
            return;
        }

        unsigned long elapsedMs = now - deviceContext.machineRuntime.lastAccumulatorMs;

        if (elapsedMs < 1000UL)
        {
            return;
        }

        uint32_t elapsedSec = static_cast<uint32_t>(elapsedMs / 1000UL);
        deviceContext.machineRuntime.lastAccumulatorMs += elapsedSec * 1000UL;

        if (deviceContext.machineRuntime.state == MachineRuntimeState::Running)
        {
            deviceContext.machineRuntime.todayRuntimeSec += elapsedSec;
        }
        else if (deviceContext.machineRuntime.state == MachineRuntimeState::Stopped)
        {
            deviceContext.machineRuntime.todayStopSec += elapsedSec;
        }
    }

    void prepareMachineStatusPayload(const char* eventName)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["event"] = eventName;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;
        doc["uptime_ms"] = millis();

        JsonObject machine = doc["machine"].to<JsonObject>();
        machine["state"] = machineRuntimeStateName();
        machine["source"] = machineRuntimeSourceName();
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
        machine["last_reason"] = machineRuntimeLastReason();
        machine["today_runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
        machine["today_stop_sec"] = deviceContext.machineRuntime.todayStopSec;
        machine["observed_sec"] = machineRuntimeObservedSec();
        machine["utilization_pct"] = machineRuntimeUtilizationPct();
        machine["current_segment_sec"] = deviceContext.machineRuntime.currentSegmentSec;
        machine["state_change_count"] = deviceContext.machineRuntime.stateChangeCount;
        machine["running_current_threshold"] = deviceContext.machineRuntime.runningCurrentThreshold;
        machine["current"] = deviceContext.state.current;
        machine["temperature"] = deviceContext.state.temperature;

        machineStatusPayload = "";
        serializeJson(doc, machineStatusPayload);
        machineStatusPayloadPending = true;
    }

    void transitionToState(MachineRuntimeState nextState, const char* reason, const char* source, bool manualOverride)
    {
        unsigned long now = millis();

        updateSegmentStats(now);

        if (deviceContext.machineRuntime.state == nextState &&
            deviceContext.machineRuntime.manualOverride == manualOverride)
        {
            deviceContext.machineRuntime.stateSource = source;
            deviceContext.machineRuntime.lastStateReason = reason;
            return;
        }

        deviceContext.machineRuntime.previousState = deviceContext.machineRuntime.state;
        deviceContext.machineRuntime.state = nextState;
        deviceContext.machineRuntime.manualOverride = manualOverride;
        deviceContext.machineRuntime.stateSource = source;
        deviceContext.machineRuntime.lastStateReason = reason;
        deviceContext.machineRuntime.lastStateChangeMs = now;
        deviceContext.machineRuntime.currentSegmentSec = 0;
        deviceContext.machineRuntime.stateChangeCount++;

        if (nextState == MachineRuntimeState::Running)
        {
            deviceContext.machineRuntime.runStartCount++;
            logPrintln(LOG_LEVEL_INFO, "Machine runtime: RUNNING");
        }
        else if (nextState == MachineRuntimeState::Stopped)
        {
            deviceContext.machineRuntime.stopStartCount++;
            logPrintln(LOG_LEVEL_INFO, "Machine runtime: STOPPED");
        }

        prepareMachineStatusPayload("MACHINE_STATE_CHANGED");
    }

    bool parseMachineState(const String& state, MachineRuntimeState& parsedState)
    {
        String normalized = state;
        normalized.toUpperCase();
        normalized.trim();

        if (normalized == "RUNNING" || normalized == "RUN")
        {
            parsedState = MachineRuntimeState::Running;
            return true;
        }

        if (normalized == "STOPPED" || normalized == "STOP" || normalized == "IDLE")
        {
            parsedState = MachineRuntimeState::Stopped;
            return true;
        }

        return false;
    }
}

void setupMachineRuntimeManager()
{
    unsigned long now = millis();

    deviceContext.machineRuntime.enabled = true;
    deviceContext.machineRuntime.state = MachineRuntimeState::Unknown;
    deviceContext.machineRuntime.previousState = MachineRuntimeState::Unknown;
    deviceContext.machineRuntime.manualOverride = false;
    deviceContext.machineRuntime.stateSource = "AUTO_CURRENT";
    deviceContext.machineRuntime.lastStateReason = "BOOT";
    deviceContext.machineRuntime.startedAtMs = now;
    deviceContext.machineRuntime.lastUpdateMs = now;
    deviceContext.machineRuntime.lastAccumulatorMs = now;
    deviceContext.machineRuntime.lastStateChangeMs = now;
    deviceContext.machineRuntime.lastStatusPublishMs = 0;
    deviceContext.machineRuntime.statusPublishIntervalSec = 30;
    deviceContext.machineRuntime.runningCurrentThreshold = 3.0f;

    resetDailyCounters(currentDayIndex(now));

    machineStatusPayloadPending = false;
    machineStatusPayload = "";

    transitionToState(desiredStateFromSensor(), "BOOT_AUTO_CURRENT", "AUTO_CURRENT", false);

    logPrintln(LOG_LEVEL_INFO, "Machine runtime tracker basladi.");
}

void updateMachineRuntimeManager()
{
    if (!deviceContext.machineRuntime.enabled)
    {
        return;
    }

    unsigned long now = millis();
    uint32_t dayIndex = currentDayIndex(now);

    if (dayIndex != deviceContext.machineRuntime.uptimeDayIndex)
    {
        resetDailyCounters(dayIndex);
        deviceContext.machineRuntime.lastAccumulatorMs = now;
        deviceContext.machineRuntime.lastStateChangeMs = now;
        deviceContext.machineRuntime.lastStateReason = "NEW_UPTIME_DAY";
        prepareMachineStatusPayload("MACHINE_DAILY_COUNTER_RESET");
    }

    accumulateRuntime(now);
    updateSegmentStats(now);

    if (!deviceContext.machineRuntime.manualOverride)
    {
        MachineRuntimeState desiredState = desiredStateFromSensor();

        if (desiredState != deviceContext.machineRuntime.state)
        {
            transitionToState(desiredState, "AUTO_CURRENT_THRESHOLD", "AUTO_CURRENT", false);
            updateSegmentStats(now);
        }
    }

    deviceContext.machineRuntime.lastUpdateMs = now;

    unsigned long intervalMs = deviceContext.machineRuntime.statusPublishIntervalSec * 1000UL;

    if (deviceContext.machineRuntime.lastStatusPublishMs == 0 ||
        now - deviceContext.machineRuntime.lastStatusPublishMs >= intervalMs)
    {
        deviceContext.machineRuntime.lastStatusPublishMs = now;
        prepareMachineStatusPayload("MACHINE_STATUS");
    }
}

const char* machineRuntimeStateName()
{
    return machineRuntimeStateName(deviceContext.machineRuntime.state);
}

const char* machineRuntimeStateName(MachineRuntimeState state)
{
    switch (state)
    {
        case MachineRuntimeState::Running:
            return "RUNNING";

        case MachineRuntimeState::Stopped:
            return "STOPPED";

        default:
            return "UNKNOWN";
    }
}

const char* machineRuntimeSourceName()
{
    return deviceContext.machineRuntime.stateSource;
}

const char* machineRuntimeLastReason()
{
    return deviceContext.machineRuntime.lastStateReason;
}

bool setMachineRuntimeStateFromString(const String& state, const char* reason)
{
    MachineRuntimeState parsedState;

    if (!parseMachineState(state, parsedState))
    {
        return false;
    }

    unsigned long now = millis();
    accumulateRuntime(now);
    updateSegmentStats(now);

    transitionToState(parsedState, reason, "MANUAL_COMMAND", true);
    updateSegmentStats(now);
    return true;
}

void clearMachineRuntimeManualOverride()
{
    unsigned long now = millis();
    accumulateRuntime(now);
    updateSegmentStats(now);

    deviceContext.machineRuntime.manualOverride = false;
    transitionToState(desiredStateFromSensor(), "MANUAL_OVERRIDE_CLEARED", "AUTO_CURRENT", false);
    updateSegmentStats(now);
}

void resetMachineRuntimeCounters()
{
    unsigned long now = millis();
    resetDailyCounters(currentDayIndex(now));
    deviceContext.machineRuntime.lastAccumulatorMs = now;
    deviceContext.machineRuntime.lastStateChangeMs = now;
    deviceContext.machineRuntime.lastStateReason = "MANUAL_COUNTER_RESET";
    prepareMachineStatusPayload("MACHINE_COUNTERS_RESET");
}

int machineRuntimeUtilizationPct()
{
    uint32_t observedSec = machineRuntimeObservedSec();

    if (observedSec == 0)
    {
        return 0;
    }

    return static_cast<int>((deviceContext.machineRuntime.todayRuntimeSec * 100UL) / observedSec);
}

unsigned long machineRuntimeCurrentSegmentMs()
{
    if (deviceContext.machineRuntime.lastStateChangeMs == 0)
    {
        return 0;
    }

    return millis() - deviceContext.machineRuntime.lastStateChangeMs;
}

uint32_t machineRuntimeObservedSec()
{
    return deviceContext.machineRuntime.todayRuntimeSec + deviceContext.machineRuntime.todayStopSec;
}

String buildMachineRuntimeJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["uptime_ms"] = millis();

    JsonObject machine = doc["machine"].to<JsonObject>();
    machine["state"] = machineRuntimeStateName();
    machine["source"] = machineRuntimeSourceName();
    machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
    machine["last_reason"] = machineRuntimeLastReason();
    machine["today_runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
    machine["today_stop_sec"] = deviceContext.machineRuntime.todayStopSec;
    machine["observed_sec"] = machineRuntimeObservedSec();
    machine["utilization_pct"] = machineRuntimeUtilizationPct();
    machine["current_segment_sec"] = deviceContext.machineRuntime.currentSegmentSec;
    machine["last_state_change_ms"] = deviceContext.machineRuntime.lastStateChangeMs;
    machine["state_change_count"] = deviceContext.machineRuntime.stateChangeCount;
    machine["run_start_count"] = deviceContext.machineRuntime.runStartCount;
    machine["stop_start_count"] = deviceContext.machineRuntime.stopStartCount;
    machine["longest_run_sec"] = deviceContext.machineRuntime.longestRunSec;
    machine["longest_stop_sec"] = deviceContext.machineRuntime.longestStopSec;
    machine["running_current_threshold"] = deviceContext.machineRuntime.runningCurrentThreshold;
    machine["current"] = deviceContext.state.current;
    machine["temperature"] = deviceContext.state.temperature;

    String payload;
    serializeJson(doc, payload);
    return payload;
}

String buildDailySummaryJson()
{
    JsonDocument doc;

    doc["device_id"] = MIA_DEVICE_ID;
    doc["firmware_version"] = MIA_FIRMWARE_VERSION;
    doc["platform_name"] = MIA_PLATFORM_NAME;
    doc["uptime_ms"] = millis();

    JsonObject summary = doc["daily_summary"].to<JsonObject>();
    summary["date_source"] = "uptime_day";
    summary["uptime_day_index"] = deviceContext.machineRuntime.uptimeDayIndex;
    summary["machine_state"] = machineRuntimeStateName();
    summary["runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
    summary["stop_sec"] = deviceContext.machineRuntime.todayStopSec;
    summary["observed_sec"] = machineRuntimeObservedSec();
    summary["runtime_min"] = deviceContext.machineRuntime.todayRuntimeSec / 60;
    summary["stop_min"] = deviceContext.machineRuntime.todayStopSec / 60;
    summary["utilization_pct"] = machineRuntimeUtilizationPct();
    summary["state_change_count"] = deviceContext.machineRuntime.stateChangeCount;
    summary["run_start_count"] = deviceContext.machineRuntime.runStartCount;
    summary["stop_start_count"] = deviceContext.machineRuntime.stopStartCount;
    summary["longest_run_sec"] = deviceContext.machineRuntime.longestRunSec;
    summary["longest_stop_sec"] = deviceContext.machineRuntime.longestStopSec;
    summary["report_ready_for_n8n"] = true;

    JsonObject ai = doc["ai_report_hint"].to<JsonObject>();
    ai["language"] = "tr";
    ai["audience"] = "workshop_owner";
    ai["message_type"] = "daily_factorybox_summary";

    String payload;
    serializeJson(doc, payload);
    return payload;
}

bool hasMachineStatusPayload()
{
    return machineStatusPayloadPending;
}

String takeMachineStatusPayload()
{
    String payload = machineStatusPayload;

    machineStatusPayload = "";
    machineStatusPayloadPending = false;

    return payload;
}
