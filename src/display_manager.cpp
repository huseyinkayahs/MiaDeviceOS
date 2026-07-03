#include "display_manager.h"
#include "device_context.h"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

void setupDisplay()
{
    Wire.begin(21, 22);

    if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C))
    {
        Serial.println("OLED bulunamadi!");
        return;
    }

    Serial.println("OLED baslatildi.");

    showBootScreen();
}

void showBootScreen()
{
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);

    display.setTextSize(2);
    display.setCursor(10, 6);
    display.println("Mia");

    display.setCursor(10, 28);
    display.println("DeviceOS");

    display.setTextSize(1);
    display.setCursor(18, 48);
    display.println("v0.7.0");

    // Progress bar çerçevesi
    display.drawRect(14, 58, 100, 6, SSD1306_WHITE);

    // Çubuk dolumu
    for (int i = 0; i <= 96; i += 12)
    {
        display.fillRect(16, 60, i, 2, SSD1306_WHITE);
        display.display();
        delay(150);
    }

    delay(500);
}

void updateDisplay()
{
    display.clearDisplay();

    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);

    display.setCursor(0, 0);
    display.println("MiaDeviceOS");

    display.drawLine(0, 10, 128, 10, SSD1306_WHITE);

    display.setCursor(0, 16);
    display.print("WiFi : ");
    display.println(deviceContext.state.wifiConnected ? "OK" : "OFF");

    display.setCursor(0, 26);
    display.print("MQTT : ");
    display.println(deviceContext.state.mqttConnected ? "OK" : "OFF");

    display.setCursor(0, 36);
    display.print("RSSI : ");
    display.println(deviceContext.state.wifiRSSI);

    display.setCursor(0, 46);
    display.print("Current: ");
    display.print(deviceContext.state.current, 1);
    display.println(" A");

    display.setCursor(0, 56);
    display.print("Temp   : ");
    display.print(deviceContext.state.temperature, 1);
    display.println(" C");

    display.display();
}