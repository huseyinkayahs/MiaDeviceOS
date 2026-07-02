#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("MiaDeviceOS basladi");
}

void loop() {
  Serial.println("ESP32 PlatformIO calisiyor");
  delay(1000);
}