const machineCode = 'laser01';
const siteCode = 'site01';
let selectedReportId = null;
let detailBusy = false;

function fmtSec(v) {
  if (v === null || v === undefined) return '-';
  const s = Number(v);
  if (!Number.isFinite(s) || s <= 0) return '0 sn';
  if (s < 60) return `${s} sn`;
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

function esc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(v) {
  if (!v) return '-';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('tr-TR');
}

async function getJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function fillList(id, items) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (items || []).length
    ? items.map(item => `<li>${esc(item)}</li>`).join('')
    : '<li>Veri yok</li>';
}

function renderReportDetail(report) {
  const el = document.getElementById('reportDetail');
  if (!el) return;

  if (!report) {
    el.innerHTML = '<span class="muted">Detay görmek için geçmişten bir rapora tıkla.</span>';
    return;
  }

  const payload = report.report_json || report.raw_payload || {};
  const findings = payload.findings || [];
  const recommendations = payload.recommendations || [];
  const raw = payload.raw || {};

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="label">Rapor ID</p>
        <strong>${esc(report.id)}</strong>
      </div>
      <div>
        <p class="label">Skor</p>
        <strong class="${Number(report.health_score) >= 75 ? 'ok' : 'alarm'}">${esc(report.health_score ?? '-')} / 100</strong>
      </div>
      <div>
        <p class="label">Tarih</p>
        <span>${esc(fmtDate(report.created_at))}</span>
      </div>
    </div>

    <p class="detail-summary">${esc(report.summary || report.summary_text || report.report_text || payload.summary || '-')}</p>

    <div class="detail-grid">
      <div>
        <h3>Bulgular</h3>
        <ul>${findings.length ? findings.map(x => `<li>${esc(x)}</li>`).join('') : '<li>Veri yok</li>'}</ul>
      </div>
      <div>
        <h3>Öneriler</h3>
        <ul>${recommendations.length ? recommendations.map(x => `<li>${esc(x)}</li>`).join('') : '<li>Veri yok</li>'}</ul>
      </div>
    </div>

    <h3>Rapor Verisi</h3>
    <pre>${esc(JSON.stringify({
      report_type: report.report_type,
      report_date: report.report_date,
      generated_at: payload.generated_at,
      raw
    }, null, 2))}</pre>

    ${report.telegram_text ? `<h3>Telegram Mesajı</h3><pre>${esc(report.telegram_text)}</pre>` : ''}
  `;
}

function renderHistory(history) {
  const historyEl = document.getElementById('aiHistory');
  if (!historyEl) return;

  const reports = history.reports || [];
  if (!reports.length) {
    historyEl.innerHTML = '<span class="muted">Henüz kayıtlı SmartAI raporu yok. Önce /ai/daily-report/telegram?save=1 çalıştır.</span>';
    renderReportDetail(null);
    return;
  }

  historyEl.innerHTML = reports.map(r => `
    <button class="history-row ${String(r.id) === String(selectedReportId) ? 'active' : ''}" data-report-id="${esc(r.id)}">
      <div class="history-score">${esc(r.health_score ?? '-')} / 100</div>
      <div class="history-meta">
        <strong>${esc(fmtDate(r.created_at))}</strong>
        <p>${esc(r.summary || '-')}</p>
      </div>
    </button>
  `).join('');
}

function renderReportCenter(center) {
  const el = document.getElementById('multiMachineStatus');
  if (!el) return;

  const machines = center.machines || [];
  el.innerHTML = machines.length
    ? machines.map(m => `
        <div class="machine-row">
          <strong>${esc(m.machine_code)}</strong>
          <span>${esc(m.latest_state?.state || '-')}</span>
          <span>${esc(m.latest_report?.health_score ?? '-')} / 100</span>
          <span>${esc(m.active_alarm_count)} aktif alarm</span>
        </div>
      `).join('')
    : '<span class="muted">Makine bulunamadı.</span>';
}

async function showReportDetail(id) {
  if (!id || detailBusy) return;
  detailBusy = true;
  selectedReportId = String(id);
  renderHistory(window.lastHistory || {reports: []});

  const el = document.getElementById('reportDetail');
  if (el) el.innerHTML = '<span class="muted">Rapor detayı yükleniyor...</span>';

  try {
    const data = await getJson(`/api/machines/${machineCode}/ai/reports/${encodeURIComponent(id)}`);
    renderReportDetail(data.report);
  } catch (e) {
    if (el) el.innerHTML = `<span class="alarm">${esc(e.message)}</span>`;
  } finally {
    detailBusy = false;
  }
}

async function cleanupDemoReports() {
  const statusEl = document.getElementById('cleanupStatus');
  if (statusEl) statusEl.textContent = 'Temizleniyor...';

  try {
    const data = await getJson(`/api/machines/${machineCode}/ai/reports/cleanup-demo?confirm=1`);
    selectedReportId = null;
    if (statusEl) statusEl.textContent = `${data.deleted_count || 0} demo rapor temizlendi.`;
    await refresh(true);
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
  }
}

async function refresh(forceDetail = false) {
  try {
    const h = await getJson('/api/health');
    const st = await getJson(`/api/machines/${machineCode}/status`);
    const alarms = await getJson(`/api/machines/${machineCode}/alarms`);
    const ai = await getJson(`/api/machines/${machineCode}/ai/daily-report`);
    const history = await getJson(`/api/machines/${machineCode}/ai/reports?limit=10`);
    const center = await getJson(`/api/sites/${siteCode}/ai/report-center`);

    window.lastHistory = history;

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
      ? alarms.slice(0, 8).map(a => `<div class="alarm-row"><strong>${esc(a.alarm_type)}</strong><span>${esc(a.severity)}</span><span>${esc(a.status)}</span><span>${esc(a.message || '')}</span></div>`).join('')
      : '<span class="muted">Alarm yok</span>';

    const report = ai.report || {};
    document.getElementById('aiScore').textContent = report.health_score !== undefined ? `${report.health_score}/100` : '-';
    document.getElementById('aiScore').className = report.health_score >= 75 ? 'ok' : 'alarm';
    document.getElementById('aiSummary').textContent = report.summary || 'Rapor oluşturulamadı.';
    fillList('aiFindings', report.findings);
    fillList('aiRecommendations', report.recommendations);

    renderHistory(history);
    renderReportCenter(center);

    if (!selectedReportId && history.reports && history.reports[0]) {
      selectedReportId = String(history.reports[0].id);
      forceDetail = true;
    }

    if (forceDetail && selectedReportId) {
      await showReportDetail(selectedReportId);
    }

    document.getElementById('healthJson').textContent = JSON.stringify(h, null, 2);
  } catch (e) {
    document.getElementById('serviceStatus').textContent = 'Hata';
    document.getElementById('healthJson').textContent = e.message;
  }
}

document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-report-id]');
  if (row) showReportDetail(row.dataset.reportId);
});

const cleanupBtn = document.getElementById('cleanupDemoReports');
if (cleanupBtn) cleanupBtn.addEventListener('click', cleanupDemoReports);

refresh(true);
setInterval(() => refresh(false), 5000);
