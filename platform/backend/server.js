require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const CFG = {
  mqttUrl: process.env.MQTT_URL || 'mqtt://broker.emqx.io:1883',
  baseTopic: process.env.MQTT_BASE_TOPIC || 'mia/site01/laser01',
  customerCode: process.env.CUSTOMER_CODE || 'mia-demo',
  customerName: process.env.CUSTOMER_NAME || 'Mia Demo',
  siteCode: process.env.SITE_CODE || 'site01',
  siteName: process.env.SITE_NAME || 'Mia Demo Atolye',
  machineCode: process.env.MACHINE_CODE || 'laser01',
  machineName: process.env.MACHINE_NAME || 'Lazer-01',
  machineType: process.env.MACHINE_TYPE || 'laser_cutting',
  deviceUid: process.env.DEVICE_UID || 'laser01',
  deviceModel: process.env.DEVICE_MODEL || 'FactoryBox One'
};

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5433),
  database: process.env.PGDATABASE || 'factorybox',
  user: process.env.PGUSER || 'factorybox',
  password: process.env.PGPASSWORD || 'factorybox_dev_pass'
});

const app = express();
app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname, 'public')));

let mqttConnected = false;
let lastMqttMessageAt = null;
let lastMqttTopic = null;
let ids = null;

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const b = (v) => typeof v === 'boolean' ? v : (v === 'true' || v === '1' ? true : (v === 'false' || v === '0' ? false : null));
async function one(sql, params=[]) { const r = await pool.query(sql, params); return r.rows[0] || null; }

async function ensureEntities() {
  if (ids) return ids;
  const customer = await one(`INSERT INTO customers(code,name,status) VALUES($1,$2,'pilot')
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name, updated_at=now() RETURNING id,code,name`, [CFG.customerCode, CFG.customerName]);
  const site = await one(`INSERT INTO sites(customer_id,code,name,location,status) VALUES($1,$2,$3,'Istanbul','pilot')
    ON CONFLICT(customer_id,code) DO UPDATE SET name=EXCLUDED.name, updated_at=now() RETURNING id,code,name`, [customer.id, CFG.siteCode, CFG.siteName]);
  const machine = await one(`INSERT INTO machines(site_id,code,name,machine_type,status) VALUES($1,$2,$3,$4,'active')
    ON CONFLICT(site_id,code) DO UPDATE SET name=EXCLUDED.name, machine_type=EXCLUDED.machine_type, updated_at=now() RETURNING id,code,name`, [site.id, CFG.machineCode, CFG.machineName, CFG.machineType]);
  const device = await one(`INSERT INTO devices(machine_id,device_uid,model,mqtt_base_topic,status,last_seen_at) VALUES($1,$2,$3,$4,'online',now())
    ON CONFLICT(device_uid) DO UPDATE SET machine_id=EXCLUDED.machine_id, model=EXCLUDED.model, mqtt_base_topic=EXCLUDED.mqtt_base_topic, status='online', last_seen_at=now(), updated_at=now() RETURNING id,device_uid`, [machine.id, CFG.deviceUid, CFG.deviceModel, CFG.baseTopic]);
  await pool.query(`INSERT INTO sensors(device_id,code,sensor_type,name,unit,metadata) VALUES
    ($1,'DI1','digital_input','Machine RUN Signal',NULL,'{"pin":27,"active_low":true,"driver":"PC817"}'::jsonb),
    ($1,'TEMP1','temperature','DS18B20 Temperature Sensor','C','{"pin":4,"resolution_bits":10}'::jsonb)
    ON CONFLICT(device_id,code) DO UPDATE SET name=EXCLUDED.name, sensor_type=EXCLUDED.sensor_type, unit=EXCLUDED.unit, metadata=EXCLUDED.metadata, updated_at=now()`, [device.id]);
  ids = { customer, site, machine, device };
  return ids;
}

async function seen(payload={}) {
  const { device } = await ensureEntities();
  await ensureAiReportsHistorySchema();
  await pool.query(`UPDATE devices SET last_seen_at=now(), status='online', firmware_version=COALESCE($2, firmware_version), updated_at=now() WHERE id=$1`, [device.id, payload.firmware_version || null]);
}

async function telemetry(payload, source) {
  const { machine, device } = await ensureEntities();
  const temp = payload.temperature_sensor?.temperature_c ?? payload.temperature_c ?? payload.temperature;
  await pool.query(`INSERT INTO telemetry_events(device_id,machine_id,event_ts,current_amp,temperature_c,wifi_rssi,uptime_ms,alarm_active,raw_payload)
    VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8::jsonb)`, [
    device.id, machine.id,
    n(payload.current_amp ?? payload.current),
    n(temp),
    n(payload.wifi_rssi ?? payload.rssi),
    n(payload.uptime_ms ?? payload.uptimeMs),
    b(payload.alarm_active ?? payload.alarmActive),
    JSON.stringify({ source, ...payload })
  ]);
  await seen(payload);
}

