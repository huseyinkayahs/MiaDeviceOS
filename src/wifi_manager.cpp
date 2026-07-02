#include <Arduino.h>
#include <WiFi.h>
#include "wifi_manager.h"

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
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}