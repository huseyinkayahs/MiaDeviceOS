#pragma once

#include <Arduino.h>

void setupMQTT();
void loopMQTT();
void publishHello();
void requestConfig();
void publishTelemetry(const char* payload);
void publishAlarm(const char* payload);
void publishCommandStatus(const char* payload);
void publishConfigStatus(const char* payload);
void publishHeartbeat(const char* payload);
void publishOtaStatus(const char* payload);
void publishMachineStatus(const char* payload);

bool hasIncomingConfigPayload();
String takeIncomingConfigPayload();

bool hasIncomingCommandPayload();
String takeIncomingCommandPayload();
