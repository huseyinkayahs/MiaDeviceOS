const machineCode = 'laser01';

function fmtSec(v) {
  if (v === null || v === undefined) return '-';

  const s = Number(v);
  if (!Number.isFinite(s) || s <= 0) return '0 sn';

  if (s < 60) {
    return `${s} sn`;
  }

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  const parts = [];
  if (h > 0) parts.push(`${h} sa`);
  if (m > 0) parts.push(`${m} dk`);
  if (sec > 0 && h === 0) parts.push(`${sec} sn`);

  return parts.join(' ');
}

function val(v, suffix = '') {
  return v === null || v === undefined ? '-' : `${v}${suffix}`;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function fillList(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = (items || []).length
    ? items.map(item => `<li>${item}</li>`).join('')
    : '<li>Veri yok</li>';
}

async function refresh() {
  try {
    const h = await getJson('/api/health');
    const st = await getJson(`/api/machines/${machineCode}/status`);
    const alarms = await getJson(`/api/machines/${machineCode}/alarms`);
    const ai = await getJson(`/api/machines/${machineCode}/ai/daily-report`);
    const history = await getJson(`/api/machines/${machineCode}/ai/reports?limit=5`);

    document.getElementById('serviceStatus').textContent = 'Çalışıyor';
    document.getElementById('backendStatus').textContent = h.status;
    document.getElementById('backendStatus').className = 'ok';

    document.getElementById('mqttStatus').textContent = h.mqtt_connected ? 'connected' : 'waiting';
    document.getElementById('mqttStatus').className = h.mqtt_connected ? 'ok' : 'muted';
    document.getElementById('lastMessage').textContent = h.last_mqtt_message_at || '-';

    document.getElementById('machineCode').textContent = st.machine_code || machineCode;

    const ls = st.latest_state || {};
    document.getElementById('machineState').textContent = ls.state || '-';
    document.getElementById('machineState').className = ls.state === 'RUNNING' ? 'ok' : 'alarm';
    document.getElementById('machineSource').textContent = ls.source || '-';

    const lt = st.latest_telemetry || {};
    document.getElementById('temperature').textContent = val(lt.temperature_c, ' °C');
    document.getElementById('current').textContent = val(lt.current_amp, ' A');
    document.getElementById('rssi').textContent = val(lt.wifi_rssi, ' dBm');

    const sm = st.calculated_today_summary || st.latest_daily_summary || {};
    document.getElementById('runtime').textContent = fmtSec(sm.runtime_sec);
    document.getElementById('stop').textContent = fmtSec(sm.stop_sec);
    document.getElementById('utilization').textContent = val(sm.utilization_pct, ' %');

    document.getElementById('alarms').innerHTML = alarms.length
      ? alarms.slice(0, 8).map(a => `<div class="alarm-row"><strong>${a.alarm_type}</strong><span>${a.severity}</span><span>${a.status}</span><span>${a.message || ''}</span></div>`).join('')
      : '<span class="muted">Alarm yok</span>';

    const report = ai.report || {};
    document.getElementById('aiScore').textContent = report.health_score !== undefined ? `${report.health_score}/100` : '-';
    document.getElementById('aiScore').className = report.health_score >= 75 ? 'ok' : 'alarm';
    document.getElementById('aiSummary').textContent = report.summary || 'Rapor oluşturulamadı.';
    fillList('aiFindings', report.findings);
    fillList('aiRecommendations', report.recommendations);

    const historyEl = document.getElementById('aiHistory');
    if (historyEl) {
      historyEl.innerHTML = (history.reports || []).length
        ? history.reports.map(r => `
            <div class="history-row">
              <strong>${r.health_score ?? '-'} / 100</strong>
              <span>${new Date(r.created_at).toLocaleString('tr-TR')}</span>
              <p>${r.summary || '-'}</p>
            </div>
          `).join('')
        : '<span class="muted">Henüz kayıtlı SmartAI raporu yok. Önce /ai/daily-report/telegram?save=1 çalıştır.</span>';
    }


    document.getElementById('healthJson').textContent = JSON.stringify(h, null, 2);
  } catch (e) {
    document.getElementById('serviceStatus').textContent = 'Hata';
    document.getElementById('healthJson').textContent = e.message;
  }
}

refresh();
setInterval(refresh, 3000);
