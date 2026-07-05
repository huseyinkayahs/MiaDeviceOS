const socket = io();
let currentState = null;

function minutes(sec) {
  const value = Number(sec || 0);
  return Math.round(value / 60);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

function render(state) {
  currentState = state;

  const machine = state.machineRuntime || state.health || {};
  const daily = state.dailySummary || {};
  const di1 = state.digitalInputs?.di1 || {};
  const alarm = state.lastAlarm || {};
  const reliability = state.reliability || state.health || {};
  const command = state.lastCommandStatus || {};

  const mqttStatus = document.getElementById('mqttStatus');
  mqttStatus.textContent = state.mqttConnected ? 'MQTT bağlı' : 'MQTT bağlı değil';
  mqttStatus.classList.toggle('ok', Boolean(state.mqttConnected));

  const machineState = machine.state || daily.machine_state || state.health?.machine_state || '—';
  const stateEl = document.getElementById('machineState');
  stateEl.textContent = machineState;
  stateEl.className = '';
  if (machineState === 'RUNNING') stateEl.classList.add('running');
  if (machineState === 'STOPPED') stateEl.classList.add('stopped');

  const inputSource = machine.input_source || daily.input_source || state.health?.machine_input_source || '—';
  setText('machineSource', `Kaynak: ${inputSource}`);

  const utilization = machine.utilization_pct ?? daily.utilization_pct ?? state.health?.machine_utilization_pct ?? '—';
  setText('utilizationPct', utilization === '—' ? '—%' : `%${utilization}`);

  setText('runtimeMin', `${minutes(machine.today_runtime_sec ?? daily.runtime_sec ?? state.health?.machine_runtime_sec)} dk`);
  setText('stopMin', `${minutes(machine.today_stop_sec ?? daily.stop_sec ?? state.health?.machine_stop_sec)} dk`);
  setText('di1State', di1.state || (state.health?.di1_active ? 'ACTIVE' : 'INACTIVE'));
  setText('alarmState', alarm.event || (state.health?.alarm_active ? 'ALARM' : 'NORMAL'));
  setText('firmwareVersion', command.firmware_version || state.lastHeartbeat?.firmware_version || state.config?.device?.firmware_version || '—');
  setText('reliabilityScore', reliability.score ?? reliability.field_reliability_score ?? '—');

  setText('lastCommand', pretty(command));
  setText('rawMessages', pretty((state.rawMessages || []).slice(0, 10)));
}

socket.on('state', render);

fetch('/api/state')
  .then((response) => response.json())
  .then(render)
  .catch(console.error);

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const command = target.dataset.command;
  const action = target.dataset.action;
  const source = target.dataset.source;

  try {
    if (command) await postJson(`/api/command/${command}`);
    if (source) await postJson(`/api/machine/input-source/${source}`);
    if (action === 'refresh') await postJson('/api/refresh');
    if (action === 'restart') {
      const ok = window.confirm('Cihaz restart edilsin mi?');
      if (ok) await postJson('/api/device/restart');
    }
  } catch (error) {
    alert(`Komut gönderilemedi: ${error.message}`);
  }
});
