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

const topics = {
  command: `${BASE_TOPIC}/command`,
  commandStatus: `${BASE_TOPIC}/command/status`,
  heartbeat: `${BASE_TOPIC}/heartbeat`,
  alarm: `${BASE_TOPIC}/alarm`,
  telemetry: `${BASE_TOPIC}/telemetry`,
  machineStatus: `${BASE_TOPIC}/machine/status`,
};

const state = {
  mqttConnected: false,
  lastUpdatedAt: null,
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
  runtimeSettings: null,
  config: null,
  rawMessages: [],
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function nowIso() {
  return new Date().toISOString();
}

function pushRawMessage(topic, payload) {
  state.rawMessages.unshift({ topic, payload, receivedAt: nowIso() });
  if (state.rawMessages.length > 40) state.rawMessages.pop();
}

function safeJsonParse(input) {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch (error) {
    return { raw: input, parse_error: error.message };
  }
}

function applyCommandStatus(message) {
  state.lastCommandStatus = message;

  if (message.command === 'get_machine_runtime' && message.machine) {
    state.machineRuntime = message.machine;
  }
  if (message.command === 'get_daily_summary' && message.daily_summary) {
    state.dailySummary = message.daily_summary;
  }
  if (message.command === 'get_health' && message.health) {
    state.health = message.health;
  }
  if (message.command === 'get_diagnostics') {
    state.diagnostics = message;
    if (message.machine_runtime) state.machineRuntime = message.machine_runtime;
    if (message.digital_inputs) state.digitalInputs = message.digital_inputs;
    if (message.field_reliability) state.reliability = message.field_reliability;
    if (message.watchdog) state.watchdog = message.watchdog;
  }
  if (message.command === 'get_reliability' && message.field_reliability) {
    state.reliability = message.field_reliability;
  }
  if (message.command === 'get_watchdog' && message.watchdog) {
    state.watchdog = message.watchdog;
  }
  if (message.command === 'get_digital_inputs' && message.digital_inputs) {
    state.digitalInputs = message.digital_inputs;
  }
  if (message.command === 'get_runtime_settings' && message.runtime_settings) {
    state.runtimeSettings = message.runtime_settings;
  }
  if (message.command === 'get_config') {
    state.config = message;
  }
  if (message.command === 'set_machine_input_source' && message.machine) {
    state.machineRuntime = {
      ...(state.machineRuntime || {}),
      ...message.machine,
    };
  }
  if (message.command === 'set_di1_simulation' && message.digital_inputs) {
    state.digitalInputs = message.digital_inputs;
  }
}

function publishState() {
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
  mqttClient.subscribe([
    topics.commandStatus,
    topics.heartbeat,
    topics.alarm,
    topics.telemetry,
    topics.machineStatus,
  ], (error) => {
    if (error) console.error('MQTT subscribe error:', error.message);
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
  console.error('MQTT error:', error.message);
});

mqttClient.on('message', (topic, buffer) => {
  const rawPayload = buffer.toString();
  const payload = safeJsonParse(rawPayload);
  pushRawMessage(topic, payload);

  if (topic === topics.commandStatus) {
    applyCommandStatus(payload);
  } else if (topic === topics.heartbeat) {
    state.lastHeartbeat = payload;
  } else if (topic === topics.alarm) {
    state.lastAlarm = payload;
  } else if (topic === topics.telemetry) {
    state.lastTelemetry = payload;
  } else if (topic === topics.machineStatus) {
    state.machineRuntime = payload.machine || payload;
  }

  publishState();
});

function sendCommand(command, extra = {}) {
  const payload = {
    command,
    request_id: `${command}-${Date.now()}`,
    ...extra,
  };

  mqttClient.publish(topics.command, JSON.stringify(payload), { qos: 0 }, (error) => {
    if (error) console.error('MQTT publish error:', error.message);
  });

  return payload;
}

function requestSnapshot() {
  const commands = [
    'get_machine_runtime',
    'get_daily_summary',
    'get_health',
    'get_digital_inputs',
    'get_runtime_settings',
    'get_reliability',
    'get_watchdog',
  ];

  commands.forEach((command, index) => {
    setTimeout(() => sendCommand(command), index * 250);
  });
}

app.get('/api/state', (_req, res) => {
  res.json(state);
});

app.post('/api/refresh', (_req, res) => {
  requestSnapshot();
  res.json({ ok: true, message: 'Snapshot requested' });
});

app.post('/api/command/:command', (req, res) => {
  const command = req.params.command;
  const payload = sendCommand(command, req.body || {});
  res.json({ ok: true, published: payload });
});

app.post('/api/machine/input-source/:source', (req, res) => {
  const source = req.params.source;
  if (!['AUTO_CURRENT', 'DI1'].includes(source)) {
    return res.status(400).json({ ok: false, error: 'Invalid source' });
  }
  const payload = sendCommand('set_machine_input_source', { source });
  return res.json({ ok: true, published: payload });
});

app.post('/api/device/restart', (_req, res) => {
  const payload = sendCommand('restart');
  res.json({ ok: true, published: payload });
});

io.on('connection', (socket) => {
  socket.emit('state', state);
});

server.listen(PORT, () => {
  console.log(`SmartDashboard Lite running at http://localhost:${PORT}`);
  console.log(`MQTT broker: ${MQTT_URL}`);
  console.log(`Base topic: ${BASE_TOPIC}`);
});
