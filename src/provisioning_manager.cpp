#include "provisioning_manager.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "app_version.h"
#include "device_context.h"
#include "mqtt_topics.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef PROVISIONING_CLAIM_URL
#define PROVISIONING_CLAIM_URL "https://panel.hukatech.com/api/device/provision/claim"
#endif

#ifndef PROVISIONING_TOKEN
#define PROVISIONING_TOKEN ""
#endif

#ifndef PROVISIONING_MODEL
#define PROVISIONING_MODEL "FactoryBox One"
#endif

#ifndef PROVISIONING_SERIAL_NO
#define PROVISIONING_SERIAL_NO ""
#endif

namespace
{
    const unsigned long INITIAL_CLAIM_DELAY_MS = 5000UL;
    const unsigned long CLAIM_RETRY_INTERVAL_MS = 60000UL;
    const unsigned long HTTP_TIMEOUT_MS = 12000UL;

    Preferences provisioningPreferences;

    bool provisioningStorageReady = false;
    bool provisioned = false;
    bool claimPending = false;
    bool claimInProgress = false;

    String pendingToken;
    String pendingClaimUrl;
    String lastStatus = "idle";
    String lastMessage = "";
    int lastHttpCode = 0;

    unsigned long bootMs = 0;
    unsigned long lastClaimAttemptMs = 0;

    void persistProvisionedState(
        bool paired,
        const String& serverVersion,
        const String& mqttBaseTopic
    )
    {
        if (!provisioningStorageReady)
        {
            return;
        }

        provisioningPreferences.putBool("paired", paired);

        if (serverVersion.length() > 0)
        {
            provisioningPreferences.putString("serverVer", serverVersion);
        }

        if (mqttBaseTopic.length() > 0)
        {
            provisioningPreferences.putString("mqttTopic", mqttBaseTopic);
        }
    }

    String responseMessage(JsonDocument& response)
    {
        if (response["message"].is<const char*>())
        {
            return response["message"].as<String>();
        }

        if (response["status"].is<const char*>())
        {
            return response["status"].as<String>();
        }

        return "";
    }

    bool claimProvisioningToken()
    {
        if (claimInProgress || !claimPending || pendingToken.length() == 0)
        {
            return false;
        }

        if (WiFi.status() != WL_CONNECTED)
        {
            lastStatus = "waiting_wifi";
            lastMessage = "Wi-Fi connection required";
            return false;
        }

        claimInProgress = true;
        lastClaimAttemptMs = millis();
        lastStatus = "claiming";
        lastMessage = "Provisioning claim started";
        lastHttpCode = 0;

        Serial.println("Provisioning claim baslatildi. Token ekrana yazdirilmadi.");

        // Build the JSON in a short inner scope so ArduinoJson releases its
        // heap before the TLS handshake starts. BLE + TLS on ESP32 is otherwise
        // prone to SSL "Memory allocation failed" errors.
        String requestBody;
        requestBody.reserve(512);
        {
            JsonDocument request;
            request["token"] = pendingToken;
            request["device_uid"] = MIA_DEVICE_ID;
            request["model"] = PROVISIONING_MODEL;
            request["firmware_version"] = MIA_FIRMWARE_VERSION;
            request["hardware_revision"] = MIA_HARDWARE_REVISION;
            request["mqtt_base_topic"] = MIA_TOPIC_BASE;

            const String serialNo = String(PROVISIONING_SERIAL_NO);
            if (serialNo.length() > 0)
            {
                request["serial_no"] = serialNo;
            }

            serializeJson(request, requestBody);
        }

        WiFiClientSecure secureClient;

        // v6.13.0 development transport:
        // Cloudflare edge certificates may rotate. Certificate pinning / CA bundle
        // will be hardened before customer production rollout.
        secureClient.setInsecure();
        secureClient.setTimeout(HTTP_TIMEOUT_MS / 1000UL);

        HTTPClient http;
        http.setConnectTimeout(HTTP_TIMEOUT_MS);
        http.setTimeout(HTTP_TIMEOUT_MS);
        http.setReuse(false);

        const String claimUrl =
            pendingClaimUrl.length() > 0
                ? pendingClaimUrl
                : String(PROVISIONING_CLAIM_URL);

        if (!claimUrl.startsWith("https://"))
        {
            lastStatus = "error";
            lastMessage = "Provisioning URL must use HTTPS";
            Serial.println("Provisioning reddedildi: URL HTTPS olmali.");
            claimInProgress = false;
            return false;
        }

        if (!http.begin(secureClient, claimUrl))
        {
            lastStatus = "error";
            lastMessage = "HTTP client could not start";
            Serial.println("Provisioning HTTP istemcisi baslatilamadi.");
            claimInProgress = false;
            return false;
        }

        http.addHeader("Content-Type", "application/json");
        http.addHeader("Accept", "application/json");
        http.addHeader("User-Agent", "HukaTech-FactoryBox/" MIA_FIRMWARE_VERSION);

        const int httpCode = http.POST(
            reinterpret_cast<uint8_t*>(
                const_cast<char*>(requestBody.c_str())
            ),
            requestBody.length()
        );

        lastHttpCode = httpCode;
        String responseBody;

        if (httpCode > 0)
        {
            responseBody = http.getString();
        }

        http.end();
        requestBody = "";

        if (httpCode <= 0)
        {
            lastStatus = "network_error";
            lastMessage = HTTPClient::errorToString(httpCode);
            Serial.print("Provisioning baglanti hatasi: ");
            Serial.println(lastMessage);
            claimInProgress = false;
            return false;
        }

        JsonDocument response;
        const DeserializationError parseError =
            deserializeJson(response, responseBody);

        responseBody = "";

        if (parseError)
        {
            lastStatus = "invalid_response";
            lastMessage = "Provisioning response is not valid JSON";
            Serial.print("Provisioning gecersiz cevap. HTTP: ");
            Serial.println(httpCode);
            claimInProgress = false;
            return false;
        }

        const String responseStatus =
            response["status"].is<const char*>()
                ? response["status"].as<String>()
                : "";

        lastMessage = responseMessage(response);

        if (httpCode >= 200 && httpCode < 300 && responseStatus == "ok")
        {
            const String serverVersion =
                response["version"].is<const char*>()
                    ? response["version"].as<String>()
                    : "";

            const String mqttBaseTopic =
                response["mqtt"]["base_topic"].is<const char*>()
                    ? response["mqtt"]["base_topic"].as<String>()
                    : "";

            provisioned = true;
            claimPending = false;
            pendingToken = "";
            pendingClaimUrl = "";
            lastStatus = "paired";
            lastMessage = "Device provisioning completed";

            persistProvisionedState(
                true,
                serverVersion,
                mqttBaseTopic
            );

            Serial.println("Provisioning basarili: cihaz PAIRED durumuna gecti.");
            claimInProgress = false;
            return true;
        }

        lastStatus =
            responseStatus.length() > 0
                ? responseStatus
                : "claim_failed";

        if (lastMessage.length() == 0)
        {
            lastMessage = "Provisioning claim failed";
        }

        Serial.print("Provisioning reddedildi. HTTP: ");
        Serial.print(httpCode);
        Serial.print(" Durum: ");
        Serial.println(lastStatus);

        // The token is kept only in RAM so a temporary network/server error can retry.
        // Invalid, expired or UID-mismatch responses still retry slowly; an operator can
        // reboot with a new token or submit a new token through the future BLE setup flow.
        claimInProgress = false;
        return false;
    }
}

