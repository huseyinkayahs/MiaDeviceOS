#include "ble_manager.h"

#include "app_version.h"
#include "device_context.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

namespace
{
    const char* BLE_DEVICE_NAME = "MiaDeviceOS-laser01";

    const char* SERVICE_UUID = "6d696100-0000-4000-8000-000000000001";
    const char* INFO_CHAR_UUID = "6d696100-0000-4000-8000-000000000002";
    const char* STATUS_CHAR_UUID = "6d696100-0000-4000-8000-000000000003";
    const char* COMMAND_CHAR_UUID = "6d696100-0000-4000-8000-000000000004";

    BLEServer* bleServer = nullptr;
    BLECharacteristic* infoCharacteristic = nullptr;
    BLECharacteristic* statusCharacteristic = nullptr;
    BLECharacteristic* commandCharacteristic = nullptr;

    bool bleStarted = false;

    String buildInfoPayload()
    {
        JsonDocument doc;

        doc["project"] = MIA_PROJECT_NAME;
        doc["device_id"] = MIA_DEVICE_ID;
        doc["device_model"] = MIA_DEVICE_MODEL;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["build_type"] = MIA_BUILD_TYPE;
        doc["hardware_revision"] = MIA_HARDWARE_REVISION;
        doc["platform_name"] = MIA_PLATFORM_NAME;
        doc["ble_device_name"] = BLE_DEVICE_NAME;

        String payload;
        serializeJson(doc, payload);
        return payload;
    }

    String buildStatusPayload()
    {
        JsonDocument doc;

        doc["device_id"] = MIA_DEVICE_ID;
        doc["firmware_version"] = MIA_FIRMWARE_VERSION;
        doc["platform_name"] = MIA_PLATFORM_NAME;
        doc["event"] = "BLE_STATUS";
        doc["uptime_ms"] = millis();
        doc["wifi_connected"] = deviceContext.state.wifiConnected;
        doc["mqtt_connected"] = deviceContext.state.mqttConnected;
        doc["wifi_rssi"] = deviceContext.state.wifiRSSI;
        doc["alarm_active"] = deviceContext.alarm.active;
        doc["current"] = deviceContext.state.current;
        doc["temperature"] = deviceContext.state.temperature;
        doc["ble_client_connected"] = deviceContext.ble.clientConnected;
        doc["ble_command_count"] = deviceContext.ble.commandCount;

        String payload;
        serializeJson(doc, payload);
        return payload;
    }

    void updateStatusCharacteristic(bool notifyClient)
    {
        if (statusCharacteristic == nullptr)
        {
            return;
        }

        String payload = buildStatusPayload();
        statusCharacteristic->setValue(payload.c_str());

        if (notifyClient && deviceContext.ble.clientConnected)
        {
            statusCharacteristic->notify();
        }

        Serial.print("BLE status guncellendi: ");
        Serial.println(payload);
    }

    String readStringValue(BLECharacteristic* characteristic)
    {
        if (characteristic == nullptr)
        {
            return "";
        }

        std::string value = characteristic->getValue();
        return String(value.c_str());
    }

    String readOptionalString(JsonDocument& doc, const char* key)
    {
        if (doc[key].is<const char*>())
        {
            return doc[key].as<String>();
        }

        return "";
    }

    void handleBleCommand(const String& payload)
    {
        deviceContext.ble.commandCount++;

        String command = payload;
        command.trim();

        if (command.startsWith("{"))
        {
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, command);

            if (error)
            {
                Serial.println("BLE komut reddedildi: Invalid JSON");
                updateStatusCharacteristic(true);
                return;
            }

            command = readOptionalString(doc, "command");
            command.trim();
        }

        Serial.print("BLE komut alindi: ");
        Serial.println(command);

        if (command == "get_status")
        {
            updateStatusCharacteristic(true);
            return;
        }

        if (command == "reset_alarm")
        {
            deviceContext.command.resetAlarmRequested = true;
            Serial.println("BLE reset_alarm komutu kabul edildi.");
            updateStatusCharacteristic(true);
            return;
        }

        Serial.println("BLE komut reddedildi: Unknown command");
        updateStatusCharacteristic(true);
    }

    class MiaBleServerCallbacks : public BLEServerCallbacks
    {
    public:
        void onConnect(BLEServer* server) override
        {
            deviceContext.ble.clientConnected = true;
            Serial.println("BLE client baglandi.");
            updateStatusCharacteristic(true);
        }

        void onDisconnect(BLEServer* server) override
        {
            deviceContext.ble.clientConnected = false;
            Serial.println("BLE client ayrildi. Advertising tekrar baslatiliyor.");
            server->getAdvertising()->start();
        }
    };

    class MiaBleCommandCallbacks : public BLECharacteristicCallbacks
    {
    public:
        void onWrite(BLECharacteristic* characteristic) override
        {
            String payload = readStringValue(characteristic);
            handleBleCommand(payload);
        }
    };
}

void setupBLE()
{
    if (!deviceContext.ble.enabled)
    {
        Serial.println("BLE service mode kapali.");
        return;
    }

    BLEDevice::init(BLE_DEVICE_NAME);

    bleServer = BLEDevice::createServer();
    bleServer->setCallbacks(new MiaBleServerCallbacks());

    BLEService* service = bleServer->createService(SERVICE_UUID);

    infoCharacteristic = service->createCharacteristic(
        INFO_CHAR_UUID,
        BLECharacteristic::PROPERTY_READ
    );
    infoCharacteristic->setValue(buildInfoPayload().c_str());

    statusCharacteristic = service->createCharacteristic(
        STATUS_CHAR_UUID,
        BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
    );
    statusCharacteristic->addDescriptor(new BLE2902());
    statusCharacteristic->setValue(buildStatusPayload().c_str());

    commandCharacteristic = service->createCharacteristic(
        COMMAND_CHAR_UUID,
        BLECharacteristic::PROPERTY_WRITE
    );
    commandCharacteristic->setCallbacks(new MiaBleCommandCallbacks());

    service->start();

    BLEAdvertising* advertising = BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE_UUID);
    advertising->setScanResponse(true);
    advertising->setMinPreferred(0x06);
    advertising->setMinPreferred(0x12);
    BLEDevice::startAdvertising();

    deviceContext.ble.clientConnected = false;
    deviceContext.ble.lastStatusUpdateMs = millis();

    bleStarted = true;

    Serial.print("BLE service mode basladi. Device name: ");
    Serial.println(BLE_DEVICE_NAME);
}

void updateBLE()
{
    if (!bleStarted)
    {
        return;
    }

    unsigned long now = millis();

    if (now - deviceContext.ble.lastStatusUpdateMs >= deviceContext.ble.statusIntervalMs)
    {
        deviceContext.ble.lastStatusUpdateMs = now;
        updateStatusCharacteristic(true);
    }
}

bool isBleClientConnected()
{
    return deviceContext.ble.clientConnected;
}
