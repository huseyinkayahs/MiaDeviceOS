# FactoryBox One Input Strategy

## Sprint
v2.6 FactoryBox Input Strategy / Machine Signal Planning

## Purpose
FactoryBox One needs a reliable way to decide whether a machine is RUNNING or STOPPED in a real workshop.

Until now this was tested with simulated current and manual commands. This document defines the real-world input strategy for the first pilot installations.

## Core Decision
FactoryBox One should support more than one signal source, but the first commercial version must stay simple.

Recommended priority:

1. Digital RUN signal from the machine if available
2. Current sensor fallback if no RUN signal is available
3. Modbus / PLC integration only for later versions

## Input Priority Logic

```text
If DI1 RUN signal is configured and valid:
    DI1 active   -> RUNNING
    DI1 inactive -> STOPPED
Else:
    current >= running_current_threshold -> RUNNING
    current < running_current_threshold  -> STOPPED
```

## Why This Strategy

A clean digital RUN signal is usually the most reliable source because it comes directly from the machine control circuit.

Current sensing is easier to retrofit but needs threshold calibration. Some machines consume standby current even when not producing, so current alone may not always be enough.

## FactoryBox One MVP Inputs

Recommended first hardware input plan:

```text
DI1  -> Machine RUN signal / dry contact / relay contact
DI2  -> Machine alarm signal or door/safety signal
DI3  -> Optional start/stop button signal
DI4  -> Optional operator / maintenance signal
AI1  -> Current sensor input
AI2  -> Optional temperature / voltage / spare analog input
Relay 1 -> Optional warning lamp / buzzer / external signal
Relay 2 -> Optional machine interlock or future use
```

## First Pilot Rule

For the first pilot, do not try to connect every possible signal.

Recommended minimum:

```text
1 signal for RUN / STOP
1 current sensor if safe and practical
1 power supply
MQTT / Wi-Fi connection
```

## Safety Note

FactoryBox must not be connected directly to dangerous machine voltage without proper isolation.

Preferred signal types:

```text
Dry contact
Opto-isolated digital input
Relay auxiliary contact
Current transformer / clamp sensor
Low-voltage PLC output
```

Any 220V / 380V wiring inside a panel should be handled by a qualified electrician.

## Product Positioning

FactoryBox One should be sold as a machine visibility device, not as a machine controller.

First promise:

```text
Know whether your machine is running, stopped, and how long it worked today.
```

Avoid early promises like:

```text
Full production planning
Full PLC integration
Full ERP integration
Full energy analytics
```

These can come later as modules.

## Next Firmware Direction

The current Machine Runtime Tracker already supports:

```text
RUNNING / STOPPED
runtime counters
daily summary
manual test command
current based auto mode
```

Next firmware work should add a clean abstraction for machine input source:

```text
MachineInputSource
- AUTO_CURRENT
- DIGITAL_INPUT
- MANUAL_COMMAND
- MODBUS
```

For now, planning is enough. The next code sprint should only start after the pilot wiring decision is clear.


## v2.7 Notu

DI1 dijital giriş sürücüsü eklendi. Firmware artık `set_machine_input_source` komutu ile Machine Runtime kaynağını `DI1` veya `AUTO_CURRENT` olarak değiştirebilir. Fiziksel bağlantı olmadan test için `set_di1_simulation` komutu kullanılabilir.
