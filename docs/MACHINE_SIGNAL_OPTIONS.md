# Machine Signal Options

## Purpose
This document compares possible ways to detect whether a laser / CNC machine is RUNNING or STOPPED.

## Option 1: Digital RUN Signal

### Description
Read a machine-provided RUN signal, relay output, lamp output, or PLC output.

### Example

```text
DI1 active   -> RUNNING
DI1 inactive -> STOPPED
```

### Pros

```text
Most reliable
Simple logic
Low processing needed
Good for production reporting
```

### Cons

```text
May require access to control panel
Signal type differs by machine
May require isolation circuit
Needs electrician for panel wiring
```

### Recommendation
Best option when a safe RUN contact is available.

---

## Option 2: Current Sensor

### Description
Measure current draw and infer machine state from a threshold.

### Example

```text
Current >= 3A -> RUNNING
Current < 3A  -> STOPPED
```

### Pros

```text
Easy retrofit
No need to modify machine logic
Works with many machines
Good first pilot option
```

### Cons

```text
Needs calibration
Standby current can cause false RUNNING
Different jobs may draw different current
Sensor choice matters
```

### Recommendation
Best fallback when no clean RUN signal is available.

---

## Option 3: Contact Relay / Contactor Auxiliary Contact

### Description
Use an auxiliary contact from the motor/contact system or main work contactor.

### Pros

```text
Reliable
Simple digital input
Industrial-friendly
```

### Cons

```text
Requires panel access
Must be wired safely
May not represent actual production in all machines
```

### Recommendation
Very good for machines with a clear production contactor.

---

## Option 4: Stack Light / Warning Lamp Signal

### Description
Use the machine's signal tower or status lamp output.

### Pros

```text
Often already indicates running/stopped/alarm
Useful for CNC machines
Can map multiple states
```

### Cons

```text
Voltage may be 24V, 220V, or custom
Lamp meaning can differ by machine
Needs safe interface
```

### Recommendation
Good option if the workshop already uses stack lights.

---

## Option 5: Modbus / PLC / Controller Data

### Description
Read machine state through Modbus RTU/TCP, PLC registers, or CNC controller data.

### Pros

```text
Most detailed data
Can read alarms, counters, job state, speed, etc.
Professional long-term direction
```

### Cons

```text
Machine-specific
Longer setup time
Not suitable for first MVP
Requires protocol knowledge
```

### Recommendation
Not for first MVP. Keep for future SmartBox / SmartFlows modules.

---

## Final MVP Recommendation

For FactoryBox One MVP:

```text
Primary: DI1 RUN signal if available
Fallback: Current sensor threshold
Future: Modbus / PLC integration
```

## Field Survey Questions

Before installation, ask:

```text
Does the machine have a RUN relay output?
Is there a 24V status output?
Is there a stack light?
Can we safely access the panel?
Does the machine have a main contactor auxiliary contact?
What is standby current?
What is normal running current?
Is Wi-Fi stable near the machine?
```
