# SmartFlows n8n Workflows

## Purpose

This document records the first SmartFlows built for FactoryBox One.

SmartFlows are reusable n8n automation packs for industrial workflows.

---

## Flow 1: Daily Summary Request

Workflow name:

```text
FactoryBox - Daily Summary Request
```

Nodes:

```text
Schedule Trigger
↓
MQTT Publish
```

MQTT topic:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_daily_summary",
  "request_id": "daily-report-001"
}
```

Recommended schedule:

```text
Every day around 08:00
```

If n8n sends about 1 minute late, schedule 1 minute earlier.

---

## Flow 2: Daily Summary Telegram Report

Workflow name:

```text
FactoryBox - Daily Summary Telegram Report
```

Nodes:

```text
MQTT Trigger
↓
Parse MQTT JSON
↓
IF
↓
Telegram
```

MQTT trigger topic:

```text
mia/site01/laser01/command/status
```

Parse MQTT JSON Code node:

```javascript
return [
  {
    json: JSON.parse($json.message)
  }
];
```

IF conditions:

```text
command = get_daily_summary
status = done
```

---

## Flow 3: Stop Alert Request

Workflow name:

```text
FactoryBox - Stop Alert Request
```

Nodes:

```text
Schedule Trigger
↓
MQTT Publish
```

Recommended schedule:

```text
Every 5 minutes
```

Payload:

```json
{
  "command": "get_machine_runtime",
  "request_id": "stop-alert-check-001"
}
```

---

## Flow 4: Stop Alert Telegram

Workflow name:

```text
FactoryBox - Stop Alert Telegram
```

Nodes:

```text
MQTT Trigger
↓
Parse MQTT JSON
↓
Stop Alert Gate
↓
Telegram
```

Stop Alert Gate Code node:

```javascript
const data = $getWorkflowStaticData('global');

const item = $json;

if (item.command !== 'get_machine_runtime' || item.status !== 'done') {
  return [];
}

const machine = item.machine || {};
const state = machine.state;
const currentSegmentSec = Number(machine.current_segment_sec || 0);
const lastStateChangeMs = Number(machine.last_state_change_ms || 0);

const STOP_ALERT_THRESHOLD_SEC = 900;

if (state === 'RUNNING') {
  data.stopAlertSent = false;
  data.lastStopStateChangeMs = null;
  return [];
}

if (state !== 'STOPPED') {
  return [];
}

if (currentSegmentSec < STOP_ALERT_THRESHOLD_SEC) {
  return [];
}

if (
  data.stopAlertSent === true &&
  data.lastStopStateChangeMs === lastStateChangeMs
) {
  return [];
}

data.stopAlertSent = true;
data.lastStopStateChangeMs = lastStateChangeMs;

return [
  {
    json: {
      ...item,
      stop_alert: {
        send: true,
        threshold_sec: STOP_ALERT_THRESHOLD_SEC,
        current_segment_sec: currentSegmentSec,
        last_state_change_ms: lastStateChangeMs
      }
    }
  }
];
```

Behavior:

```text
15+ minutes STOPPED → Send one alert
Still STOPPED → Do not repeat
RUNNING → Reset alert lock
New STOPPED event → Send new alert after threshold
```
