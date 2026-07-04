#include "log_manager.h"

namespace
{
    MiaLogLevel currentLevel = LOG_LEVEL_INFO;

    String normalizeLevelName(const String& raw)
    {
        String value = raw;
        value.trim();
        value.toUpperCase();
        return value;
    }
}

void setupLogManager()
{
    currentLevel = LOG_LEVEL_INFO;
}

bool setLogLevel(MiaLogLevel level)
{
    if (level < LOG_LEVEL_ERROR || level > LOG_LEVEL_DEBUG)
    {
        return false;
    }

    currentLevel = level;
    return true;
}

bool setLogLevelFromInt(int level)
{
    if (level < LOG_LEVEL_ERROR || level > LOG_LEVEL_DEBUG)
    {
        return false;
    }

    currentLevel = static_cast<MiaLogLevel>(level);
    return true;
}

bool setLogLevelFromString(const String& levelName)
{
    String value = normalizeLevelName(levelName);

    if (value == "ERROR")
    {
        currentLevel = LOG_LEVEL_ERROR;
        return true;
    }

    if (value == "WARN" || value == "WARNING")
    {
        currentLevel = LOG_LEVEL_WARN;
        return true;
    }

    if (value == "INFO")
    {
        currentLevel = LOG_LEVEL_INFO;
        return true;
    }

    if (value == "DEBUG")
    {
        currentLevel = LOG_LEVEL_DEBUG;
        return true;
    }

    return false;
}

MiaLogLevel getLogLevel()
{
    return currentLevel;
}

const char* logLevelToString(MiaLogLevel level)
{
    switch (level)
    {
        case LOG_LEVEL_ERROR:
            return "ERROR";

        case LOG_LEVEL_WARN:
            return "WARN";

        case LOG_LEVEL_INFO:
            return "INFO";

        case LOG_LEVEL_DEBUG:
            return "DEBUG";

        default:
            return "UNKNOWN";
    }
}

const char* currentLogLevelName()
{
    return logLevelToString(currentLevel);
}

bool shouldLog(MiaLogLevel level)
{
    return level <= currentLevel;
}

void logPrint(MiaLogLevel level, const char* message)
{
    if (shouldLog(level))
    {
        Serial.print(message);
    }
}

void logPrint(MiaLogLevel level, const String& message)
{
    if (shouldLog(level))
    {
        Serial.print(message);
    }
}

void logPrintln(MiaLogLevel level, const char* message)
{
    if (shouldLog(level))
    {
        Serial.println(message);
    }
}

void logPrintln(MiaLogLevel level, const String& message)
{
    if (shouldLog(level))
    {
        Serial.println(message);
    }
}

void logPrintln(MiaLogLevel level)
{
    if (shouldLog(level))
    {
        Serial.println();
    }
}
