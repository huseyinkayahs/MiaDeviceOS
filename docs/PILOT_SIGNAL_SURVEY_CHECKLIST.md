# FactoryBox One Pilot Signal Survey Checklist

## Purpose
Use this checklist before the first FactoryBox One pilot installation.

## Customer / Workshop Info

```text
Workshop name:
Machine type:
Machine brand/model:
Location:
Responsible person:
Installation date:
```

## Machine Operation

```text
What does the machine do?
Typical daily working hours:
Typical job duration:
Does the machine stay powered while idle?
Does it have standby mode?
Does it have a visible running lamp?
Does it have alarm lamp / tower light?
```

## Possible RUN Signal

Check available signal sources:

```text
[ ] RUN relay output
[ ] PLC 24V output
[ ] Stack light running signal
[ ] Main contactor auxiliary contact
[ ] Spindle / laser active signal
[ ] Compressor / pump / motor contactor
[ ] No clear digital signal available
```

## Current Sensor Feasibility

```text
Can we clamp around one phase / live conductor safely?
Is the panel accessible?
Is there enough space for current transformer?
Estimated standby current:
Estimated running current:
Suggested threshold:
```

## Network

```text
Wi-Fi available near machine?
Signal strength acceptable?
MQTT broker reachable?
Need external antenna?
Ethernet preferred?
```

## Power

```text
Available 220V socket?
DIN rail power supply possible?
24V DC available in panel?
Need separate adapter?
```

## Safety

```text
Qualified electrician required?
Panel access permission received?
No direct high-voltage connection to ESP32?
Opto-isolated input needed?
Fuse / protection needed?
```

## Recommended Pilot Setup

Choose one:

```text
[ ] DI1 RUN signal only
[ ] Current sensor only
[ ] DI1 RUN signal + current sensor backup
[ ] Not suitable yet
```

## Notes

```text
...
```
