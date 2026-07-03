#include "ota_manager.h"

#include "device_context.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Update.h>

namespace
{
    const char* DEVICE_ID = "laser01";

    const unsigned long OTA_START_DELAY_MS = 700;
    const unsigned long OTA_RESTART_DELAY_MS = 2000;

    bool otaStatusPending = false;
    String otaStatusPayload;

    void setOtaStatus(const char* status, const char* message)
    {
        JsonDocument doc;

        doc["device_id"] = DEVICE_ID;
        doc["request_id"] = deviceContext.ota.requestId;
        doc["event"] = "OTA_STATUS";
        doc["status"] = status;
        doc["message"] = message;
        doc["target_version"] = deviceContext.ota.targetVersion;
        doc["uptime_ms"] = millis();

        otaStatusPayload = "";
        serializeJson(doc, otaStatusPayload);
        otaStatusPending = true;
    }

    bool isValidOtaUrl(const String& url)
    {
        return url.startsWith("http://");
    }

    void clearOtaRequest()
    {
        deviceContext.ota.updateRequested = false;
        deviceContext.ota.inProgress = false;
        deviceContext.ota.downloadingStatusPrepared = false;
        deviceContext.ota.url = "";
        deviceContext.ota.targetVersion = "";
        deviceContext.ota.requestId = "";
        deviceContext.ota.requestedAtMs = 0;
        deviceContext.ota.downloadStartAtMs = 0;
    }

    void startHttpOta()
    {
        Serial.print("OTA baslatiliyor. URL: ");
        Serial.println(deviceContext.ota.url);

        WiFiClient wifiClient;
        HTTPClient http;

        if (!http.begin(wifiClient, deviceContext.ota.url))
        {
            setOtaStatus("failed", "HTTP client begin failed");
            clearOtaRequest();
            return;
        }

        int httpCode = http.GET();

        if (httpCode != HTTP_CODE_OK)
        {
            String errorMessage = "HTTP GET failed. Code: ";
            errorMessage += String(httpCode);
            Serial.println(errorMessage);
            http.end();
            setOtaStatus("failed", errorMessage.c_str());
            clearOtaRequest();
            return;
        }

        int contentLength = http.getSize();

        if (contentLength <= 0)
        {
            http.end();
            setOtaStatus("failed", "Invalid firmware size");
            clearOtaRequest();
            return;
        }

        Serial.print("OTA firmware boyutu: ");
        Serial.println(contentLength);

        if (!Update.begin(contentLength))
        {
            String errorMessage = "Update begin failed: ";
            errorMessage += Update.errorString();
            Serial.println(errorMessage);
            http.end();
            setOtaStatus("failed", errorMessage.c_str());
            clearOtaRequest();
            return;
        }

        WiFiClient* stream = http.getStreamPtr();
        size_t written = Update.writeStream(*stream);

        if (written != (size_t)contentLength)
        {
            String errorMessage = "OTA write incomplete. Written: ";
            errorMessage += String(written);
            errorMessage += " / ";
            errorMessage += String(contentLength);
            Serial.println(errorMessage);
            Update.abort();
            http.end();
            setOtaStatus("failed", errorMessage.c_str());
            clearOtaRequest();
            return;
        }

        if (!Update.end())
        {
            String errorMessage = "Update end failed: ";
            errorMessage += Update.errorString();
            Serial.println(errorMessage);
            http.end();
            setOtaStatus("failed", errorMessage.c_str());
            clearOtaRequest();
            return;
        }

        http.end();

        if (!Update.isFinished())
        {
            setOtaStatus("failed", "OTA update not finished");
            clearOtaRequest();
            return;
        }

        Serial.println("OTA basarili. Restart planlandi.");
        setOtaStatus("done", "OTA update successful. Device will restart");

        deviceContext.ota.updateRequested = false;
        deviceContext.ota.inProgress = false;
        deviceContext.ota.restartPending = true;
        deviceContext.ota.restartAtMs = millis() + OTA_RESTART_DELAY_MS;
    }
}

void setupOta()
{
    deviceContext.ota.updateRequested = false;
    deviceContext.ota.inProgress = false;
    deviceContext.ota.downloadingStatusPrepared = false;
    deviceContext.ota.restartPending = false;
    deviceContext.ota.requestId = "";
    deviceContext.ota.url = "";
    deviceContext.ota.targetVersion = "";
    deviceContext.ota.requestedAtMs = 0;
    deviceContext.ota.downloadStartAtMs = 0;
    deviceContext.ota.restartAtMs = 0;

    otaStatusPending = false;
    otaStatusPayload = "";
}

void updateOta()
{
    if (deviceContext.ota.restartPending)
    {
        unsigned long now = millis();

        if ((long)(now - deviceContext.ota.restartAtMs) >= 0)
        {
            Serial.println("OTA sonrasi restart uygulaniyor.");
            ESP.restart();
        }

        return;
    }

    if (!deviceContext.ota.updateRequested)
    {
        return;
    }

    if (!deviceContext.state.wifiConnected)
    {
        setOtaStatus("failed", "WiFi not connected");
        clearOtaRequest();
        return;
    }

    if (!isValidOtaUrl(deviceContext.ota.url))
    {
        setOtaStatus("failed", "Missing or invalid OTA URL");
        clearOtaRequest();
        return;
    }

    if (!deviceContext.ota.downloadingStatusPrepared)
    {
        deviceContext.ota.inProgress = true;
        deviceContext.ota.downloadingStatusPrepared = true;
        deviceContext.ota.downloadStartAtMs = millis() + OTA_START_DELAY_MS;
        setOtaStatus("downloading", "OTA download will start");
        return;
    }

    unsigned long now = millis();

    if ((long)(now - deviceContext.ota.downloadStartAtMs) < 0)
    {
        return;
    }

    startHttpOta();
}

bool isOtaInProgress()
{
    return deviceContext.ota.inProgress;
}

bool hasOtaStatusPayload()
{
    return otaStatusPending;
}

String takeOtaStatusPayload()
{
    String payload = otaStatusPayload;

    otaStatusPayload = "";
    otaStatusPending = false;

    return payload;
}
