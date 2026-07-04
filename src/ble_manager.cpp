#include "ble_manager.h"

#include "app_version.h"
#include "device_context.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#include <Arduino.h>
#include <ArduinoJson.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#ifndef BLE_SERVICE_PIN
#define BLE_SERVICE_PIN "123456"
#endif

#ifndef BLE_MAX_FAILED_AUTH
#define BLE_MAX_FAILED_AUTH 5
#endif

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

    void setCommandResult(const String& command, const String& status, const String& message)
    {
        deviceContext.ble.lastCommand = command;
        deviceContext.ble.lastCommandStatus = status;
        deviceContext.ble.lastCommandMessage = message;
    }

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
        doc["ble_security"] = "service_pin";

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
        doc["ble_service_authenticated"] = deviceContext.ble.serviceAuthenticated;
        doc["ble_command_count"] = deviceContext.ble.commandCount;
        doc["ble_rejected_command_count"] = deviceContext.ble.rejectedCommandCount;
        doc["ble_failed_auth_count"] = deviceContext.ble.failedAuthCount;
        doc["last_command"] = deviceContext.ble.lastCommand;
        doc["last_command_status"] = deviceContext.ble.lastCommandStatus;
        doc["last_command_message"] = deviceContext.ble.lastCommandMessage;

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

    bool isValidPin(const String& pin)
    {
        return pin == String(BLE_SERVICE_PIN);
    }

    bool authorizeCommand(const String& command, const String& pin)
    {
        if (command == "get_status")
        {
            return true;
        }

        if (deviceContext.ble.serviceAuthenticated)
        {
            return true;
        }

        if (deviceContext.ble.failedAuthCount >= BLE_MAX_FAILED_AUTH)
        {
            deviceContext.ble.rejectedCommandCount++;
            return false;
        }

        if (pin.length() > 0 && isValidPin(pin))
        {
            return true;
        }

        if (pin.length() > 0)
        {
            deviceContext.ble.failedAuthCount++;
        }

        deviceContext.ble.rejectedCommandCount++;
        return false;
    }

    void rejectBleCommand(const String& command, const String& message)
    {
        Serial.print("BLE komut reddedildi: ");
        Serial.println(message);
        setCommandResult(command, "rejected", message);
        updateStatusCharacteristic(true);
    }

    void acceptAuthentication()
    {
        deviceContext.ble.serviceAuthenticated = true;
        setCommandResult("auth", "done", "Service PIN accepted");
        Serial.println("BLE servis PIN kabul edildi.");
        updateStatusCharacteristic(true);
    }

    void handleBleCommand(const String& payload)
    {
        deviceContext.ble.commandCount++;

        String command = payload;
        String pin = "";
        command.trim();

        if (command.startsWith("{"))
        {
            JsonDocument doc;
            DeserializationError error = deserializeJson(doc, command);

            if (error)
            {
                rejectBleCommand("", "Invalid JSON");
                return;
            }

            command = readOptionalString(doc, "command");
            pin = readOptionalString(doc, "pin");
            command.trim();
            pin.trim();
        }

        Serial.print("BLE komut alindi: ");
        Serial.println(command);

        if (command.length() == 0)
        {
            rejectBleCommand(command, "Missing command");
            return;
        }

        if (command == "auth")
        {
            if (deviceContext.ble.failedAuthCount >= BLE_MAX_FAILED_AUTH)
            {
                deviceContext.ble.rejectedCommandCount++;
                rejectBleCommand(command, "Too many failed PIN attempts. Reconnect required");
                return;
            }

            if (isValidPin(pin))
            {
                deviceContext.ble.failedAuthCount = 0;
                acceptAuthentication();
                return;
            }

            deviceContext.ble.failedAuthCount++;
            deviceContext.ble.rejectedCommandCount++;
            rejectBleCommand(command, "Invalid service PIN");
            return;
        }

        if (command == "logout")
        {
            deviceContext.ble.serviceAuthenticated = false;
            setCommandResult(command, "done", "BLE service session closed");
            Serial.println("BLE servis oturumu kapatildi.");
            updateStatusCharacteristic(true);
            return;
        }

        if (!authorizeCommand(command, pin))
        {
            rejectBleCommand(command, "Service PIN required or invalid");
            return;
        }

        if (command == "get_status")
        {
            setCommandResult(command, "done", "Status returned");
            updateStatusCharacteristic(true);
            return;
        }

        if (command == "reset_alarm")
        {
            deviceContext.command.resetAlarmRequested = true;
            setCommandResult(command, "accepted", "Alarm reset requested");
            Serial.println("BLE reset_alarm komutu kabul edildi.");
            updateStatusCharacteristic(true);
            return;
        }

        deviceContext.ble.rejectedCommandCount++;
        rejectBleCommand(command, "Unknown command");
    }

    class MiaBleServerCallbacks : public BLEServerCallbacks
    {
    public:
        void onConnect(BLEServer* server) override
        {
            deviceContext.ble.clientConnected = true;
            deviceContext.ble.serviceAuthenticated = false;
            deviceContext.ble.failedAuthCount = 0;
            Serial.println("BLE client baglandi.");
            updateStatusCharacteristic(true);
        }

        void onDisconnect(BLEServer* server) override
        {
            deviceContext.ble.clientConnected = false;
            deviceContext.ble.serviceAuthenticated = false;
            deviceContext.ble.failedAuthCount = 0;
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
    deviceContext.ble.serviceAuthenticated = false;
    deviceContext.ble.lastStatusUpdateMs = millis();
    setCommandResult("", "idle", "");

    bleStarted = true;

    Serial.print("BLE service mode basladi. Device name: ");
    Serial.println(BLE_DEVICE_NAME);
    Serial.println("BLE service mode security: service PIN required for protected commands.");
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
