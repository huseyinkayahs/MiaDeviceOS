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













function renderEmailStatus(status) {
  const el = document.getElementById('emailStatus');
  if (!el) return;

  const cfg = status.email || {};
  el.innerHTML = `
    <div class="machine-row">
      <strong>SMTP</strong>
      <span class="${cfg.configured ? 'ok' : 'alarm'}">${cfg.configured ? 'configured' : 'missing'}</span>
      <span>Enabled: ${cfg.enabled ? 'yes' : 'no'}</span>
      <span>Port: ${esc(cfg.port ?? '-')}</span>
    </div>
  `;
}

async function sendLatestReportEmail() {
  const statusEl = document.getElementById('emailActionStatus');
  const toInput = document.getElementById('reportEmailTo');
  const btn = document.getElementById('sendLatestReportEmail');
  const to = toInput ? toInput.value.trim() : '';

  if (statusEl) statusEl.textContent = 'Son site raporu e-posta ile gönderiliyor...';
  if (btn) btn.disabled = true;

  try {
    const query = to ? `?to=${encodeURIComponent(to)}` : '';
    const result = await getJson(`/api/sites/${siteCode}/ai/reports/latest/email${query}`);
    if (statusEl) {
      statusEl.textContent = result.email?.sent
        ? `Gönderildi. Message ID: ${result.email.message_id || '-'}`
        : `Gönderilemedi: ${result.email?.reason || 'bilinmeyen hata'}`;
    }
  } catch(e) {
    if (statusEl) statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function createAndEmailSiteReport() {
  const statusEl = document.getElementById('emailActionStatus');
  const toInput = document.getElementById('reportEmailTo');
  const btn = document.getElementById('createAndEmailSiteReport');
  const to = toInput ? toInput.value.trim() : '';

  if (statusEl) statusEl.textContent = 'Yeni site raporu oluşturuluyor, kaydediliyor ve e-posta gönderiliyor...';
  if (btn) btn.disabled = true;

  try {
    const qs = new URLSearchParams({save:'1'});
    if (to) qs.set('to', to);
    const result = await getJson(`/api/sites/${siteCode}/ai/daily-report/email?${qs.toString()}`);
    if (statusEl) {
      statusEl.textContent = result.email?.sent
        ? `Gönderildi. Report ID: ${result.saved_to_database?.report_id || '-'}`
        : `Gönderilemedi: ${result.email?.reason || 'bilinmeyen hata'}`;
    }
    await refresh(true);
  } catch(e) {
    if (statusEl) statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function createAndEmailOpenAiReport() {
  const statusEl = document.getElementById('emailActionStatus');
  const toInput = document.getElementById('reportEmailTo');
  const btn = document.getElementById('createAndEmailOpenAiReport');
  const to = toInput ? toInput.value.trim() : '';

  if (statusEl) statusEl.textContent = 'OpenAI raporu oluşturuluyor, kaydediliyor ve e-posta gönderiliyor...';
  if (btn) btn.disabled = true;

  try {
    const qs = new URLSearchParams({save:'1'});
    if (to) qs.set('to', to);
    const result = await getJson(`/api/sites/${siteCode}/ai/openai-report/email?${qs.toString()}`);
    if (statusEl) {
      statusEl.textContent = result.email?.sent
        ? `Gönderildi. Report ID: ${result.saved_to_database?.report_id || '-'}`
        : `Gönderilemedi: ${result.email?.reason || result.openai?.reason || 'bilinmeyen hata'}`;
    }
    if (result.report) {
      renderOpenAiReport({
        report:result.report,
        openai:result.openai,
        telegram_text:result.report.telegram_text
      });
    }
    await refresh(true);
  } catch(e) {
    if (statusEl) statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderOpenAiStatus(status) {
  const el = document.getElementById('openAiStatus');
  if (!el) return;

  const cfg = status.openai || {};
  el.innerHTML = `
    <div class="machine-row">
      <strong>Configured</strong>
      <span class="${cfg.configured ? 'ok' : 'alarm'}">${cfg.configured ? 'yes' : 'no'}</span>
      <span>Enabled: ${cfg.enabled ? 'yes' : 'no'}</span>
      <span>Model: ${esc(cfg.model || '-')}</span>
    </div>
  `;
}

function renderOpenAiReport(result) {
  const el = document.getElementById('openAiReportPreview');
  if (!el) return;

  if (!result || !result.report) {
    el.innerHTML = '<span class="muted">OpenAI raporu henüz oluşturulmadı.</span>';
    return;
  }

  const r = result.report;
  el.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="label">AI Engine</p>
        <strong>${esc(r.ai_engine || '-')}</strong>
      </div>
      <div>
        <p class="label">Skor</p>
        <strong class="${Number(r.overall_score) >= 75 ? 'ok' : 'alarm'}">${esc(r.overall_score ?? '-')} / 100</strong>
      </div>
      <div>
        <p class="label">OpenAI</p>
        <span class="${result.openai?.ok ? 'ok' : 'alarm'}">${result.openai?.ok ? 'ok' : (result.openai?.reason || 'fallback')}</span>
      </div>
    </div>
    <p class="ai-summary">${esc(r.summary || '-')}</p>
    ${r.executive_comment ? `<h3>AI Yorumu</h3><p class="detail-summary">${esc(r.executive_comment)}</p>` : ''}
    <div class="detail-grid">
      <div>
        <h3>Bulgular</h3>
        <ul>${(r.findings || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div>
        <h3>Öneriler</h3>
        <ul>${(r.recommendations || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
    </div>
    ${(r.risks || []).length ? `<h3>Riskler</h3><ul>${r.risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${(r.action_items || []).length ? `<h3>Aksiyonlar</h3><ul>${r.action_items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${result.telegram_text ? `<h3>Telegram Mesajı</h3><pre>${esc(result.telegram_text)}</pre>` : ''}
  `;
}

async function createOpenAiReport() {
  const statusEl = document.getElementById('openAiActionStatus');
  const btn = document.getElementById('createOpenAiReport');
  if (statusEl) statusEl.textContent = 'OpenAI SmartAI raporu oluşturuluyor...';
  if (btn) btn.disabled = true;

  try {
    const result = await getJson(`/api/sites/${siteCode}/ai/openai-report/telegram?save=1`);
    if (statusEl) {
      statusEl.textContent = result.saved_to_database?.saved
        ? `Kaydedildi. Report ID: ${result.saved_to_database.report_id}`
        : `Kaydedilmedi: ${result.saved_to_database?.reason || result.openai?.reason || 'bilinmeyen durum'}`;
    }
    renderOpenAiReport(result);
    await refresh(true);
  } catch(e) {
    if (statusEl) statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updatePdfLinks(siteReports) {
  const latest = (siteReports.reports || [])[0];

  const latestLink = document.getElementById('latestSitePdf');
  if (latestLink) {
    latestLink.href = latest
      ? `/api/sites/${siteCode}/ai/reports/latest/print`
      : `/api/sites/${siteCode}/ai/daily-report/print?save=1`;
  }

  const newReportPdf = document.getElementById('newSitePdf');
  if (newReportPdf) {
    newReportPdf.href = `/api/sites/${siteCode}/ai/daily-report/print?save=1`;
  }
}

function renderSiteReportHistory(siteReports) {
  const el = document.getElementById('siteReportHistory');
  if (!el) return;

  const reports = siteReports.reports || [];
  el.innerHTML = reports.length
    ? reports.map(r => `
        <button class="history-row site-report-history-row" data-site-report-id="${esc(r.id)}">
          <div class="history-score">${esc(r.health_score ?? '-')} / 100</div>
          <div class="history-meta">
            <strong>${esc(fmtDate(r.created_at))}</strong>
            <p>${esc(r.summary || '-')}</p>
          </div>
        </button>
      `).join('')
    : '<span class="muted">Henüz kayıtlı site raporu yok. “Site Raporu Oluştur + Kaydet” butonuna bas.</span>';

  const latest = reports[0];
  const latestEl = document.getElementById('latestSiteReport');
  if (latestEl) {
    latestEl.innerHTML = latest
      ? `<strong>${esc(latest.health_score ?? '-')} / 100</strong><span>${esc(fmtDate(latest.created_at))}</span><p>${esc(latest.summary || '-')}</p>`
      : '<span class="muted">Kayıtlı site raporu yok.</span>';
  }
}

function renderSiteReportDetail(report) {
  const el = document.getElementById('siteReportDetail');
  if (!el) return;

  if (!report) {
    el.innerHTML = '<span class="muted">Detay görmek için site rapor geçmişinden bir kayda tıkla.</span>';
    return;
  }

  const payload = report.report_json || report.raw_payload || {};
  const machines = payload.machines || [];
  const findings = payload.findings || [];
  const recommendations = payload.recommendations || [];

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="label">Site Rapor ID</p>
        <strong>${esc(report.id)}</strong>
        <p><a class="print-link" id="reportPdfLink" href="/api/sites/${siteCode}/ai/reports/${encodeURIComponent(report.id)}/print" target="_blank">PDF / Yazdır</a></p>
      </div>
      <div>
        <p class="label">Genel Skor</p>
        <strong class="${Number(report.health_score) >= 75 ? 'ok' : 'alarm'}">${esc(report.health_score ?? '-')} / 100</strong>
      </div>
      <div>
        <p class="label">Tarih</p>
        <span>${esc(fmtDate(report.created_at))}</span>
      </div>
    </div>
    <p class="detail-summary">${esc(report.summary || payload.summary || '-')}</p>
    <h3>Makine Özeti</h3>
    <div class="machine-table">
      ${machines.length ? machines.map(m => `
        <div class="machine-row">
          <strong>${esc(m.machine_code)}</strong>
          <span>${esc(m.state || '-')}</span>
          <span>${esc(m.score ?? '-')} / 100</span>
          <span>${esc(m.active_alarm_count ?? 0)} alarm</span>
        </div>
      `).join('') : '<span class="muted">Makine verisi yok.</span>'}
    </div>
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
    ${report.telegram_text ? `<h3>Telegram Mesajı</h3><pre>${esc(report.telegram_text)}</pre>` : ''}
  `;
}

async function showSiteReportDetail(id) {
  if (!id) return;

  const el = document.getElementById('siteReportDetail');
  if (el) el.innerHTML = '<span class="muted">Site rapor detayı yükleniyor...</span>';

  try {
    const data = await getJson(`/api/sites/${siteCode}/ai/reports/${encodeURIComponent(id)}`);
    renderSiteReportDetail(data.report);
  } catch(e) {
    if (el) el.innerHTML = `<span class="alarm">${esc(e.message)}</span>`;
  }
}

async function createAndSaveSiteReport() {
  const statusEl = document.getElementById('siteReportActionStatus');
  const btn = document.getElementById('createSiteReport');
  if (statusEl) statusEl.textContent = 'Site raporu oluşturuluyor ve kaydediliyor...';
  if (btn) btn.disabled = true;

  try {
    const result = await getJson(`/api/sites/${siteCode}/ai/daily-report/telegram?save=1`);
    if (statusEl) {
      statusEl.textContent = result.saved_to_database?.saved
        ? `Kaydedildi. Report ID: ${result.saved_to_database.report_id}`
        : `Kaydedilemedi: ${result.saved_to_database?.reason || 'bilinmeyen hata'}`;
    }
    await refresh(true);
  } catch(e) {
    if (statusEl) statusEl.textContent = e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderDeviceInfo(deviceInfo) {
  const device = deviceInfo.device || {};
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '-';
  };

  setText('deviceUid', device.device_uid || '-');
  setText('deviceModel', device.model || '-');
  setText('deviceFirmware', device.firmware_version || '-');
  setText('devicePlatform', device.platform_name || '-');
  setText('deviceBuildType', device.build_type || '-');
  setText('deviceStatus', device.status || '-');
  setText('deviceLastSeen', fmtDate(device.last_seen_at));

  const statusEl = document.getElementById('deviceStatus');
  if (statusEl) statusEl.className = device.status === 'online' ? 'ok' : 'alarm';
}

function renderSiteDailyReport(siteDaily) {
  const el = document.getElementById('siteDailyReport');
  const telegramEl = document.getElementById('siteTelegramPreview');
  if (!el) return;

  const report = siteDaily.report || {};
  const machines = report.machines || [];

  el.innerHTML = `
    <div class="site-score-row">
      <div>
        <p class="label">Genel Fabrika Skoru</p>
        <strong class="${Number(report.overall_score) >= 75 ? 'ok' : 'alarm'}">${esc(report.overall_score ?? '-')} / 100</strong>
      </div>
      <div>
        <p class="label">Makine</p>
        <strong>${esc(report.running_count ?? 0)} / ${esc(report.machine_count ?? 0)}</strong>
      </div>
      <div>
        <p class="label">Aktif Alarm</p>
        <strong class="${Number(report.active_alarm_total || 0) > 0 ? 'alarm' : 'ok'}">${esc(report.active_alarm_total ?? 0)}</strong>
      </div>
    </div>
    <p class="ai-summary">${esc(report.summary || '-')}</p>
    <h3>Makine Bazlı Özet</h3>
    <div class="machine-table">
      ${machines.length ? machines.map(m => `
        <div class="machine-row">
          <strong>${esc(m.machine_code)}</strong>
          <span>${esc(m.state || '-')}</span>
          <span>${esc(m.score ?? '-')} / 100</span>
          <span>${esc(m.active_alarm_count ?? 0)} alarm</span>
        </div>
      `).join('') : '<span class="muted">Makine bulunamadı.</span>'}
    </div>
    <h3>Bulgular</h3>
    <ul>${(report.findings || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3>Öneriler</h3>
    <ul>${(report.recommendations || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  `;

  if (telegramEl) {
    telegramEl.textContent = siteDaily.report?.telegram_text || 'Telegram metni için /api/sites/site01/ai/daily-report/telegram endpointini kullan.';
  }
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
    const deviceInfo = await getJson(`/api/machines/${machineCode}/device-info`);
    const siteDaily = await getJson(`/api/sites/${siteCode}/ai/daily-report`);
    const siteReports = await getJson(`/api/sites/${siteCode}/ai/reports?limit=5`);
    const openAiStatus = await getJson('/api/ai/openai/status');
    const emailStatus = await getJson('/api/email/status');

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
    renderDeviceInfo(deviceInfo);
    renderSiteDailyReport(siteDaily);
    renderSiteReportHistory(siteReports);
    renderOpenAiStatus(openAiStatus);
    renderEmailStatus(emailStatus);
    updatePdfLinks(siteReports);

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

  const siteRow = e.target.closest('[data-site-report-id]');
  if (siteRow) showSiteReportDetail(siteRow.dataset.siteReportId);
});

const cleanupBtn = document.getElementById('cleanupDemoReports');
if (cleanupBtn) cleanupBtn.addEventListener('click', cleanupDemoReports);

const createSiteReportBtn = document.getElementById('createSiteReport');
if (createSiteReportBtn) createSiteReportBtn.addEventListener('click', createAndSaveSiteReport);

const createOpenAiReportBtn = document.getElementById('createOpenAiReport');
if (createOpenAiReportBtn) createOpenAiReportBtn.addEventListener('click', createOpenAiReport);

refresh(true);
setInterval(() => refresh(false), 5000);


const sendLatestReportEmailBtn = document.getElementById('sendLatestReportEmail');
if (sendLatestReportEmailBtn) sendLatestReportEmailBtn.addEventListener('click', sendLatestReportEmail);

const createAndEmailSiteReportBtn = document.getElementById('createAndEmailSiteReport');
if (createAndEmailSiteReportBtn) createAndEmailSiteReportBtn.addEventListener('click', createAndEmailSiteReport);

const createAndEmailOpenAiReportBtn = document.getElementById('createAndEmailOpenAiReport');
if (createAndEmailOpenAiReportBtn) createAndEmailOpenAiReportBtn.addEventListener('click', createAndEmailOpenAiReport);
