#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

#include "mqtt_manager.h"
#include "config_manager.h"
#include "device_context.h"

WiFiClient espClient;
PubSubClient client(espClient);

const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;

void mqttCallback(char* topic, byte* payload, unsigned int length)
{
    Serial.print("MQTT mesaj alindi. Topic: ");
    Serial.println(topic);

    String json;

    Serial.print("Payload: ");

    for (unsigned int i = 0; i < length; i++)
    {
        char c = (char)payload[i];
        Serial.print(c);
        json += c;
    }

    Serial.println();

    if (applyConfigJson(json.c_str()))
    {
        Serial.println("Config basariyla uygulandi.");
    }
    else
    {
        Serial.println("Config uygulanamadi.");
    }
}

void reconnect()
{
    while (!client.connected())
    {
        Serial.print("MQTT baglaniyor...");

        String clientId = "Laser01-";
        clientId += String(random(0xffff), HEX);

        if (client.connect(clientId.c_str()))
        {
            Serial.println(" BAGLANDI");
            deviceContext.state.mqttConnected = true;

            client.subscribe("mia/site01/laser01/config");
            Serial.println("Config topic dinleniyor.");
        }
        else
        {
            Serial.print(" HATA: ");
            Serial.println(client.state());
            delay(3000);
        }
    }
}

void setupMQTT()
{
    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
}

void loopMQTT()
{
    if (!client.connected())
    {
        reconnect();
    }

    client.loop();
    deviceContext.state.mqttConnected = client.connected();
}

void publishHello()
{
    client.publish(
        "mia/test",
        "{\"device\":\"laser01\",\"status\":\"ONLINE\"}");

    Serial.println("MQTT mesaji gonderildi.");
}

void requestConfig()
{
    client.publish(
        "mia/site01/laser01/getconfig",
        "{\"device_id\":\"laser01\",\"request\":\"get_config\"}");

    Serial.println("Config istegi gonderildi.");
}

void publishTelemetry(const char* payload)
{
    client.publish(
        "mia/site01/laser01/telemetry",
        payload
    );
}