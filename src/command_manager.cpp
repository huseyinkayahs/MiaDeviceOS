#include "command_manager.h"

#include "device_context.h"
#include "app_version.h"
#include "platform/platform_system.h"
#include "log_manager.h"
#include "runtime_settings_manager.h"
#include "production_manager.h"
#include "watchdog_manager.h"
#include "field_reliability_manager.h"
#include "machine_runtime_manager.h"
#include "digital_input_manager.h"
#include "sensor_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
    const unsigned long RESTART_DELAY_MS = 1500;

    bool commandStatusPending = false;
    String commandStatusPayload;

    void setCommandStatus(
        const String& requestId,
        const String& command,
        const char* status,
        const char* message
    )
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = command;
        doc["status"] = status;
        doc["message"] = message;
        doc["uptime_ms"] = millis();

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setConfigStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_config";
        doc["status"] = "done";
        doc["message"] = "Config returned";
        doc["uptime_ms"] = millis();

        JsonObject device = doc["device"].to<JsonObject>();
        device["project"] = MIA_PROJECT_NAME;
        device["device_id"] = MIA_DEVICE_ID;
        device["device_model"] = MIA_DEVICE_MODEL;
        device["firmware_version"] = MIA_FIRMWARE_VERSION;
        device["build_type"] = MIA_BUILD_TYPE;
        device["hardware_revision"] = MIA_HARDWARE_REVISION;
        device["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject config = doc["config"].to<JsonObject>();
        config["current_limit"] = deviceContext.config.currentLimit;
        config["temperature_limit"] = deviceContext.config.temperatureLimit;
        config["repeat_if_continues_min"] = deviceContext.config.repeatIfContinuesMin;
        config["normal_send_interval_sec"] = deviceContext.config.normalSendIntervalSec;
        config["over_current_delay_sec"] = deviceContext.config.overCurrentDelaySec;
        config["heartbeat_interval_sec"] = deviceContext.config.heartbeatIntervalSec;
        config["wifi_connect_timeout_sec"] = deviceContext.config.wifiConnectTimeoutSec;
        config["wifi_reconnect_interval_sec"] = deviceContext.config.wifiReconnectIntervalSec;
        config["mqtt_reconnect_interval_sec"] = deviceContext.config.mqttReconnectIntervalSec;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    String readOptionalString(JsonDocument& doc, const char* key)
    {
        if (doc[key].is<const char*>())
        {
            return doc[key].as<String>();
        }

        return "";
    }


    const char* alarmTypeToString(AlarmType type)
    {
        switch (type)
        {
            case AlarmType::OverCurrent:
                return "OVER_CURRENT";

            case AlarmType::OverTemperature:
                return "OVER_TEMPERATURE";

            case AlarmType::WiFiDisconnected:
                return "WIFI_DISCONNECTED";

            case AlarmType::MQTTDisconnected:
                return "MQTT_DISCONNECTED";

            case AlarmType::SensorError:
                return "SENSOR_ERROR";

            default:
                return "NONE";
        }
    }


    void fillTemperatureSensorStatus(JsonObject sensor)
    {
        const bool valid = temperatureSensorHasValidReading();
        const bool connected = temperatureSensorConnected();
        const float temperatureC = temperatureSensorValueC();

        sensor["type"] = temperatureSensorTypeName();
        sensor["connected"] = connected;
        sensor["valid"] = valid;

        if (valid)
        {
            sensor["temperature_c"] = temperatureC;
        }
        else
        {
            sensor["temperature_c"] = nullptr;
        }

        sensor["unit"] = "C";
        sensor["data_pin"] = temperatureSensorDataPin();
        sensor["resolution_bits"] = temperatureSensorResolutionBits();
        sensor["read_interval_ms"] = temperatureSensorReadIntervalMs();
        sensor["last_read_ms"] = temperatureSensorLastReadMs();
        sensor["read_count"] = temperatureSensorReadCount();
        sensor["error_count"] = temperatureSensorErrorCount();
        sensor["temperature_limit_c"] = deviceContext.config.temperatureLimit;
        sensor["over_limit"] = valid && temperatureC > deviceContext.config.temperatureLimit;
        sensor["pullup_required"] = true;
    }

    void setDiagnosticsStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_diagnostics";
        doc["status"] = "done";
        doc["message"] = "Diagnostics returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject wifi = doc["wifi"].to<JsonObject>();
        wifi["connected"] = deviceContext.state.wifiConnected;
        wifi["rssi"] = deviceContext.state.wifiRSSI;
        wifi["reconnects"] = deviceContext.state.wifiReconnectCount;

        JsonObject mqtt = doc["mqtt"].to<JsonObject>();
        mqtt["connected"] = deviceContext.state.mqttConnected;
        mqtt["reconnects"] = deviceContext.state.mqttReconnectCount;
        mqtt["failures"] = deviceContext.state.mqttConnectFailCount;

        JsonObject runtime = doc["runtime"].to<JsonObject>();
        runtime["free_heap"] = MiaPlatform::freeHeapBytes();
        runtime["min_free_heap"] = MiaPlatform::minFreeHeapBytes();
        runtime["sketch_size"] = MiaPlatform::sketchSizeBytes();
        runtime["free_sketch"] = MiaPlatform::freeSketchSpaceBytes();
        runtime["boot_count"] = deviceContext.production.bootCount;
        runtime["reset_reason"] = deviceContext.production.resetReason;
        runtime["health_status"] = productionHealthStatus();
        runtime["low_heap_threshold"] = deviceContext.production.lowHeapThresholdBytes;
        runtime["low_heap_warning"] = deviceContext.production.lowHeapWarningActive;
        runtime["low_heap_warning_count"] = deviceContext.production.lowHeapWarningCount;

        JsonObject watchdog = doc["watchdog"].to<JsonObject>();
        watchdog["enabled"] = deviceContext.watchdog.enabled;
        watchdog["supported"] = deviceContext.watchdog.supported;
        watchdog["setup_ok"] = deviceContext.watchdog.setupOk;
        watchdog["timeout_sec"] = deviceContext.watchdog.timeoutSec;
        watchdog["feed_interval_ms"] = deviceContext.watchdog.feedIntervalMs;
        watchdog["feed_count"] = deviceContext.watchdog.feedCount;
        watchdog["last_feed_ms"] = deviceContext.watchdog.lastFeedMs;

        JsonObject reliability = doc["field_reliability"].to<JsonObject>();
        reliability["status"] = fieldReliabilityStatus();
        reliability["issue"] = fieldReliabilityIssue();
        reliability["score"] = fieldReliabilityScore();
        reliability["wifi_drop_events"] = deviceContext.fieldReliability.wifiDropEvents;
        reliability["mqtt_drop_events"] = deviceContext.fieldReliability.mqttDropEvents;
        reliability["wifi_offline_ms"] = fieldReliabilityWifiOfflineMs();
        reliability["mqtt_offline_ms"] = fieldReliabilityMqttOfflineMs();
        reliability["warning_count"] = deviceContext.fieldReliability.warningCount;
        reliability["offline_warning_threshold_ms"] = deviceContext.fieldReliability.offlineWarningThresholdMs;

        JsonObject machine = doc["machine_runtime"].to<JsonObject>();
        machine["state"] = machineRuntimeStateName();
        machine["source"] = machineRuntimeSourceName();
        machine["input_source"] = machineRuntimeInputSourceModeName();
        machine["input_source_persistent"] = true;
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
        machine["di1_active"] = digitalInputDi1Active();
        machine["di1_source"] = digitalInputDi1SourceName();
        machine["di1_simulation_enabled"] = digitalInputDi1SimulationEnabled();
        machine["today_runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
        machine["today_stop_sec"] = deviceContext.machineRuntime.todayStopSec;
        machine["observed_sec"] = machineRuntimeObservedSec();
        machine["utilization_pct"] = machineRuntimeUtilizationPct();
        machine["state_change_count"] = deviceContext.machineRuntime.stateChangeCount;
        machine["current_segment_sec"] = deviceContext.machineRuntime.currentSegmentSec;

        JsonObject digitalInputs = doc["digital_inputs"].to<JsonObject>();
        JsonObject di1 = digitalInputs["di1"].to<JsonObject>();
        di1["pin"] = deviceContext.digitalInput.di1Pin;
        di1["active"] = deviceContext.digitalInput.di1Active;
        di1["state"] = digitalInputDi1StateName();
        di1["source"] = digitalInputDi1SourceName();
        di1["simulation_enabled"] = deviceContext.digitalInput.di1SimulationEnabled;
        di1["change_count"] = deviceContext.digitalInput.di1ChangeCount;

        JsonObject alarm = doc["alarm"].to<JsonObject>();
        alarm["active"] = deviceContext.alarm.active;
        alarm["type"] = alarmTypeToString(deviceContext.alarm.activeAlarm);
        alarm["ack"] = deviceContext.alarm.acknowledged;
        alarm["notifications"] = deviceContext.alarm.notificationCount;

        JsonObject ble = doc["ble"].to<JsonObject>();
        ble["enabled"] = deviceContext.ble.enabled;
        ble["connected"] = deviceContext.ble.clientConnected;
        ble["authenticated"] = deviceContext.ble.serviceAuthenticated;
        ble["commands"] = deviceContext.ble.commandCount;
        ble["rejected"] = deviceContext.ble.rejectedCommandCount;

        JsonObject ota = doc["ota"].to<JsonObject>();
        ota["in_progress"] = deviceContext.ota.inProgress;
        ota["restart_pending"] = deviceContext.ota.restartPending;

        JsonObject log = doc["log"].to<JsonObject>();
        log["level"] = currentLogLevelName();
        log["level_value"] = static_cast<int>(getLogLevel());
        log["persistent"] = true;

        JsonObject sensor = doc["sensor"].to<JsonObject>();
        sensor["current"] = deviceContext.state.current;
        sensor["current_simulated"] = true;
        sensor["temperature"] = deviceContext.state.temperature;
        JsonObject temperatureSensor = sensor["temperature_sensor"].to<JsonObject>();
        fillTemperatureSensorStatus(temperatureSensor);

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setLogLevelStatus(const String& requestId, const char* status, const char* message)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "set_log_level";
        doc["status"] = status;
        doc["message"] = message;
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["log_level"] = currentLogLevelName();
        doc["log_level_value"] = static_cast<int>(getLogLevel());
        doc["persistent"] = true;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setGetLogLevelStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_log_level";
        doc["status"] = "done";
        doc["message"] = "Log level returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["log_level"] = currentLogLevelName();
        doc["log_level_value"] = static_cast<int>(getLogLevel());
        doc["persistent"] = true;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setRuntimeSettingsStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_runtime_settings";
        doc["status"] = "done";
        doc["message"] = "Runtime settings returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;

        JsonObject runtimeSettings = doc["runtime_settings"].to<JsonObject>();
        runtimeSettings["log_level"] = currentLogLevelName();
        runtimeSettings["log_level_value"] = static_cast<int>(getLogLevel());
        runtimeSettings["log_level_persistent"] = true;
        runtimeSettings["machine_input_source"] = machineRuntimeInputSourceModeName();
        runtimeSettings["machine_input_source_persistent"] = true;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setHealthStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_health";
        doc["status"] = "done";
        doc["message"] = "Health returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject health = doc["health"].to<JsonObject>();
        health["status"] = productionHealthStatus();
        health["boot_count"] = deviceContext.production.bootCount;
        health["reset_reason"] = deviceContext.production.resetReason;
        health["free_heap"] = MiaPlatform::freeHeapBytes();
        health["min_free_heap"] = MiaPlatform::minFreeHeapBytes();
        health["low_heap_threshold"] = deviceContext.production.lowHeapThresholdBytes;
        health["low_heap_warning"] = deviceContext.production.lowHeapWarningActive;
        health["low_heap_warning_count"] = deviceContext.production.lowHeapWarningCount;
        health["wifi_connected"] = deviceContext.state.wifiConnected;
        health["mqtt_connected"] = deviceContext.state.mqttConnected;
        health["alarm_active"] = deviceContext.alarm.active;
        health["ota_in_progress"] = deviceContext.ota.inProgress;
        health["field_reliability_status"] = fieldReliabilityStatus();
        health["field_reliability_issue"] = fieldReliabilityIssue();
        health["field_reliability_score"] = fieldReliabilityScore();
        health["machine_state"] = machineRuntimeStateName();
        health["machine_utilization_pct"] = machineRuntimeUtilizationPct();
        health["machine_runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
        health["machine_stop_sec"] = deviceContext.machineRuntime.todayStopSec;
        health["machine_input_source"] = machineRuntimeInputSourceModeName();
        health["di1_active"] = digitalInputDi1Active();
        health["temperature_c"] = temperatureSensorValueC();
        health["temperature_sensor_connected"] = temperatureSensorConnected();
        health["temperature_sensor_valid"] = temperatureSensorHasValidReading();
        health["temperature_over_limit"] =
            temperatureSensorHasValidReading() &&
            temperatureSensorValueC() > deviceContext.config.temperatureLimit;

        JsonObject watchdog = health["watchdog"].to<JsonObject>();
        watchdog["enabled"] = deviceContext.watchdog.enabled;
        watchdog["setup_ok"] = deviceContext.watchdog.setupOk;
        watchdog["timeout_sec"] = deviceContext.watchdog.timeoutSec;
        watchdog["feed_count"] = deviceContext.watchdog.feedCount;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }


    void setFieldReliabilityStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_reliability";
        doc["status"] = "done";
        doc["message"] = "Field reliability returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject reliability = doc["field_reliability"].to<JsonObject>();
        reliability["status"] = fieldReliabilityStatus();
        reliability["issue"] = fieldReliabilityIssue();
        reliability["score"] = fieldReliabilityScore();
        reliability["wifi_connected"] = deviceContext.state.wifiConnected;
        reliability["mqtt_connected"] = deviceContext.state.mqttConnected;
        reliability["wifi_drop_events"] = deviceContext.fieldReliability.wifiDropEvents;
        reliability["mqtt_drop_events"] = deviceContext.fieldReliability.mqttDropEvents;
        reliability["wifi_offline_ms"] = fieldReliabilityWifiOfflineMs();
        reliability["mqtt_offline_ms"] = fieldReliabilityMqttOfflineMs();
        reliability["wifi_offline_warning"] = deviceContext.fieldReliability.wifiOfflineWarning;
        reliability["mqtt_offline_warning"] = deviceContext.fieldReliability.mqttOfflineWarning;
        reliability["warning_count"] = deviceContext.fieldReliability.warningCount;
        reliability["check_interval_ms"] = deviceContext.fieldReliability.checkIntervalMs;
        reliability["offline_warning_threshold_ms"] = deviceContext.fieldReliability.offlineWarningThresholdMs;
        reliability["low_heap_warning"] = deviceContext.production.lowHeapWarningActive;
        reliability["alarm_active"] = deviceContext.alarm.active;
        reliability["ota_in_progress"] = deviceContext.ota.inProgress;
        reliability["watchdog_setup_ok"] = deviceContext.watchdog.setupOk;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }



    void setMachineRuntimeStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_machine_runtime";
        doc["status"] = "done";
        doc["message"] = "Machine runtime returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject machine = doc["machine"].to<JsonObject>();
        machine["state"] = machineRuntimeStateName();
        machine["source"] = machineRuntimeSourceName();
        machine["input_source"] = machineRuntimeInputSourceModeName();
        machine["input_source_persistent"] = true;
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
        machine["di1_active"] = digitalInputDi1Active();
        machine["di1_source"] = digitalInputDi1SourceName();
        machine["di1_simulation_enabled"] = digitalInputDi1SimulationEnabled();
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

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setDailySummaryStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_daily_summary";
        doc["status"] = "done";
        doc["message"] = "Daily summary returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject summary = doc["daily_summary"].to<JsonObject>();
        summary["date_source"] = "uptime_day";
        summary["uptime_day_index"] = deviceContext.machineRuntime.uptimeDayIndex;
        summary["machine_state"] = machineRuntimeStateName();
        summary["input_source"] = machineRuntimeInputSourceModeName();
        summary["input_source_persistent"] = true;
        summary["di1_active"] = digitalInputDi1Active();
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

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setMachineStateStatus(const String& requestId, const char* status, const char* message)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "set_machine_state";
        doc["status"] = status;
        doc["message"] = message;
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;

        JsonObject machine = doc["machine"].to<JsonObject>();
        machine["state"] = machineRuntimeStateName();
        machine["source"] = machineRuntimeSourceName();
        machine["input_source"] = machineRuntimeInputSourceModeName();
        machine["input_source_persistent"] = true;
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
        machine["di1_active"] = digitalInputDi1Active();
        machine["di1_source"] = digitalInputDi1SourceName();
        machine["di1_simulation_enabled"] = digitalInputDi1SimulationEnabled();
        machine["today_runtime_sec"] = deviceContext.machineRuntime.todayRuntimeSec;
        machine["today_stop_sec"] = deviceContext.machineRuntime.todayStopSec;
        machine["utilization_pct"] = machineRuntimeUtilizationPct();

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }


    void setMachineInputSourceStatus(const String& requestId, const char* status, const char* message)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "set_machine_input_source";
        doc["status"] = status;
        doc["message"] = message;
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;

        JsonObject machine = doc["machine"].to<JsonObject>();
        machine["state"] = machineRuntimeStateName();
        machine["source"] = machineRuntimeSourceName();
        machine["input_source"] = machineRuntimeInputSourceModeName();
        machine["input_source_persistent"] = true;
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;
        machine["di1_active"] = digitalInputDi1Active();
        machine["di1_source"] = digitalInputDi1SourceName();

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setDigitalInputsStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_digital_inputs";
        doc["status"] = "done";
        doc["message"] = "Digital inputs returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

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

        JsonObject machine = doc["machine"].to<JsonObject>();
        machine["input_source"] = machineRuntimeInputSourceModeName();
        machine["state"] = machineRuntimeStateName();
        machine["manual_override"] = deviceContext.machineRuntime.manualOverride;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }


    void setTemperatureStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_temperature";
        doc["status"] = "done";
        doc["message"] = temperatureSensorConnected()
            ? "Temperature returned"
            : "Temperature sensor unavailable";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject sensor = doc["temperature_sensor"].to<JsonObject>();
        fillTemperatureSensorStatus(sensor);

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setDi1SimulationStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "set_di1_simulation";
        doc["status"] = "done";
        doc["message"] = "DI1 simulation updated";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;

        JsonObject digitalInputs = doc["digital_inputs"].to<JsonObject>();
        JsonObject di1 = digitalInputs["di1"].to<JsonObject>();
        di1["active"] = deviceContext.digitalInput.di1Active;
        di1["state"] = digitalInputDi1StateName();
        di1["source"] = digitalInputDi1SourceName();
        di1["simulation_enabled"] = deviceContext.digitalInput.di1SimulationEnabled;
        di1["simulated_active"] = deviceContext.digitalInput.di1SimulatedActive;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setMachineCounterResetStatus(const String& requestId)
    {
        resetMachineRuntimeCounters();
        setCommandStatus(requestId, "reset_machine_runtime", "done", "Machine runtime counters reset");
    }

    void setWatchdogStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_watchdog";
        doc["status"] = "done";
        doc["message"] = "Watchdog returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject watchdog = doc["watchdog"].to<JsonObject>();
        watchdog["enabled"] = deviceContext.watchdog.enabled;
        watchdog["supported"] = deviceContext.watchdog.supported;
        watchdog["setup_ok"] = deviceContext.watchdog.setupOk;
        watchdog["timeout_sec"] = deviceContext.watchdog.timeoutSec;
        watchdog["feed_interval_ms"] = deviceContext.watchdog.feedIntervalMs;
        watchdog["feed_count"] = deviceContext.watchdog.feedCount;
        watchdog["last_feed_ms"] = deviceContext.watchdog.lastFeedMs;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void setBootDiagnosticsStatus(const String& requestId)
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_boot_diagnostics";
        doc["status"] = "done";
        doc["message"] = "Boot diagnostics returned";
        doc["uptime_ms"] = millis();
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;

        JsonObject boot = doc["boot"].to<JsonObject>();
        boot["boot_count"] = deviceContext.production.bootCount;
        boot["reset_reason"] = deviceContext.production.resetReason;
        boot["started_at_ms"] = deviceContext.production.startedAtMs;
        boot["free_heap"] = MiaPlatform::freeHeapBytes();
        boot["min_free_heap"] = MiaPlatform::minFreeHeapBytes();
        boot["sketch_size"] = MiaPlatform::sketchSizeBytes();
        boot["free_sketch"] = MiaPlatform::freeSketchSpaceBytes();
        boot["health_status"] = productionHealthStatus();

        JsonObject watchdog = boot["watchdog"].to<JsonObject>();
        watchdog["enabled"] = deviceContext.watchdog.enabled;
        watchdog["supported"] = deviceContext.watchdog.supported;
        watchdog["setup_ok"] = deviceContext.watchdog.setupOk;
        watchdog["timeout_sec"] = deviceContext.watchdog.timeoutSec;
        watchdog["feed_count"] = deviceContext.watchdog.feedCount;

        commandStatusPayload = "";
        serializeJson(doc, commandStatusPayload);
        commandStatusPending = true;
    }

    void executeCommand(const String& command, const String& requestId)
    {
        if (command == "get_config")
        {
            setConfigStatus(requestId);
            return;
        }

        if (command == "get_diagnostics")
        {
            setDiagnosticsStatus(requestId);
            return;
        }

        if (command == "get_health")
        {
            setHealthStatus(requestId);
            return;
        }

        if (command == "get_reliability")
        {
            setFieldReliabilityStatus(requestId);
            return;
        }

        if (command == "get_digital_inputs")
        {
            setDigitalInputsStatus(requestId);
            return;
        }

        if (command == "get_temperature")
        {
            setTemperatureStatus(requestId);
            return;
        }

        if (command == "get_machine_runtime")
        {
            setMachineRuntimeStatus(requestId);
            return;
        }

        if (command == "get_daily_summary")
        {
            setDailySummaryStatus(requestId);
            return;
        }

        if (command == "reset_machine_runtime")
        {
            setMachineCounterResetStatus(requestId);
            return;
        }

        if (command == "get_watchdog")
        {
            setWatchdogStatus(requestId);
            return;
        }

        if (command == "get_boot_diagnostics")
        {
            setBootDiagnosticsStatus(requestId);
            return;
        }

        if (command == "get_log_level")
        {
            setGetLogLevelStatus(requestId);
            return;
        }

        if (command == "get_runtime_settings")
        {
            setRuntimeSettingsStatus(requestId);
            return;
        }

        if (command == "reset_alarm")
        {
            deviceContext.command.resetAlarmRequested = true;
            setCommandStatus(requestId, command, "accepted", "Alarm reset requested");
            return;
        }

        if (command == "restart")
        {
            deviceContext.command.restartRequested = true;
            deviceContext.command.restartRequestedAtMs = millis();
            setCommandStatus(requestId, command, "accepted", "Device will restart");
            return;
        }

        if (command == "ota_update")
        {
            setCommandStatus(requestId, command, "rejected", "OTA command must be handled with full payload");
            return;
        }

        setCommandStatus(requestId, command, "rejected", "Unknown command");
    }
}