async function machineState(payload, source) {
  const { machine, device } = await ensureEntities();
  const m = payload.machine || {};
  const state = String(payload.state || m.state || payload.machine_state || '').toUpperCase();
  if (!['RUNNING','STOPPED','UNKNOWN'].includes(state)) return;
  const latest = await one(`SELECT id,state,ended_at FROM machine_state_events WHERE machine_id=$1 ORDER BY started_at DESC LIMIT 1`, [machine.id]);
  const raw = JSON.stringify({ source, ...payload });
  if (latest && latest.state === state) {
    await pool.query(`UPDATE machine_state_events SET duration_sec=GREATEST(0,EXTRACT(EPOCH FROM(now()-started_at))::int), raw_payload=$2::jsonb WHERE id=$1`, [latest.id, raw]);
  } else {
    if (latest && !latest.ended_at) await pool.query(`UPDATE machine_state_events SET ended_at=now(), duration_sec=GREATEST(0,EXTRACT(EPOCH FROM(now()-started_at))::int) WHERE id=$1`, [latest.id]);
    await pool.query(`INSERT INTO machine_state_events(machine_id,device_id,state,source,started_at,raw_payload) VALUES($1,$2,$3,$4,now(),$5::jsonb)`, [machine.id, device.id, state, payload.source || m.input_source || source, raw]);
  }
  await seen(payload);
}

async function alarm(payload) {
  const { machine, device } = await ensureEntities();

  const typ = payload.type || payload.alarm_type || payload.alarmType || 'UNKNOWN_ALARM';
  const event = String(payload.event || payload.status || '').toUpperCase();
  const severity = payload.severity || 'warning';
  const message = payload.message || `${typ} alarm`;

  if (event.includes('CLEAR')) {
    await pool.query(
      `UPDATE alarms
       SET status='cleared',
           cleared_at=now(),
           message=COALESCE($5, message),
           raw_payload=$4::jsonb
       WHERE machine_id=$1
         AND device_id=$2
         AND alarm_type=$3
         AND status='active'`,
      [machine.id, device.id, typ, JSON.stringify(payload), message]
    );
  } else {
    const existingActiveAlarm = await one(
      `SELECT id
       FROM alarms
       WHERE machine_id=$1
         AND device_id=$2
         AND alarm_type=$3
         AND status='active'
       ORDER BY started_at DESC
       LIMIT 1`,
      [machine.id, device.id, typ]
    );

    if (existingActiveAlarm) {
      await pool.query(
        `UPDATE alarms
         SET severity=$2,
             message=$3,
             raw_payload=$4::jsonb
         WHERE id=$1`,
        [existingActiveAlarm.id, severity, message, JSON.stringify(payload)]
      );
    } else {
      await pool.query(
        `INSERT INTO alarms(machine_id,device_id,alarm_type,severity,status,started_at,message,raw_payload)
         VALUES($1,$2,$3,$4,'active',now(),$5,$6::jsonb)`,
        [machine.id, device.id, typ, severity, message, JSON.stringify(payload)]
      );
    }
  }

  await seen(payload);
}
async function dailySummary(payload) {
  const { machine } = await ensureEntities();
  const s = payload.daily_summary || payload.summary || payload.machine || payload.machine_runtime || payload;
  const runtime = n(s.runtime_sec ?? s.daily_runtime_sec ?? s.runtime_total_sec) || 0;
  const stop = n(s.stop_sec ?? s.daily_stop_sec ?? s.stop_total_sec) || 0;
  const observed = n(s.observed_sec ?? s.total_observed_sec) || runtime + stop;
  await pool.query(`INSERT INTO daily_machine_summaries(machine_id,summary_date,runtime_sec,stop_sec,observed_sec,utilization_pct,longest_run_sec,longest_stop_sec,run_start_count,stop_start_count,raw_payload)
    VALUES($1,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    ON CONFLICT(machine_id,summary_date) DO UPDATE SET runtime_sec=EXCLUDED.runtime_sec, stop_sec=EXCLUDED.stop_sec, observed_sec=EXCLUDED.observed_sec, utilization_pct=EXCLUDED.utilization_pct, longest_run_sec=EXCLUDED.longest_run_sec, longest_stop_sec=EXCLUDED.longest_stop_sec, run_start_count=EXCLUDED.run_start_count, stop_start_count=EXCLUDED.stop_start_count, raw_payload=EXCLUDED.raw_payload`, [
      machine.id, runtime, stop, observed, n(s.utilization_pct ?? s.utilization_percent), n(s.longest_run_sec)||0, n(s.longest_stop_sec)||0, n(s.run_start_count)||0, n(s.stop_start_count)||0, JSON.stringify(payload)
    ]);
}

