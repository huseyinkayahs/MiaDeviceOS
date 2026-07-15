require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const mqtt = require('mqtt');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.emqx.io:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';
const BASE_TOPIC = process.env.MQTT_BASE_TOPIC || 'mia/site01/laser01';
const DEVICE_ID = process.env.DEVICE_ID || 'laser01';
const DEVICE_ONLINE_TIMEOUT_SEC = Number(process.env.DEVICE_ONLINE_TIMEOUT_SEC || 90);

const ALLOWED_COMMANDS = new Set([
  'get_config',
  'get_health',
  'get_machine_runtime',
  'get_daily_summary',
  'get_digital_inputs',
  'get_temperature',
  'get_runtime_settings',
  'get_diagnostics',
  'get_reliability',
  'get_watchdog',
  'get_boot_diagnostics',
  'get_log_level',
]);

const topics = {
  command: `${BASE_TOPIC}/command`,
  commandStatus: `${BASE_TOPIC}/command/status`,
  heartbeat: `${BASE_TOPIC}/heartbeat`,
  alarm: `${BASE_TOPIC}/alarm`,
  telemetry: `${BASE_TOPIC}/telemetry`,
  machineStatus: `${BASE_TOPIC}/machine/status`,
  digitalInputStatus: `${BASE_TOPIC}/digital-input/status`,
};

