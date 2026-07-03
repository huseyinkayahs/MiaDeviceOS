#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <string.h>

#include "mqtt_manager.h"
#include "device_context.h"

WiFiClient espClient;
PubSubClient client(espClient);

const char* mqtt_server = "broker.emqx.io";
const int mqtt_port = 1883;

namespace
{
    const char* TOPIC_CONFIG = "mia/site01/laser01/config";
    const char* TOPIC_GET_CONFIG = "mia/site01/laser01/getconfig";
    const char* TOPIC_TELEMETRY = "mia/site01/laser01/telemetry";
    const char* TOPIC_ALARM = "mia/site01/laser01/alarm";
    const char* TOPIC_COMMAND = "mia/site01/laser01/command";
    const char* TOPIC_COMMAND_STATUS = "mia/site01/laser01/command/status";
    const char* TOPIC_HEARTBEAT = "mia/site01/laser01/heartbeat";

    bool incomingConfigPending = false;
    String incomingConfigPayload;

    bool incomingCommandPending = false;
    String incomingCommandPayload;
}

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

    if (strcmp(topic, TOPIC_CONFIG) == 0)
    {
        incomingConfigPayload = json;
        incomingConfigPending = true;
        return;
    }

    if (strcmp(topic, TOPIC_COMMAND) == 0)
    {
        incomingCommandPayload = json;
        incomingCommandPending = true;
        return;
    }

    Serial.println("MQTT mesaji bu cihaz tarafindan islenmedi.");
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

            client.subscribe(TOPIC_CONFIG);
            Serial.println("Config topic dinleniyor.");

            client.subscribe(TOPIC_COMMAND);
            Serial.println("Command topic dinleniyor.");
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
    client.setBufferSize(768);
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
        TOPIC_GET_CONFIG,
        "{\"device_id\":\"laser01\",\"request\":\"get_config\"}");

    Serial.println("Config istegi gonderildi.");
}

void publishTelemetry(const char* payload)
{
    client.publish(
        TOPIC_TELEMETRY,
        payload
    );
}

void publishAlarm(const char* payload)
{
    client.publish(
        TOPIC_ALARM,
        payload
    );
}

void publishCommandStatus(const char* payload)
{
    bool published = client.publish(
        TOPIC_COMMAND_STATUS,
        payload
    );

    if (published)
    {
        Serial.print("Command status gonderildi: ");
        Serial.println(payload);
    }
    else
    {
        Serial.print("Command status gonderilemedi: ");
        Serial.println(payload);
    }
}

void publishHeartbeat(const char* payload)
{
    bool published = client.publish(
        TOPIC_HEARTBEAT,
        payload
    );

    if (published)
    {
        Serial.print("Heartbeat gonderildi: ");
        Serial.println(payload);
    }
    else
    {
        Serial.print("Heartbeat gonderilemedi: ");
        Serial.println(payload);
    }
}

bool hasIncomingConfigPayload()
{
    return incomingConfigPending;
}

String takeIncomingConfigPayload()
{
    String payload = incomingConfigPayload;

    incomingConfigPayload = "";
    incomingConfigPending = false;

    return payload;
}

bool hasIncomingCommandPayload()
{
    return incomingCommandPending;
}

String takeIncomingCommandPayload()
{
    String payload = incomingCommandPayload;

    incomingCommandPayload = "";
    incomingCommandPending = false;

    return payload;
}
