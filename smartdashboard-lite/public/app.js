const socket = io();
let currentState = null;
let lastToastTimer = null;

function minutes(sec) {
  const value = Number(sec || 0);
  return Math.round(value / 60);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch (_error) {
    return '—';
  }
}

function secondsAgo(iso) {
  if (!iso) return '—';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec} sn önce`;
  return `${Math.round(sec / 60)} dk önce`;
}

function setPill(id, active, activeText, inactiveText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = active ? activeText : inactiveText;
  el.classList.toggle('ok', Boolean(active));
  el.classList.toggle('bad', !active);
}

function showToast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(lastToastTimer);
  lastToastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || 'Request failed');
  }
  return result;
}

function confirmInputSource(source) {
  const currentSource = currentState?.machineRuntime?.input_source
    || currentState?.runtimeSettings?.machine_input_source
    || 'bilinmiyor';

  if (source === 'DI1') {
    return window.confirm(
      `Makine kaynağı DI1 yapılacak.\n\n` +
      `Bu seçim restart sonrası da korunur. DI1 fiziksel olarak bağlı değilse makine STOPPED görünebilir.\n\n` +
      `Mevcut kaynak: ${currentSource}\nDevam edilsin mi?`
    );
  }

  return window.confirm(
    `Makine kaynağı AUTO_CURRENT yapılacak.\n\n` +
    `Bu seçim restart sonrası da korunur. Simüle akım yüksekse makine RUNNING görünür.\n\n` +
    `Mevcut kaynak: ${currentSource}\nDevam edilsin mi?`
  );
}

function render(state) {
  currentState = state;

  const machine = state.machineRuntime || state.health || {};
  const daily = state.dailySummary || {};
  const di1 = state.digitalInputs?.di1 || {};
  const alarm = state.lastAlarm || {};
  const reliability = state.reliability || state.health || {};
  const command = state.lastCommandStatus || {};

  setPill('mqttStatus', state.mqttConnected, 'MQTT bağlı', 'MQTT bağlı değil');
  setPill('deviceStatus', state.deviceOnline, 'Cihaz online', 'Cihaz bekleniyor');

  const machineState = machine.state || daily.machine_state || state.health?.machine_state || '—';
  const stateEl = document.getElementById('machineState');
  stateEl.textContent = machineState;
  stateEl.className = '';
  if (machineState === 'RUNNING') stateEl.classList.add('running');
  if (machineState === 'STOPPED') stateEl.classList.add('stopped');

  const inputSource = machine.input_source || daily.input_source || state.health?.machine_input_source || state.runtimeSettings?.machine_input_source || '—';
  setText('machineSource', `Kaynak: ${inputSource}`);

  const utilization = machine.utilization_pct ?? daily.utilization_pct ?? state.health?.machine_utilization_pct ?? '—';
  setText('utilizationPct', utilization === '—' ? '—%' : `%${utilization}`);

  setText('runtimeMin', `${minutes(machine.today_runtime_sec ?? daily.runtime_sec ?? state.health?.machine_runtime_sec)} dk`);
  setText('stopMin', `${minutes(machine.today_stop_sec ?? daily.stop_sec ?? state.health?.machine_stop_sec)} dk`);
  setText('di1State', di1.state || (state.health?.di1_active ? 'ACTIVE' : 'INACTIVE'));
  setText('alarmState', alarm.event || (state.health?.alarm_active ? 'ALARM' : 'NORMAL'));
  setText('firmwareVersion', command.firmware_version || state.lastHeartbeat?.firmware_version || state.config?.device?.firmware_version || '—');
  setText('reliabilityScore', reliability.score ?? reliability.field_reliability_score ?? '—');

  setText('lastUpdateTime', formatTime(state.lastUpdatedAt));
  setText('lastMqttTime', `${formatTime(state.lastMqttMessageAt)} (${secondsAgo(state.lastMqttMessageAt)})`);
  setText('lastCommandSent', state.lastCommandSent?.command || '—');
  setText('lastCommandStatus', command.command ? `${command.command} / ${command.status || '—'}` : '—');
  setText('lastError', state.lastCommandError || 'Yok');

  setText('lastCommand', pretty(command));
  setText('rawMessages', pretty((state.rawMessages || []).slice(0, 10)));
  setText('commandHistory', pretty((state.commandHistory || []).slice(0, 10)));
  setText('diagnosticsData', pretty(state.diagnostics || {}));
  setText('reliabilityData', pretty(state.reliability || {}));
  setText('runtimeSettingsData', pretty(state.runtimeSettings || {}));
  setText('digitalInputsData', pretty(state.digitalInputs || {}));
}

socket.on('state', render);
socket.on('connect', () => showToast('Panel sunucusuna bağlandı', 'ok'));
socket.on('disconnect', () => showToast('Panel sunucusu bağlantısı kesildi', 'error'));

fetch('/api/state')
  .then((response) => response.json())
  .then(render)
  .catch((error) => showToast(`Panel verisi alınamadı: ${error.message}`, 'error'));

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;

  const command = target.dataset.command;
  const action = target.dataset.action;
  const source = target.dataset.source;
  const originalText = target.textContent;

  try {
    target.disabled = true;
    target.textContent = 'Gönderiliyor...';

    if (command) {
      await postJson(`/api/command/${command}`);
      showToast(`${command} gönderildi`, 'ok');
    }
    if (source) {
      const ok = confirmInputSource(source);
      if (!ok) {
        showToast('İşlem iptal edildi', 'info');
        return;
      }
      await postJson(`/api/machine/input-source/${source}`);
      showToast(`${source} seçildi`, 'ok');
    }
    if (action === 'refresh') {
      await postJson('/api/refresh');
      showToast('Tüm veriler yenileniyor', 'ok');
    }
    if (action === 'restart') {
      const ok = window.confirm('Cihaz restart edilsin mi?\n\nCihaz birkaç saniye offline görünebilir.');
      if (ok) {
        await postJson('/api/device/restart');
        showToast('Restart komutu gönderildi', 'ok');
      }
    }
  } catch (error) {
    showToast(`Komut gönderilemedi: ${error.message}`, 'error');
  } finally {
    target.disabled = false;
    target.textContent = originalText;
  }
});
