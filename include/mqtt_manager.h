#pragma once

void setupMQTT();
void loopMQTT();
void publishHello();
void requestConfig();
void publishTelemetry(const char* payload);
void publishAlarm(const char* payload);