const state = {
  mqttConnected: false,
  deviceOnline: false,
  baseTopic: BASE_TOPIC,
  deviceId: DEVICE_ID,
  serverStartedAt: new Date().toISOString(),
  lastUpdatedAt: null,
  lastMqttMessageAt: null,
  lastCommandSent: null,
  lastCommandSentAt: null,
  lastCommandError: null,
  lastCommandStatus: null,
  lastHeartbeat: null,
  lastAlarm: null,
  lastTelemetry: null,
  machineRuntime: null,
  dailySummary: null,
  health: null,
  diagnostics: null,
  reliability: null,
  watchdog: null,
  digitalInputs: null,
  temperatureSensor: null,
  runtimeSettings: null,
  bootDiagnostics: null,
  logLevel: null,
  config: null,
  rawMessages: [],
  commandHistory: [],
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function nowIso() {
  return new Date().toISOString();
}

function secondsSince(iso) {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

function computeDeviceOnline() {
  const recentHeartbeat = secondsSince(state.lastHeartbeat?.receivedAt) <= DEVICE_ONLINE_TIMEOUT_SEC;
  const recentCommand = secondsSince(state.lastCommandStatus?.receivedAt) <= DEVICE_ONLINE_TIMEOUT_SEC;
  const recentMachine = secondsSince(state.machineRuntime?.receivedAt) <= DEVICE_ONLINE_TIMEOUT_SEC;
  state.deviceOnline = Boolean(state.mqttConnected && (recentHeartbeat || recentCommand || recentMachine));
}

function pushRawMessage(topic, payload) {
  const receivedAt = nowIso();
  state.rawMessages.unshift({ topic, payload, receivedAt });
  if (state.rawMessages.length > 40) state.rawMessages.pop();
  state.lastMqttMessageAt = receivedAt;
}

function pushCommandHistory(entry) {
  state.commandHistory.unshift({ ...entry, at: nowIso() });
  if (state.commandHistory.length > 20) state.commandHistory.pop();
}

function safeJsonParse(input) {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch (error) {
    return { raw: input, parse_error: error.message };
  }
}

function withReceivedAt(message) {
  if (!message || typeof message !== 'object') return message;
  return { ...message, receivedAt: nowIso() };
}

function updateLiveDi1(active, source = 'GPIO') {
  if (typeof active !== 'boolean') return;

  const receivedAt = nowIso();
  const previousInputs = state.digitalInputs || {};
  const previousDi1 = previousInputs.di1 || {};

  state.digitalInputs = {
    ...previousInputs,
    di1: {
      ...previousDi1,
      active,
      state: active ? 'ACTIVE' : 'INACTIVE',
      source: source || previousDi1.source || 'GPIO',
      receivedAt,
    },
    receivedAt,
  };
}

function applyCommandStatus(message) {
  const enriched = withReceivedAt(message);
  state.lastCommandStatus = enriched;
  state.lastCommandError = message.status === 'failed' || message.status === 'rejected'
    ? message.message || 'Command failed'
    : null;

  if (message.command) {
    pushCommandHistory({
      direction: 'in',
      command: message.command,
      status: message.status,
      message: message.message,
      request_id: message.request_id,
    });
  }

  if (message.command === 'get_machine_runtime' && message.machine) {
    state.machineRuntime = withReceivedAt(message.machine);
  }
  if (message.command === 'get_daily_summary' && message.daily_summary) {
    state.dailySummary = withReceivedAt(message.daily_summary);
  }
  if (message.command === 'get_health' && message.health) {
    state.health = withReceivedAt(message.health);
  }
  if (message.command === 'get_diagnostics') {
    state.diagnostics = enriched;
    if (message.machine_runtime) state.machineRuntime = withReceivedAt(message.machine_runtime);
    if (message.digital_inputs) state.digitalInputs = withReceivedAt(message.digital_inputs);
    if (message.field_reliability) state.reliability = withReceivedAt(message.field_reliability);
    if (message.watchdog) state.watchdog = withReceivedAt(message.watchdog);
    if (message.sensor?.temperature_sensor) state.temperatureSensor = withReceivedAt(message.sensor.temperature_sensor);
  }
  if (message.command === 'get_reliability' && message.field_reliability) {
    state.reliability = withReceivedAt(message.field_reliability);
  }
  if (message.command === 'get_watchdog' && message.watchdog) {
    state.watchdog = withReceivedAt(message.watchdog);
  }
  if (message.command === 'get_digital_inputs' && message.digital_inputs) {
    state.digitalInputs = withReceivedAt(message.digital_inputs);
  }
  if (message.command === 'get_temperature' && message.temperature_sensor) {
    state.temperatureSensor = withReceivedAt(message.temperature_sensor);
  }
  if (message.command === 'get_runtime_settings' && message.runtime_settings) {
    state.runtimeSettings = withReceivedAt(message.runtime_settings);
  }
  if (message.command === 'get_config') {
    state.config = enriched;
  }
  if (message.command === 'get_boot_diagnostics' && message.boot) {
    state.bootDiagnostics = withReceivedAt(message.boot);
  }
  if (message.command === 'get_log_level') {
    state.logLevel = withReceivedAt({
      level: message.log_level,
      level_value: message.log_level_value,
      persistent: message.persistent,
    });
  }
  if (message.command === 'set_machine_input_source' && message.machine) {
    state.machineRuntime = withReceivedAt({
      ...(state.machineRuntime || {}),
      ...message.machine,
    });
  }
  if (message.command === 'set_di1_simulation' && message.digital_inputs) {
    state.digitalInputs = withReceivedAt(message.digital_inputs);
  }
}

function publishState() {
  computeDeviceOnline();
  state.lastUpdatedAt = nowIso();
  io.emit('state', state);
}

const mqttOptions = {
  clientId: `smartdashboard-lite-${DEVICE_ID}-${Math.random().toString(16).slice(2)}`,
  clean: true,
  reconnectPeriod: 3000,
};

if (MQTT_USERNAME) mqttOptions.username = MQTT_USERNAME;
if (MQTT_PASSWORD) mqttOptions.password = MQTT_PASSWORD;

const mqttClient = mqtt.connect(MQTT_URL, mqttOptions);

mqttClient.on('connect', () => {
  state.mqttConnected = true;
  state.lastCommandError = null;
  mqttClient.subscribe([
    topics.commandStatus,
    topics.heartbeat,
    topics.alarm,
    topics.telemetry,
    topics.machineStatus,
    topics.digitalInputStatus,
  ], (error) => {
    if (error) {
      state.lastCommandError = `MQTT subscribe error: ${error.message}`;
      console.error('MQTT subscribe error:', error.message);
    }
  });
  publishState();
  requestSnapshot();
});

mqttClient.on('reconnect', () => {
  state.mqttConnected = false;
  publishState();
});

mqttClient.on('close', () => {
  state.mqttConnected = false;
  publishState();
});

mqttClient.on('error', (error) => {
  state.lastCommandError = `MQTT error: ${error.message}`;
  console.error('MQTT error:', error.message);
  publishState();
});

mqttClient.on('message', (topic, buffer) => {
  const rawPayload = buffer.toString();
  const payload = safeJsonParse(rawPayload);
  pushRawMessage(topic, payload);

  if (topic === topics.commandStatus) {
    applyCommandStatus(payload);
  } else if (topic === topics.heartbeat) {
    state.lastHeartbeat = withReceivedAt(payload);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'di1_active')) {
      updateLiveDi1(Boolean(payload.di1_active), payload.di1_source || 'GPIO');
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'temperature')) {
      state.temperatureSensor = withReceivedAt({
        ...(state.temperatureSensor || {}),
        type: state.temperatureSensor?.type || 'DS18B20',
        connected: payload.temperature_sensor_connected,
        valid: payload.temperature_sensor_valid,
        temperature_c: payload.temperature,
        unit: 'C',
      });
    }
  } else if (topic === topics.alarm) {
    state.lastAlarm = withReceivedAt(payload);
  } else if (topic === topics.telemetry) {
    state.lastTelemetry = withReceivedAt(payload);
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'temperature')) {
      state.temperatureSensor = withReceivedAt({
        ...(state.temperatureSensor || {}),
        type: state.temperatureSensor?.type || 'DS18B20',
        connected: payload.temperature_sensor_connected,
        valid: payload.temperature_sensor_valid,
        temperature_c: payload.temperature,
        unit: 'C',
      });
    }
  } else if (topic === topics.machineStatus) {
    const machinePayload = payload.machine || payload;
    state.machineRuntime = withReceivedAt(machinePayload);
    if (machinePayload && Object.prototype.hasOwnProperty.call(machinePayload, 'di1_active')) {
      updateLiveDi1(Boolean(machinePayload.di1_active), machinePayload.di1_source || 'GPIO');
    }
  } else if (topic === topics.digitalInputStatus) {
    state.digitalInputs = withReceivedAt(payload.digital_inputs || payload);
  }

  publishState();
});

