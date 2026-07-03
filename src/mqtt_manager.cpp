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
    const char* TOPIC_OTA_STATUS = "mia/site01/laser01/ota/status";

    bool incomingConfigPending = false;
    String incomingConfigPayload;

    bool incomingCommandPending = false;
    String incomingCommandPayload;

    unsigned long lastMqttReconnectAttemptMs = 0;

    unsigned long secondsToMs(int seconds, int minimumSeconds)
    {
        if (seconds < minimumSeconds)
        {
            seconds = minimumSeconds;
        }

        return seconds * 1000UL;
    }

    bool attemptMqttConnection()
    {
        Serial.print("MQTT baglaniyor...");

        unsigned long now = millis();
        lastMqttReconnectAttemptMs = now;
        deviceContext.state.lastMqttReconnectMs = now;
        deviceContext.state.mqttReconnectCount++;

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

            return true;
        }

        Serial.print(" HATA: ");
        Serial.println(client.state());
        deviceContext.state.mqttConnected = false;
        deviceContext.state.mqttConnectFailCount++;
        return false;
    }
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

void setupMQTT()
{
    client.setBufferSize(768);
    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
    lastMqttReconnectAttemptMs = 0;
    deviceContext.state.mqttConnected = false;
}

void loopMQTT()
{
    if (!deviceContext.state.wifiConnected)
    {
        if (client.connected())
        {
            client.disconnect();
        }

        deviceContext.state.mqttConnected = false;
        return;
    }

    if (!client.connected())
    {
        deviceContext.state.mqttConnected = false;

        unsigned long now = millis();
        unsigned long reconnectIntervalMs = secondsToMs(deviceContext.config.mqttReconnectIntervalSec, 3);

        if (lastMqttReconnectAttemptMs == 0 || now - lastMqttReconnectAttemptMs >= reconnectIntervalMs)
        {
            attemptMqttConnection();
        }

        return;
    }

    client.loop();
    deviceContext.state.mqttConnected = true;
}

void publishHello()
{
    if (!client.connected())
    {
        Serial.println("MQTT bagli degil. Hello gonderilmedi.");
        return;
    }

    client.publish(
        "mia/test",
        "{\"device\":\"laser01\",\"status\":\"ONLINE\"}");

    Serial.println("MQTT mesaji gonderildi.");
}

void requestConfig()
{
    if (!client.connected())
    {
        Serial.println("MQTT bagli degil. Config istegi gonderilmedi.");
        return;
    }

    client.publish(
        TOPIC_GET_CONFIG,
        "{\"device_id\":\"laser01\",\"request\":\"get_config\"}");

    Serial.println("Config istegi gonderildi.");
}

void publishTelemetry(const char* payload)
{
    if (!client.connected())
    {
        Serial.println("MQTT bagli degil. Telemetry gonderilmedi.");
        return;
    }

    client.publish(
        TOPIC_TELEMETRY,
        payload
    );
}

void publishAlarm(const char* payload)
{
    if (!client.connected())
    {
        Serial.println("MQTT bagli degil. Alarm gonderilmedi.");
        return;
    }

    client.publish(
        TOPIC_ALARM,
        payload
    );
}

void publishCommandStatus(const char* payload)
{
    if (!client.connected())
    {
        Serial.print("MQTT bagli degil. Command status gonderilmedi: ");
        Serial.println(payload);
        return;
    }

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
    if (!client.connected())
    {
        Serial.print("MQTT bagli degil. Heartbeat gonderilmedi: ");
        Serial.println(payload);
        return;
    }

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


void publishOtaStatus(const char* payload)
{
    if (!client.connected())
    {
        Serial.print("MQTT bagli degil. OTA status gonderilmedi: ");
        Serial.println(payload);
        return;
    }

    bool published = client.publish(
        TOPIC_OTA_STATUS,
        payload
    );

    if (published)
    {
        Serial.print("OTA status gonderildi: ");
        Serial.println(payload);
    }
    else
    {
        Serial.print("OTA status gonderilemedi: ");
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
