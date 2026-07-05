# FactoryBox One Input Source Persistence

## Purpose

FactoryBox One can use more than one source to decide whether the machine is RUNNING or STOPPED.

The two MVP sources are:

```text
AUTO_CURRENT → simulated / current-threshold based runtime detection
DI1          → digital input based RUN signal detection
```

v2.8 makes the selected machine input source persistent.

This means that if the device is changed to DI1 mode and then restarted, it will boot again in DI1 mode.

---

## Why this matters

In a real pilot installation, FactoryBox One may be connected to a machine RUN signal through DI1.

Without persistence, the device would return to AUTO_CURRENT after every restart. That could create wrong runtime readings in the field.

With persistence:

```text
DI1 selected → restart → DI1 still selected
AUTO_CURRENT selected → restart → AUTO_CURRENT still selected
```

---

## Command

### set_machine_input_source

Topic:

```text
mia/site01/laser01/command
```

Set DI1 as the runtime source:

```json
{
  "command": "set_machine_input_source",
  "request_id": "source-di1-001",
  "source": "DI1"
}
```

Set AUTO_CURRENT as the runtime source:

```json
{
  "command": "set_machine_input_source",
  "request_id": "source-auto-001",
  "source": "AUTO_CURRENT"
}
```

---

## Expected response

```json
{
  "command": "set_machine_input_source",
  "status": "done",
  "message": "Machine input source updated and persisted",
  "machine": {
    "input_source": "DI1",
    "input_source_persistent": true
  }
}
```

---

## Runtime settings

The selected source is also visible through:

```json
{
  "command": "get_runtime_settings",
  "request_id": "runtime-settings-001"
}
```

Expected section:

```json
{
  "runtime_settings": {
    "log_level": "INFO",
    "log_level_persistent": true,
    "machine_input_source": "DI1",
    "machine_input_source_persistent": true
  }
}
```

---

## Boot behavior

During boot, MachineRuntimeManager loads the saved machine input source from runtime settings.

Examples:

```text
Saved source: DI1          → boot source: DI1
Saved source: AUTO_CURRENT → boot source: AUTO_CURRENT
Invalid saved value        → fallback: AUTO_CURRENT
```

The boot log includes:

```text
Machine runtime input source: DI1
```

or:

```text
Machine runtime input source: AUTO_CURRENT
```

---

## Test plan

1. Set DI1 simulation active.
2. Set machine input source to DI1.
3. Verify `input_source: DI1` and `input_source_persistent: true`.
4. Restart device.
5. Run `get_machine_runtime`.
6. Verify the device still reports `input_source: DI1`.
7. Set source back to AUTO_CURRENT.
8. Restart again.
9. Verify `input_source: AUTO_CURRENT`.

---

## Safety note

For real installations, DI1 should be connected through a safe and isolated machine signal path.

Recommended sources:

```text
Dry contact
Relay auxiliary contact
Optocoupler-isolated output
PLC digital output through proper isolation
```

Do not connect ESP32 GPIO directly to 220V / 380V or unknown machine control voltages.


## v2.8.1 Hotfix

ESP32 Preferences / NVS key names must be short. The persisted machine input source key was shortened from `machineInputSource` to `machSrc` to avoid `KEY_TOO_LONG` errors.

Test expectation:

```text
set_machine_input_source DI1 -> status: done
Restart -> machine_input_source: DI1
```
