#pragma once

#include <Arduino.h>

enum MiaLogLevel
{
    LOG_LEVEL_ERROR = 0,
    LOG_LEVEL_WARN = 1,
    LOG_LEVEL_INFO = 2,
    LOG_LEVEL_DEBUG = 3
};

void setupLogManager();

bool setLogLevel(MiaLogLevel level);
bool setLogLevelFromString(const String& levelName);
bool setLogLevelFromInt(int level);

MiaLogLevel getLogLevel();
const char* logLevelToString(MiaLogLevel level);
const char* currentLogLevelName();

bool shouldLog(MiaLogLevel level);

void logPrint(MiaLogLevel level, const char* message);
void logPrint(MiaLogLevel level, const String& message);
void logPrintln(MiaLogLevel level, const char* message);
void logPrintln(MiaLogLevel level, const String& message);
void logPrintln(MiaLogLevel level);
