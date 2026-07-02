#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "mqtt_manager.h"


WiFiClient espClient;
PubSubClient client(espClient);

const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;
int currentLimit = 20;
int temperatureLimit = 50;
int repeatIfContinuesMin = 10;
int normalSendIntervalSec = 60;
Preferences preferences;
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    Serial.print("MQTT mesaj alindi. Topic: ");
    Serial.println(topic);

    Serial.print("Payload: ");
    for (unsigned int i = 0; i < length; i++) {
        Serial.print((char)payload[i]);
    }
    Serial.println();

    StaticJsonDocument<512> doc;

    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
        Serial.print("JSON parse hatasi: ");
        Serial.println(error.c_str());
        return;
    }

    Serial.println("JSON parse basarili.");

    if (doc.containsKey("current_limit")) {
        currentLimit = doc["current_limit"];
    }

    if (doc.containsKey("temperature_limit")) {
        temperatureLimit = doc["temperature_limit"];
    }

    if (doc.containsKey("repeat_if_continues_min")) {
        repeatIfContinuesMin = doc["repeat_if_continues_min"];
    }

    if (doc.containsKey("normal_send_interval_sec")) {
        normalSendIntervalSec = doc["normal_send_interval_sec"];
    }

   preferences.putInt("curLim", currentLimit);
    preferences.putInt("tempLim", temperatureLimit);
    preferences.putInt("repMin", repeatIfContinuesMin);
    preferences.putInt("sendInt", normalSendIntervalSec);

Serial.println("Config flash hafizaya kaydedildi.");

    Serial.println("Yeni config uygulandi:");
    Serial.print("currentLimit: ");
    Serial.println(currentLimit);

    Serial.print("temperatureLimit: ");
    Serial.println(temperatureLimit);

    Serial.print("repeatIfContinuesMin: ");
    Serial.println(repeatIfContinuesMin);

    Serial.print("normalSendIntervalSec: ");
    Serial.println(normalSendIntervalSec);
}



void reconnect() {
    while (!client.connected()) {
        Serial.print("MQTT baglaniyor...");

        String clientId = "Laser01-";
        clientId += String(random(0xffff), HEX);

       if (client.connect(clientId.c_str())) {
    Serial.println(" BAGLANDI");

    client.subscribe("mia/site01/laser01/config");
    Serial.println("Config topic dinleniyor: mia/site01/laser01/config");
    } else {
            Serial.print(" HATA: ");
            Serial.println(client.state());
            delay(3000);
        }
    }
}

void setupMQTT() {

    preferences.begin("config", false);

    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
}

void loopMQTT() {
    if (!client.connected()) {
        reconnect();
    }

    client.loop();
}

void publishHello() {
    client.publish(
        "mia/test",
        "{\"device\":\"laser01\",\"status\":\"ONLINE\"}"
    );

    Serial.println("MQTT mesaji gonderildi.");
}
void requestConfig() {

    client.publish(
        "mia/site01/laser01/getconfig",
        "{\"device_id\":\"laser01\",\"request\":\"get_config\"}"
    );

    Serial.println("Config istegi gonderildi.");
}