async function workflow(eventType, payload) {
  const { machine } = await ensureEntities();
  await pool.query(`INSERT INTO workflow_events(workflow_name,machine_id,event_type,status,event_ts,raw_payload) VALUES('platform-backend-mvp',$1,$2,$3,now(),$4::jsonb)`, [machine.id, eventType, payload.status || 'done', JSON.stringify(payload)]);
}

async function commandStatus(payload) {
  await workflow(`command_status_${payload.command || 'unknown'}`, payload);
  if (payload.command === 'get_daily_summary' && payload.status === 'done') await dailySummary(payload);
  if (payload.command === 'get_temperature' && payload.status === 'done') await telemetry(payload, 'command_status_get_temperature');
  if (payload.command === 'get_machine_runtime' && payload.status === 'done') await machineState(payload, 'command_status_get_machine_runtime');
  await seen(payload);
}

async function handleMessage(topic, buffer) {
  let payload;
  try { payload = JSON.parse(buffer.toString()); } catch { console.warn('Invalid JSON', topic); return; }
  lastMqttMessageAt = new Date().toISOString(); lastMqttTopic = topic;
  try {
    if (topic.endsWith('/telemetry')) await telemetry(payload, 'telemetry');
    else if (topic.endsWith('/heartbeat')) await telemetry(payload, 'heartbeat');
    else if (topic.endsWith('/alarm')) await alarm(payload);
    else if (topic.endsWith('/machine/status')) await machineState(payload, 'machine_status');
    else if (topic.endsWith('/digital_inputs/status')) { await workflow('digital_inputs_status', payload); await machineState(payload, 'digital_inputs_status'); await seen(payload); }
    else if (topic.endsWith('/command/status')) await commandStatus(payload);
    else { await workflow('unhandled_mqtt_message', { topic, ...payload }); await seen(payload); }
    console.log('MQTT saved:', topic);
  } catch (e) { console.error('MQTT save error:', topic, e.message); }
}


function pct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

function secondsToHuman(seconds) {
  const s = Number(seconds || 0);
  if (!Number.isFinite(s) || s <= 0) return '0 saniye';

  if (s < 60) {
    return `${s} saniye`;
  }

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  const parts = [];
  if (h > 0) parts.push(`${h} saat`);
  if (m > 0) parts.push(`${m} dakika`);
  if (sec > 0 && h === 0) parts.push(`${sec} saniye`);

  return parts.join(' ');
}

function healthScoreFromData(summary, activeAlarmCount, latestTelemetry) {
  let score = 100;

  const utilization = Number(summary?.utilization_pct ?? 0);
  const temp = Number(latestTelemetry?.temperature_c ?? 0);
  const rssi = Number(latestTelemetry?.wifi_rssi ?? -50);

  if (utilization < 30) score -= 25;
  else if (utilization < 60) score -= 12;

  if (activeAlarmCount > 0) score -= Math.min(35, activeAlarmCount * 15);

  if (temp >= 35) score -= 12;
  else if (temp >= 30) score -= 5;

  if (rssi < -75) score -= 10;
  else if (rssi < -65) score -= 5;

  return Math.max(0, Math.min(100, score));
}