void setupCommand()
{
    commandStatusPending = false;
    commandStatusPayload = "";

    deviceContext.command.resetAlarmRequested = false;
    deviceContext.command.restartRequested = false;
    deviceContext.command.restartRequestedAtMs = 0;
}

void updateCommand()
{
    if (deviceContext.command.restartRequested)
    {
        unsigned long now = millis();

        if (now - deviceContext.command.restartRequestedAtMs >= RESTART_DELAY_MS)
        {
            logPrintln(LOG_LEVEL_INFO, "Restart komutu uygulanıyor.");
            MiaPlatform::restart();
        }
    }
}

void handleCommandJson(const char* json)
{
    JsonDocument doc;

    DeserializationError error = deserializeJson(doc, json);

    if (error)
    {
        setCommandStatus("", "", "rejected", "Invalid JSON");
        return;
    }

    if (!doc["command"].is<const char*>())
    {
        setCommandStatus(readOptionalString(doc, "request_id"), "", "rejected", "Missing or invalid command");
        return;
    }

    String command = doc["command"].as<String>();
    String requestId = readOptionalString(doc, "request_id");


    if (command == "set_machine_input_source")
    {
        String source = readOptionalString(doc, "source");

        if (source.length() == 0)
        {
            setMachineInputSourceStatus(requestId, "rejected", "Missing source. Use AUTO_CURRENT or DI1");
            return;
        }

        if (!setMachineRuntimeInputSourceFromString(source))
        {
            setMachineInputSourceStatus(requestId, "rejected", "Invalid source. Use AUTO_CURRENT or DI1");
            return;
        }

        if (!saveRuntimeMachineInputSource(machineRuntimeInputSourceModeName()))
        {
            setMachineInputSourceStatus(requestId, "failed", "Machine input source updated in memory but failed to persist");
            return;
        }

        setMachineInputSourceStatus(requestId, "done", "Machine input source updated and persisted");
        return;
    }

    if (command == "set_di1_simulation")
    {
        bool enabled = false;
        bool active = false;

        if (doc["enabled"].is<bool>())
        {
            enabled = doc["enabled"].as<bool>();
        }
        else
        {
            setCommandStatus(requestId, command, "rejected", "Missing enabled boolean");
            return;
        }

        if (doc["active"].is<bool>())
        {
            active = doc["active"].as<bool>();
        }

        setDigitalInputDi1Simulation(enabled, active);
        setDi1SimulationStatus(requestId);
        return;
    }

    if (command == "set_machine_state")
    {
        String state = readOptionalString(doc, "state");

        if (state.length() == 0)
        {
            setMachineStateStatus(requestId, "rejected", "Missing machine state. Use RUNNING, STOPPED or AUTO");
            return;
        }

        String normalized = state;
        normalized.toUpperCase();
        normalized.trim();

        if (normalized == "AUTO")
        {
            clearMachineRuntimeManualOverride();
            setMachineStateStatus(requestId, "done", "Machine state returned to AUTO mode");
            return;
        }

        if (!setMachineRuntimeStateFromString(state, "MANUAL_COMMAND"))
        {
            setMachineStateStatus(requestId, "rejected", "Invalid machine state. Use RUNNING, STOPPED or AUTO");
            return;
        }

        setMachineStateStatus(requestId, "done", "Machine state updated");
        return;
    }

    if (command == "set_log_level")
    {
        bool changed = false;

        if (doc["level"].is<const char*>())
        {
            changed = setLogLevelFromString(doc["level"].as<String>());
        }
        else if (doc["level"].is<int>())
        {
            changed = setLogLevelFromInt(doc["level"].as<int>());
        }

        if (!changed)
        {
            setLogLevelStatus(requestId, "rejected", "Invalid log level. Use ERROR, WARN, INFO, DEBUG or 0-3");
            return;
        }

        if (!saveRuntimeLogLevel(static_cast<int>(getLogLevel())))
        {
            setLogLevelStatus(requestId, "failed", "Log level updated in memory but failed to persist");
            return;
        }

        setLogLevelStatus(requestId, "done", "Log level updated and persisted");
        return;
    }

    if (command == "ota_update")
    {
        String url = readOptionalString(doc, "url");
        String version = readOptionalString(doc, "version");

        if (url.length() == 0)
        {
            setCommandStatus(requestId, command, "rejected", "Missing OTA URL");
            return;
        }

        if (deviceContext.ota.updateRequested || deviceContext.ota.inProgress)
        {
            setCommandStatus(requestId, command, "rejected", "OTA already in progress");
            return;
        }

        deviceContext.ota.updateRequested = true;
        deviceContext.ota.inProgress = false;
        deviceContext.ota.downloadingStatusPrepared = false;
        deviceContext.ota.requestId = requestId;
        deviceContext.ota.url = url;
        deviceContext.ota.targetVersion = version;
        deviceContext.ota.requestedAtMs = millis();

        setCommandStatus(requestId, command, "accepted", "OTA update requested");
        return;
    }

    executeCommand(command, requestId);
}

bool hasCommandStatusPayload()
{
    return commandStatusPending;
}

String takeCommandStatusPayload()
{
    String payload = commandStatusPayload;

    commandStatusPayload = "";
    commandStatusPending = false;

    return payload;
}
