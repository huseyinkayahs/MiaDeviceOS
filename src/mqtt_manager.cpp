#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <string.h>

#include "mqtt_manager.h"
#include "device_context.h"
#include "app_version.h"
#include "mqtt_topics.h"
#include "secrets.h"
#include "log_manager.h"

WiFiClient espClient;
PubSubClient client(espClient);

namespace
{
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
        logPrint(LOG_LEVEL_INFO, "MQTT baglaniyor...");

        unsigned long now = millis();
        lastMqttReconnectAttemptMs = now;
        deviceContext.state.lastMqttReconnectMs = now;
        deviceContext.state.mqttReconnectCount++;

        String clientId = "Laser01-";
        clientId += String(random(0xffff), HEX);

        bool connected = false;

        if (strlen(MQTT_USERNAME) > 0)
        {
            connected = client.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD);
        }
        else
        {
            connected = client.connect(clientId.c_str());
        }

        if (connected)
        {
            logPrintln(LOG_LEVEL_INFO, " BAGLANDI");
            deviceContext.state.mqttConnected = true;

            client.subscribe(MiaTopics::CONFIG);
            logPrintln(LOG_LEVEL_INFO, "Config topic dinleniyor.");

            client.subscribe(MiaTopics::COMMAND);
            logPrintln(LOG_LEVEL_INFO, "Command topic dinleniyor.");

            return true;
        }

        logPrint(LOG_LEVEL_WARN, " HATA: ");
        logPrintln(LOG_LEVEL_WARN, String(client.state()));
        deviceContext.state.mqttConnected = false;
        deviceContext.state.mqttConnectFailCount++;
        return false;
    }
}

void mqttCallback(char* topic, byte* payload, unsigned int length)
{
    if (shouldLog(LOG_LEVEL_DEBUG))
    {
        Serial.print("MQTT mesaj alindi. Topic: ");
        Serial.println(topic);
    }

    String json;

    for (unsigned int i = 0; i < length; i++)
    {
        char c = (char)payload[i];
        json += c;
    }

    if (shouldLog(LOG_LEVEL_DEBUG))
    {
        Serial.print("Payload: ");
        Serial.println(json);
    }

    if (strcmp(topic, MiaTopics::CONFIG) == 0)
    {
        incomingConfigPayload = json;
        incomingConfigPending = true;
        return;
    }

    if (strcmp(topic, MiaTopics::COMMAND) == 0)
    {
        incomingCommandPayload = json;
        incomingCommandPending = true;
        return;
    }

    logPrintln(LOG_LEVEL_WARN, "MQTT mesaji bu cihaz tarafindan islenmedi.");
}

void setupMQTT()
{
    client.setBufferSize(4096);
    client.setServer(MQTT_SERVER, MQTT_PORT);
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
        logPrintln(LOG_LEVEL_WARN, "MQTT bagli degil. Hello gonderilmedi.");
        return;
    }

    char payload[160];
    snprintf(payload, sizeof(payload),
        "{\"device_id\":\"%s\",\"device_model\":\"%s\",\"firmware_version\":\"%s\",\"status\":\"ONLINE\"}",
        MIA_DEVICE_ID,
        MIA_DEVICE_MODEL,
        MIA_FIRMWARE_VERSION);

    client.publish(
        MiaTopics::TEST,
        payload);

    logPrintln(LOG_LEVEL_DEBUG, "MQTT mesaji gonderildi.");
}

void requestConfig()
{
    if (!client.connected())
    {
        logPrintln(LOG_LEVEL_WARN, "MQTT bagli degil. Config istegi gonderilmedi.");
        return;
    }

    char payload[96];
    snprintf(payload, sizeof(payload),
        "{\"device_id\":\"%s\",\"request\":\"get_config\"}",
        MIA_DEVICE_ID);

    client.publish(
        MiaTopics::GET_CONFIG,
        payload);

    logPrintln(LOG_LEVEL_DEBUG, "Config istegi gonderildi.");
}

void publishTelemetry(const char* payload)
{
    if (!client.connected())
    {
        return;
    }

    client.publish(
        MiaTopics::TELEMETRY,
        payload
    );
}

void publishAlarm(const char* payload)
{
    if (!client.connected())
    {
        logPrintln(LOG_LEVEL_WARN, "MQTT bagli degil. Alarm gonderilmedi.");
        return;
    }

    client.publish(
        MiaTopics::ALARM,
        payload
    );
}

void publishCommandStatus(const char* payload)
{
    if (!client.connected())
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("MQTT bagli degil. Command status gonderilmedi: ");
            Serial.println(payload);
        }
        return;
    }

    bool published = client.publish(
        MiaTopics::COMMAND_STATUS,
        payload
    );

    if (published)
    {
        if (shouldLog(LOG_LEVEL_INFO))
        {
            Serial.print("Command status gonderildi: ");
            Serial.println(payload);
        }
    }
    else
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("Command status gonderilemedi: ");
            Serial.println(payload);
        }
    }
}

void publishConfigStatus(const char* payload)
{
    if (!client.connected())
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("MQTT bagli degil. Config status gonderilmedi: ");
            Serial.println(payload);
        }
        return;
    }

    bool published = client.publish(
        MiaTopics::CONFIG_STATUS,
        payload
    );

    if (published)
    {
        if (shouldLog(LOG_LEVEL_INFO))
        {
            Serial.print("Config status gonderildi: ");
            Serial.println(payload);
        }
    }
    else
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("Config status gonderilemedi: ");
            Serial.println(payload);
        }
    }
}

void publishHeartbeat(const char* payload)
{
    if (!client.connected())
    {
        return;
    }

    client.publish(
        MiaTopics::HEARTBEAT,
        payload
    );
}


void publishOtaStatus(const char* payload)
{
    if (!client.connected())
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("MQTT bagli degil. OTA status gonderilmedi: ");
            Serial.println(payload);
        }
        return;
    }

    bool published = client.publish(
        MiaTopics::OTA_STATUS,
        payload
    );

    if (published)
    {
        if (shouldLog(LOG_LEVEL_INFO))
        {
            Serial.print("OTA status gonderildi: ");
            Serial.println(payload);
        }
    }
    else
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("OTA status gonderilemedi: ");
            Serial.println(payload);
        }
    }
}


void publishMachineStatus(const char* payload)
{
    if (!client.connected())
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("MQTT bagli degil. Machine status gonderilmedi: ");
            Serial.println(payload);
        }
        return;
    }

    bool published = client.publish(
        MiaTopics::MACHINE_STATUS,
        payload
    );

    if (published)
    {
        if (shouldLog(LOG_LEVEL_DEBUG))
        {
            Serial.print("Machine status gonderildi: ");
            Serial.println(payload);
        }
    }
    else
    {
        if (shouldLog(LOG_LEVEL_WARN))
        {
            Serial.print("Machine status gonderilemedi: ");
            Serial.println(payload);
        }
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
