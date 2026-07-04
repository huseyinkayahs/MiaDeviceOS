#include "command_manager.h"

#include "device_context.h"
#include "app_version.h"
#include "platform/platform_system.h"
#include "log_manager.h"
#include "runtime_settings_manager.h"
#include "production_manager.h"

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
        sensor["temperature"] = deviceContext.state.temperature;

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