function buildSmartAiReport(machineCode, status, telemetryRows, alarmRows, summaryRows) {
  const latestState = status?.latest_state || {};
  const latestTelemetry = status?.latest_telemetry || {};
  const summary = status?.calculated_today_summary || status?.latest_daily_summary || summaryRows?.[0] || {};
  const activeAlarms = alarmRows.filter(a => a.status === 'active');
  const clearedAlarms = alarmRows.filter(a => a.status === 'cleared');

  const runtimeSec = Number(summary.runtime_sec || 0);
  const stopSec = Number(summary.stop_sec || 0);
  const utilizationPct = pct(summary.utilization_pct ?? 0);
  const score = healthScoreFromData(summary, activeAlarms.length, latestTelemetry);

  const findings = [];
  const recommendations = [];

  if (latestState.state) {
    findings.push(`Makine son durumda ${latestState.state} görünüyor. Kaynak: ${latestState.source || 'bilinmiyor'}.`);
  } else {
    findings.push('Makine state bilgisi henüz oluşmamış.');
  }

  findings.push(`Bugünkü çalışma süresi ${secondsToHuman(runtimeSec)}, duruş süresi ${secondsToHuman(stopSec)}.`);
  findings.push(`Günlük kullanım oranı yaklaşık %${utilizationPct ?? 0}.`);

  if (latestTelemetry.temperature_c !== null && latestTelemetry.temperature_c !== undefined) {
    findings.push(`Son sıcaklık değeri ${latestTelemetry.temperature_c} °C.`);
  }

  if (latestTelemetry.current_amp !== null && latestTelemetry.current_amp !== undefined) {
    findings.push(`Son akım değeri ${latestTelemetry.current_amp} A.`);
  }

  if (latestTelemetry.wifi_rssi !== null && latestTelemetry.wifi_rssi !== undefined) {
    findings.push(`WiFi sinyal seviyesi ${latestTelemetry.wifi_rssi} dBm.`);
  }

  if (activeAlarms.length > 0) {
    findings.push(`${activeAlarms.length} adet aktif alarm var. En kritik görünen alarm: ${activeAlarms[0].alarm_type}.`);
    recommendations.push('Aktif alarm temizlenmeden üretim performansı doğru yorumlanmamalı.');
    recommendations.push('Alarm devam ediyorsa eşik değerleri ve sensör okuması kontrol edilmeli.');
  } else {
    findings.push('Aktif alarm görünmüyor.');
    recommendations.push('Alarm listesi temiz olduğu için günlük üretim analizi güvenilir görünüyor.');
  }

  if (utilizationPct !== null && utilizationPct < 60) {
    recommendations.push('Kullanım oranı düşük. Planlı duruş, operatör bekleme veya iş emri boşluğu ayrıştırılmalı.');
  } else if (utilizationPct !== null && utilizationPct >= 80) {
    recommendations.push('Kullanım oranı iyi görünüyor. Bu seviyenin sürdürülebilirliği takip edilmeli.');
  }

  if (Number(latestTelemetry.temperature_c || 0) >= 30) {
    recommendations.push('Sıcaklık 30 °C ve üzerindeyse ortam havalandırması veya pano içi sıcaklık takip edilmeli.');
  }

  if (Number(latestTelemetry.wifi_rssi || -50) < -65) {
    recommendations.push('WiFi sinyali zayıflarsa veri kayıpları yaşanabilir. Router konumu veya anten kontrol edilmeli.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Sistem normal görünüyor. Veri toplamaya devam edilmeli.');
  }

  const summaryText = [
    `SmartAI günlük özet: ${machineCode} için sistem skoru ${score}/100.`,
    `Makine durumu ${latestState.state || 'bilinmiyor'}, günlük kullanım oranı %${utilizationPct ?? 0}.`,
    activeAlarms.length > 0 ? `Dikkat: ${activeAlarms.length} aktif alarm var.` : 'Aktif alarm bulunmuyor.'
  ].join(' ');

  return {
    machine_code: machineCode,
    report_type: 'daily_production',
    generated_at: new Date().toISOString(),
    health_score: score,
    summary: summaryText,
    findings,
    recommendations,
    raw: {
      latest_state: latestState,
      latest_telemetry: latestTelemetry,
      latest_daily_summary: summary,
      active_alarm_count: activeAlarms.length,
      cleared_alarm_count: clearedAlarms.length,
      telemetry_sample_count: telemetryRows.length,
      alarm_sample_count: alarmRows.length,
      summary_sample_count: summaryRows.length
    }
  };
}

async function getMachineSmartAiData(machineCode) {
  const status = await one(
    `SELECT mo.*, row_to_json(ls.*) latest_state, row_to_json(lt.*) latest_telemetry,
      (SELECT row_to_json(s.*) FROM (SELECT summary_date,runtime_sec,stop_sec,observed_sec,utilization_pct,longest_run_sec,longest_stop_sec,run_start_count,stop_start_count FROM daily_machine_summaries d WHERE d.machine_id=mo.machine_id ORDER BY summary_date DESC LIMIT 1) s) latest_daily_summary
      FROM v_machine_overview mo
      LEFT JOIN v_latest_machine_state ls ON ls.machine_id=mo.machine_id
      LEFT JOIN v_latest_device_telemetry lt ON lt.machine_id=mo.machine_id
      WHERE mo.machine_code=$1
      LIMIT 1`,
    [machineCode]
  );

  if (!status) return null;

  const telemetry = await pool.query(
    `SELECT event_ts,current_amp,temperature_c,wifi_rssi,uptime_ms,alarm_active
     FROM telemetry_events
     WHERE machine_id=$1
     ORDER BY event_ts DESC
     LIMIT 50`,
    [status.machine_id]
  );

  const alarms = await pool.query(
    `SELECT alarm_type,severity,status,started_at,cleared_at,message
     FROM alarms
     WHERE machine_id=$1
     ORDER BY started_at DESC
     LIMIT 50`,
    [status.machine_id]
  );

  const summaries = await pool.query(
    `SELECT summary_date,runtime_sec,stop_sec,observed_sec,utilization_pct,longest_run_sec,longest_stop_sec,run_start_count,stop_start_count
     FROM daily_machine_summaries
     WHERE machine_id=$1
     ORDER BY summary_date DESC
     LIMIT 7`,
    [status.machine_id]
  );

  status.calculated_today_summary = await getCalculatedTodayRuntime(status.machine_id);

  return {
    status,
    telemetryRows: telemetry.rows,
    alarmRows: alarms.rows,
    summaryRows: summaries.rows
  };
}


