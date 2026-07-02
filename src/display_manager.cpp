#include "display_manager.h"

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

    display.clearDisplay();

    display.setTextSize(2);
    display.setTextColor(SSD1306_WHITE);

    display.setCursor(8, 10);
    display.println("Mia");

    display.setCursor(8, 35);
    display.println("DeviceOs");

    display.display();

    Serial.println("OLED baslatildi.");
}

void updateDisplay()
{
    // Şimdilik boş
}