#include <Arduino.h>
#include <WiFi.h>
#include "wifi_manager.h"
#include "device_context.h"
#include "secrets.h"

namespace
{
    unsigned long lastWifiAttemptMs = 0;

    unsigned long secondsToMs(int seconds, int minimumSeconds)
    {
        if (seconds < minimumSeconds)
        {
            seconds = minimumSeconds;
        }

        return seconds * 1000UL;
    }

    void markWifiConnected()
    {
        deviceContext.state.wifiConnected = true;
        deviceContext.state.wifiRSSI = WiFi.RSSI();

        Serial.println();
        Serial.println("WiFi baglandi");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
    }

    void markWifiDisconnected()
    {
        deviceContext.state.wifiConnected = false;
        deviceContext.state.wifiRSSI = 0;
    }

    void startWifiAttempt(unsigned long now, const char* reason)
    {
        Serial.print("WiFi baglaniyor: ");
        Serial.print(WIFI_SSID);
        Serial.print(" (");
        Serial.print(reason);
        Serial.println(")");

        lastWifiAttemptMs = now;
        deviceContext.state.lastWifiReconnectMs = now;
        deviceContext.state.wifiReconnectCount++;

        WiFi.mode(WIFI_STA);
        WiFi.disconnect(false);
        delay(50);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
}

void connectWiFi()
{
    unsigned long now = millis();
    unsigned long timeoutMs = secondsToMs(deviceContext.config.wifiConnectTimeoutSec, 3);

    startWifiAttempt(now, "initial");

    while (WiFi.status() != WL_CONNECTED && millis() - now < timeoutMs)
    {
        delay(500);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        markWifiConnected();
        return;
    }

    Serial.println();
    Serial.println("WiFi baglanti timeout. Cihaz calismaya devam edecek.");
    markWifiDisconnected();
}

void updateWiFi()
{
    unsigned long now = millis();

    if (WiFi.status() == WL_CONNECTED)
    {
        if (!deviceContext.state.wifiConnected)
        {
            Serial.println("WiFi yeniden baglandi.");
            Serial.print("IP: ");
            Serial.println(WiFi.localIP());
        }

        deviceContext.state.wifiConnected = true;
        deviceContext.state.wifiRSSI = WiFi.RSSI();
        return;
    }

    if (deviceContext.state.wifiConnected)
    {
        Serial.println("WiFi baglantisi koptu.");
    }

    markWifiDisconnected();

    unsigned long reconnectIntervalMs = secondsToMs(deviceContext.config.wifiReconnectIntervalSec, 3);

    if (lastWifiAttemptMs == 0 || now - lastWifiAttemptMs >= reconnectIntervalMs)
    {
        startWifiAttempt(now, "retry");
    }
}
