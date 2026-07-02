#include <Arduino.h>
#include <WiFi.h>
#include "wifi_manager.h"
#include "device_context.h"

const char* WIFI_SSID = "SUPERONLINE_Wi-Fi_EAE7";
const char* WIFI_PASSWORD = "DjnUxjsfX9";

void connectWiFi() {
  Serial.print("WiFi baglaniyor: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi baglandi");
  deviceContext.state.wifiConnected = true;
  deviceContext.state.wifiRSSI = WiFi.RSSI();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  
}
void updateWiFi()
{
    deviceContext.state.wifiConnected = (WiFi.status() == WL_CONNECTED);

    if (deviceContext.state.wifiConnected)
    {
        deviceContext.state.wifiRSSI = WiFi.RSSI();
    }
}