#pragma once

// Bu dosya GitHub'a gidebilir. Gercek bilgiler burada olmamali.
// Kullanim:
// 1. Bu dosyayi include/secrets.h olarak kopyala.
// 2. Kendi WiFi/MQTT bilgilerini secrets.h icine yaz.
// 3. include/secrets.h .gitignore icinde oldugu icin commit edilmez.

#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define MQTT_SERVER "broker.emqx.io"
#define MQTT_PORT 1883

// MQTT broker kullanici adi/sifre istemiyorsa bos birak.
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
