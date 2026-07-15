#include "sensor_manager.h"
#include "device_context.h"

#include <Arduino.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <math.h>

namespace
{
constexpr uint8_t DS18B20_PIN = 4;
constexpr uint8_t DS18B20_RESOLUTION_BITS = 10;
constexpr unsigned long TEMPERATURE_READ_INTERVAL_MS = 2000;
constexpr unsigned long TEMPERATURE_LOG_INTERVAL_MS = 30000;
constexpr float TEMPERATURE_LOG_CHANGE_C = 0.5f;

OneWire oneWire(DS18B20_PIN);
DallasTemperature temperatureSensor(&oneWire);

unsigned long lastTemperatureReadMs = 0;
unsigned long lastTemperatureLogMs = 0;
unsigned int successfulReadCount = 0;
unsigned int failedReadCount = 0;

bool sensorConnected = false;
bool validReadingAvailable = false;
float lastLoggedTemperatureC = 0.0f;

bool isValidTemperature(float temperatureC)
{
    return temperatureC != DEVICE_DISCONNECTED_C &&
           temperatureC >= -55.0f &&
           temperatureC <= 125.0f;
}

void logTemperatureIfNeeded(unsigned long now, float temperatureC)
{
    const bool firstLog = lastTemperatureLogMs == 0;
    const bool intervalElapsed = now - lastTemperatureLogMs >= TEMPERATURE_LOG_INTERVAL_MS;
    const bool meaningfulChange = fabsf(temperatureC - lastLoggedTemperatureC) >= TEMPERATURE_LOG_CHANGE_C;

    if (!firstLog && !intervalElapsed && !meaningfulChange)
    {
        return;
    }

    Serial.printf("Sicaklik: %.2f C\n", temperatureC);
    lastTemperatureLogMs = now;
    lastLoggedTemperatureC = temperatureC;
}
}

float simulatedCurrent = 0.0f;

void setupSensors()
{
    simulatedCurrent = 0.0f;

    temperatureSensor.begin();
    temperatureSensor.setResolution(DS18B20_RESOLUTION_BITS);

    sensorConnected = temperatureSensor.getDeviceCount() > 0;
    validReadingAvailable = false;
    successfulReadCount = 0;
    failedReadCount = 0;
    lastTemperatureLogMs = 0;
    lastTemperatureReadMs = millis() - TEMPERATURE_READ_INTERVAL_MS;

    if (sensorConnected)
    {
        Serial.println("DS18B20 sensor bulundu.");
    }
    else
    {
        Serial.println("UYARI: DS18B20 sensor bulunamadi.");
    }
}

void updateSensors()
{
    // Akim sensoru henuz simulasyon.
    deviceContext.state.current = 20.0f;

    const unsigned long now = millis();

    if (now - lastTemperatureReadMs < TEMPERATURE_READ_INTERVAL_MS)
    {
        return;
    }

    lastTemperatureReadMs = now;
    temperatureSensor.requestTemperatures();

    const float temperatureC = temperatureSensor.getTempCByIndex(0);
    const bool wasConnected = sensorConnected;

    if (isValidTemperature(temperatureC))
    {
        deviceContext.state.temperature = temperatureC;
        sensorConnected = true;
        validReadingAvailable = true;
        successfulReadCount++;

        if (!wasConnected)
        {
            Serial.println("DS18B20 sensor yeniden baglandi.");
        }

        logTemperatureIfNeeded(now, temperatureC);
        return;
    }

    sensorConnected = false;
    validReadingAvailable = false;
    failedReadCount++;

    if (wasConnected || failedReadCount == 1)
    {
        Serial.println("UYARI: DS18B20 okuma hatasi.");
    }
}

bool temperatureSensorConnected()
{
    return sensorConnected;
}

bool temperatureSensorHasValidReading()
{
    return validReadingAvailable;
}

float temperatureSensorValueC()
{
    return deviceContext.state.temperature;
}

const char* temperatureSensorTypeName()
{
    return "DS18B20";
}

uint8_t temperatureSensorDataPin()
{
    return DS18B20_PIN;
}

uint8_t temperatureSensorResolutionBits()
{
    return DS18B20_RESOLUTION_BITS;
}

unsigned long temperatureSensorReadIntervalMs()
{
    return TEMPERATURE_READ_INTERVAL_MS;
}

unsigned long temperatureSensorLastReadMs()
{
    return lastTemperatureReadMs;
}

unsigned int temperatureSensorReadCount()
{
    return successfulReadCount;
}

unsigned int temperatureSensorErrorCount()
{
    return failedReadCount;
}
