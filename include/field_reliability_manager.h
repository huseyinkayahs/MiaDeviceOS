#pragma once

#include <Arduino.h>

void setupFieldReliabilityManager();
void updateFieldReliabilityManager();

const char* fieldReliabilityStatus();
const char* fieldReliabilityIssue();
int fieldReliabilityScore();
unsigned long fieldReliabilityWifiOfflineMs();
unsigned long fieldReliabilityMqttOfflineMs();
String buildFieldReliabilityJson();
