#include "command_manager.h"

#include "device_context.h"

#include <Arduino.h>
#include <ArduinoJson.h>

namespace
{
    const char* DEVICE_ID = "laser01";

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

        doc["device_id"] = DEVICE_ID;
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

        doc["device_id"] = DEVICE_ID;
        doc["request_id"] = requestId;
        doc["command"] = "get_config";
        doc["status"] = "done";
        doc["message"] = "Config returned";
        doc["uptime_ms"] = millis();

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

    void executeCommand(const String& command, const String& requestId)
    {
        if (command == "get_config")
        {
            setConfigStatus(requestId);
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
            Serial.println("Restart komutu uygulanıyor.");
            ESP.restart();
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