function sendCommand(command, extra = {}) {
  const payload = {
    command,
    request_id: `${command}-${Date.now()}`,
    ...extra,
  };

  state.lastCommandSent = payload;
  state.lastCommandSentAt = nowIso();
  state.lastCommandError = null;
  pushCommandHistory({ direction: 'out', command, status: 'sent', request_id: payload.request_id });
  publishState();

  mqttClient.publish(topics.command, JSON.stringify(payload), { qos: 0 }, (error) => {
    if (error) {
      state.lastCommandError = `MQTT publish error: ${error.message}`;
      pushCommandHistory({ direction: 'out', command, status: 'publish_error', message: error.message, request_id: payload.request_id });
      console.error('MQTT publish error:', error.message);
      publishState();
    }
  });

  return payload;
}

function requestSnapshot() {
  const commands = [
    'get_config',
    'get_machine_runtime',
    'get_daily_summary',
    'get_health',
    'get_digital_inputs',
    'get_temperature',
    'get_runtime_settings',
    'get_reliability',
    'get_watchdog',
    'get_boot_diagnostics',
    'get_diagnostics',
  ];

  commands.forEach((command, index) => {
    setTimeout(() => sendCommand(command), index * 250);
  });
}

setInterval(() => {
  computeDeviceOnline();
  io.emit('state', state);
}, 5000);

app.get('/api/state', (_req, res) => {
  computeDeviceOnline();
  res.json(state);
});

app.post('/api/refresh', (_req, res) => {
  requestSnapshot();
  res.json({ ok: true, message: 'Snapshot requested' });
});

app.post('/api/command/:command', (req, res) => {
  const command = req.params.command;
  if (!ALLOWED_COMMANDS.has(command)) {
    return res.status(400).json({ ok: false, message: 'Command is not allowed from dashboard' });
  }
  const payload = sendCommand(command, req.body || {});
  res.json({ ok: true, payload });
});

app.post('/api/machine/input-source/:source', (req, res) => {
  const source = String(req.params.source || '').toUpperCase();
  if (!['AUTO_CURRENT', 'DI1'].includes(source)) {
    return res.status(400).json({ ok: false, message: 'Invalid source' });
  }

  const payload = sendCommand('set_machine_input_source', { source });
  res.json({ ok: true, payload });
});

app.post('/api/device/restart', (_req, res) => {
  const payload = sendCommand('restart');
  res.json({ ok: true, payload });
});

server.listen(PORT, () => {
  console.log(`SmartDashboard Lite running at http://localhost:${PORT}`);
  console.log(`MQTT broker: ${MQTT_URL}`);
  console.log(`Base topic: ${BASE_TOPIC}`);
});
