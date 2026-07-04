#pragma once

#include <Arduino.h>

void setupProductionManager();
void updateProductionManager();

const char* productionHealthStatus();
String buildProductionHealthJson();