async function getCalculatedTodayRuntime(machineId) {
  const row = await one(
    `
    WITH events AS (
      SELECT
        state,
        started_at,
        COALESCE(ended_at, now()) AS ended_at
      FROM machine_state_events
      WHERE machine_id = $1
        AND started_at < (CURRENT_DATE + INTERVAL '1 day')
        AND COALESCE(ended_at, now()) >= CURRENT_DATE
    ),
    clipped AS (
      SELECT
        state,
        GREATEST(started_at, CURRENT_DATE) AS start_ts,
        LEAST(ended_at, CURRENT_DATE + INTERVAL '1 day') AS end_ts
      FROM events
    ),
    totals AS (
      SELECT
        COALESCE(SUM(EXTRACT(EPOCH FROM (end_ts - start_ts))) FILTER (WHERE state = 'RUNNING'), 0)::int AS runtime_sec,
        COALESCE(SUM(EXTRACT(EPOCH FROM (end_ts - start_ts))) FILTER (WHERE state = 'STOPPED'), 0)::int AS stop_sec
      FROM clipped
      WHERE end_ts > start_ts
    )
    SELECT
      runtime_sec,
      stop_sec,
      (runtime_sec + stop_sec)::int AS observed_sec,
      CASE
        WHEN (runtime_sec + stop_sec) > 0
        THEN ROUND((runtime_sec::numeric / (runtime_sec + stop_sec)) * 100, 1)
        ELSE 0
      END AS utilization_pct
    FROM totals
    `,
    [machineId]
  );

  return row || {
    runtime_sec: 0,
    stop_sec: 0,
    observed_sec: 0,
    utilization_pct: 0
  };
}



async function ensureAiReportsHistorySchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS ai_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id uuid,
      report_type text NOT NULL DEFAULT 'daily_production',
      report_date date NOT NULL DEFAULT CURRENT_DATE,
      health_score integer,
      summary text,
      telegram_text text,
      report_json jsonb,
      raw_payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS machine_id uuid;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'daily_production';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_date date NOT NULL DEFAULT CURRENT_DATE;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS health_score integer;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS summary text;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS summary_text text;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_text text;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS telegram_text text;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_json jsonb;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS raw_payload jsonb;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

    ALTER TABLE ai_reports ALTER COLUMN summary_text DROP NOT NULL;
    ALTER TABLE ai_reports ALTER COLUMN report_text DROP NOT NULL;

    UPDATE ai_reports
    SET summary_text = COALESCE(summary_text, summary, report_text, 'SmartAI report')
    WHERE summary_text IS NULL;

    UPDATE ai_reports
    SET summary = COALESCE(summary, summary_text, report_text, 'SmartAI report')
    WHERE summary IS NULL;

    CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_created
    ON ai_reports(machine_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_date
    ON ai_reports(machine_id, report_date DESC);
  `);
}

async function saveSmartAiReportIfPossible(machineId, report) {
  await ensureAiReportsHistorySchema();

  const reportJson = report.report_json || report;
  const summary = report.summary || reportJson.summary || null;
  const telegramText = report.telegram_text || reportJson.telegram_text || null;
  const healthScoreRaw = report.health_score ?? reportJson.health_score ?? null;
  const healthScore = Number(healthScoreRaw);
  const reportType = report.report_type || reportJson.report_type || 'daily_production';

  const saved = await one(
    `
    INSERT INTO ai_reports
      (machine_id, report_type, report_date, health_score, summary, summary_text, report_text, telegram_text, report_json, raw_payload, created_at)
    VALUES
      ($1, $2, CURRENT_DATE, $3, $4, $4, $4, $5, $6::jsonb, $6::jsonb, now())
    RETURNING id, report_date, created_at
    `,
    [
      machineId,
      reportType,
      Number.isFinite(healthScore) ? healthScore : null,
      summary,
      telegramText,
      JSON.stringify(reportJson)
    ]
  );

  return {
    saved: true,
    report_id: saved.id,
    report_date: saved.report_date,
    created_at: saved.created_at
  };
}

app.get('/api/health', async (req,res)=>{
  try {
    const db = await pool.query('SELECT now() AS now');
    const counts = await one(`SELECT (SELECT count(*)::int FROM customers) customers, (SELECT count(*)::int FROM machines) machines, (SELECT count(*)::int FROM devices) devices, (SELECT count(*)::int FROM telemetry_events) telemetry_events, (SELECT count(*)::int FROM machine_state_events) machine_state_events, (SELECT count(*)::int FROM alarms) alarms`);
    res.json({ status:'ok', service:'factorybox-platform-backend', version:'3.9.0', database_time: db.rows[0].now, mqtt_connected:mqttConnected, mqtt_base_topic:CFG.baseTopic, last_mqtt_message_at:lastMqttMessageAt, last_mqtt_topic:lastMqttTopic, counts });
  } catch(e) { res.status(500).json({status:'error', message:e.message}); }
});

app.get('/api/machines', async (req,res)=>{ const r=await pool.query('SELECT * FROM v_machine_overview ORDER BY customer_code,site_code,machine_code'); res.json(r.rows); });
app.get('/api/machines/:code/status', async (req,res)=>{
  const r = await one(`SELECT mo.*, row_to_json(ls.*) latest_state, row_to_json(lt.*) latest_telemetry,
    (SELECT json_agg(a ORDER BY a.started_at DESC) FROM (SELECT alarm_type,severity,status,started_at,cleared_at,message FROM alarms a WHERE a.machine_id=mo.machine_id ORDER BY started_at DESC LIMIT 5) a) recent_alarms,
    (SELECT row_to_json(s.*) FROM (SELECT summary_date,runtime_sec,stop_sec,observed_sec,utilization_pct,longest_run_sec,longest_stop_sec,run_start_count,stop_start_count FROM daily_machine_summaries d WHERE d.machine_id=mo.machine_id ORDER BY summary_date DESC LIMIT 1) s) latest_daily_summary
    FROM v_machine_overview mo LEFT JOIN v_latest_machine_state ls ON ls.machine_id=mo.machine_id LEFT JOIN v_latest_device_telemetry lt ON lt.machine_id=mo.machine_id WHERE mo.machine_code=$1 LIMIT 1`, [req.params.code]);
  if (!r) return res.status(404).json({status:'not_found'}); r.calculated_today_summary = await getCalculatedTodayRuntime(r.machine_id); res.json(r);
});
app.get('/api/machines/:code/telemetry/latest', async (req,res)=>{ const r=await pool.query('SELECT t.* FROM telemetry_events t JOIN machines m ON m.id=t.machine_id WHERE m.code=$1 ORDER BY t.event_ts DESC LIMIT 20',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/daily-summary', async (req,res)=>{ const r=await pool.query('SELECT d.* FROM daily_machine_summaries d JOIN machines m ON m.id=d.machine_id WHERE m.code=$1 ORDER BY d.summary_date DESC LIMIT 30',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/alarms', async (req,res)=>{ const r=await pool.query('SELECT a.* FROM alarms a JOIN machines m ON m.id=a.machine_id WHERE m.code=$1 ORDER BY a.started_at DESC LIMIT 50',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/events', async (req,res)=>{ const r=await pool.query(`SELECT 'machine_state' event_group,state event_type,started_at event_ts,raw_payload FROM machine_state_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 UNION ALL SELECT 'vision',event_type,event_ts,raw_payload FROM vision_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 UNION ALL SELECT 'workflow',event_type,event_ts,raw_payload FROM workflow_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 ORDER BY event_ts DESC LIMIT 50`,[req.params.code]); res.json(r.rows); });



function formatTelegramLine(label, value) {
  if (value === null || value === undefined || value === '') return `${label}: -`;
  return `${label}: ${value}`;
}

function buildTelegramDailyReportText(report) {
  const raw = report.raw || {};
  const state = raw.latest_state || {};
  const telemetry = raw.latest_telemetry || {};
  const summary = raw.latest_daily_summary || {};

  const lines = [];

  lines.push('🏭 FactoryBox SmartAI Günlük Üretim Raporu');
  lines.push('');
  lines.push(`Makine: ${report.machine_code}`);
  lines.push(`Skor: ${report.health_score}/100`);
  lines.push('');
  lines.push('📌 Özet');
  lines.push(report.summary || '-');
  lines.push('');
  lines.push('⚙️ Durum');
  lines.push(formatTelegramLine('Makine', state.state || '-'));
  lines.push(formatTelegramLine('Kaynak', state.source || '-'));
  lines.push(formatTelegramLine('Runtime', secondsToHuman(summary.runtime_sec || 0)));
  lines.push(formatTelegramLine('Stop', secondsToHuman(summary.stop_sec || 0)));
  lines.push(formatTelegramLine('Utilization', `${summary.utilization_pct ?? 0}%`));
  lines.push('');
  lines.push('🌡️ Son Telemetry');
  lines.push(formatTelegramLine('Sıcaklık', telemetry.temperature_c !== undefined && telemetry.temperature_c !== null ? `${telemetry.temperature_c} °C` : '-'));
  lines.push(formatTelegramLine('Akım', telemetry.current_amp !== undefined && telemetry.current_amp !== null ? `${telemetry.current_amp} A` : '-'));
  lines.push(formatTelegramLine('WiFi RSSI', telemetry.wifi_rssi !== undefined && telemetry.wifi_rssi !== null ? `${telemetry.wifi_rssi} dBm` : '-'));
  lines.push('');
  lines.push('🔎 Bulgular');
  (report.findings || []).slice(0, 6).forEach((item) => lines.push(`• ${item}`));
  lines.push('');
  lines.push('✅ Öneriler');
  (report.recommendations || []).slice(0, 5).forEach((item) => lines.push(`• ${item}`));
  lines.push('');
  lines.push(`Rapor zamanı: ${new Date(report.generated_at).toLocaleString('tr-TR')}`);

  return lines.join('\n');
}

async function createSmartAiDailyReport(machineCode, save) {
  const data = await getMachineSmartAiData(machineCode);

  if (!data) {
    return null;
  }

  const report = buildSmartAiReport(
    machineCode,
    data.status,
    data.telemetryRows,
    data.alarmRows,
    data.summaryRows
  );

  const telegram_text = buildTelegramDailyReportText(report);
  const saveResult = save
    ? await saveSmartAiReportIfPossible(data.status.machine_id, {
        ...report,
        telegram_text
      })
    : { saved:false, reason:'save query not requested' };

  return {
    machine_id: data.status.machine_id,
    report,
    telegram_text,
    saveResult
  };
}



app.get('/api/machines/:code/ai/daily-report', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSmartAiDailyReport(req.params.code, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    res.json({
      status:'ok',
      ai_engine:'SmartAI Local Rule Engine',
      version:'3.9.0',
      saved_to_database: result.saveResult,
      report: result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/machines/:code/ai/daily-report/telegram', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSmartAiDailyReport(req.params.code, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    res.json({
      status:'ok',
      ai_engine:'SmartAI Local Rule Engine',
      version:'3.9.0',
      machine_code: req.params.code,
      saved_to_database: result.saveResult,
      telegram_text: result.telegram_text,
      report: result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});




app.get('/api/machines/:code/ai/reports', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const machine = await one(
      `SELECT id, code FROM machines WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    if (!machine) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const result = await pool.query(
      `
      SELECT
        id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        created_at,
        report_json
      FROM ai_reports
      WHERE machine_id=$1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [machine.id, limit]
    );

    res.json({
      status:'ok',
      version:'3.9.0',
      machine_code:req.params.code,
      count: result.rows.length,
      reports: result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/machines/:code/ai/reports/latest', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const machine = await one(
      `SELECT id, code FROM machines WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    if (!machine) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    const report = await one(
      `
      SELECT
        id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        created_at,
        report_json
      FROM ai_reports
      WHERE machine_id=$1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [machine.id]
    );

    res.json({
      status:'ok',
      version:'3.9.0',
      machine_code:req.params.code,
      report: report || null
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});



app.get('/api/machines/:code/ai/reports/cleanup-demo', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const machine = await one(
      `SELECT id, code FROM machines WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    if (!machine) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    const demoWhere = `
      machine_id=$1 AND (
        health_score IS NULL OR
        COALESCE(summary,'') ILIKE '%demo rapor%' OR
        COALESCE(summary_text,'') ILIKE '%demo rapor%' OR
        COALESCE(report_text,'') ILIKE '%demo rapor%' OR
        COALESCE(report_type,'') ILIKE '%demo%'
      )
    `;

    if (String(req.query.confirm || '') !== '1') {
      const c = await one(`SELECT COUNT(*)::int AS count FROM ai_reports WHERE ${demoWhere}`, [machine.id]);
      return res.json({
        status:'ok',
        version:'3.9.0',
        machine_code:req.params.code,
        dry_run:true,
        demo_report_count:Number(c?.count || 0),
        message:'Silmek için ?confirm=1 ekleyin.'
      });
    }

    const deleted = await pool.query(
      `DELETE FROM ai_reports WHERE ${demoWhere} RETURNING id`,
      [machine.id]
    );

    res.json({
      status:'ok',
      version:'3.9.0',
      machine_code:req.params.code,
      deleted_count:deleted.rowCount,
      deleted_ids:deleted.rows.map(r => String(r.id))
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.post('/api/machines/:code/ai/reports/cleanup-demo', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const machine = await one(
      `SELECT id, code FROM machines WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    if (!machine) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    const deleted = await pool.query(
      `
      DELETE FROM ai_reports
      WHERE machine_id=$1 AND (
        health_score IS NULL OR
        COALESCE(summary,'') ILIKE '%demo rapor%' OR
        COALESCE(summary_text,'') ILIKE '%demo rapor%' OR
        COALESCE(report_text,'') ILIKE '%demo rapor%' OR
        COALESCE(report_type,'') ILIKE '%demo%'
      )
      RETURNING id
      `,
      [machine.id]
    );

    res.json({
      status:'ok',
      version:'3.9.0',
      machine_code:req.params.code,
      deleted_count:deleted.rowCount,
      deleted_ids:deleted.rows.map(r => String(r.id))
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/machines/:code/ai/reports/:id', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const machine = await one(
      `SELECT id, code FROM machines WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    if (!machine) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    const report = await one(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        summary_text,
        report_text,
        telegram_text,
        report_json,
        raw_payload,
        created_at
      FROM ai_reports
      WHERE machine_id=$1
        AND id::text=$2
      LIMIT 1
      `,
      [machine.id, String(req.params.id)]
    );

    if (!report) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code, report_id:String(req.params.id)});
    }

    res.json({
      status:'ok',
      version:'3.9.0',
      machine_code:req.params.code,
      report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/report-center', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    const machines = await pool.query(
      `SELECT id, code, name, machine_type, status FROM machines WHERE site_id=$1 ORDER BY code`,
      [site.id]
    );

    const rows = [];
    for (const m of machines.rows) {
      const device = await one(
        `SELECT device_uid, model, firmware_version, status, last_seen_at FROM devices WHERE machine_id=$1 ORDER BY updated_at DESC LIMIT 1`,
        [m.id]
      );
      const latestState = await one(
        `SELECT state, source, started_at, ended_at, duration_sec FROM machine_state_events WHERE machine_id=$1 ORDER BY started_at DESC LIMIT 1`,
        [m.id]
      );
      const latestTelemetry = await one(
        `SELECT event_ts, current_amp, temperature_c, wifi_rssi, alarm_active FROM telemetry_events WHERE machine_id=$1 ORDER BY event_ts DESC LIMIT 1`,
        [m.id]
      );
      const activeAlarms = await one(
        `SELECT COUNT(*)::int AS count FROM alarms WHERE machine_id=$1 AND status='active'`,
        [m.id]
      );
      const latestReport = await one(
        `SELECT id::text AS id, report_type, report_date, health_score, summary, created_at FROM ai_reports WHERE machine_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [m.id]
      );

      rows.push({
        machine_code:m.code,
        machine_name:m.name,
        machine_type:m.machine_type,
        machine_status:m.status,
        device:device || null,
        latest_state:latestState || null,
        latest_telemetry:latestTelemetry || null,
        active_alarm_count:Number(activeAlarms?.count || 0),
        latest_report:latestReport || null
      });
    }

    res.json({
      status:'ok',
      version:'3.9.0',
      site:{ code:site.code, name:site.name, status:site.status },
      machine_count:rows.length,
      machines:rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

async function start() {
  await pool.query('SELECT 1');
  await ensureEntities();
  const client = mqtt.connect(CFG.mqttUrl, { clientId:`factorybox-platform-backend-${Math.random().toString(16).slice(2)}`, clean:true, reconnectPeriod:3000 });
  client.on('connect',()=>{ mqttConnected=true; client.subscribe(`${CFG.baseTopic}/#`, (err)=> console.log(err ? err.message : `MQTT subscribed: ${CFG.baseTopic}/#`)); });
  client.on('close',()=>{ mqttConnected=false; });
  client.on('error',(e)=> console.error('MQTT error:', e.message));
  client.on('message', handleMessage);
  app.listen(PORT, ()=> console.log(`FactoryBox Platform Backend + SmartAI MVP: http://localhost:${PORT}`));
}
start().catch(e=>{ console.error('Backend start failed:', e); process.exit(1); });
