#include <Arduino.h>
#include "wifi_manager.h"
#include "mqtt_manager.h"

bool helloSent = false;

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("MiaDeviceOS basladi");

    connectWiFi();

    setupMQTT();
}

void loop() {

    loopMQTT();

    if (!helloSent) {
        publishHello();
        requestConfig();
        helloSent = true;
    }

    delay(100);
}