void setupProvisioning()
{
    bootMs = millis();

    provisioningStorageReady =
        provisioningPreferences.begin("provision", false);

    if (provisioningStorageReady)
    {
        provisioned =
            provisioningPreferences.getBool("paired", false);
    }

    if (provisioned)
    {
        lastStatus = "paired";
        lastMessage = "Provisioning state loaded from persistent storage";
        Serial.println("Provisioning: cihaz daha once eslestirilmis.");
        return;
    }

    pendingToken = String(PROVISIONING_TOKEN);
    pendingToken.trim();
    pendingClaimUrl = String(PROVISIONING_CLAIM_URL);
    pendingClaimUrl.trim();

    claimPending = pendingToken.length() > 0;

    if (claimPending)
    {
        lastStatus = "pending";
        lastMessage = "Provisioning token is ready";
        Serial.println("Provisioning: tek kullanimlik token hazir. Wi-Fi bekleniyor.");
    }
    else
    {
        lastStatus = "not_configured";
        lastMessage = "Provisioning token is not configured";
        Serial.println("Provisioning: token tanimli degil. MQTT normal calismaya devam edecek.");
    }
}

bool attemptProvisioningNow()
{
    if (provisioned)
    {
        return true;
    }

    if (!claimPending || claimInProgress)
    {
        return false;
    }

    if (WiFi.status() != WL_CONNECTED)
    {
        lastStatus = "waiting_wifi";
        lastMessage = "Wi-Fi connection required";
        return false;
    }

    // The boot-time call is deliberately made before MQTT and BLE are started,
    // leaving the largest possible free heap for the TLS handshake.
    lastClaimAttemptMs = 0;
    return claimProvisioningToken();
}

void updateProvisioning()
{
    if (provisioned || !claimPending || claimInProgress)
    {
        return;
    }

    const unsigned long now = millis();

    if (now - bootMs < INITIAL_CLAIM_DELAY_MS)
    {
        return;
    }

    if (
        lastClaimAttemptMs > 0 &&
        now - lastClaimAttemptMs < CLAIM_RETRY_INTERVAL_MS
    )
    {
        return;
    }

    claimProvisioningToken();
}

bool requestProvisioningClaim(
    const String& token,
    const String& claimUrl
)
{
    if (provisioned)
    {
        lastStatus = "already_paired";
        lastMessage = "Device is already paired";
        return false;
    }

    String cleanedToken = token;
    cleanedToken.trim();

    if (cleanedToken.length() == 0)
    {
        lastStatus = "error";
        lastMessage = "Provisioning token is required";
        return false;
    }

    String cleanedUrl = claimUrl;
    cleanedUrl.trim();

    if (cleanedUrl.length() == 0)
    {
        cleanedUrl = String(PROVISIONING_CLAIM_URL);
    }

    if (!cleanedUrl.startsWith("https://"))
    {
        lastStatus = "error";
        lastMessage = "Provisioning URL must use HTTPS";
        return false;
    }

    pendingToken = cleanedToken;
    pendingClaimUrl = cleanedUrl;
    claimPending = true;
    lastClaimAttemptMs = 0;
    lastStatus = "pending";
    lastMessage = "Provisioning token accepted in RAM";

    return true;
}

bool isDeviceProvisioned()
{
    return provisioned;
}

bool isProvisioningClaimPending()
{
    return claimPending;
}

String provisioningStatusName()
{
    return lastStatus;
}

String provisioningLastMessage()
{
    return lastMessage;
}

int provisioningLastHttpCode()
{
    return lastHttpCode;
}
