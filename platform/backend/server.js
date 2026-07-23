require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

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
app.use(express.static(path.join(__dirname, 'public'), {
  etag:false,
  maxAge:0,
  setHeaders:(res, filePath)=>{
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

let mqttConnected = false;
let lastMqttMessageAt = null;
let lastMqttTopic = null;
let ids = null;
let billingFoundationReady = false;
let inviteSchemaReady = false;
const authSessions = new Map();
const passwordResetRequestWindow = new Map();

const APP_VERSION = '5.14.2';

function subscriptionEnforcementEnabled() {
  return String(process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED || 'true').toLowerCase() !== 'false';
}

function deviceProvisioningEnabled() {
  return String(process.env.DEVICE_PROVISIONING_ENABLED || 'true').toLowerCase() !== 'false';
}

function adminDashboardKpiEnabled() {
  return String(process.env.ADMIN_DASHBOARD_KPI_ENABLED || 'true').toLowerCase() !== 'false';
}

function assetManagementEnabled() {
  return String(process.env.ASSET_MANAGEMENT_ENABLED || 'true').toLowerCase() !== 'false';
}

function liveMonitoringEnabled() {
  return String(process.env.LIVE_MONITORING_ENABLED || 'true').toLowerCase() !== 'false';
}

function alarmCenterEnabled() {
  return String(process.env.ALARM_CENTER_ENABLED || 'true').toLowerCase() !== 'false';
}

function alarmAnalyticsEnabled() {
  return String(process.env.ALARM_ANALYTICS_ENABLED || 'true').toLowerCase() !== 'false';
}

function alarmEscalationEnabled() {
  return String(process.env.ALARM_ESCALATION_ENABLED || 'true').toLowerCase() !== 'false';
}

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

async function ensureDeviceInfoSyncSchema() {
  await pool.query(`
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS platform_name text;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS build_type text;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_build text;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS raw_device_info jsonb;
  `);
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function extractDeviceInfo(payload = {}) {
  const info = payload.device_info || payload.device || payload.info || {};
  const firmware = payload.firmware || info.firmware || {};

  return {
    device_uid: firstValue(
      payload.device_uid,
      payload.device_id,
      payload.deviceId,
      info.device_uid,
      info.device_id,
      info.uid,
      info.id,
      CFG.deviceUid
    ),
    firmware_version: firstValue(
      payload.firmware_version,
      payload.firmwareVersion,
      firmware.version,
      firmware.firmware_version,
      info.firmware_version,
      info.firmwareVersion,
      payload.version
    ),
    model: firstValue(
      payload.model,
      payload.device_model,
      payload.deviceModel,
      info.model,
      info.device_model,
      info.deviceModel,
      CFG.deviceModel
    ),
    platform_name: firstValue(
      payload.platform_name,
      payload.platformName,
      payload.platform,
      info.platform_name,
      info.platformName,
      info.platform
    ),
    build_type: firstValue(
      payload.build_type,
      payload.buildType,
      info.build_type,
      info.buildType
    ),
    firmware_build: firstValue(
      payload.firmware_build,
      payload.build,
      payload.build_id,
      info.firmware_build,
      info.build,
      firmware.build
    )
  };
}

async function syncDeviceInfoFromPayload(payload = {}, source = 'mqtt') {
  const { device } = await ensureEntities();
  await ensureDeviceInfoSyncSchema();
  await ensureDeviceInfoSyncSchema();

  const info = extractDeviceInfo(payload);
  const raw = JSON.stringify({ source, ...payload });

  const row = await one(
    `
    UPDATE devices
    SET
      device_uid = COALESCE($2, device_uid),
      firmware_version = COALESCE($3, firmware_version),
      model = COALESCE($4, model),
      platform_name = COALESCE($5, platform_name),
      build_type = COALESCE($6, build_type),
      firmware_build = COALESCE($7, firmware_build),
      raw_device_info = COALESCE($8::jsonb, raw_device_info),
      status = 'online',
      last_seen_at = now(),
      updated_at = now()
    WHERE id=$1
    RETURNING
      id,
      device_uid,
      model,
      firmware_version,
      platform_name,
      build_type,
      firmware_build,
      status,
      last_seen_at,
      updated_at,
      raw_device_info
    `,
    [
      device.id,
      info.device_uid,
      info.firmware_version,
      info.model,
      info.platform_name,
      info.build_type,
      info.firmware_build,
      raw
    ]
  );

  return row;
}

async function seen(payload={}) {
  await syncDeviceInfoFromPayload(payload, 'seen');
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
  if (['get_device_info','get_info','get_status','get_health','get_diagnostics'].includes(payload.command) && payload.status === 'done') {
    await syncDeviceInfoFromPayload(payload, `command_status_${payload.command}`);
  }
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



function authConfig() {
  const resetMinutes = Number(process.env.PASSWORD_RESET_TOKEN_MINUTES || 30);
  const resetCooldown = Number(process.env.PASSWORD_RESET_COOLDOWN_SECONDS || 60);

  return {
    enabled: String(process.env.AUTH_ENABLED || 'false').toLowerCase() === 'true',
    sessionHours: Number(process.env.AUTH_SESSION_HOURS || 12),
    signupEnabled: String(process.env.SIGNUP_ENABLED || 'false').toLowerCase() === 'true',
    passwordResetEnabled: String(process.env.PASSWORD_RESET_ENABLED || 'true').toLowerCase() !== 'false',
    passwordResetTokenMinutes: Math.max(5, Number.isFinite(resetMinutes) ? resetMinutes : 30),
    passwordResetCooldownSeconds: Math.max(10, Number.isFinite(resetCooldown) ? resetCooldown : 60),
    adminEmail: process.env.FACTORYBOX_ADMIN_EMAIL || '',
    adminPassword: process.env.FACTORYBOX_ADMIN_PASSWORD || '',
    defaultRole: process.env.FACTORYBOX_ADMIN_ROLE || 'owner'
  };
}

function nowIso() {
  return new Date().toISOString();
}

function makeUserId() {
  return `usr_${crypto.randomBytes(12).toString('hex')}`;
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ''), String(salt || ''), 120000, 32, 'sha256').toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (!expectedHash || !salt) return false;
  const actual = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expectedHash));
}


const ROLE_PERMISSIONS = {
  system_admin: [
    'ADMIN_VIEW',
    'MANAGE_USERS',
    'MANAGE_CUSTOMERS',
    'MANAGE_SITES',
    'MANAGE_DEVICES',
    'MANAGE_INVITES',
    'VIEW_BILLING',
    'MANAGE_BILLING',
    'AUDIT_VIEW',
    'SEND_REPORTS',
    'VIEW_REPORTS',
    'VIEW_DASHBOARD'
  ],
  owner: [
    'ADMIN_VIEW',
    'MANAGE_USERS',
    'MANAGE_CUSTOMERS',
    'MANAGE_SITES',
    'MANAGE_DEVICES',
    'MANAGE_INVITES',
    'VIEW_BILLING',
    'MANAGE_BILLING',
    'AUDIT_VIEW',
    'SEND_REPORTS',
    'VIEW_REPORTS',
    'VIEW_DASHBOARD'
  ],
  admin: [
    'ADMIN_VIEW',
    'MANAGE_CUSTOMERS',
    'MANAGE_SITES',
    'MANAGE_DEVICES',
    'MANAGE_INVITES',
    'VIEW_BILLING',
    'AUDIT_VIEW',
    'SEND_REPORTS',
    'VIEW_REPORTS',
    'VIEW_DASHBOARD'
  ],
  operator: [
    'SEND_REPORTS',
    'VIEW_REPORTS',
    'VIEW_DASHBOARD'
  ],
  viewer: [
    'VIEW_REPORTS',
    'VIEW_DASHBOARD'
  ]
};

function getRolePermissions(role) {
  return ROLE_PERMISSIONS[String(role || 'viewer')] || ROLE_PERMISSIONS.viewer;
}

function hasPermission(userOrRole, permission) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return getRolePermissions(role).includes(permission);
}

function publicPermissions(user) {
  return getRolePermissions(user?.role || 'viewer');
}

function permissionRequired(permission) {
  return (req, res, next) => {
    if (!authConfig().enabled) {
      return next();
    }

    if (!req.user) {
      return res.status(401).json({
        status:'unauthorized',
        message:'Login required'
      });
    }

    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        status:'forbidden',
        message:`Permission required: ${permission}`,
        permission,
        role:req.user.role
      });
    }

    return next();
  };
}

function assertRoleChangeAllowed(actor, targetRole) {
  const actorRole = actor?.role || 'viewer';
  const nextRole = String(targetRole || '').trim();

  if (nextRole === 'system_admin' && actorRole !== 'system_admin') {
    const err = new Error('Only system_admin can assign system_admin role');
    err.statusCode = 403;
    throw err;
  }

  if (nextRole === 'owner' && !['system_admin', 'owner'].includes(actorRole)) {
    const err = new Error('Only owner or system_admin can assign owner role');
    err.statusCode = 403;
    throw err;
  }

  return true;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id:row.id,
    email:row.email,
    full_name:row.full_name,
    role:row.role,
    status:row.status,
    permissions:publicPermissions(row),
    default_customer_code:row.default_customer_code,
    default_site_code:row.default_site_code
  };
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getSession(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires_at) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function isPasswordResetTokenFormat(token) {
  return /^[a-f0-9]{64}$/i.test(String(token || ''));
}

function publicAppBaseUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3100';
  return `${proto}://${host}`;
}

function publicPasswordResetUrl(req, token) {
  return `${publicAppBaseUrl(req)}/reset-password.html?token=${encodeURIComponent(token)}`;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!name || !domain) return '';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

function validateNewPassword(password) {
  const clean = String(password || '');
  if (clean.length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.statusCode = 400;
    throw err;
  }
  if (clean.length > 128) {
    const err = new Error('Password must be at most 128 characters');
    err.statusCode = 400;
    throw err;
  }
  return clean;
}

function revokeSessionsForUser(userId) {
  let revoked = 0;
  for (const [token, session] of authSessions.entries()) {
    if (String(session?.user?.id || '') === String(userId || '')) {
      authSessions.delete(token);
      revoked += 1;
    }
  }
  return revoked;
}

function passwordResetRequestAllowed(req, email) {
  const cfg = authConfig();
  const now = Date.now();
  const cooldownMs = cfg.passwordResetCooldownSeconds * 1000;
  const keys = [`ip:${reqIp(req)}`, `email:${String(email || '').toLowerCase()}`];

  const blocked = keys.some(key => {
    const last = passwordResetRequestWindow.get(key) || 0;
    return now - last < cooldownMs;
  });

  if (blocked) return false;

  keys.forEach(key => passwordResetRequestWindow.set(key, now));

  if (passwordResetRequestWindow.size > 5000) {
    for (const [key, timestamp] of passwordResetRequestWindow.entries()) {
      if (now - timestamp > cooldownMs * 2) passwordResetRequestWindow.delete(key);
    }
  }

  return true;
}

async function ensurePasswordResetSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id bigserial PRIMARY KEY,
      user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      requested_ip text,
      used_ip text,
      email_sent_at timestamptz,
      email_message_id text,
      email_last_error text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
    ON password_reset_tokens(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active
    ON password_reset_tokens(expires_at)
    WHERE used_at IS NULL
  `);
}

function passwordResetEmailSubject() {
  return 'FactoryBox şifre sıfırlama bağlantınız';
}

function passwordResetEmailHtml(user, resetUrl, expiresMinutes) {
  const name = user.full_name || user.email;
  return emailShellHtml('FactoryBox Şifre Sıfırlama', `
    <h1 style="margin:0 0 12px 0;color:#102033;">Şifrenizi sıfırlayın</h1>
    <p style="font-size:15px;line-height:1.6;color:#334155;">
      Merhaba <strong>${h(name)}</strong>,<br>
      FactoryBox hesabınız için bir şifre sıfırlama isteği aldık.
    </p>

    <p style="margin:22px 0;">
      <a href="${h(resetUrl)}" style="display:inline-block;background:#123d64;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;">
        Yeni Şifre Belirle
      </a>
    </p>

    <p style="font-size:13px;color:#64748b;line-height:1.5;">
      Buton çalışmazsa bu linki tarayıcıya yapıştırın:<br>
      <span style="word-break:break-all;">${h(resetUrl)}</span>
    </p>

    <p style="font-size:12px;color:#94a3b8;margin-top:22px;line-height:1.5;">
      Bu bağlantı ${h(expiresMinutes)} dakika geçerlidir ve yalnızca bir kez kullanılabilir.<br>
      Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.
    </p>
  `);
}

function passwordResetEmailText(user, resetUrl, expiresMinutes) {
  return [
    `Merhaba ${user.full_name || user.email},`,
    '',
    'FactoryBox hesabınız için şifre sıfırlama isteği aldık.',
    `Yeni şifre belirlemek için: ${resetUrl}`,
    '',
    `Bu bağlantı ${expiresMinutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.`,
    'Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz.'
  ].join('\n');
}

async function findValidPasswordResetToken(token, queryable = pool, forUpdate = false) {
  if (!isPasswordResetTokenFormat(token)) return null;
  const tokenHash = hashPasswordResetToken(token);
  const lock = forUpdate ? 'FOR UPDATE' : '';
  const result = await queryable.query(
    `
    SELECT
      prt.id,
      prt.user_id,
      prt.expires_at,
      prt.used_at,
      u.email,
      u.full_name,
      u.status
    FROM password_reset_tokens prt
    JOIN app_users u ON u.id=prt.user_id
    WHERE prt.token_hash=$1
      AND prt.used_at IS NULL
      AND prt.expires_at > now()
      AND u.status='active'
    LIMIT 1
    ${lock}
    `,
    [tokenHash]
  );
  return result.rows[0] || null;
}


function slugCode(value, fallback) {
  const raw = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);

  return raw || fallback || `tenant-${Date.now()}`;
}

async function uniqueCode(tableName, baseCode, extra = {}) {
  let code = baseCode;
  let i = 1;

  while (true) {
    let row;
    if (tableName === 'customers') {
      row = await one(`SELECT id FROM customers WHERE code=$1 LIMIT 1`, [code]);
    } else if (tableName === 'sites') {
      row = await one(`SELECT id FROM sites WHERE customer_id=$1 AND code=$2 LIMIT 1`, [extra.customer_id, code]);
    } else {
      throw new Error('Unsupported uniqueCode table');
    }

    if (!row) return code;

    i += 1;
    code = `${baseCode}-${i}`;
  }
}

function defaultSiteName(customerName) {
  return `${customerName || 'Yeni Müşteri'} Ana Atölye`;
}

async function createSignupOwner({email, password, fullName, customerName, siteName}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  const cleanFullName = String(fullName || '').trim() || normalizedEmail;
  const cleanCustomerName = String(customerName || '').trim();
  const cleanSiteName = String(siteName || '').trim() || defaultSiteName(cleanCustomerName);

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Valid email required');
  }

  if (cleanPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  if (!cleanCustomerName) {
    throw new Error('Customer / company name required');
  }

  const existingUser = await one(
    `SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1`,
    [normalizedEmail]
  );

  if (existingUser) {
    const err = new Error('Email already registered');
    err.statusCode = 409;
    throw err;
  }

  const customerBaseCode = slugCode(cleanCustomerName, 'customer');
  const customerCode = await uniqueCode('customers', customerBaseCode);

  const customer = await one(
    `
    INSERT INTO customers(code,name,status)
    VALUES($1,$2,'trial')
    RETURNING id, code, name, status
    `,
    [customerCode, cleanCustomerName]
  );

  const siteBaseCode = slugCode(cleanSiteName, 'site01');
  const siteCode = await uniqueCode('sites', siteBaseCode, {customer_id:customer.id});

  const site = await one(
    `
    INSERT INTO sites(customer_id,code,name,location,status)
    VALUES($1,$2,$3,'','trial')
    RETURNING id, code, name, status
    `,
    [customer.id, siteCode, cleanSiteName]
  );

  const salt = makeSalt();
  const passwordHash = hashPassword(cleanPassword, salt);
  const userId = makeUserId();

  const user = await one(
    `
    INSERT INTO app_users(
      id,email,password_hash,password_salt,full_name,role,status,default_customer_code,default_site_code
    )
    VALUES($1,$2,$3,$4,$5,'owner','active',$6,$7)
    RETURNING *
    `,
    [userId, normalizedEmail, passwordHash, salt, cleanFullName, customer.code, site.code]
  );

  await pool.query(
    `
    INSERT INTO app_user_tenant_access(user_email,customer_code,site_code,access_role)
    VALUES($1,$2,$3,'owner')
    ON CONFLICT(user_email,customer_code,site_code) DO UPDATE SET access_role='owner'
    `,
    [user.email, customer.code, site.code]
  );

  await ensureCustomerSubscription(customer.id, 'trial');

  return {
    user,
    customer,
    site,
    tenant:await getTenantContextForUser(user),
    subscription:await getSubscriptionSnapshot(customer.code)
  };
}


async function ensureSaasFoundation() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id text PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      password_salt text NOT NULL,
      full_name text,
      role text NOT NULL DEFAULT 'owner',
      status text NOT NULL DEFAULT 'active',
      default_customer_code text,
      default_site_code text,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_tenant_access (
      id bigserial PRIMARY KEY,
      user_email text NOT NULL,
      customer_code text NOT NULL,
      site_code text,
      access_role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_email, customer_code, site_code)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_app_user_tenant_access_email
    ON app_user_tenant_access(user_email)
  `);

  const cfg = authConfig();

  if (cfg.adminEmail && cfg.adminPassword) {
    const salt = makeSalt();
    const passwordHash = hashPassword(cfg.adminPassword, salt);
    const existing = await one(`SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1`, [cfg.adminEmail]);
    const id = existing?.id || makeUserId();

    await pool.query(
      `
      INSERT INTO app_users(id,email,password_hash,password_salt,full_name,role,status,default_customer_code,default_site_code)
      VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8)
      ON CONFLICT(email) DO UPDATE SET
        password_hash=EXCLUDED.password_hash,
        password_salt=EXCLUDED.password_salt,
        role=EXCLUDED.role,
        status='active',
        default_customer_code=EXCLUDED.default_customer_code,
        default_site_code=EXCLUDED.default_site_code,
        updated_at=now()
      `,
      [id, cfg.adminEmail, passwordHash, salt, 'FactoryBox Admin', cfg.defaultRole, CFG.customerCode, CFG.siteCode]
    );

    await pool.query(
      `
      INSERT INTO app_user_tenant_access(user_email,customer_code,site_code,access_role)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(user_email,customer_code,site_code) DO UPDATE SET access_role=EXCLUDED.access_role
      `,
      [cfg.adminEmail, CFG.customerCode, CFG.siteCode, cfg.defaultRole]
    );
  }
}


const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'];

async function ensureBillingFoundation() {
  if (billingFoundationReady) return;

  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
      ALTER TABLE customers ADD CONSTRAINT customers_status_check
        CHECK (status IN ('active','passive','pilot','archived','trial','inactive','suspended'));

      ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_status_check;
      ALTER TABLE sites ADD CONSTRAINT sites_status_check
        CHECK (status IN ('active','passive','pilot','archived','trial','inactive','suspended'));
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      code text PRIMARY KEY,
      name text NOT NULL,
      description text,
      trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
      user_limit integer CHECK (user_limit IS NULL OR user_limit >= 0),
      site_limit integer CHECK (site_limit IS NULL OR site_limit >= 0),
      device_limit integer CHECK (device_limit IS NULL OR device_limit >= 0),
      monthly_price_cents integer CHECK (monthly_price_cents IS NULL OR monthly_price_cents >= 0),
      currency text NOT NULL DEFAULT 'TRY',
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      id bigserial PRIMARY KEY,
      customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
      plan_code text NOT NULL REFERENCES subscription_plans(code),
      status text NOT NULL DEFAULT 'trialing',
      starts_at timestamptz NOT NULL DEFAULT now(),
      trial_ends_at timestamptz,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancelled_at timestamptz,
      external_provider text,
      external_reference text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('trialing','active','past_due','cancelled','expired'))
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status
    ON tenant_subscriptions(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_plan_code
    ON tenant_subscriptions(plan_code)
  `);

  await pool.query(`
    INSERT INTO subscription_plans(
      code,name,description,trial_days,user_limit,site_limit,device_limit,monthly_price_cents,currency,is_active,sort_order
    ) VALUES
      ('trial','Trial','14 günlük FactoryBox deneme paketi',14,3,1,2,0,'TRY',true,10),
      ('starter','Starter','Küçük atölyeler için başlangıç paketi',0,5,2,5,NULL,'TRY',true,20),
      ('professional','Professional','Büyüyen üretim ekipleri için profesyonel paket',0,20,10,50,NULL,'TRY',true,30),
      ('enterprise','Enterprise','Kurumsal ve özel limitli paket',0,NULL,NULL,NULL,NULL,'TRY',true,40)
    ON CONFLICT(code) DO UPDATE SET
      name=EXCLUDED.name,
      description=EXCLUDED.description,
      trial_days=EXCLUDED.trial_days,
      user_limit=EXCLUDED.user_limit,
      site_limit=EXCLUDED.site_limit,
      device_limit=EXCLUDED.device_limit,
      monthly_price_cents=EXCLUDED.monthly_price_cents,
      currency=EXCLUDED.currency,
      is_active=EXCLUDED.is_active,
      sort_order=EXCLUDED.sort_order,
      updated_at=now()
  `);

  await pool.query(`
    INSERT INTO tenant_subscriptions(
      customer_id,plan_code,status,starts_at,trial_ends_at,current_period_start,current_period_end
    )
    SELECT
      c.id,
      'trial',
      'trialing',
      now(),
      now() + interval '14 days',
      now(),
      now() + interval '14 days'
    FROM customers c
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_subscriptions ts WHERE ts.customer_id=c.id
    )
  `);

  await refreshExpiredSubscriptions();
  billingFoundationReady = true;
}

async function refreshExpiredSubscriptions() {
  await pool.query(`
    UPDATE tenant_subscriptions
    SET status='expired', updated_at=now()
    WHERE status='trialing'
      AND trial_ends_at IS NOT NULL
      AND trial_ends_at < now()
  `);

  await pool.query(`
    UPDATE tenant_subscriptions
    SET status='expired', updated_at=now()
    WHERE status='active'
      AND current_period_end IS NOT NULL
      AND current_period_end < now()
  `);
}

async function ensureCustomerSubscription(customerId, planCode='trial') {
  await ensureBillingFoundation();

  const plan = await one(
    `SELECT code, trial_days FROM subscription_plans WHERE code=$1 AND is_active=true LIMIT 1`,
    [planCode]
  );

  if (!plan) throw new Error(`Subscription plan not found: ${planCode}`);

  const initialStatus = plan.code === 'trial' ? 'trialing' : 'active';
  const periodDays = plan.trial_days > 0 ? plan.trial_days : 30;

  return one(
    `
    INSERT INTO tenant_subscriptions(
      customer_id,plan_code,status,starts_at,trial_ends_at,current_period_start,current_period_end
    )
    VALUES(
      $1,$2,$3,now(),
      CASE WHEN $3='trialing' THEN now() + make_interval(days => $4) ELSE NULL END,
      now(),
      now() + make_interval(days => $4)
    )
    ON CONFLICT(customer_id) DO UPDATE SET updated_at=tenant_subscriptions.updated_at
    RETURNING *
    `,
    [customerId, plan.code, initialStatus, periodDays]
  );
}

function limitSnapshot(used, limit, reserved=0) {
  const numericUsed = Number(used || 0);
  const numericReserved = Number(reserved || 0);
  const numericLimit = limit === null || limit === undefined ? null : Number(limit);
  const effectiveUsed = numericUsed + numericReserved;

  return {
    used:numericUsed,
    reserved:numericReserved,
    effective_used:effectiveUsed,
    limit:numericLimit,
    unlimited:numericLimit === null,
    remaining:numericLimit === null ? null : Math.max(0, numericLimit - effectiveUsed),
    at_limit:numericLimit === null ? false : effectiveUsed >= numericLimit,
    exceeded:numericLimit === null ? false : numericUsed > numericLimit,
    capacity_exceeded:numericLimit === null ? false : effectiveUsed > numericLimit
  };
}

async function getSubscriptionSnapshot(customerCode, skipEnsure=false) {
  if (!skipEnsure) await ensureBillingFoundation();
  await ensureInviteSchema();
  await refreshExpiredSubscriptions();

  const row = await one(
    `
    SELECT
      c.id::text AS customer_id,
      c.code AS customer_code,
      c.name AS customer_name,
      c.status AS customer_status,
      ts.id::text AS subscription_id,
      ts.plan_code,
      ts.status,
      ts.starts_at,
      ts.trial_ends_at,
      ts.current_period_start,
      ts.current_period_end,
      ts.cancelled_at,
      ts.external_provider,
      ts.external_reference,
      ts.metadata,
      ts.created_at,
      ts.updated_at,
      p.name AS plan_name,
      p.description AS plan_description,
      p.trial_days,
      p.user_limit,
      p.site_limit,
      p.device_limit,
      p.monthly_price_cents,
      p.currency,
      (SELECT count(DISTINCT s.id)::int FROM sites s WHERE s.customer_id=c.id) AS site_count,
      (
        SELECT count(DISTINCT u.id)::int
        FROM app_user_tenant_access a
        JOIN app_users u ON lower(u.email)=lower(a.user_email)
        WHERE a.customer_code=c.code AND u.status='active'
      ) AS user_count,
      (
        SELECT count(DISTINCT lower(ui.email))::int
        FROM user_invites ui
        WHERE ui.customer_code=c.code
          AND ui.status='pending'
          AND ui.expires_at > now()
          AND NOT EXISTS (
            SELECT 1
            FROM app_user_tenant_access a2
            JOIN app_users u2 ON lower(u2.email)=lower(a2.user_email)
            WHERE a2.customer_code=c.code
              AND lower(u2.email)=lower(ui.email)
              AND u2.status='active'
          )
      ) AS pending_user_invite_count,
      (
        SELECT count(DISTINCT d.id)::int
        FROM sites s
        JOIN machines m ON m.site_id=s.id
        JOIN devices d ON d.machine_id=m.id
        WHERE s.customer_id=c.id AND d.status <> 'archived'
      ) AS device_count
    FROM customers c
    JOIN tenant_subscriptions ts ON ts.customer_id=c.id
    JOIN subscription_plans p ON p.code=ts.plan_code
    WHERE c.code=$1
    LIMIT 1
    `,
    [customerCode]
  );

  if (!row) return null;

  const usage = {
    users:limitSnapshot(row.user_count, row.user_limit, row.pending_user_invite_count),
    sites:limitSnapshot(row.site_count, row.site_limit),
    devices:limitSnapshot(row.device_count, row.device_limit)
  };

  const statusAllowsAccess = ['trialing', 'active'].includes(row.status);
  const limitExceeded = Object.values(usage).some(item => item.exceeded);

  return {
    customer:{
      id:row.customer_id,
      code:row.customer_code,
      name:row.customer_name,
      status:row.customer_status
    },
    subscription:{
      id:row.subscription_id,
      plan_code:row.plan_code,
      plan_name:row.plan_name,
      plan_description:row.plan_description,
      status:row.status,
      starts_at:row.starts_at,
      trial_ends_at:row.trial_ends_at,
      current_period_start:row.current_period_start,
      current_period_end:row.current_period_end,
      cancelled_at:row.cancelled_at,
      external_provider:row.external_provider,
      external_reference:row.external_reference,
      metadata:row.metadata,
      monthly_price_cents:row.monthly_price_cents,
      currency:row.currency,
      created_at:row.created_at,
      updated_at:row.updated_at
    },
    usage,
    access:{
      allowed:statusAllowsAccess && !limitExceeded,
      enforcement_enabled:subscriptionEnforcementEnabled(),
      status_allows_access:statusAllowsAccess,
      limit_exceeded:limitExceeded,
      quota_at_limit:Object.values(usage).some(item => item.at_limit),
      quota_capacity_exceeded:Object.values(usage).some(item => item.capacity_exceeded),
      reason:!statusAllowsAccess
        ? `subscription_status_${row.status}`
        : (limitExceeded ? 'plan_limit_exceeded' : 'ok')
    }
  };
}

function subscriptionGuardError(message, statusCode, details={}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.subscription = details.subscription || null;
  err.usage = details.usage || null;
  err.access = details.access || null;
  err.resource = details.resource || null;
  return err;
}

async function assertSubscriptionAccessForCustomer(customerCode) {
  const snapshot = await getSubscriptionSnapshot(customerCode);

  if (!snapshot) {
    throw subscriptionGuardError('Tenant subscription not found', 403, {
      access:{allowed:false, reason:'subscription_not_found'}
    });
  }

  if (!subscriptionEnforcementEnabled()) return snapshot;

  if (!snapshot.access.status_allows_access) {
    throw subscriptionGuardError(`Subscription is ${snapshot.subscription.status}`, 403, snapshot);
  }

  if (snapshot.access.limit_exceeded) {
    throw subscriptionGuardError('Plan usage limit exceeded', 403, snapshot);
  }

  return snapshot;
}

async function assertSubscriptionCapacity(customerCode, resource, additional=1, includeReserved=true) {
  const snapshot = await assertSubscriptionAccessForCustomer(customerCode);
  if (!subscriptionEnforcementEnabled()) return snapshot;

  const item = snapshot.usage?.[resource];
  if (!item) {
    throw subscriptionGuardError(`Unknown subscription resource: ${resource}`, 400, {resource});
  }

  if (item.unlimited) return snapshot;

  const projected = item.used + (includeReserved ? item.reserved : 0) + Math.max(0, Number(additional || 0));
  if (projected > item.limit) {
    throw subscriptionGuardError(`${resource} plan limit reached`, 409, {
      ...snapshot,
      resource,
      usage:{...snapshot.usage, projected:{resource, value:projected, limit:item.limit}}
    });
  }

  return snapshot;
}

async function operationalCustomerCodeForRequest(req) {
  if (req.user?.role === 'system_admin') return null;

  if (req.params?.siteCode) {
    const row = await one(`
      SELECT c.code AS customer_code
      FROM sites s
      JOIN customers c ON c.id=s.customer_id
      WHERE s.code=$1
      LIMIT 1
    `, [req.params.siteCode]);
    if (row?.customer_code) return row.customer_code;
  }

  if (req.params?.uid) {
    const row = await one(`
      SELECT c.code AS customer_code
      FROM devices d
      JOIN machines m ON m.id=d.machine_id
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE d.device_uid=$1
      LIMIT 1
    `, [req.params.uid]);
    if (row?.customer_code) return row.customer_code;
  }

  if (req.params?.code) {
    const row = await one(`
      SELECT c.code AS customer_code
      FROM machines m
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE m.code=$1
      LIMIT 1
    `, [req.params.code]);
    if (row?.customer_code) return row.customer_code;
  }

  return subscriptionCustomerCodeForRequest(req);
}

async function subscriptionAccessRequired(req, res, next) {
  try {
    if (!subscriptionEnforcementEnabled() || req.user?.role === 'system_admin') return next();

    const customerCode = await operationalCustomerCodeForRequest(req);
    const snapshot = await assertSubscriptionAccessForCustomer(customerCode);
    req.subscription = snapshot;
    return next();
  } catch(e) {
    return res.status(e.statusCode || 500).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'subscription_blocked',
      version:APP_VERSION,
      message:e.message,
      resource:e.resource || null,
      subscription:e.subscription || null,
      usage:e.usage || null,
      access:e.access || null
    });
  }
}

async function subscriptionCustomerCodeForRequest(req) {
  const requested = String(req.query?.customer_code || '').trim();
  const isSystemAdmin = req.user?.role === 'system_admin';

  if (requested && isSystemAdmin) return requested;

  const allowedCustomers = req.tenant?.customers || [];
  if (requested && allowedCustomers.some(c => c.code === requested)) return requested;

  return req.tenant?.current_customer?.code
    || req.user?.default_customer_code
    || CFG.customerCode;
}

async function getTenantContextForUser(user) {
  if (!user) {
    return {
      auth_enabled:false,
      user:null,
      current_customer:{code:CFG.customerCode, name:CFG.customerName},
      current_site:{code:CFG.siteCode, name:CFG.siteName},
      customers:[{code:CFG.customerCode, name:CFG.customerName, role:'owner'}],
      sites:[{code:CFG.siteCode, name:CFG.siteName, customer_code:CFG.customerCode, role:'owner'}]
    };
  }

  const access = await pool.query(
    `
    SELECT a.customer_code, a.site_code, a.access_role,
           c.name AS customer_name,
           s.name AS site_name
    FROM app_user_tenant_access a
    LEFT JOIN customers c ON c.code=a.customer_code
    LEFT JOIN sites s ON s.code=a.site_code AND s.customer_id=c.id
    WHERE lower(a.user_email)=lower($1)
    ORDER BY a.customer_code, a.site_code NULLS FIRST
    `,
    [user.email]
  );

  const customers = [];
  const customerSeen = new Set();
  const sites = [];
  const customerLevelAccess = [];

  for (const row of access.rows) {
    if (!customerSeen.has(row.customer_code)) {
      customerSeen.add(row.customer_code);
      customers.push({
        code:row.customer_code,
        name:row.customer_name || row.customer_code,
        role:row.access_role
      });
    }

    if (row.site_code) {
      sites.push({
        code:row.site_code,
        name:row.site_name || row.site_code,
        customer_code:row.customer_code,
        role:row.access_role
      });
    } else {
      customerLevelAccess.push(row);
    }
  }

  for (const row of customerLevelAccess) {
    const siteRows = await pool.query(
      `
      SELECT s.code, s.name, c.code AS customer_code
      FROM sites s
      JOIN customers c ON c.id=s.customer_id
      WHERE c.code=$1
      ORDER BY s.created_at ASC
      `,
      [row.customer_code]
    );

    for (const siteRow of siteRows.rows) {
      if (!sites.some(s => s.code === siteRow.code && s.customer_code === siteRow.customer_code)) {
        sites.push({
          code:siteRow.code,
          name:siteRow.name || siteRow.code,
          customer_code:siteRow.customer_code,
          role:row.access_role
        });
      }
    }
  }

  return {
    auth_enabled:true,
    user:publicUser(user),
    current_customer:customers[0] || {code:user.default_customer_code || CFG.customerCode, name:user.default_customer_code || CFG.customerName},
    current_site:sites[0] || {code:user.default_site_code || CFG.siteCode, name:user.default_site_code || CFG.siteName, customer_code:user.default_customer_code || CFG.customerCode},
    customers,
    sites
  };
}

function authRequired(req, res, next) {
  const cfg = authConfig();

  if (!cfg.enabled) {
    return next();
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({
      status:'unauthorized',
      message:'Login required',
      login_url:'/login.html'
    });
  }

  req.user = session.user;
  req.tenant = session.tenant;
  return next();
}

async function siteAccessRequired(req, res, next) {
  try {
    const cfg = authConfig();

    if (!cfg.enabled || !req.user) {
      return next();
    }

    const siteCode = req.params.siteCode;
    const allowedSites = req.tenant?.sites || [];
    const allowedCustomers = req.tenant?.customers || [];
    const hasSiteAccess = allowedSites.some(s => s.code === siteCode);
    const isSystemAdmin = req.user.role === 'system_admin';

    if (hasSiteAccess || isSystemAdmin) {
      return next();
    }

    const siteOwner = await one(
      `
      SELECT c.code AS customer_code
      FROM sites s
      JOIN customers c ON c.id=s.customer_id
      WHERE s.code=$1
      LIMIT 1
      `,
      [siteCode]
    );

    const hasCustomerLevelAccess = siteOwner
      && allowedCustomers.some(c => c.code === siteOwner.customer_code);

    if (hasCustomerLevelAccess) {
      return next();
    }

    return res.status(403).json({
      status:'forbidden',
      message:'User does not have access to this site',
      site_code:siteCode
    });
  } catch(e) {
    return res.status(500).json({status:'error', message:e.message});
  }
}

app.get('/api/auth/status', async (req,res)=>{
  const cfg = authConfig();
  res.json({
    status:'ok',
    version:APP_VERSION,
    auth:{
      enabled:cfg.enabled,
      admin_configured:Boolean(cfg.adminEmail && cfg.adminPassword),
      session_hours:cfg.sessionHours,
      signup_enabled:cfg.signupEnabled,
      password_reset_enabled:cfg.passwordResetEnabled,
      password_reset_token_minutes:cfg.passwordResetTokenMinutes,
      password_reset_email_configured:emailConfig().enabled && emailConfig().configured,
      subscription_enforcement_enabled:subscriptionEnforcementEnabled(),
      audit_export_enabled:auditExportEnabled(),
      device_provisioning_enabled:deviceProvisioningEnabled(),
      admin_dashboard_kpi_enabled:adminDashboardKpiEnabled(),
      asset_management_enabled:assetManagementEnabled(),
      live_monitoring_enabled:liveMonitoringEnabled(),
      alarm_center_enabled:alarmCenterEnabled(),
      alarm_analytics_enabled:alarmAnalyticsEnabled(),
      alarm_escalation_enabled:alarmEscalationEnabled()
    }
  });
});

app.get('/api/auth/me', async (req,res)=>{
  const cfg = authConfig();
  const session = getSession(req);

  if (!cfg.enabled) {
    return res.json({
      status:'ok',
      version:APP_VERSION,
      authenticated:false,
      auth_enabled:false,
      user:null,
      tenant:await getTenantContextForUser(null)
    });
  }

  if (!session) {
    return res.json({
      status:'ok',
      version:APP_VERSION,
      authenticated:false,
      auth_enabled:true,
      user:null,
      tenant:null
    });
  }

  res.json({
    status:'ok',
    version:APP_VERSION,
    authenticated:true,
    auth_enabled:true,
    user:publicUser(session.user),
    tenant:session.tenant,
    subscription:await getSubscriptionSnapshot(
      session.tenant?.current_customer?.code || session.user?.default_customer_code || CFG.customerCode
    ),
    expires_at:new Date(session.expires_at).toISOString()
  });
});


app.post('/api/auth/forgot-password', async (req,res)=>{
  const genericResponse = {
    status:'ok',
    version:APP_VERSION,
    message:'If an active account exists for this email, a password reset link has been sent.'
  };

  try {
    const cfg = authConfig();
    if (!cfg.passwordResetEnabled) {
      return res.status(503).json({
        status:'disabled',
        version:APP_VERSION,
        message:'Password reset is disabled'
      });
    }

    await ensurePasswordResetSchema();

    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) {
      return res.json(genericResponse);
    }

    if (!passwordResetRequestAllowed(req, email)) {
      return res.json(genericResponse);
    }

    const user = await one(
      `SELECT id, email, full_name, status FROM app_users WHERE lower(email)=lower($1) AND status='active' LIMIT 1`,
      [email]
    );

    if (!user) {
      return res.json(genericResponse);
    }

    await pool.query(
      `UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`,
      [user.id]
    );

    const rawToken = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + cfg.passwordResetTokenMinutes * 60 * 1000);

    const resetRow = await one(
      `
      INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, requested_ip)
      VALUES($1,$2,$3,$4)
      RETURNING id, user_id, expires_at, created_at
      `,
      [user.id, tokenHash, expiresAt, reqIp(req)]
    );

    const resetUrl = publicPasswordResetUrl(req, rawToken);
    let emailResult;

    try {
      emailResult = await sendReportEmail({
        to:user.email,
        subject:passwordResetEmailSubject(),
        html:passwordResetEmailHtml(user, resetUrl, cfg.passwordResetTokenMinutes),
        text:passwordResetEmailText(user, resetUrl, cfg.passwordResetTokenMinutes)
      });
    } catch(e) {
      emailResult = {sent:false, reason:e.message, message_id:null};
    }

    await pool.query(
      `
      UPDATE password_reset_tokens
      SET
        email_sent_at=CASE WHEN $2::boolean THEN now() ELSE NULL END,
        email_message_id=$3,
        email_last_error=$4
      WHERE id=$1
      `,
      [
        resetRow.id,
        Boolean(emailResult.sent),
        emailResult.message_id || null,
        emailResult.sent ? null : (emailResult.reason || 'Email could not be sent')
      ]
    );

    await writeAuditLog(req, {
      action:'request_password_reset',
      entity_type:'user',
      entity_id:user.id,
      old_values:null,
      new_values:{password_reset_requested:true, expires_at:expiresAt.toISOString()},
      metadata:{email_sent:Boolean(emailResult.sent)}
    });

    return res.json(genericResponse);
  } catch(e) {
    console.error('Password reset request failed:', e.message);
    return res.json(genericResponse);
  }
});

app.post('/api/auth/password-reset/validate', async (req,res)=>{
  try {
    const cfg = authConfig();
    if (!cfg.passwordResetEnabled) {
      return res.status(503).json({status:'disabled', version:APP_VERSION, valid:false});
    }

    await ensurePasswordResetSchema();
    const reset = await findValidPasswordResetToken(req.body?.token);

    if (!reset) {
      return res.status(400).json({
        status:'invalid',
        version:APP_VERSION,
        valid:false,
        message:'Reset link is invalid, expired, or already used'
      });
    }

    return res.json({
      status:'ok',
      version:APP_VERSION,
      valid:true,
      email_hint:maskEmail(reset.email),
      expires_at:reset.expires_at
    });
  } catch(e) {
    return res.status(500).json({status:'error', version:APP_VERSION, valid:false, message:e.message});
  }
});

app.post('/api/auth/reset-password', async (req,res)=>{
  let client;
  try {
    const cfg = authConfig();
    if (!cfg.passwordResetEnabled) {
      return res.status(503).json({status:'disabled', version:APP_VERSION, message:'Password reset is disabled'});
    }

    const token = String(req.body?.token || '');
    const password = validateNewPassword(req.body?.password);

    await ensurePasswordResetSchema();
    client = await pool.connect();
    await client.query('BEGIN');

    const reset = await findValidPasswordResetToken(token, client, true);
    if (!reset) {
      await client.query('ROLLBACK');
      client.release();
      client = null;
      return res.status(400).json({
        status:'invalid',
        version:APP_VERSION,
        message:'Reset link is invalid, expired, or already used'
      });
    }

    const salt = makeSalt();
    const passwordHash = hashPassword(password, salt);

    await client.query(
      `UPDATE app_users SET password_hash=$1, password_salt=$2, updated_at=now() WHERE id=$3`,
      [passwordHash, salt, reset.user_id]
    );

    await client.query(
      `
      UPDATE password_reset_tokens
      SET used_at=now(), used_ip=$2
      WHERE user_id=$1 AND used_at IS NULL
      `,
      [reset.user_id, reqIp(req)]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    const revokedSessions = revokeSessionsForUser(reset.user_id);

    await writeAuditLog(req, {
      action:'reset_user_password',
      entity_type:'user',
      entity_id:reset.user_id,
      old_values:null,
      new_values:{password_changed:true, sessions_revoked:revokedSessions},
      metadata:{reset_token_id:String(reset.id)}
    });

    return res.json({
      status:'ok',
      version:APP_VERSION,
      password_reset:true,
      sessions_revoked:revokedSessions,
      login_url:'/login.html'
    });
  } catch(e) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch(_) {}
      client.release();
    }
    return res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


app.post('/api/auth/signup', async (req,res)=>{
  try {
    const cfg = authConfig();

    if (!cfg.signupEnabled) {
      return res.status(403).json({
        status:'disabled',
        version:APP_VERSION,
        message:'SIGNUP_ENABLED=false'
      });
    }

    await ensureSaasFoundation();
  await ensureAuditLogSchema();
  await ensureInviteSchema();

    const created = await createSignupOwner({
      email:req.body?.email,
      password:req.body?.password,
      fullName:req.body?.full_name,
      customerName:req.body?.customer_name,
      siteName:req.body?.site_name
    });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (cfg.sessionHours * 60 * 60 * 1000);

    authSessions.set(token, {
      token,
      user:created.user,
      tenant:created.tenant,
      created_at:Date.now(),
      expires_at:expiresAt
    });

    await pool.query(`UPDATE app_users SET last_login_at=now(), updated_at=now() WHERE id=$1`, [created.user.id]);

    await writeAuditLog(req, {
      action:'signup_owner_created',
      entity_type:'user',
      entity_id:created.user.id,
      old_values:null,
      new_values:{
        user:publicUser(created.user),
        customer:created.customer,
        site:created.site
      },
      metadata:{customer_code:created.customer.code, site_code:created.site.code}
    });

    res.status(201).json({
      status:'ok',
      version:APP_VERSION,
      authenticated:true,
      token,
      user:publicUser(created.user),
      customer:created.customer,
      site:created.site,
      tenant:created.tenant,
      subscription:created.subscription,
      expires_at:new Date(expiresAt).toISOString()
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({
      status:'error',
      version:APP_VERSION,
      message:e.message
    });
  }
});


app.post('/api/auth/login', async (req,res)=>{
  try {
    const cfg = authConfig();

    if (!cfg.enabled) {
      return res.json({
        status:'ok',
        version:APP_VERSION,
        authenticated:true,
        auth_enabled:false,
        token:null,
        message:'AUTH_ENABLED=false, login bypassed for local development'
      });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({status:'error', message:'Email and password required'});
    }

    const user = await one(
      `SELECT * FROM app_users WHERE lower(email)=lower($1) AND status='active' LIMIT 1`,
      [email]
    );

    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      await writeAuditLog(req, {
        action:'login_failed',
        entity_type:'auth',
        entity_id:email,
        old_values:null,
        new_values:null,
        metadata:{email, reason:'invalid_credentials'}
      });
      return res.status(401).json({status:'unauthorized', message:'Invalid email or password'});
    }

    const tenant = await getTenantContextForUser(user);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (cfg.sessionHours * 60 * 60 * 1000);

    authSessions.set(token, {
      token,
      user,
      tenant,
      created_at:Date.now(),
      expires_at:expiresAt
    });

    await pool.query(`UPDATE app_users SET last_login_at=now(), updated_at=now() WHERE id=$1`, [user.id]);

    await writeAuditLog(req, {
      action:'login_success',
      entity_type:'user',
      entity_id:user.id,
      old_values:null,
      new_values:{last_login_at:nowIso()},
      metadata:{email:user.email, customer_code:tenant?.current_customer?.code || user.default_customer_code || null}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      authenticated:true,
      token,
      user:publicUser(user),
      tenant,
      subscription:await getSubscriptionSnapshot(
        tenant?.current_customer?.code || user.default_customer_code || CFG.customerCode
      ),
      expires_at:new Date(expiresAt).toISOString()
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.post('/api/auth/logout', async (req,res)=>{
  const token = bearerToken(req);
  const session = token ? authSessions.get(token) : null;
  if (token) authSessions.delete(token);

  if (session?.user) {
    await writeAuditLog(req, {
      action:'logout',
      entity_type:'user',
      entity_id:session.user.id,
      old_values:null,
      new_values:{logged_out:true},
      metadata:{email:session.user.email}
    });
  }

  res.json({status:'ok', version:APP_VERSION, logged_out:true});
});




app.get('/api/subscription/current', authRequired, async (req,res)=>{
  try {
    const customerCode = await subscriptionCustomerCodeForRequest(req);
    const snapshot = await getSubscriptionSnapshot(customerCode);

    if (!snapshot) {
      return res.status(404).json({
        status:'not_found',
        version:APP_VERSION,
        customer_code:customerCode
      });
    }

    res.json({status:'ok', version:APP_VERSION, ...snapshot});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/subscription/access-check', authRequired, async (req,res)=>{
  try {
    const customerCode = await subscriptionCustomerCodeForRequest(req);
    const snapshot = await getSubscriptionSnapshot(customerCode);

    if (!snapshot) {
      return res.status(404).json({
        status:'not_found',
        version:APP_VERSION,
        customer_code:customerCode,
        access:{allowed:false, reason:'subscription_not_found'}
      });
    }

    res.status(snapshot.access.allowed ? 200 : 403).json({
      status:snapshot.access.allowed ? 'ok' : 'subscription_blocked',
      version:APP_VERSION,
      customer:snapshot.customer,
      subscription:snapshot.subscription,
      usage:snapshot.usage,
      access:snapshot.access
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


app.get('/api/subscription/quota-check/:resource', authRequired, async (req,res)=>{
  try {
    const resource = validateChoice(req.params.resource, ['users','sites','devices'], 'resource');
    const requestedAdditional = Number(req.query.additional ?? 1);
    const additional = Number.isFinite(requestedAdditional) ? Math.max(0, requestedAdditional) : 1;
    const customerCode = await subscriptionCustomerCodeForRequest(req);
    const snapshot = await assertSubscriptionCapacity(customerCode, resource, additional, true);

    res.json({
      status:'ok',
      version:APP_VERSION,
      resource,
      additional,
      customer:snapshot.customer,
      subscription:snapshot.subscription,
      usage:snapshot.usage,
      access:snapshot.access
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'error',
      version:APP_VERSION,
      message:e.message,
      resource:e.resource || req.params.resource,
      subscription:e.subscription || null,
      usage:e.usage || null,
      access:e.access || null
    });
  }
});

function adminRequired(req, res, next) {
  const cfg = authConfig();

  if (!cfg.enabled) {
    return next();
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({
      status:'unauthorized',
      message:'Login required'
    });
  }

  const role = session.user?.role || '';
  if (!['owner', 'admin', 'system_admin'].includes(role)) {
    return res.status(403).json({
      status:'forbidden',
      message:'Admin access required'
    });
  }

  req.user = session.user;
  req.tenant = session.tenant;
  req.permissions = publicPermissions(session.user);
  return next();
}



const ASSET_CUSTOMER_STATUSES = ['trial','pilot','active','inactive','suspended','passive','archived'];
const ASSET_SITE_STATUSES = ['trial','pilot','active','inactive','suspended','passive','archived'];
const ASSET_MACHINE_STATUSES = ['active','passive','maintenance','archived'];

async function ensureAssetManagementFoundation() {
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_status_check;
      ALTER TABLE machines ADD CONSTRAINT machines_status_check
        CHECK (status IN ('active','passive','maintenance','archived'));
    END $$;
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customers_code_status ON customers(code, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sites_customer_status ON sites(customer_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_machines_site_status ON machines(site_id, status)`);
}

function normalizeAssetCode(value, label) {
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${label} is required`);
    err.statusCode = 400;
    throw err;
  }
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(v)) {
    const err = new Error(`${label} must be 2-64 chars and contain only letters, numbers, dash or underscore`);
    err.statusCode = 400;
    throw err;
  }
  return v.toLowerCase();
}

function cleanAssetName(value, label, maxLen=160) {
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${label} is required`);
    err.statusCode = 400;
    throw err;
  }
  return v.slice(0, maxLen);
}

function cleanOptionalText(value, maxLen=200) {
  const v = String(value || '').trim();
  return v ? v.slice(0, maxLen) : null;
}

async function machineAssetRows(limit=300) {
  const safeLimit = Math.min(Math.max(Number(limit || 300), 1), 500);
  const result = await pool.query(`
    SELECT
      m.id::text,
      m.code,
      m.name,
      m.machine_type,
      m.status,
      s.code AS site_code,
      s.name AS site_name,
      c.code AS customer_code,
      c.name AS customer_name,
      m.created_at,
      m.updated_at,
      count(DISTINCT d.id)::int AS device_count,
      (count(DISTINCT a.id) FILTER (WHERE a.status='active'))::int AS active_alarm_count
    FROM machines m
    JOIN sites s ON s.id=m.site_id
    JOIN customers c ON c.id=s.customer_id
    LEFT JOIN devices d ON d.machine_id=m.id
    LEFT JOIN alarms a ON a.machine_id=m.id
    GROUP BY m.id, m.code, m.name, m.machine_type, m.status, s.code, s.name, c.code, c.name, m.created_at, m.updated_at
    ORDER BY c.code, s.code, m.code
    LIMIT $1
  `, [safeLimit]);
  return result.rows;
}

app.get('/api/admin/overview', adminRequired, async (req,res)=>{
  try {
    const counts = await one(`
      SELECT
        (SELECT count(*)::int FROM customers) AS customers,
        (SELECT count(*)::int FROM sites) AS sites,
        (SELECT count(*)::int FROM machines) AS machines,
        (SELECT count(*)::int FROM devices) AS devices,
        (SELECT count(*)::int FROM devices WHERE provisioning_status='pending') AS pending_devices,
        (SELECT count(*)::int FROM devices WHERE provisioning_status='paired') AS paired_devices,
        (SELECT count(*)::int FROM app_users) AS users,
        (SELECT count(*)::int FROM app_user_tenant_access) AS tenant_access,
        (SELECT count(*)::int FROM ai_reports) AS ai_reports,
        (SELECT count(*)::int FROM alarms WHERE status='active') AS active_alarms,
        (SELECT count(*)::int FROM admin_audit_logs) AS audit_logs,
        (SELECT count(*)::int FROM admin_audit_logs WHERE created_at >= now() - interval '24 hours') AS audit_logs_24h,
        (SELECT count(*)::int FROM admin_audit_logs WHERE action IN ('login_success','login_failed','logout','request_password_reset','reset_user_password','signup_owner_created')) AS security_events,
        (SELECT count(*)::int FROM admin_audit_logs WHERE action='login_failed' AND created_at >= now() - interval '24 hours') AS failed_logins_24h,
        (SELECT count(*)::int FROM user_invites) AS invites,
        (SELECT count(*)::int FROM subscription_plans WHERE is_active=true) AS subscription_plans,
        (SELECT count(*)::int FROM tenant_subscriptions) AS subscriptions,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status='trialing') AS trialing_subscriptions,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status='active') AS active_subscriptions,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status IN ('past_due','cancelled','expired')) AS blocked_subscriptions
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      subscription_enforcement_enabled:subscriptionEnforcementEnabled(),
      audit_export_enabled:auditExportEnabled(),
      device_provisioning_enabled:deviceProvisioningEnabled(),
      asset_management_enabled:assetManagementEnabled(),
      live_monitoring_enabled:liveMonitoringEnabled(),
      alarm_center_enabled:alarmCenterEnabled(),
      alarm_analytics_enabled:alarmAnalyticsEnabled(),
      counts
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }

});

app.get('/api/admin/dashboard-summary', adminRequired, async (req,res)=>{
  try {
    const counts = await one(`
      SELECT
        (SELECT count(*)::int FROM customers) AS customers,
        (SELECT count(*)::int FROM sites) AS sites,
        (SELECT count(*)::int FROM machines) AS machines,
        (SELECT count(*)::int FROM devices) AS devices,
        (SELECT count(*)::int FROM devices WHERE status='online') AS online_devices,
        (SELECT count(*)::int FROM devices WHERE status='offline') AS offline_devices,
        (SELECT count(*)::int FROM devices WHERE status IN ('unknown','maintenance','archived')) AS other_devices,
        (SELECT count(*)::int FROM devices WHERE provisioning_status='pending') AS pending_devices,
        (SELECT count(*)::int FROM devices WHERE provisioning_status='paired') AS paired_devices,
        (SELECT count(*)::int FROM app_users) AS users,
        (SELECT count(*)::int FROM app_users WHERE status='active') AS active_users,
        (SELECT count(*)::int FROM user_invites WHERE status='pending') AS pending_invites,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status='trialing') AS trialing_subscriptions,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status='active') AS active_subscriptions,
        (SELECT count(*)::int FROM tenant_subscriptions WHERE status IN ('past_due','cancelled','expired')) AS blocked_subscriptions,
        (SELECT count(*)::int FROM admin_audit_logs WHERE created_at >= now() - interval '24 hours') AS audit_logs_24h,
        (SELECT count(*)::int FROM admin_audit_logs WHERE action='login_failed' AND created_at >= now() - interval '24 hours') AS failed_logins_24h,
        (SELECT count(*)::int FROM alarms WHERE status='active') AS active_alarms
    `);

    const subscriptionsByStatus = await pool.query(`
      SELECT status, count(*)::int AS count
      FROM tenant_subscriptions
      GROUP BY status
      ORDER BY status
    `);

    const devicesByStatus = await pool.query(`
      SELECT COALESCE(status, 'unknown') AS status, count(*)::int AS count
      FROM devices
      GROUP BY COALESCE(status, 'unknown')
      ORDER BY status
    `);

    const devicesByProvisioning = await pool.query(`
      SELECT COALESCE(provisioning_status, 'unknown') AS status, count(*)::int AS count
      FROM devices
      GROUP BY COALESCE(provisioning_status, 'unknown')
      ORDER BY status
    `);

    const usersByRole = await pool.query(`
      SELECT role, count(*)::int AS count
      FROM app_users
      GROUP BY role
      ORDER BY role
    `);

    const latestAudit = await pool.query(`
      SELECT created_at, actor_email, actor_role, action, entity_type, entity_id
      FROM admin_audit_logs
      ORDER BY created_at DESC
      LIMIT 8
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      kpi_enabled:adminDashboardKpiEnabled(),
      generated_at:new Date().toISOString(),
      counts,
      subscriptions_by_status:subscriptionsByStatus.rows,
      devices_by_status:devicesByStatus.rows,
      devices_by_provisioning:devicesByProvisioning.rows,
      users_by_role:usersByRole.rows,
      latest_audit:latestAudit.rows,
      alerts:{
        blocked_subscriptions:counts.blocked_subscriptions || 0,
        failed_logins_24h:counts.failed_logins_24h || 0,
        active_alarms:counts.active_alarms || 0,
        offline_devices:counts.offline_devices || 0
      }
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});



async function ensureLiveMonitoringFoundation() {
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_events_machine_ts_desc
    ON telemetry_events(machine_id, event_ts DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_machine_state_events_machine_started_desc
    ON machine_state_events(machine_id, started_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarms_machine_status_started
    ON alarms(machine_id, status, started_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_machine_status_seen
    ON devices(machine_id, status, last_seen_at DESC)
  `);
}

function classifyLiveMachine(row) {
  const activeAlarms = Number(row.active_alarm_count || 0);
  const deviceCount = Number(row.device_count || 0);
  const onlineDevices = Number(row.online_device_count || 0);
  const rawSignalAge = Number(row.signal_age_sec);
  const signalAge = Number.isFinite(rawSignalAge) ? rawSignalAge : 999999;
  const staleThresholdSec = Number(process.env.LIVE_MONITORING_STALE_SECONDS || 300);
  const machineStatus = String(row.machine_status || '').toLowerCase();
  const latestState = String(row.latest_state || '').toUpperCase();

  // v5.11.1: Machine status ile canlı bağlantı sağlığı ayrıldı.
  // Öncelik: cihaz yok / bağlantı eski / bakım / alarm / çalışma durumu.
  if (deviceCount === 0) return 'no_device';
  if (machineStatus === 'archived') return 'archived';
  if (onlineDevices === 0) return 'offline';
  if (signalAge > staleThresholdSec) return 'stale';
  if (machineStatus === 'maintenance') return 'maintenance';
  if (activeAlarms > 0) return 'alarm';
  if (latestState === 'RUNNING') return 'running';
  if (latestState === 'STOPPED') return 'stopped';
  return 'online';
}

function liveMachineSummary(rows) {
  const summary = {
    total: rows.length,
    running: 0,
    stopped: 0,
    online: 0,
    offline: 0,
    stale: 0,
    alarm: 0,
    maintenance: 0,
    no_device: 0,
    archived: 0
  };

  for (const row of rows) {
    const key = summary[row.health] === undefined ? 'online' : row.health;
    summary[key] += 1;
  }

  return summary;
}

app.get('/api/admin/live-monitoring', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureLiveMonitoringFoundation();
    await ensureDeviceInfoSyncSchema();

    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 300);
    const result = await pool.query(`
      WITH latest_telemetry AS (
        SELECT DISTINCT ON (machine_id)
          machine_id,
          event_ts,
          current_amp,
          temperature_c,
          wifi_rssi,
          uptime_ms,
          alarm_active
        FROM telemetry_events
        ORDER BY machine_id, event_ts DESC
      ),
      latest_state AS (
        SELECT DISTINCT ON (machine_id)
          machine_id,
          state,
          started_at,
          duration_sec
        FROM machine_state_events
        ORDER BY machine_id, started_at DESC
      ),
      device_rollup AS (
        SELECT
          machine_id,
          count(*)::int AS device_count,
          (count(*) FILTER (WHERE status='online'))::int AS online_device_count,
          max(last_seen_at) AS last_seen_at,
          max(updated_at) AS last_device_update_at,
          max(firmware_version) AS firmware_version,
          string_agg(DISTINCT COALESCE(status,'unknown'), ', ' ORDER BY COALESCE(status,'unknown')) AS device_statuses
        FROM devices
        GROUP BY machine_id
      ),
      alarm_rollup AS (
        SELECT
          machine_id,
          (count(*) FILTER (WHERE status='active'))::int AS active_alarm_count,
          max(started_at) FILTER (WHERE status='active') AS latest_alarm_at
        FROM alarms
        GROUP BY machine_id
      )
      SELECT
        m.id::text AS machine_id,
        m.code AS machine_code,
        m.name AS machine_name,
        m.machine_type,
        m.status AS machine_status,
        s.code AS site_code,
        s.name AS site_name,
        c.code AS customer_code,
        c.name AS customer_name,
        COALESCE(dr.device_count, 0)::int AS device_count,
        COALESCE(dr.online_device_count, 0)::int AS online_device_count,
        COALESCE(dr.device_statuses, '-') AS device_statuses,
        dr.firmware_version,
        dr.last_seen_at,
        lt.event_ts AS latest_telemetry_at,
        lt.current_amp,
        lt.temperature_c,
        lt.wifi_rssi,
        lt.uptime_ms,
        lt.alarm_active,
        ls.state AS latest_state,
        ls.started_at AS state_started_at,
        ls.duration_sec AS state_duration_sec,
        COALESCE(ar.active_alarm_count, 0)::int AS active_alarm_count,
        ar.latest_alarm_at,
        GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(lt.event_ts, dr.last_seen_at, dr.last_device_update_at, m.updated_at, m.created_at)))::int) AS signal_age_sec
      FROM machines m
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN latest_telemetry lt ON lt.machine_id=m.id
      LEFT JOIN latest_state ls ON ls.machine_id=m.id
      LEFT JOIN device_rollup dr ON dr.machine_id=m.id
      LEFT JOIN alarm_rollup ar ON ar.machine_id=m.id
      ORDER BY c.code, s.code, m.code
      LIMIT $1
    `, [limit]);

    const machines = result.rows.map(row => {
      const health = classifyLiveMachine(row);
      const activeAlarmCount = Number(row.active_alarm_count || 0);
      const connectionIssue = ['stale', 'offline', 'no_device'].includes(health);

      return {
        ...row,
        health,
        connection_health: health,
        visible_active_alarm_count: connectionIssue ? 0 : activeAlarmCount,
        has_stale_alarm: connectionIssue && activeAlarmCount > 0,
        live_status_note: connectionIssue && activeAlarmCount > 0
          ? 'Bağlantı eski/kopuk; aktif alarm kaydı eski olabilir.'
          : ''
      };
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      live_monitoring_enabled:liveMonitoringEnabled(),
      alarm_center_enabled:alarmCenterEnabled(),
      generated_at:new Date().toISOString(),
      summary:liveMachineSummary(machines),
      machines
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


async function ensureAlarmCenterFoundation() {
  await pool.query(`
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS acknowledged_by text;
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS acknowledge_note text;
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS cleared_by text;
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS clear_note text;
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS updated_at timestamptz;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarms_status_started_desc
    ON alarms(status, started_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarms_machine_started_desc
    ON alarms(machine_id, started_at DESC)
  `);
}

function alarmLimit(raw, fallback = 100, max = 500) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function parseAlarmDate(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const suffix = endOfDay ? 'T23:59:59' : 'T00:00:00';
  const date = new Date(raw.length <= 10 ? `${raw}${suffix}` : raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

app.get('/api/admin/alarm-center', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmCenterFoundation();

    const limit = alarmLimit(req.query.limit, 100, 500);
    const params = [];
    const where = [];

    const status = String(req.query.status || 'active').trim();
    if (status && status !== 'all') {
      params.push(status);
      where.push(`a.status=$${params.length}`);
    }

    const severity = String(req.query.severity || '').trim();
    if (severity && severity !== 'all') {
      params.push(severity);
      where.push(`a.severity=$${params.length}`);
    }

    const machineCode = String(req.query.machine_code || '').trim();
    if (machineCode) {
      params.push(machineCode);
      where.push(`m.code=$${params.length}`);
    }

    const fromDate = parseAlarmDate(req.query.from, false);
    if (fromDate) {
      params.push(fromDate.toISOString());
      where.push(`a.started_at >= $${params.length}`);
    }

    const toDate = parseAlarmDate(req.query.to, true);
    if (toDate) {
      params.push(toDate.toISOString());
      where.push(`a.started_at <= $${params.length}`);
    }

    const search = String(req.query.q || '').trim();
    if (search) {
      params.push(`%${search}%`);
      where.push(`(a.alarm_type ILIKE $${params.length} OR a.message ILIKE $${params.length} OR m.code ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const summary = await one(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status='active')::int AS active,
        count(*) FILTER (WHERE status='cleared')::int AS cleared,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND status='active')::int AS acknowledged,
        count(*) FILTER (WHERE severity='critical')::int AS critical,
        count(*) FILTER (WHERE severity='warning')::int AS warning
      FROM alarms
    `);

    params.push(limit);

    const result = await pool.query(`
      SELECT
        a.id::text,
        a.alarm_type,
        a.severity,
        a.status,
        a.started_at,
        a.cleared_at,
        a.acknowledged_at,
        a.acknowledged_by,
        a.acknowledge_note,
        a.cleared_by,
        a.clear_note,
        a.message,
        m.code AS machine_code,
        m.name AS machine_name,
        s.code AS site_code,
        c.code AS customer_code
      FROM alarms a
      LEFT JOIN machines m ON m.id=a.machine_id
      LEFT JOIN sites s ON s.id=m.site_id
      LEFT JOIN customers c ON c.id=s.customer_id
      ${whereSql}
      ORDER BY a.started_at DESC
      LIMIT $${params.length}
    `, params);

    res.json({
      status:'ok',
      version:APP_VERSION,
      alarm_center_enabled:alarmCenterEnabled(),
      generated_at:new Date().toISOString(),
      summary:summary || {},
      alarms:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/alarms/:id/acknowledge', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmCenterFoundation();

    const id = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim();
    const actor = req.user || getSession(req)?.user || null;

    const oldAlarm = await one(`SELECT * FROM alarms WHERE id=$1`, [id]);
    if (!oldAlarm) return res.status(404).json({status:'not_found', message:'Alarm not found'});

    const updated = await one(`
      UPDATE alarms
      SET acknowledged_at=COALESCE(acknowledged_at, now()),
          acknowledged_by=$2,
          acknowledge_note=NULLIF($3,''),
          updated_at=now()
      WHERE id=$1
      RETURNING *
    `, [id, actor?.email || 'admin', note]);

    await writeAuditLog(req, {
      action:'acknowledge_alarm',
      entity_type:'alarm',
      entity_id:id,
      old_values:oldAlarm,
      new_values:updated,
      metadata:{machine_id:String(updated.machine_id || ''), alarm_type:updated.alarm_type}
    });

    res.json({status:'ok', version:APP_VERSION, alarm:updated});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/alarms/:id/clear', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmCenterFoundation();

    const id = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim();
    const actor = req.user || getSession(req)?.user || null;

    const oldAlarm = await one(`SELECT * FROM alarms WHERE id=$1`, [id]);
    if (!oldAlarm) return res.status(404).json({status:'not_found', message:'Alarm not found'});

    const updated = await one(`
      UPDATE alarms
      SET status='cleared',
          cleared_at=COALESCE(cleared_at, now()),
          cleared_by=$2,
          clear_note=NULLIF($3,''),
          updated_at=now()
      WHERE id=$1
      RETURNING *
    `, [id, actor?.email || 'admin', note]);

    await writeAuditLog(req, {
      action:'clear_alarm',
      entity_type:'alarm',
      entity_id:id,
      old_values:oldAlarm,
      new_values:updated,
      metadata:{machine_id:String(updated.machine_id || ''), alarm_type:updated.alarm_type}
    });

    res.json({status:'ok', version:APP_VERSION, alarm:updated});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


function alarmAnalyticsDays(raw, fallback = 7, max = 90) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function alarmAnalyticsLimit(raw, fallback = 8, max = 25) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

app.get('/api/admin/alarm-analytics', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmCenterFoundation();

    const days = alarmAnalyticsDays(req.query.days, 7, 90);
    const limit = alarmAnalyticsLimit(req.query.limit, 8, 25);

    const summary = await one(`
      SELECT
        count(*) FILTER (WHERE started_at >= now() - ($1::int * interval '1 day'))::int AS total_in_window,
        count(*) FILTER (WHERE status='active')::int AS active,
        count(*) FILTER (WHERE status='active' AND acknowledged_at IS NULL)::int AS unacknowledged_active,
        count(*) FILTER (WHERE status='active' AND acknowledged_at IS NOT NULL)::int AS acknowledged_active,
        count(*) FILTER (WHERE status='active' AND severity='critical')::int AS critical_active,
        count(*) FILTER (WHERE status='cleared' AND cleared_at >= now() - ($1::int * interval '1 day'))::int AS cleared_in_window,
        ROUND((AVG(EXTRACT(EPOCH FROM (acknowledged_at - started_at)) / 60.0)
          FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at >= started_at
            AND started_at >= now() - ($1::int * interval '1 day')))::numeric, 1) AS avg_ack_minutes,
        ROUND((AVG(EXTRACT(EPOCH FROM (cleared_at - started_at)) / 60.0)
          FILTER (WHERE cleared_at IS NOT NULL AND cleared_at >= started_at
            AND started_at >= now() - ($1::int * interval '1 day')))::numeric, 1) AS avg_resolution_minutes,
        min(started_at) FILTER (WHERE status='active') AS oldest_active_started_at
      FROM alarms
    `, [days]);

    const daily = await pool.query(`
      WITH days AS (
        SELECT generate_series(
          current_date - ($1::int - 1),
          current_date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        count(a.id)::int AS total,
        count(a.id) FILTER (WHERE a.severity='critical')::int AS critical,
        count(a.id) FILTER (WHERE a.severity='warning')::int AS warning,
        count(a.id) FILTER (WHERE a.status='cleared')::int AS cleared
      FROM days d
      LEFT JOIN alarms a
        ON a.started_at >= d.day
       AND a.started_at < d.day + interval '1 day'
      GROUP BY d.day
      ORDER BY d.day
    `, [days]);

    const topTypes = await pool.query(`
      SELECT
        COALESCE(NULLIF(alarm_type, ''), 'unknown') AS alarm_type,
        count(*)::int AS count,
        count(*) FILTER (WHERE severity='critical')::int AS critical_count,
        count(*) FILTER (WHERE status='active')::int AS active_count
      FROM alarms
      WHERE started_at >= now() - ($1::int * interval '1 day')
      GROUP BY COALESCE(NULLIF(alarm_type, ''), 'unknown')
      ORDER BY count(*) DESC, alarm_type
      LIMIT $2
    `, [days, limit]);

    const topMachines = await pool.query(`
      SELECT
        COALESCE(m.code, 'unassigned') AS machine_code,
        COALESCE(m.name, 'Unassigned') AS machine_name,
        COALESCE(s.code, '-') AS site_code,
        COALESCE(c.code, '-') AS customer_code,
        count(a.id)::int AS alarm_count,
        count(a.id) FILTER (WHERE a.severity='critical')::int AS critical_count,
        count(a.id) FILTER (WHERE a.status='active')::int AS active_count
      FROM alarms a
      LEFT JOIN machines m ON m.id=a.machine_id
      LEFT JOIN sites s ON s.id=m.site_id
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE a.started_at >= now() - ($1::int * interval '1 day')
      GROUP BY m.code, m.name, s.code, c.code
      ORDER BY count(a.id) DESC, machine_code
      LIMIT $2
    `, [days, limit]);

    const responseBuckets = await one(`
      SELECT
        count(*) FILTER (WHERE acknowledged_at IS NULL)::int AS not_acknowledged,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at - started_at <= interval '5 minutes')::int AS under_5m,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at - started_at > interval '5 minutes' AND acknowledged_at - started_at <= interval '15 minutes')::int AS from_5_to_15m,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at - started_at > interval '15 minutes' AND acknowledged_at - started_at <= interval '60 minutes')::int AS from_15_to_60m,
        count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND acknowledged_at - started_at > interval '60 minutes')::int AS over_60m
      FROM alarms
      WHERE started_at >= now() - ($1::int * interval '1 day')
    `, [days]);

    res.json({
      status:'ok',
      version:APP_VERSION,
      alarm_analytics_enabled:alarmAnalyticsEnabled(),
      generated_at:new Date().toISOString(),
      window_days:days,
      summary:summary || {},
      response_buckets:responseBuckets || {},
      daily:daily.rows,
      top_alarm_types:topTypes.rows,
      top_machines:topMachines.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});



async function ensureAlarmEscalationFoundation() {
  await ensureAlarmCenterFoundation();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarm_escalation_rules (
      id bigserial PRIMARY KEY,
      rule_key text NOT NULL UNIQUE,
      name text NOT NULL,
      customer_code text,
      site_code text,
      machine_code text,
      alarm_type text,
      severity text NOT NULL DEFAULT 'all',
      acknowledge_sla_minutes integer NOT NULL DEFAULT 15,
      resolve_sla_minutes integer NOT NULL DEFAULT 120,
      escalation_channel text NOT NULL DEFAULT 'dashboard',
      recipients text,
      priority integer NOT NULL DEFAULT 100,
      enabled boolean NOT NULL DEFAULT true,
      is_system boolean NOT NULL DEFAULT false,
      created_by text,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (severity IN ('all','critical','warning','info')),
      CHECK (acknowledge_sla_minutes BETWEEN 1 AND 10080),
      CHECK (resolve_sla_minutes BETWEEN 1 AND 43200),
      CHECK (priority BETWEEN 0 AND 1000)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_escalation_rules_enabled_priority
    ON alarm_escalation_rules(enabled, priority DESC)
  `);

  await pool.query(`
    INSERT INTO alarm_escalation_rules(
      rule_key,name,severity,acknowledge_sla_minutes,resolve_sla_minutes,
      escalation_channel,priority,enabled,is_system,created_by,updated_by
    ) VALUES
      ('system-critical','Critical Alarm SLA','critical',5,30,'dashboard',300,true,true,'system','system'),
      ('system-warning','Warning Alarm SLA','warning',15,120,'dashboard',200,true,true,'system','system'),
      ('system-info','Info Alarm SLA','info',60,480,'dashboard',100,true,true,'system','system')
    ON CONFLICT(rule_key) DO NOTHING
  `);
}

function alarmSlaMinutes(raw, fallback, max) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function alarmRuleText(raw, max = 120) {
  const value = String(raw || '').trim();
  return value ? value.slice(0, max) : null;
}

function alarmRuleSeverity(raw) {
  const value = String(raw || 'all').trim().toLowerCase();
  return ['all','critical','warning','info'].includes(value) ? value : 'all';
}

function alarmRulePriority(raw, fallback = 100) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 0), 1000);
}

function alarmRuleMatches(rule, alarm) {
  let score = Number(rule.priority || 0);

  const checks = [
    ['customer_code', 1],
    ['site_code', 2],
    ['machine_code', 4],
    ['alarm_type', 8]
  ];

  for (const [field, weight] of checks) {
    const wanted = String(rule[field] || '').trim().toLowerCase();
    if (!wanted) continue;
    const actual = String(alarm[field] || '').trim().toLowerCase();
    if (wanted !== actual) return -1;
    score += weight * 10000;
  }

  const severity = String(rule.severity || 'all').toLowerCase();
  if (severity !== 'all') {
    if (severity !== String(alarm.severity || '').toLowerCase()) return -1;
    score += 16 * 10000;
  }

  return score;
}

function alarmSlaStatus(alarm, rule, nowMs = Date.now()) {
  if (!rule) {
    return {
      ...alarm,
      rule_id:null,
      rule_name:null,
      acknowledge_sla_minutes:null,
      resolve_sla_minutes:null,
      age_minutes:Math.max(0, Math.round((nowMs - new Date(alarm.started_at).getTime()) / 60000)),
      ack_due_at:null,
      resolve_due_at:null,
      ack_overdue:false,
      resolve_overdue:false,
      sla_status:'no_rule'
    };
  }

  const startedMs = new Date(alarm.started_at).getTime();
  const ageMinutes = Math.max(0, (nowMs - startedMs) / 60000);
  const ackLimit = Number(rule.acknowledge_sla_minutes || 0);
  const resolveLimit = Number(rule.resolve_sla_minutes || 0);
  const ackOverdue = !alarm.acknowledged_at && ageMinutes > ackLimit;
  const resolveOverdue = ageMinutes > resolveLimit;
  const status = resolveOverdue ? 'resolve_overdue' : (ackOverdue ? 'ack_overdue' : 'within_sla');

  return {
    ...alarm,
    rule_id:String(rule.id),
    rule_name:rule.name,
    escalation_channel:rule.escalation_channel,
    recipients:rule.recipients,
    acknowledge_sla_minutes:ackLimit,
    resolve_sla_minutes:resolveLimit,
    age_minutes:Math.round(ageMinutes * 10) / 10,
    ack_due_at:new Date(startedMs + ackLimit * 60000).toISOString(),
    resolve_due_at:new Date(startedMs + resolveLimit * 60000).toISOString(),
    ack_overdue:ackOverdue,
    resolve_overdue:resolveOverdue,
    sla_status:status
  };
}

app.get('/api/admin/alarm-escalation', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();

    const rulesResult = await pool.query(`
      SELECT *
      FROM alarm_escalation_rules
      ORDER BY priority DESC, is_system DESC, id ASC
    `);

    const activeResult = await pool.query(`
      SELECT
        a.id::text,
        a.alarm_type,
        a.severity,
        a.status,
        a.started_at,
        a.acknowledged_at,
        a.acknowledged_by,
        a.message,
        m.code AS machine_code,
        m.name AS machine_name,
        s.code AS site_code,
        c.code AS customer_code
      FROM alarms a
      LEFT JOIN machines m ON m.id=a.machine_id
      LEFT JOIN sites s ON s.id=m.site_id
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE a.status='active'
      ORDER BY a.started_at ASC
      LIMIT 500
    `);

    const enabledRules = rulesResult.rows.filter(rule => rule.enabled);
    const nowMs = Date.now();
    const activeAlarms = activeResult.rows.map(alarm => {
      let selected = null;
      let selectedScore = -1;
      for (const rule of enabledRules) {
        const score = alarmRuleMatches(rule, alarm);
        if (score > selectedScore) {
          selected = rule;
          selectedScore = score;
        }
      }
      return alarmSlaStatus(alarm, selected, nowMs);
    }).sort((a,b) => {
      const rank = {resolve_overdue:0, ack_overdue:1, within_sla:2, no_rule:3};
      return (rank[a.sla_status] ?? 9) - (rank[b.sla_status] ?? 9) || Number(b.age_minutes || 0) - Number(a.age_minutes || 0);
    });

    const summary = activeAlarms.reduce((acc,row)=>{
      acc.active += 1;
      acc[row.sla_status] = (acc[row.sla_status] || 0) + 1;
      if (row.severity === 'critical') acc.critical_active += 1;
      return acc;
    }, {active:0, critical_active:0, within_sla:0, ack_overdue:0, resolve_overdue:0, no_rule:0});

    const actor = req.user || getSession(req)?.user || null;
    res.json({
      status:'ok',
      version:APP_VERSION,
      alarm_escalation_enabled:alarmEscalationEnabled(),
      can_manage_rules:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
      generated_at:new Date().toISOString(),
      summary,
      rules:rulesResult.rows,
      active_alarms:activeAlarms
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/alarm-escalation/rules', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();
    const actor = req.user || getSession(req)?.user || null;
    const name = alarmRuleText(req.body?.name, 100);
    if (!name) return res.status(400).json({status:'invalid_request', message:'Rule name is required'});

    const ackMinutes = alarmSlaMinutes(req.body?.acknowledge_sla_minutes, 15, 10080);
    const resolveMinutes = alarmSlaMinutes(req.body?.resolve_sla_minutes, 120, 43200);
    if (resolveMinutes < ackMinutes) {
      return res.status(400).json({status:'invalid_request', message:'Resolve SLA must be equal to or greater than acknowledge SLA'});
    }

    const ruleKey = `custom-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const created = await one(`
      INSERT INTO alarm_escalation_rules(
        rule_key,name,customer_code,site_code,machine_code,alarm_type,severity,
        acknowledge_sla_minutes,resolve_sla_minutes,escalation_channel,recipients,
        priority,enabled,is_system,created_by,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false,$13,$13)
      RETURNING *
    `, [
      ruleKey,
      name,
      alarmRuleText(req.body?.customer_code, 80),
      alarmRuleText(req.body?.site_code, 80),
      alarmRuleText(req.body?.machine_code, 80),
      alarmRuleText(req.body?.alarm_type, 100),
      alarmRuleSeverity(req.body?.severity),
      ackMinutes,
      resolveMinutes,
      alarmRuleText(req.body?.escalation_channel, 40) || 'dashboard',
      alarmRuleText(req.body?.recipients, 500),
      alarmRulePriority(req.body?.priority, 500),
      actor?.email || 'admin'
    ]);

    await writeAuditLog(req, {
      action:'create_alarm_escalation_rule',
      entity_type:'alarm_escalation_rule',
      entity_id:String(created.id),
      old_values:null,
      new_values:created,
      metadata:{rule_key:created.rule_key}
    });

    res.status(201).json({status:'ok', version:APP_VERSION, rule:created});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.patch('/api/admin/alarm-escalation/rules/:id', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();
    const id = String(req.params.id || '').trim();
    const oldRule = await one(`SELECT * FROM alarm_escalation_rules WHERE id=$1`, [id]);
    if (!oldRule) return res.status(404).json({status:'not_found', message:'Alarm escalation rule not found'});

    const actor = req.user || getSession(req)?.user || null;
    const ackMinutes = alarmSlaMinutes(req.body?.acknowledge_sla_minutes, oldRule.acknowledge_sla_minutes, 10080);
    const resolveMinutes = alarmSlaMinutes(req.body?.resolve_sla_minutes, oldRule.resolve_sla_minutes, 43200);
    if (resolveMinutes < ackMinutes) {
      return res.status(400).json({status:'invalid_request', message:'Resolve SLA must be equal to or greater than acknowledge SLA'});
    }

    const updated = await one(`
      UPDATE alarm_escalation_rules
      SET name=$2,
          customer_code=$3,
          site_code=$4,
          machine_code=$5,
          alarm_type=$6,
          severity=$7,
          acknowledge_sla_minutes=$8,
          resolve_sla_minutes=$9,
          escalation_channel=$10,
          recipients=$11,
          priority=$12,
          enabled=$13,
          updated_by=$14,
          updated_at=now()
      WHERE id=$1
      RETURNING *
    `, [
      id,
      alarmRuleText(req.body?.name, 100) || oldRule.name,
      Object.prototype.hasOwnProperty.call(req.body || {}, 'customer_code') ? alarmRuleText(req.body?.customer_code, 80) : oldRule.customer_code,
      Object.prototype.hasOwnProperty.call(req.body || {}, 'site_code') ? alarmRuleText(req.body?.site_code, 80) : oldRule.site_code,
      Object.prototype.hasOwnProperty.call(req.body || {}, 'machine_code') ? alarmRuleText(req.body?.machine_code, 80) : oldRule.machine_code,
      Object.prototype.hasOwnProperty.call(req.body || {}, 'alarm_type') ? alarmRuleText(req.body?.alarm_type, 100) : oldRule.alarm_type,
      alarmRuleSeverity(req.body?.severity ?? oldRule.severity),
      ackMinutes,
      resolveMinutes,
      alarmRuleText(req.body?.escalation_channel, 40) || oldRule.escalation_channel || 'dashboard',
      Object.prototype.hasOwnProperty.call(req.body || {}, 'recipients') ? alarmRuleText(req.body?.recipients, 500) : oldRule.recipients,
      alarmRulePriority(req.body?.priority, oldRule.priority),
      typeof req.body?.enabled === 'boolean' ? req.body.enabled : oldRule.enabled,
      actor?.email || 'admin'
    ]);

    await writeAuditLog(req, {
      action:'update_alarm_escalation_rule',
      entity_type:'alarm_escalation_rule',
      entity_id:id,
      old_values:oldRule,
      new_values:updated,
      metadata:{rule_key:updated.rule_key, is_system:updated.is_system}
    });

    res.json({status:'ok', version:APP_VERSION, rule:updated});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/permissions', adminRequired, async (req,res)=>{
  try {
    const user = req.user || getSession(req)?.user || null;
    res.json({
      status:'ok',
      version:APP_VERSION,
      role:user?.role || 'viewer',
      user:publicUser(user),
      permissions:publicPermissions(user),
      matrix:ROLE_PERMISSIONS
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});


app.get('/api/admin/subscription-plans', adminRequired, permissionRequired('VIEW_BILLING'), async (req,res)=>{
  try {
    await ensureBillingFoundation();
    const result = await pool.query(`
      SELECT
        code,
        name,
        description,
        trial_days,
        user_limit,
        site_limit,
        device_limit,
        monthly_price_cents,
        currency,
        is_active,
        sort_order,
        created_at,
        updated_at
      FROM subscription_plans
      ORDER BY sort_order, code
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      plans:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/subscriptions', adminRequired, permissionRequired('VIEW_BILLING'), async (req,res)=>{
  try {
    await ensureBillingFoundation();
    await refreshExpiredSubscriptions();
    const customers = await pool.query(`SELECT code FROM customers ORDER BY created_at DESC LIMIT 300`);
    const subscriptions = [];

    for (const customer of customers.rows) {
      const snapshot = await getSubscriptionSnapshot(customer.code, true);
      if (snapshot) subscriptions.push(snapshot);
    }

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:subscriptions.length,
      subscriptions
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.patch('/api/admin/subscriptions/:customerCode', adminRequired, permissionRequired('MANAGE_BILLING'), async (req,res)=>{
  let client;
  try {
    await ensureBillingFoundation();

    const customerCode = String(req.params.customerCode || '').trim();
    const planCode = String(req.body?.plan_code || '').trim();
    if (!planCode) {
      const err = new Error('plan_code is required');
      err.statusCode = 400;
      throw err;
    }
    const status = validateChoice(req.body?.status, SUBSCRIPTION_STATUSES, 'status');

    const parseOptionalDate = (value, label) => {
      if (value === null || value === undefined || value === '') return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        const err = new Error(`${label} is not a valid date`);
        err.statusCode = 400;
        throw err;
      }
      return date;
    };

    const requestedTrialEnd = parseOptionalDate(req.body?.trial_ends_at, 'trial_ends_at');
    const requestedPeriodEnd = parseOptionalDate(req.body?.current_period_end, 'current_period_end');

    client = await pool.connect();
    await client.query('BEGIN');

    const customerResult = await client.query(
      `SELECT id, code, name FROM customers WHERE code=$1 LIMIT 1 FOR UPDATE`,
      [customerCode]
    );
    const customer = customerResult.rows[0];
    if (!customer) {
      const err = new Error('Customer not found');
      err.statusCode = 404;
      throw err;
    }

    const planResult = await client.query(
      `SELECT code, trial_days FROM subscription_plans WHERE code=$1 AND is_active=true LIMIT 1`,
      [planCode]
    );
    const plan = planResult.rows[0];
    if (!plan) {
      const err = new Error('Active subscription plan not found');
      err.statusCode = 404;
      throw err;
    }

    const oldResult = await client.query(
      `SELECT * FROM tenant_subscriptions WHERE customer_id=$1 LIMIT 1 FOR UPDATE`,
      [customer.id]
    );
    const oldSubscription = oldResult.rows[0] || null;

    const defaultDays = status === 'trialing' ? Math.max(1, Number(plan.trial_days || 14)) : 30;
    const subscriptionChanged = !oldSubscription
      || oldSubscription.plan_code !== plan.code
      || oldSubscription.status !== status;
    const trialEndsAt = status === 'trialing'
      ? (requestedTrialEnd
        || (subscriptionChanged ? null : oldSubscription?.trial_ends_at)
        || new Date(Date.now() + defaultDays * 86400000))
      : null;
    const periodEnd = requestedPeriodEnd
      || (subscriptionChanged ? null : oldSubscription?.current_period_end)
      || new Date(Date.now() + defaultDays * 86400000);

    const updatedResult = await client.query(
      `
      INSERT INTO tenant_subscriptions(
        customer_id,plan_code,status,starts_at,trial_ends_at,current_period_start,current_period_end,cancelled_at
      ) VALUES(
        $1,$2,$3,now(),$4,now(),$5,CASE WHEN $3='cancelled' THEN now() ELSE NULL END
      )
      ON CONFLICT(customer_id) DO UPDATE SET
        plan_code=EXCLUDED.plan_code,
        status=EXCLUDED.status,
        trial_ends_at=EXCLUDED.trial_ends_at,
        current_period_start=CASE
          WHEN tenant_subscriptions.plan_code <> EXCLUDED.plan_code
            OR tenant_subscriptions.status <> EXCLUDED.status
          THEN now()
          ELSE tenant_subscriptions.current_period_start
        END,
        current_period_end=EXCLUDED.current_period_end,
        cancelled_at=CASE WHEN EXCLUDED.status='cancelled' THEN now() ELSE NULL END,
        updated_at=now()
      RETURNING *
      `,
      [customer.id, plan.code, status, trialEndsAt, periodEnd]
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    const snapshot = await getSubscriptionSnapshot(customer.code, true);

    await writeAuditLog(req, {
      action:'update_tenant_subscription',
      entity_type:'subscription',
      entity_id:updatedResult.rows[0].id,
      old_values:oldSubscription,
      new_values:updatedResult.rows[0],
      metadata:{customer_code:customer.code, customer_name:customer.name}
    });

    res.json({status:'ok', version:APP_VERSION, ...snapshot});
  } catch(e) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch(_) {}
      client.release();
    }
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/users', adminRequired, async (req,res)=>{
  try {
    const result = await pool.query(`
      SELECT
        id,
        email,
        full_name,
        role,
        status,
        default_customer_code,
        default_site_code,
        last_login_at,
        created_at,
        updated_at
      FROM app_users
      ORDER BY created_at DESC
      LIMIT 200
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      users:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/admin/customers', adminRequired, async (req,res)=>{
  try {
    const result = await pool.query(`
      SELECT
        c.id::text,
        c.code,
        c.name,
        c.status,
        c.created_at,
        c.updated_at,
        count(DISTINCT s.id)::int AS site_count,
        count(DISTINCT m.id)::int AS machine_count,
        count(DISTINCT u.id)::int AS user_count
      FROM customers c
      LEFT JOIN sites s ON s.customer_id=c.id
      LEFT JOIN machines m ON m.site_id=s.id
      LEFT JOIN app_user_tenant_access a ON a.customer_code=c.code
      LEFT JOIN app_users u ON lower(u.email)=lower(a.user_email)
      GROUP BY c.id, c.code, c.name, c.status, c.created_at, c.updated_at
      ORDER BY c.created_at DESC
      LIMIT 200
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      customers:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/admin/sites', adminRequired, async (req,res)=>{
  try {
    const result = await pool.query(`
      SELECT
        s.id::text,
        s.code,
        s.name,
        s.location,
        s.status,
        c.code AS customer_code,
        c.name AS customer_name,
        s.created_at,
        s.updated_at,
        count(DISTINCT m.id)::int AS machine_count,
        count(DISTINCT d.id)::int AS device_count
      FROM sites s
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN machines m ON m.site_id=s.id
      LEFT JOIN devices d ON d.machine_id=m.id
      GROUP BY s.id, s.code, s.name, s.location, s.status, c.code, c.name, s.created_at, s.updated_at
      ORDER BY s.created_at DESC
      LIMIT 200
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      sites:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});


app.get('/api/admin/machines', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAssetManagementFoundation();
    const machines = await machineAssetRows(req.query.limit || 300);
    res.json({
      status:'ok',
      version:APP_VERSION,
      asset_management_enabled:assetManagementEnabled(),
      count:machines.length,
      machines
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/customers', adminRequired, permissionRequired('MANAGE_CUSTOMERS'), async (req,res)=>{
  let client;
  try {
    await ensureBillingFoundation();
    await ensureAssetManagementFoundation();

    const code = normalizeAssetCode(req.body?.code, 'customer code');
    const name = cleanAssetName(req.body?.name, 'customer name');
    const status = validateChoice(req.body?.status || 'pilot', ASSET_CUSTOMER_STATUSES, 'status');

    client = await pool.connect();
    await client.query('BEGIN');

    const created = await client.query(`
      INSERT INTO customers(code, name, status)
      VALUES($1,$2,$3)
      RETURNING id::text, code, name, status, created_at, updated_at
    `, [code, name, status]);

    await client.query('COMMIT');
    client.release();
    client = null;

    await ensureCustomerSubscription(created.rows[0].id, 'trial');
    const subscription = await getSubscriptionSnapshot(code, true);

    await writeAuditLog(req, {
      action:'create_customer',
      entity_type:'customer',
      entity_id:created.rows[0].id,
      old_values:null,
      new_values:created.rows[0],
      metadata:{customer_code:code, subscription_created:Boolean(subscription)}
    });

    res.status(201).json({status:'ok', version:APP_VERSION, customer:created.rows[0], subscription});
  } catch(e) {
    if (client) { try { await client.query('ROLLBACK'); } catch(_) {} client.release(); }
    const status = e.code === '23505' ? 409 : (e.statusCode || 500);
    res.status(status).json({status:'error', version:APP_VERSION, message:e.code === '23505' ? 'Customer code already exists' : e.message});
  }
});

app.patch('/api/admin/customers/:code', adminRequired, permissionRequired('MANAGE_CUSTOMERS'), async (req,res)=>{
  try {
    await ensureAssetManagementFoundation();
    const code = normalizeAssetCode(req.params.code, 'customer code');
    const oldRow = await one(`SELECT id::text, code, name, status FROM customers WHERE code=$1 LIMIT 1`, [code]);
    if (!oldRow) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Customer not found'});

    const name = req.body?.name !== undefined ? cleanAssetName(req.body.name, 'customer name') : oldRow.name;
    const status = req.body?.status !== undefined ? validateChoice(req.body.status, ASSET_CUSTOMER_STATUSES, 'status') : oldRow.status;

    const updated = await one(`
      UPDATE customers
      SET name=$2, status=$3, updated_at=now()
      WHERE code=$1
      RETURNING id::text, code, name, status, created_at, updated_at
    `, [code, name, status]);

    await writeAuditLog(req, {
      action:'update_customer',
      entity_type:'customer',
      entity_id:updated.id,
      old_values:oldRow,
      new_values:updated,
      metadata:{customer_code:code}
    });

    res.json({status:'ok', version:APP_VERSION, customer:updated});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/sites', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureBillingFoundation();
    await ensureAssetManagementFoundation();

    const customerCode = normalizeAssetCode(req.body?.customer_code, 'customer code');
    const code = normalizeAssetCode(req.body?.code, 'site code');
    const name = cleanAssetName(req.body?.name, 'site name');
    const location = cleanOptionalText(req.body?.location, 220);
    const status = validateChoice(req.body?.status || 'pilot', ASSET_SITE_STATUSES, 'status');

    const customer = await one(`SELECT id::text, code, name FROM customers WHERE code=$1 LIMIT 1`, [customerCode]);
    if (!customer) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Customer not found'});

    await assertSubscriptionCapacity(customerCode, 'sites', 1, false);

    const created = await one(`
      INSERT INTO sites(customer_id, code, name, location, status)
      VALUES($1,$2,$3,$4,$5)
      RETURNING id::text, code, name, location, status, created_at, updated_at
    `, [customer.id, code, name, location, status]);

    await writeAuditLog(req, {
      action:'create_site',
      entity_type:'site',
      entity_id:created.id,
      old_values:null,
      new_values:created,
      metadata:{customer_code:customerCode, site_code:code}
    });

    res.status(201).json({status:'ok', version:APP_VERSION, customer, site:created});
  } catch(e) {
    const status = e.code === '23505' ? 409 : (e.statusCode || 500);
    res.status(status).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'error',
      version:APP_VERSION,
      message:e.code === '23505' ? 'Site code already exists for this customer' : e.message,
      usage:e.usage || null,
      access:e.access || null
    });
  }
});

app.patch('/api/admin/sites/:customerCode/:siteCode', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAssetManagementFoundation();
    const customerCode = normalizeAssetCode(req.params.customerCode, 'customer code');
    const siteCode = normalizeAssetCode(req.params.siteCode, 'site code');

    const oldRow = await one(`
      SELECT s.id::text, s.code, s.name, s.location, s.status, c.code AS customer_code
      FROM sites s JOIN customers c ON c.id=s.customer_id
      WHERE c.code=$1 AND s.code=$2 LIMIT 1
    `, [customerCode, siteCode]);
    if (!oldRow) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Site not found'});

    const name = req.body?.name !== undefined ? cleanAssetName(req.body.name, 'site name') : oldRow.name;
    const location = req.body?.location !== undefined ? cleanOptionalText(req.body.location, 220) : oldRow.location;
    const status = req.body?.status !== undefined ? validateChoice(req.body.status, ASSET_SITE_STATUSES, 'status') : oldRow.status;

    const updated = await one(`
      UPDATE sites s
      SET name=$3, location=$4, status=$5, updated_at=now()
      FROM customers c
      WHERE s.customer_id=c.id AND c.code=$1 AND s.code=$2
      RETURNING s.id::text, s.code, s.name, s.location, s.status, s.created_at, s.updated_at
    `, [customerCode, siteCode, name, location, status]);

    await writeAuditLog(req, {
      action:'update_site',
      entity_type:'site',
      entity_id:updated.id,
      old_values:oldRow,
      new_values:updated,
      metadata:{customer_code:customerCode, site_code:siteCode}
    });

    res.json({status:'ok', version:APP_VERSION, site:updated});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/machines', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAssetManagementFoundation();
    const customerCode = normalizeAssetCode(req.body?.customer_code, 'customer code');
    const siteCode = normalizeAssetCode(req.body?.site_code, 'site code');
    const code = normalizeAssetCode(req.body?.code, 'machine code');
    const name = cleanAssetName(req.body?.name, 'machine name');
    const machineType = cleanOptionalText(req.body?.machine_type, 80) || 'unknown';
    const status = validateChoice(req.body?.status || 'active', ASSET_MACHINE_STATUSES, 'status');

    await assertSubscriptionAccessForCustomer(customerCode);

    const site = await one(`
      SELECT s.id::text, s.code, s.name, c.code AS customer_code, c.name AS customer_name
      FROM sites s JOIN customers c ON c.id=s.customer_id
      WHERE c.code=$1 AND s.code=$2 LIMIT 1
    `, [customerCode, siteCode]);
    if (!site) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Site not found'});

    const created = await one(`
      INSERT INTO machines(site_id, code, name, machine_type, status)
      VALUES($1,$2,$3,$4,$5)
      RETURNING id::text, code, name, machine_type, status, created_at, updated_at
    `, [site.id, code, name, machineType, status]);

    await writeAuditLog(req, {
      action:'create_machine',
      entity_type:'machine',
      entity_id:created.id,
      old_values:null,
      new_values:created,
      metadata:{customer_code:customerCode, site_code:siteCode, machine_code:code}
    });

    res.status(201).json({status:'ok', version:APP_VERSION, site, machine:created});
  } catch(e) {
    const status = e.code === '23505' ? 409 : (e.statusCode || 500);
    res.status(status).json({status:'error', version:APP_VERSION, message:e.code === '23505' ? 'Machine code already exists for this site' : e.message});
  }
});

app.patch('/api/admin/machines/:customerCode/:siteCode/:machineCode', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAssetManagementFoundation();
    const customerCode = normalizeAssetCode(req.params.customerCode, 'customer code');
    const siteCode = normalizeAssetCode(req.params.siteCode, 'site code');
    const machineCode = normalizeAssetCode(req.params.machineCode, 'machine code');

    const oldRow = await one(`
      SELECT m.id::text, m.code, m.name, m.machine_type, m.status, s.code AS site_code, c.code AS customer_code
      FROM machines m
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE c.code=$1 AND s.code=$2 AND m.code=$3
      LIMIT 1
    `, [customerCode, siteCode, machineCode]);
    if (!oldRow) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Machine not found'});

    const name = req.body?.name !== undefined ? cleanAssetName(req.body.name, 'machine name') : oldRow.name;
    const machineType = req.body?.machine_type !== undefined ? (cleanOptionalText(req.body.machine_type, 80) || 'unknown') : oldRow.machine_type;
    const status = req.body?.status !== undefined ? validateChoice(req.body.status, ASSET_MACHINE_STATUSES, 'status') : oldRow.status;

    const updated = await one(`
      UPDATE machines m
      SET name=$4, machine_type=$5, status=$6, updated_at=now()
      FROM sites s, customers c
      WHERE m.site_id=s.id AND s.customer_id=c.id AND c.code=$1 AND s.code=$2 AND m.code=$3
      RETURNING m.id::text, m.code, m.name, m.machine_type, m.status, m.created_at, m.updated_at
    `, [customerCode, siteCode, machineCode, name, machineType, status]);

    await writeAuditLog(req, {
      action:'update_machine',
      entity_type:'machine',
      entity_id:updated.id,
      old_values:oldRow,
      new_values:updated,
      metadata:{customer_code:customerCode, site_code:siteCode, machine_code:machineCode}
    });

    res.json({status:'ok', version:APP_VERSION, machine:updated});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/tenant-access', adminRequired, async (req,res)=>{
  try {
    const result = await pool.query(`
      SELECT
        a.id::text,
        a.user_email,
        u.full_name,
        u.role AS user_role,
        a.customer_code,
        c.name AS customer_name,
        a.site_code,
        s.name AS site_name,
        a.access_role,
        a.created_at
      FROM app_user_tenant_access a
      LEFT JOIN app_users u ON lower(u.email)=lower(a.user_email)
      LEFT JOIN customers c ON c.code=a.customer_code
      LEFT JOIN sites s ON s.code=a.site_code AND s.customer_id=c.id
      ORDER BY a.created_at DESC
      LIMIT 300
    `);

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      access:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});




async function ensureDeviceRegistrySchema() {
  await pool.query(`
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_no text;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'paired';
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_token_hash text;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_token_expires_at timestamptz;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_notes text;
  `);

  await pool.query(`
    UPDATE devices
    SET provisioning_status='paired', provisioned_at=COALESCE(provisioned_at, created_at)
    WHERE provisioning_status IS NULL
       OR provisioning_status NOT IN ('pending','paired','revoked')
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_provisioning_status
    ON devices(provisioning_status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_provisioning_token_hash
    ON devices(provisioning_token_hash)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_devices_status_updated_at
    ON devices(status, updated_at DESC)
  `);
}

function makeProvisioningToken() {
  return `fbp_${crypto.randomBytes(24).toString('hex')}`;
}

function hashProvisioningToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function tokenMinutes(raw) {
  const value = Number(raw || 60);
  if (!Number.isFinite(value)) return 60;
  return Math.min(Math.max(Math.floor(value), 5), 1440);
}

function cleanCode(value, fallback='') {
  return String(value || fallback || '').trim();
}

async function deviceTenantRowByUid(uid) {
  return one(`
    SELECT
      d.id::text AS id,
      d.device_uid,
      d.model,
      d.firmware_version,
      d.hardware_revision,
      d.mqtt_base_topic,
      d.status,
      d.last_seen_at,
      d.serial_no,
      d.provisioning_status,
      d.provisioning_token_expires_at,
      d.provisioned_at,
      d.deactivated_at,
      d.device_notes,
      m.id::text AS machine_id,
      m.code AS machine_code,
      m.name AS machine_name,
      m.machine_type,
      m.status AS machine_status,
      s.code AS site_code,
      s.name AS site_name,
      c.code AS customer_code,
      c.name AS customer_name,
      d.created_at,
      d.updated_at
    FROM devices d
    LEFT JOIN machines m ON m.id=d.machine_id
    LEFT JOIN sites s ON s.id=m.site_id
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE d.device_uid=$1
    LIMIT 1
  `, [uid]);
}

async function resolveDeviceTarget(customerCode, siteCode, machineCode, machineName, machineType) {
  const customer = await one(`SELECT id, code, name FROM customers WHERE code=$1 LIMIT 1`, [customerCode]);
  if (!customer) {
    const err = new Error(`Customer not found: ${customerCode}`);
    err.statusCode = 404;
    throw err;
  }

  const site = await one(`SELECT id, code, name FROM sites WHERE customer_id=$1 AND code=$2 LIMIT 1`, [customer.id, siteCode]);
  if (!site) {
    const err = new Error(`Site not found: ${customerCode}/${siteCode}`);
    err.statusCode = 404;
    throw err;
  }

  const machine = await one(`
    INSERT INTO machines(site_id, code, name, machine_type, status)
    VALUES($1,$2,$3,$4,'active')
    ON CONFLICT(site_id, code) DO UPDATE SET
      name=COALESCE(NULLIF(EXCLUDED.name,''), machines.name),
      machine_type=COALESCE(NULLIF(EXCLUDED.machine_type,''), machines.machine_type),
      updated_at=now()
    RETURNING id, code, name, machine_type, status
  `, [site.id, machineCode, machineName || machineCode, machineType || 'unknown']);

  return {customer, site, machine};
}

app.get('/api/admin/devices', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try {
    await ensureDeviceRegistrySchema();
  await ensureAssetManagementFoundation();
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const result = await pool.query(`
      SELECT
        d.id::text,
        d.device_uid,
        d.model,
        d.firmware_version,
        d.hardware_revision,
        d.mqtt_base_topic,
        d.status,
        d.last_seen_at,
        d.serial_no,
        d.provisioning_status,
        d.provisioning_token_expires_at,
        d.provisioned_at,
        d.deactivated_at,
        d.device_notes,
        m.code AS machine_code,
        m.name AS machine_name,
        m.machine_type,
        s.code AS site_code,
        s.name AS site_name,
        c.code AS customer_code,
        c.name AS customer_name,
        d.created_at,
        d.updated_at
      FROM devices d
      LEFT JOIN machines m ON m.id=d.machine_id
      LEFT JOIN sites s ON s.id=m.site_id
      LEFT JOIN customers c ON c.id=s.customer_id
      ORDER BY d.updated_at DESC, d.created_at DESC
      LIMIT $1
    `, [limit]);

    res.json({
      status:'ok',
      version:APP_VERSION,
      provisioning_enabled:deviceProvisioningEnabled(),
      count:result.rows.length,
      devices:result.rows
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/devices/provision-token', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try {
    if (!deviceProvisioningEnabled()) {
      return res.status(403).json({status:'disabled', version:APP_VERSION, message:'Device provisioning is disabled'});
    }

    await ensureDeviceRegistrySchema();
  await ensureAssetManagementFoundation();

    const customerCode = cleanCode(req.body?.customer_code || req.body?.customerCode || CFG.customerCode);
    const siteCode = cleanCode(req.body?.site_code || req.body?.siteCode || CFG.siteCode);
    const machineCode = cleanCode(req.body?.machine_code || req.body?.machineCode || req.body?.device_uid || CFG.machineCode);
    const machineName = cleanCode(req.body?.machine_name || req.body?.machineName || machineCode);
    const machineType = cleanCode(req.body?.machine_type || req.body?.machineType || CFG.machineType);
    const deviceUid = cleanCode(req.body?.device_uid || req.body?.deviceUid);
    const model = cleanCode(req.body?.model || CFG.deviceModel);
    const serialNo = cleanCode(req.body?.serial_no || req.body?.serialNo);
    const mqttBaseTopic = cleanCode(req.body?.mqtt_base_topic || req.body?.mqttBaseTopic || `${customerCode}/${siteCode}/${machineCode}`);
    const notes = cleanCode(req.body?.device_notes || req.body?.notes);
    const minutes = tokenMinutes(req.body?.token_minutes || req.body?.tokenMinutes);

    if (!deviceUid) {
      return res.status(400).json({status:'error', version:APP_VERSION, message:'device_uid is required'});
    }

    const existing = await deviceTenantRowByUid(deviceUid);
    if (existing?.customer_code && existing.customer_code !== customerCode) {
      return res.status(409).json({
        status:'device_uid_conflict',
        version:APP_VERSION,
        message:'This device_uid belongs to another customer',
        current_customer_code:existing.customer_code
      });
    }

    const additionalDevice = existing && existing.status !== 'archived' ? 0 : 1;
    await assertSubscriptionCapacity(customerCode, 'devices', additionalDevice, false);

    const {machine} = await resolveDeviceTarget(customerCode, siteCode, machineCode, machineName, machineType);
    const token = makeProvisioningToken();
    const tokenHash = hashProvisioningToken(token);

    const oldDevice = existing || null;
    const device = await one(`
      INSERT INTO devices(
        machine_id,
        device_uid,
        model,
        serial_no,
        mqtt_base_topic,
        status,
        provisioning_status,
        provisioning_token_hash,
        provisioning_token_expires_at,
        provisioned_at,
        device_notes
      )
      VALUES($1,$2,$3,$4,$5,'offline','pending',$6,now() + make_interval(mins => $7),NULL,$8)
      ON CONFLICT(device_uid) DO UPDATE SET
        machine_id=EXCLUDED.machine_id,
        model=EXCLUDED.model,
        serial_no=COALESCE(NULLIF(EXCLUDED.serial_no,''), devices.serial_no),
        mqtt_base_topic=EXCLUDED.mqtt_base_topic,
        status=CASE WHEN devices.status='archived' THEN 'offline' ELSE devices.status END,
        provisioning_status='pending',
        provisioning_token_hash=EXCLUDED.provisioning_token_hash,
        provisioning_token_expires_at=EXCLUDED.provisioning_token_expires_at,
        device_notes=COALESCE(NULLIF(EXCLUDED.device_notes,''), devices.device_notes),
        updated_at=now()
      RETURNING id::text, device_uid, model, serial_no, mqtt_base_topic, status, provisioning_status, provisioning_token_expires_at, provisioned_at, device_notes, created_at, updated_at
    `, [machine.id, deviceUid, model, serialNo || null, mqttBaseTopic, tokenHash, minutes, notes || null]);

    const deviceWithTenant = await deviceTenantRowByUid(deviceUid);

    await writeAuditLog(req, {
      action:'create_device_provisioning_token',
      entity_type:'device',
      entity_id:deviceUid,
      old_values:oldDevice,
      new_values:{...deviceWithTenant, provisioning_token:'issued_once'},
      metadata:{customer_code:customerCode, site_code:siteCode, machine_code:machineCode, expires_minutes:minutes}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'create_device_provisioning_token',
      device:deviceWithTenant || device,
      provisioning:{
        token,
        expires_at:device.provisioning_token_expires_at,
        claim_endpoint:'/api/device/provision/claim',
        token_visible_once:true
      }
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'error',
      version:APP_VERSION,
      message:e.message,
      resource:e.resource || null,
      usage:e.usage || null,
      access:e.access || null
    });
  }
});

app.patch('/api/admin/devices/:uid/status', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try {
    await ensureDeviceRegistrySchema();
  await ensureAssetManagementFoundation();
    const status = validateChoice(req.body?.status, ['online','offline','unknown','maintenance','archived'], 'status');
    const uid = String(req.params.uid || '').trim();

    const oldDevice = await deviceTenantRowByUid(uid);
    if (!oldDevice) return res.status(404).json({status:'not_found', version:APP_VERSION, device_uid:uid});

    const device = await one(`
      UPDATE devices
      SET
        status=$1,
        provisioning_status=CASE WHEN $1='archived' THEN 'revoked' ELSE provisioning_status END,
        deactivated_at=CASE WHEN $1='archived' THEN now() ELSE deactivated_at END,
        provisioning_token_hash=CASE WHEN $1='archived' THEN NULL ELSE provisioning_token_hash END,
        provisioning_token_expires_at=CASE WHEN $1='archived' THEN NULL ELSE provisioning_token_expires_at END,
        updated_at=now()
      WHERE device_uid=$2
      RETURNING id::text, device_uid, model, firmware_version, hardware_revision, mqtt_base_topic, status, last_seen_at, serial_no, provisioning_status, provisioning_token_expires_at, provisioned_at, deactivated_at, device_notes, created_at, updated_at
    `, [status, uid]);

    const deviceWithTenant = await deviceTenantRowByUid(uid);
    await writeAuditLog(req, {
      action:'update_device_status',
      entity_type:'device',
      entity_id:uid,
      old_values:oldDevice,
      new_values:deviceWithTenant || device,
      metadata:{changed_field:'status', old_status:oldDevice.status, new_status:status}
    });

    res.json({status:'ok', version:APP_VERSION, action:'update_device_status', device:deviceWithTenant || device});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/device/provision/claim', async (req,res)=>{
  try {
    if (!deviceProvisioningEnabled()) {
      return res.status(403).json({status:'disabled', version:APP_VERSION, message:'Device provisioning is disabled'});
    }

    await ensureDeviceRegistrySchema();
  await ensureAssetManagementFoundation();

    const token = String(req.body?.token || '').trim();
    const deviceUid = cleanCode(req.body?.device_uid || req.body?.deviceUid);

    if (!token) return res.status(400).json({status:'error', version:APP_VERSION, message:'token is required'});

    const tokenHash = hashProvisioningToken(token);
    const device = await one(`
      SELECT d.id::text, d.device_uid, d.model, d.mqtt_base_topic, d.provisioning_token_hash, d.provisioning_token_expires_at
      FROM devices d
      WHERE d.provisioning_token_hash=$1
        AND d.provisioning_status='pending'
        AND d.provisioning_token_expires_at > now()
      LIMIT 1
    `, [tokenHash]);

    if (!device) {
      await writeAuditLog(req, {
        action:'device_provisioning_failed',
        entity_type:'device',
        entity_id:deviceUid || 'unknown',
        old_values:null,
        new_values:null,
        metadata:{reason:'invalid_or_expired_token'}
      });
      return res.status(404).json({status:'invalid_or_expired_token', version:APP_VERSION, message:'Provisioning token is invalid or expired'});
    }

    if (deviceUid && deviceUid !== device.device_uid) {
      await writeAuditLog(req, {
        action:'device_provisioning_failed',
        entity_type:'device',
        entity_id:device.device_uid,
        old_values:null,
        new_values:null,
        metadata:{reason:'device_uid_mismatch', requested_device_uid:deviceUid}
      });
      return res.status(409).json({status:'device_uid_mismatch', version:APP_VERSION, expected_device_uid:device.device_uid});
    }

    const updated = await one(`
      UPDATE devices
      SET
        model=COALESCE(NULLIF($2,''), model),
        firmware_version=COALESCE(NULLIF($3,''), firmware_version),
        hardware_revision=COALESCE(NULLIF($4,''), hardware_revision),
        mqtt_base_topic=COALESCE(NULLIF($5,''), mqtt_base_topic),
        serial_no=COALESCE(NULLIF($6,''), serial_no),
        provisioning_status='paired',
        provisioning_token_hash=NULL,
        provisioning_token_expires_at=NULL,
        provisioned_at=now(),
        status='online',
        last_seen_at=now(),
        updated_at=now()
      WHERE id=$1::uuid
      RETURNING id::text, device_uid, model, firmware_version, hardware_revision, mqtt_base_topic, serial_no, status, provisioning_status, provisioned_at, last_seen_at, updated_at
    `, [
      device.id,
      cleanCode(req.body?.model),
      cleanCode(req.body?.firmware_version || req.body?.firmwareVersion),
      cleanCode(req.body?.hardware_revision || req.body?.hardwareRevision),
      cleanCode(req.body?.mqtt_base_topic || req.body?.mqttBaseTopic),
      cleanCode(req.body?.serial_no || req.body?.serialNo)
    ]);

    await writeAuditLog(req, {
      action:'claim_device_provisioning_token',
      entity_type:'device',
      entity_id:updated.device_uid,
      old_values:{device_uid:device.device_uid, provisioning_status:'pending'},
      new_values:{...updated, provisioning_token:'consumed'},
      metadata:{claim_endpoint:'/api/device/provision/claim'}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'claim_device_provisioning_token',
      device:updated,
      mqtt:{base_topic:updated.mqtt_base_topic}
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});





async function ensureAuditLogSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id bigserial PRIMARY KEY,
      actor_user_id text,
      actor_email text,
      actor_role text,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      old_values jsonb,
      new_values jsonb,
      metadata jsonb,
      ip_address text,
      user_agent text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
    ON admin_audit_logs(created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_entity
    ON admin_audit_logs(entity_type, entity_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_email
    ON admin_audit_logs(actor_email)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created_at
    ON admin_audit_logs(action, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_entity_created_at
    ON admin_audit_logs(entity_type, created_at DESC)
  `);
}

function reqIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

async function writeAuditLog(req, {action, entity_type, entity_id, old_values, new_values, metadata}) {
  try {
    await ensureAuditLogSchema();

    const actor = req.user || getSession(req)?.user || null;

    await pool.query(
      `
      INSERT INTO admin_audit_logs(
        actor_user_id,
        actor_email,
        actor_role,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        metadata,
        ip_address,
        user_agent
      )
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
      `,
      [
        actor?.id || null,
        actor?.email || null,
        actor?.role || null,
        action,
        entity_type,
        String(entity_id || ''),
        JSON.stringify(old_values || null),
        JSON.stringify(new_values || null),
        JSON.stringify(metadata || null),
        reqIp(req),
        req.headers['user-agent'] || null
      ]
    );
  } catch(e) {
    console.error('Audit log write failed:', e.message);
  }
}




async function ensureInviteSchema() {
  if (inviteSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_invites (
      id bigserial PRIMARY KEY,
      invite_token text NOT NULL UNIQUE,
      email text NOT NULL,
      full_name text,
      role text NOT NULL DEFAULT 'viewer',
      customer_code text NOT NULL,
      site_code text,
      status text NOT NULL DEFAULT 'pending',
      invited_by_email text,
      accepted_user_id text,
      accepted_at timestamptz,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS email_sent_at timestamptz`);
  await pool.query(`ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS email_message_id text`);
  await pool.query(`ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS email_last_error text`);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_email
    ON user_invites(lower(email))
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_token
    ON user_invites(invite_token)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_status
    ON user_invites(status)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_invites_customer_pending
    ON user_invites(customer_code, status, expires_at)
  `);

  inviteSchemaReady = true;
}

function createInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicInviteUrl(req, token) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3100';
  return `${proto}://${host}/invite.html?token=${encodeURIComponent(token)}`;
}

function inviteEmailSubject(invite) {
  const customer = invite.customer_code || 'FactoryBox';
  return `FactoryBox Davetiniz - ${customer}`;
}

function inviteEmailHtml(invite, inviteUrl) {
  const role = invite.role || 'viewer';
  const customer = invite.customer_code || '-';
  const site = invite.site_code || 'Tüm customer';
  const name = invite.full_name || invite.email;

  return emailShellHtml('FactoryBox Davetiniz', `
    <h1 style="margin:0 0 12px 0;color:#102033;">FactoryBox davetiniz hazır</h1>
    <p style="font-size:15px;line-height:1.6;color:#334155;">
      Merhaba <strong>${h(name)}</strong>,<br>
      FactoryBox hesabınıza erişim için davet aldınız.
    </p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:18px 0;">
      <p style="margin:6px 0;"><strong>Rol:</strong> ${h(role)}</p>
      <p style="margin:6px 0;"><strong>Customer:</strong> ${h(customer)}</p>
      <p style="margin:6px 0;"><strong>Site:</strong> ${h(site)}</p>
    </div>

    <p style="margin:22px 0;">
      <a href="${h(inviteUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;">
        Daveti Kabul Et
      </a>
    </p>

    <p style="font-size:13px;color:#64748b;line-height:1.5;">
      Buton çalışmazsa bu linki tarayıcıya yapıştırın:<br>
      <span style="word-break:break-all;">${h(inviteUrl)}</span>
    </p>

    <p style="font-size:12px;color:#94a3b8;margin-top:22px;">
      Bu davet 7 gün içinde kabul edilmelidir.
    </p>
  `);
}

function inviteText(invite, inviteUrl) {
  return [
    'FactoryBox davetiniz hazır',
    '',
    `Email: ${invite.email}`,
    `Rol: ${invite.role}`,
    `Customer: ${invite.customer_code}`,
    `Site: ${invite.site_code || 'Tüm customer'}`,
    '',
    `Daveti kabul etmek için: ${inviteUrl}`
  ].join('\n');
}

function inviteReturnFieldsSql() {
  return `
    id::text,
    invite_token,
    email,
    full_name,
    role,
    customer_code,
    site_code,
    status,
    invited_by_email,
    accepted_user_id,
    accepted_at,
    expires_at,
    email_sent_at,
    email_message_id,
    email_last_error,
    created_at,
    updated_at
  `;
}

function publicInvite(invite, req) {
  return {
    ...invite,
    invite_url:publicInviteUrl(req, invite.invite_token)
  };
}

async function deliverInviteEmail(req, invite) {
  const inviteUrl = publicInviteUrl(req, invite.invite_token);
  let emailResult;

  try {
    emailResult = await sendReportEmail({
      to:invite.email,
      subject:inviteEmailSubject(invite),
      html:inviteEmailHtml(invite, inviteUrl),
      text:inviteText(invite, inviteUrl)
    });
  } catch(e) {
    emailResult = {
      sent:false,
      reason:e.message,
      accepted:[],
      rejected:[],
      to:[invite.email]
    };
  }

  const updated = await one(
    `
    UPDATE user_invites
    SET
      email_sent_at=CASE WHEN $2::boolean THEN now() ELSE email_sent_at END,
      email_message_id=CASE WHEN $2::boolean THEN $3 ELSE email_message_id END,
      email_last_error=CASE WHEN $2::boolean THEN NULL ELSE $4 END,
      updated_at=now()
    WHERE id=$1
    RETURNING ${inviteReturnFieldsSql()}
    `,
    [
      invite.id,
      Boolean(emailResult.sent),
      emailResult.message_id || null,
      emailResult.sent ? null : (emailResult.reason || 'Email could not be sent')
    ]
  );

  await writeAuditLog(req, {
    action:'send_user_invite_email',
    entity_type:'invite',
    entity_id:invite.id,
    old_values:invite,
    new_values:updated || invite,
    metadata:{
      email:invite.email,
      sent:Boolean(emailResult.sent),
      reason:emailResult.reason || null,
      message_id:emailResult.message_id || null
    }
  });

  return {
    invite:updated || invite,
    email:emailResult
  };
}



function validateChoice(value, allowed, label) {
  const clean = String(value || '').trim();
  if (!allowed.includes(clean)) {
    const err = new Error(`${label} must be one of: ${allowed.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  return clean;
}





app.get('/api/admin/invites', adminRequired, permissionRequired('MANAGE_INVITES'), async (req,res)=>{
  try {
    await ensureInviteSchema();

    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 300);

    const result = await pool.query(
      `
      SELECT
        id::text,
        invite_token,
        email,
        full_name,
        role,
        customer_code,
        site_code,
        status,
        invited_by_email,
        accepted_user_id,
        accepted_at,
        expires_at,
        email_sent_at,
        email_message_id,
        email_last_error,
        created_at,
        updated_at
      FROM user_invites
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json({
      status:'ok',
      version:APP_VERSION,
      count:result.rows.length,
      invites:result.rows.map(row => publicInvite(row, req))
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.post('/api/admin/invites', adminRequired, permissionRequired('MANAGE_INVITES'), async (req,res)=>{
  try {
    await ensureInviteSchema();

    const email = normalizeEmail(req.body?.email);
    const fullName = String(req.body?.full_name || '').trim();
    const role = validateChoice(req.body?.role, ['viewer','operator','admin','owner'], 'role');
    const customerCode = String(req.body?.customer_code || '').trim();
    const siteCodeRaw = String(req.body?.site_code || '').trim();
    const siteCode = siteCodeRaw || null;
    const shouldSendEmail = req.body?.send_email !== false;

    if (!email || !email.includes('@')) {
      return res.status(400).json({status:'error', message:'valid email is required'});
    }

    if (!customerCode) {
      return res.status(400).json({status:'error', message:'customer_code is required'});
    }

    const customer = await one(
      `SELECT id::text, code, name, status FROM customers WHERE code=$1 LIMIT 1`,
      [customerCode]
    );

    if (!customer) {
      return res.status(404).json({status:'not_found', message:'customer not found', customer_code:customerCode});
    }

    const existingAccess = await one(`
      SELECT 1 AS found
      FROM app_user_tenant_access a
      JOIN app_users u ON lower(u.email)=lower(a.user_email)
      WHERE a.customer_code=$1 AND lower(u.email)=lower($2) AND u.status='active'
      LIMIT 1
    `, [customerCode, email]);

    const existingPendingInvite = await one(`
      SELECT id::text
      FROM user_invites
      WHERE customer_code=$1
        AND lower(email)=lower($2)
        AND status='pending'
        AND expires_at > now()
      LIMIT 1
    `, [customerCode, email]);

    if (existingPendingInvite) {
      return res.status(409).json({
        status:'duplicate_invite',
        version:APP_VERSION,
        message:'This email already has a pending invite for the tenant',
        invite_id:existingPendingInvite.id
      });
    }

    if (!existingAccess) {
      await assertSubscriptionCapacity(customerCode, 'users', 1, true);
    } else {
      await assertSubscriptionAccessForCustomer(customerCode);
    }

    if (siteCode) {
      const site = await one(
        `
        SELECT s.id::text, s.code, s.name
        FROM sites s
        JOIN customers c ON c.id=s.customer_id
        WHERE c.code=$1 AND s.code=$2
        LIMIT 1
        `,
        [customerCode, siteCode]
      );

      if (!site) {
        return res.status(404).json({status:'not_found', message:'site not found', customer_code:customerCode, site_code:siteCode});
      }
    }

    const token = createInviteToken();
    const actor = req.user || getSession(req)?.user || null;

    let invite = await one(
      `
      INSERT INTO user_invites(
        invite_token,
        email,
        full_name,
        role,
        customer_code,
        site_code,
        status,
        invited_by_email,
        expires_at
      )
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,now() + interval '7 days')
      RETURNING
        id::text,
        invite_token,
        email,
        full_name,
        role,
        customer_code,
        site_code,
        status,
        invited_by_email,
        accepted_user_id,
        accepted_at,
        expires_at,
        email_sent_at,
        email_message_id,
        email_last_error,
        created_at,
        updated_at
      `,
      [token, email, fullName || null, role, customerCode, siteCode, actor?.email || null]
    );

    await writeAuditLog(req, {
      action:'create_user_invite',
      entity_type:'invite',
      entity_id:invite.id,
      old_values:null,
      new_values:invite,
      metadata:{email, role, customer_code:customerCode, site_code:siteCode}
    });

    let inviteEmailDelivery = null;

    if (shouldSendEmail) {
      const delivery = await deliverInviteEmail(req, invite);
      invite = delivery.invite;
      inviteEmailDelivery = delivery.email;
    }

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'create_user_invite',
      invite:publicInvite(invite, req),
      email:inviteEmailDelivery
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'error',
      version:APP_VERSION,
      message:e.message,
      resource:e.resource || null,
      subscription:e.subscription || null,
      usage:e.usage || null,
      access:e.access || null
    });
  }
});



app.post('/api/admin/invites/:id/email', adminRequired, permissionRequired('MANAGE_INVITES'), async (req,res)=>{
  try {
    await ensureInviteSchema();

    const invite = await one(
      `
      SELECT ${inviteReturnFieldsSql()}
      FROM user_invites
      WHERE id=$1
      LIMIT 1
      `,
      [req.params.id]
    );

    if (!invite) {
      return res.status(404).json({status:'not_found', message:'invite not found', invite_id:req.params.id});
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({status:'error', message:`invite is ${invite.status}`});
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await pool.query(`UPDATE user_invites SET status='expired', updated_at=now() WHERE id=$1`, [invite.id]);
      return res.status(400).json({status:'error', message:'invite expired'});
    }

    const delivery = await deliverInviteEmail(req, invite);

    res.json({
      status:delivery.email.sent ? 'ok' : 'not_sent',
      version:APP_VERSION,
      action:'send_user_invite_email',
      invite:publicInvite(delivery.invite, req),
      email:delivery.email
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});


app.post('/api/admin/invites/:id/cancel', adminRequired, permissionRequired('MANAGE_INVITES'), async (req,res)=>{
  try {
    await ensureInviteSchema();

    const oldInvite = await one(
      `SELECT id::text, email, full_name, role, customer_code, site_code, status FROM user_invites WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );

    const invite = await one(
      `
      UPDATE user_invites
      SET status='cancelled', updated_at=now()
      WHERE id=$1 AND status='pending'
      RETURNING id::text, email, full_name, role, customer_code, site_code, status, invited_by_email, accepted_user_id, accepted_at, expires_at, created_at, updated_at
      `,
      [req.params.id]
    );

    if (!invite) {
      return res.status(404).json({status:'not_found', message:'pending invite not found', invite_id:req.params.id});
    }

    await writeAuditLog(req, {
      action:'cancel_user_invite',
      entity_type:'invite',
      entity_id:invite.id,
      old_values:oldInvite,
      new_values:invite,
      metadata:{email:invite.email}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'cancel_user_invite',
      invite
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/invites/:token', async (req,res)=>{
  try {
    await ensureInviteSchema();

    const invite = await one(
      `
      SELECT
        id::text,
        email,
        full_name,
        role,
        customer_code,
        site_code,
        status,
        expires_at,
        created_at
      FROM user_invites
      WHERE invite_token=$1
      LIMIT 1
      `,
      [req.params.token]
    );

    if (!invite) {
      return res.status(404).json({status:'not_found', message:'invite not found'});
    }

    const expired = new Date(invite.expires_at).getTime() < Date.now();

    res.json({
      status:'ok',
      version:APP_VERSION,
      invite:{
        ...invite,
        expired
      }
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.post('/api/invites/:token/accept', async (req,res)=>{
  try {
    await ensureInviteSchema();

    const password = String(req.body?.password || '');
    const fullNameInput = String(req.body?.full_name || '').trim();

    if (password.length < 6) {
      return res.status(400).json({status:'error', message:'password must be at least 6 characters'});
    }

    const invite = await one(
      `
      SELECT
        id::text,
        invite_token,
        email,
        full_name,
        role,
        customer_code,
        site_code,
        status,
        expires_at
      FROM user_invites
      WHERE invite_token=$1
      LIMIT 1
      `,
      [req.params.token]
    );

    if (!invite) {
      return res.status(404).json({status:'not_found', message:'invite not found'});
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({status:'error', message:`invite is ${invite.status}`});
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await pool.query(`UPDATE user_invites SET status='expired', updated_at=now() WHERE id=$1`, [invite.id]);
      return res.status(400).json({status:'error', message:'invite expired'});
    }

    const existingTenantAccess = await one(`
      SELECT 1 AS found
      FROM app_user_tenant_access a
      JOIN app_users u ON lower(u.email)=lower(a.user_email)
      WHERE a.customer_code=$1 AND lower(u.email)=lower($2) AND u.status='active'
      LIMIT 1
    `, [invite.customer_code, invite.email]);

    await assertSubscriptionCapacity(
      invite.customer_code,
      'users',
      existingTenantAccess ? 0 : 1,
      false
    );

    const fullName = fullNameInput || invite.full_name || invite.email;
    const salt = makeSalt();
    const passwordHash = hashPassword(password, salt);

    let user = await one(
      `SELECT id::text, email, full_name, role, status FROM app_users WHERE lower(email)=lower($1) LIMIT 1`,
      [invite.email]
    );

    if (user) {
      user = await one(
        `
        UPDATE app_users
        SET
          full_name=COALESCE(NULLIF($2,''), full_name),
          password_hash=$3,
          password_salt=$4,
          role=$5,
          status='active',
          default_customer_code=$6,
          default_site_code=$7,
          updated_at=now()
        WHERE id=$1
        RETURNING id::text, email, full_name, role, status, default_customer_code, default_site_code, created_at, updated_at
        `,
        [user.id, fullName, passwordHash, salt, invite.role, invite.customer_code, invite.site_code]
      );
    } else {
      user = await one(
        `
        INSERT INTO app_users(id, email, full_name, password_hash, password_salt, role, status, default_customer_code, default_site_code)
        VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8)
        RETURNING id::text, email, full_name, role, status, default_customer_code, default_site_code, created_at, updated_at
        `,
        [makeUserId(), invite.email, fullName, passwordHash, salt, invite.role, invite.customer_code, invite.site_code]
      );
    }

    await pool.query(
      `
      INSERT INTO app_user_tenant_access(user_email, customer_code, site_code, access_role)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (user_email, customer_code, site_code)
      DO UPDATE SET access_role=EXCLUDED.access_role
      `,
      [invite.email, invite.customer_code, invite.site_code, invite.role]
    );

    const acceptedInvite = await one(
      `
      UPDATE user_invites
      SET status='accepted', accepted_user_id=$2, accepted_at=now(), updated_at=now()
      WHERE id=$1
      RETURNING id::text, email, full_name, role, customer_code, site_code, status, accepted_user_id, accepted_at, expires_at, created_at, updated_at
      `,
      [invite.id, user.id]
    );

    await writeAuditLog(req, {
      action:'accept_user_invite',
      entity_type:'invite',
      entity_id:acceptedInvite.id,
      old_values:invite,
      new_values:{invite:acceptedInvite, user},
      metadata:{email:invite.email, role:invite.role, customer_code:invite.customer_code, site_code:invite.site_code}
    });

    const tenant = await getTenantContextForUser(user);
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + (authConfig().sessionHours * 60 * 60 * 1000);

    authSessions.set(sessionToken, {
      token:sessionToken,
      user,
      tenant,
      created_at:Date.now(),
      expires_at:expiresAt
    });

    await pool.query(`UPDATE app_users SET last_login_at=now(), updated_at=now() WHERE id=$1`, [user.id]);

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'accept_user_invite',
      authenticated:true,
      token:sessionToken,
      user:publicUser(user),
      tenant,
      invite:acceptedInvite,
      expires_at:new Date(expiresAt).toISOString()
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({
      status:e.statusCode === 409 ? 'subscription_quota_blocked' : 'error',
      version:APP_VERSION,
      message:e.message,
      resource:e.resource || null,
      subscription:e.subscription || null,
      usage:e.usage || null,
      access:e.access || null
    });
  }
});


function auditExportEnabled() {
  return String(process.env.AUDIT_EXPORT_ENABLED || 'true').toLowerCase() !== 'false';
}

function auditLimit(raw, fallback = 50, max = 500) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function parseAuditDate(value, endOfDay = false) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildAuditLogWhere(query = {}) {
  const conditions = [];
  const params = [];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const action = String(query.action || '').trim();
  if (action && action !== 'all') {
    conditions.push(`action = ${addParam(action)}`);
  }

  const entityType = String(query.entity_type || '').trim();
  if (entityType && entityType !== 'all') {
    conditions.push(`entity_type = ${addParam(entityType)}`);
  }

  const actorEmail = normalizeEmail(query.actor_email || '');
  if (actorEmail) {
    conditions.push(`lower(actor_email) LIKE lower(${addParam(`%${actorEmail}%`)})`);
  }

  const q = String(query.q || '').trim();
  if (q) {
    const placeholder = addParam(`%${q}%`);
    conditions.push(`(action ILIKE ${placeholder} OR entity_type ILIKE ${placeholder} OR entity_id ILIKE ${placeholder} OR actor_email ILIKE ${placeholder})`);
  }

  const fromDate = parseAuditDate(query.from || query.date_from, false);
  if (fromDate) {
    conditions.push(`created_at >= ${addParam(fromDate)}`);
  }

  const toDate = parseAuditDate(query.to || query.date_to, true);
  if (toDate) {
    conditions.push(`created_at <= ${addParam(toDate)}`);
  }

  return {
    whereSql:conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    filters:{
      action:action || null,
      entity_type:entityType || null,
      actor_email:actorEmail || null,
      q:q || null,
      from:fromDate ? fromDate.toISOString() : null,
      to:toDate ? toDate.toISOString() : null
    }
  };
}

function csvCell(value) {
  const raw = value === null || value === undefined
    ? ''
    : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  return `"${raw.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

app.get('/api/admin/audit-logs/summary', adminRequired, permissionRequired('AUDIT_VIEW'), async (req,res)=>{
  try {
    await ensureAuditLogSchema();
    const {whereSql, params, filters} = buildAuditLogWhere(req.query);

    const totals = await one(
      `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS last_24h,
        count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last_7d,
        count(DISTINCT actor_email)::int AS actor_count,
        max(created_at) AS latest_at
      FROM admin_audit_logs
      ${whereSql}
      `,
      params
    );

    const actions = await pool.query(
      `
      SELECT action, count(*)::int AS count
      FROM admin_audit_logs
      ${whereSql}
      GROUP BY action
      ORDER BY count DESC, action
      LIMIT 12
      `,
      params
    );

    const entities = await pool.query(
      `
      SELECT entity_type, count(*)::int AS count
      FROM admin_audit_logs
      ${whereSql}
      GROUP BY entity_type
      ORDER BY count DESC, entity_type
      LIMIT 12
      `,
      params
    );

    res.json({
      status:'ok',
      version:APP_VERSION,
      filters,
      totals,
      actions:actions.rows,
      entities:entities.rows,
      export_enabled:auditExportEnabled()
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/audit-logs', adminRequired, permissionRequired('AUDIT_VIEW'), async (req,res)=>{
  try {
    await ensureAuditLogSchema();

    const limit = auditLimit(req.query.limit, 50, 500);
    const {whereSql, params, filters} = buildAuditLogWhere(req.query);
    params.push(limit);

    const result = await pool.query(
      `
      SELECT
        id::text,
        actor_user_id,
        actor_email,
        actor_role,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        metadata,
        ip_address,
        user_agent,
        created_at
      FROM admin_audit_logs
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({
      status:'ok',
      version:APP_VERSION,
      filters,
      count:result.rows.length,
      logs:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/audit-logs/export.csv', adminRequired, permissionRequired('AUDIT_VIEW'), async (req,res)=>{
  try {
    if (!auditExportEnabled()) {
      return res.status(403).json({status:'disabled', version:APP_VERSION, message:'Audit CSV export is disabled'});
    }

    await ensureAuditLogSchema();

    const limit = auditLimit(req.query.limit, 500, 5000);
    const {whereSql, params, filters} = buildAuditLogWhere(req.query);
    params.push(limit);

    const result = await pool.query(
      `
      SELECT
        id::text,
        created_at,
        actor_email,
        actor_role,
        action,
        entity_type,
        entity_id,
        ip_address,
        user_agent,
        metadata,
        old_values,
        new_values
      FROM admin_audit_logs
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length}
      `,
      params
    );

    await writeAuditLog(req, {
      action:'export_audit_logs',
      entity_type:'audit_log',
      entity_id:'csv',
      old_values:null,
      new_values:{exported_count:result.rows.length},
      metadata:{filters, limit}
    });

    const headers = ['id','created_at','actor_email','actor_role','action','entity_type','entity_id','ip_address','user_agent','metadata','old_values','new_values'];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of result.rows) {
      lines.push(headers.map(h => csvCell(row[h])).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="factorybox_audit_logs_${APP_VERSION}.csv"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


app.patch('/api/admin/users/:id/status', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    const status = validateChoice(req.body?.status, ['active','inactive','suspended'], 'status');

    if (String(req.user?.id || '') === String(req.params.id || '') && status !== 'active') {
      return res.status(400).json({
        status:'error',
        message:'You cannot disable or suspend your own active admin session'
      });
    }

    const oldUser = await one(
      `SELECT id,email,full_name,role,status,default_customer_code,default_site_code FROM app_users WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );

    const user = await one(
      `
      UPDATE app_users
      SET status=$1, updated_at=now()
      WHERE id=$2
      RETURNING id,email,full_name,role,status,default_customer_code,default_site_code,last_login_at,created_at,updated_at
      `,
      [status, req.params.id]
    );

    if (!user) {
      return res.status(404).json({status:'not_found', user_id:req.params.id});
    }

    await writeAuditLog(req, {
      action:'update_user_status',
      entity_type:'user',
      entity_id:user.id,
      old_values:oldUser,
      new_values:user,
      metadata:{changed_field:'status', old_status:oldUser?.status, new_status:user.status}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'update_user_status',
      user
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', message:e.message});
  }
});

app.patch('/api/admin/users/:id/role', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    const role = validateChoice(req.body?.role, ['viewer','operator','admin','owner','system_admin'], 'role');
    assertRoleChangeAllowed(req.user, role);

    const oldUser = await one(
      `SELECT id,email,full_name,role,status,default_customer_code,default_site_code FROM app_users WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );

    const user = await one(
      `
      UPDATE app_users
      SET role=$1, updated_at=now()
      WHERE id=$2
      RETURNING id,email,full_name,role,status,default_customer_code,default_site_code,last_login_at,created_at,updated_at
      `,
      [role, req.params.id]
    );

    if (!user) {
      return res.status(404).json({status:'not_found', user_id:req.params.id});
    }

    await pool.query(
      `
      UPDATE app_user_tenant_access
      SET access_role=$1
      WHERE lower(user_email)=lower($2)
      `,
      [role === 'viewer' ? 'viewer' : role === 'operator' ? 'operator' : 'owner', user.email]
    );

    await writeAuditLog(req, {
      action:'update_user_role',
      entity_type:'user',
      entity_id:user.id,
      old_values:oldUser,
      new_values:user,
      metadata:{changed_field:'role', old_role:oldUser?.role, new_role:user.role}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'update_user_role',
      user
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', message:e.message});
  }
});

app.patch('/api/admin/customers/:code/status', adminRequired, permissionRequired('MANAGE_CUSTOMERS'), async (req,res)=>{
  try {
    const status = validateChoice(req.body?.status, ['trial','pilot','active','inactive','suspended'], 'status');
    const oldCustomer = await one(
      `SELECT id::text, code, name, status, created_at, updated_at FROM customers WHERE code=$1 LIMIT 1`,
      [req.params.code]
    );

    const customer = await one(
      `
      UPDATE customers
      SET status=$1, updated_at=now()
      WHERE code=$2
      RETURNING id::text, code, name, status, created_at, updated_at
      `,
      [status, req.params.code]
    );

    if (!customer) {
      return res.status(404).json({status:'not_found', customer_code:req.params.code});
    }

    await writeAuditLog(req, {
      action:'update_customer_status',
      entity_type:'customer',
      entity_id:customer.code,
      old_values:oldCustomer,
      new_values:customer,
      metadata:{changed_field:'status', old_status:oldCustomer?.status, new_status:customer.status}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'update_customer_status',
      customer
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', message:e.message});
  }
});

app.patch('/api/admin/sites/:customerCode/:siteCode/status', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    const status = validateChoice(req.body?.status, ['trial','pilot','active','inactive','suspended'], 'status');
    const oldSite = await one(
      `
      SELECT s.id::text, s.code, s.name, s.location, s.status, c.code AS customer_code, c.name AS customer_name, s.created_at, s.updated_at
      FROM sites s
      JOIN customers c ON c.id=s.customer_id
      WHERE c.code=$1 AND s.code=$2
      LIMIT 1
      `,
      [req.params.customerCode, req.params.siteCode]
    );

    const site = await one(
      `
      UPDATE sites s
      SET status=$1, updated_at=now()
      FROM customers c
      WHERE s.customer_id=c.id
        AND c.code=$2
        AND s.code=$3
      RETURNING s.id::text, s.code, s.name, s.location, s.status, c.code AS customer_code, c.name AS customer_name, s.created_at, s.updated_at
      `,
      [status, req.params.customerCode, req.params.siteCode]
    );

    if (!site) {
      return res.status(404).json({status:'not_found', customer_code:req.params.customerCode, site_code:req.params.siteCode});
    }

    await writeAuditLog(req, {
      action:'update_site_status',
      entity_type:'site',
      entity_id:`${site.customer_code}/${site.code}`,
      old_values:oldSite,
      new_values:site,
      metadata:{changed_field:'status', old_status:oldSite?.status, new_status:site.status}
    });

    res.json({
      status:'ok',
      version:APP_VERSION,
      action:'update_site_status',
      site
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', message:e.message});
  }
});


app.use('/api', (req,res,next)=>{
  if (req.path.startsWith('/auth/')) return next();
  if (req.path === '/health') return next();
  return authRequired(req,res,next);
});

app.use('/api/sites/:siteCode', siteAccessRequired);


app.use('/api/sites/:siteCode/ai', (req,res,next)=>{
  try {
    if (!authConfig().enabled || !req.user) {
      return next();
    }

    const path = req.path || '';
    const wantsGenerateOrDelivery =
      path.includes('/email') ||
      path.includes('/openai-report') ||
      path.includes('/daily-report/telegram') ||
      path.includes('/daily-report/print') ||
      String(req.query?.save || '') === '1';

    if (!wantsGenerateOrDelivery) {
      return next();
    }

    if (!hasPermission(req.user, 'SEND_REPORTS')) {
      return res.status(403).json({
        status:'forbidden',
        message:'Permission required: SEND_REPORTS',
        permission:'SEND_REPORTS',
        role:req.user.role
      });
    }

    return next();
  } catch(e) {
    return res.status(500).json({status:'error', message:e.message});
  }
});


app.get('/api/tenant/context', async (req,res)=>{
  try {
    const session = getSession(req);
    const context = await getTenantContextForUser(session?.user || null);
    res.json({
      status:'ok',
      version:APP_VERSION,
      tenant:context
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/tenant/customers', async (req,res)=>{
  try {
    const session = getSession(req);
    const context = await getTenantContextForUser(session?.user || null);
    res.json({
      status:'ok',
      version:APP_VERSION,
      customers:context.customers,
      sites:context.sites
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});


app.use(['/api/machines', '/api/sites', '/api/devices'], authRequired, subscriptionAccessRequired);

app.get('/api/health', async (req,res)=>{
  try {
    const db = await pool.query('SELECT now() AS now');
    const counts = await one(`SELECT (SELECT count(*)::int FROM customers) customers, (SELECT count(*)::int FROM machines) machines, (SELECT count(*)::int FROM devices) devices, (SELECT count(*)::int FROM telemetry_events) telemetry_events, (SELECT count(*)::int FROM machine_state_events) machine_state_events, (SELECT count(*)::int FROM alarms) alarms`);
    res.json({ status:'ok', service:'factorybox-platform-backend', version:APP_VERSION, database_time: db.rows[0].now, mqtt_connected:mqttConnected, mqtt_base_topic:CFG.baseTopic, last_mqtt_message_at:lastMqttMessageAt, last_mqtt_topic:lastMqttTopic, counts });
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
      version:APP_VERSION,
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
      version:APP_VERSION,
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
      version:APP_VERSION,
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
      version:APP_VERSION,
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
        version:APP_VERSION,
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
      version:APP_VERSION,
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
      version:APP_VERSION,
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
      version:APP_VERSION,
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
        `SELECT device_uid, model, firmware_version, platform_name, build_type, firmware_build, status, last_seen_at, raw_device_info FROM devices WHERE machine_id=$1 ORDER BY updated_at DESC LIMIT 1`,
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
      version:APP_VERSION,
      site:{ code:site.code, name:site.name, status:site.status },
      machine_count:rows.length,
      machines:rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});





app.get('/api/machines/:code/device-info', async (req,res)=>{
  try {
    await ensureDeviceInfoSyncSchema();

    const row = await one(
      `
      SELECT
        m.code AS machine_code,
        m.name AS machine_name,
        d.id::text AS device_id,
        d.device_uid,
        d.model,
        d.firmware_version,
        d.platform_name,
        d.build_type,
        d.firmware_build,
        d.status,
        d.last_seen_at,
        d.updated_at,
        d.mqtt_base_topic,
        d.raw_device_info,
        EXTRACT(EPOCH FROM(now() - d.last_seen_at))::int AS last_seen_age_sec
      FROM machines m
      JOIN devices d ON d.machine_id=m.id
      WHERE m.code=$1
      ORDER BY d.updated_at DESC
      LIMIT 1
      `,
      [req.params.code]
    );

    if (!row) {
      return res.status(404).json({status:'not_found', machine_code:req.params.code});
    }

    res.json({
      status:'ok',
      version:APP_VERSION,
      device:row
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/devices/:uid/info', async (req,res)=>{
  try {
    await ensureDeviceInfoSyncSchema();

    const row = await one(
      `
      SELECT
        d.id::text AS device_id,
        d.device_uid,
        d.model,
        d.firmware_version,
        d.platform_name,
        d.build_type,
        d.firmware_build,
        d.status,
        d.last_seen_at,
        d.updated_at,
        d.mqtt_base_topic,
        d.raw_device_info,
        m.code AS machine_code,
        m.name AS machine_name,
        EXTRACT(EPOCH FROM(now() - d.last_seen_at))::int AS last_seen_age_sec
      FROM devices d
      LEFT JOIN machines m ON m.id=d.machine_id
      WHERE d.device_uid=$1
      ORDER BY d.updated_at DESC
      LIMIT 1
      `,
      [req.params.uid]
    );

    if (!row) {
      return res.status(404).json({status:'not_found', device_uid:req.params.uid});
    }

    res.json({
      status:'ok',
      version:APP_VERSION,
      device:row
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

function machineSiteScore(machine) {
  if (machine.latest_report && machine.latest_report.health_score !== null && machine.latest_report.health_score !== undefined) {
    const score = Number(machine.latest_report.health_score);
    if (Number.isFinite(score)) return score;
  }

  let score = 90;

  if (!machine.latest_telemetry) score -= 15;
  if (!machine.latest_state || !machine.latest_state.state) score -= 10;
  if (machine.latest_state && machine.latest_state.state !== 'RUNNING') score -= 10;
  if (Number(machine.active_alarm_count || 0) > 0) score -= 15;

  const temp = Number(machine.latest_telemetry?.temperature_c);
  if (Number.isFinite(temp) && temp >= 30) score -= 5;

  const rssi = Number(machine.latest_telemetry?.wifi_rssi);
  if (Number.isFinite(rssi) && rssi < -65) score -= 5;

  return Math.max(0, Math.min(100, score));
}

function buildSiteTelegramDailyReportText(report) {
  const lines = [];
  lines.push('🏭 FactoryBox Günlük Yönetici Raporu');
  lines.push('');
  lines.push(`Site: ${report.site.name} (${report.site.code})`);
  lines.push(`Genel Skor: ${report.overall_score}/100`);
  lines.push('');
  lines.push('📌 Özet');
  lines.push(report.summary);
  lines.push('');
  lines.push('⚙️ Makine Durumu');
  lines.push(`Toplam makine: ${report.machine_count}`);
  lines.push(`Çalışan: ${report.running_count}`);
  lines.push(`Duruşta/Bilinmiyor: ${report.not_running_count}`);
  lines.push(`Aktif alarm: ${report.active_alarm_total}`);
  lines.push('');
  lines.push('🔎 Bulgular');
  report.findings.forEach(x => lines.push(`• ${x}`));
  lines.push('');
  lines.push('✅ Öneriler');
  report.recommendations.forEach(x => lines.push(`• ${x}`));
  lines.push('');
  lines.push('🧾 Makine Özeti');
  report.machines.forEach(m => {
    lines.push(`• ${m.machine_code}: ${m.state || '-'} | Skor ${m.score}/100 | Alarm ${m.active_alarm_count}`);
  });
  lines.push('');
  lines.push(`Rapor zamanı: ${new Date(report.generated_at).toLocaleString('tr-TR')}`);
  return lines.join('\n');
}

async function getSiteReportCenterRows(siteCode) {
  await ensureAiReportsHistorySchema();

  const site = await one(
    `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
    [siteCode]
  );

  if (!site) return null;

  const machines = await pool.query(
    `SELECT id, code, name, machine_type, status FROM machines WHERE site_id=$1 ORDER BY code`,
    [site.id]
  );

  const rows = [];
  for (const m of machines.rows) {
    const device = await one(
      `SELECT device_uid, model, firmware_version, platform_name, build_type, firmware_build, status, last_seen_at, raw_device_info FROM devices WHERE machine_id=$1 ORDER BY updated_at DESC LIMIT 1`,
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

  return {
    site:{ code:site.code, name:site.name, status:site.status },
    machines:rows
  };
}

function buildSiteDailyReport(center) {
  const machines = center.machines || [];
  const enriched = machines.map(m => {
    const score = machineSiteScore(m);
    return {
      machine_code:m.machine_code,
      machine_name:m.machine_name,
      machine_type:m.machine_type,
      state:m.latest_state?.state || null,
      source:m.latest_state?.source || null,
      temperature_c:m.latest_telemetry?.temperature_c ?? null,
      current_amp:m.latest_telemetry?.current_amp ?? null,
      wifi_rssi:m.latest_telemetry?.wifi_rssi ?? null,
      active_alarm_count:Number(m.active_alarm_count || 0),
      latest_report_id:m.latest_report?.id || null,
      latest_report_score:m.latest_report?.health_score ?? null,
      score
    };
  });

  const machineCount = enriched.length;
  const runningCount = enriched.filter(m => m.state === 'RUNNING').length;
  const notRunningCount = machineCount - runningCount;
  const activeAlarmTotal = enriched.reduce((sum, m) => sum + Number(m.active_alarm_count || 0), 0);
  const machinesWithoutReport = enriched.filter(m => !m.latest_report_id).length;
  const overallScore = machineCount
    ? Math.round(enriched.reduce((sum, m) => sum + Number(m.score || 0), 0) / machineCount)
    : 0;

  const findings = [];
  const recommendations = [];

  findings.push(`${center.site.name} için ${machineCount} makine rapora dahil edildi.`);
  findings.push(`${runningCount} makine çalışıyor, ${notRunningCount} makine duruşta veya bilinmiyor.`);
  findings.push(`Toplam aktif alarm sayısı ${activeAlarmTotal}.`);

  if (machinesWithoutReport > 0) {
    findings.push(`${machinesWithoutReport} makinede henüz SmartAI makine raporu yok.`);
    recommendations.push('Raporu olmayan makineler için günlük makine raporu üretimi planlanmalı.');
  }

  if (activeAlarmTotal > 0) {
    recommendations.push('Aktif alarm olan makineler öncelikli kontrol edilmeli.');
  }

  if (overallScore >= 80) {
    recommendations.push('Genel saha skoru iyi görünüyor. Mevcut çalışma performansı takip edilmeli.');
  } else if (overallScore >= 60) {
    recommendations.push('Genel saha skoru orta seviyede. Alarm ve duruş nedenleri ayrıştırılmalı.');
  } else {
    recommendations.push('Genel saha skoru düşük. Operasyon, bakım ve bağlantı sorunları birlikte incelenmeli.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Sistem normal görünüyor. Veri toplamaya devam edilmeli.');
  }

  const summary = [
    `${center.site.name} günlük yönetici özeti: genel skor ${overallScore}/100.`,
    `${machineCount} makinenin ${runningCount} tanesi çalışıyor.`,
    activeAlarmTotal > 0 ? `${activeAlarmTotal} aktif alarm var.` : 'Aktif alarm görünmüyor.'
  ].join(' ');

  return {
    site: center.site,
    report_type:'site_daily_production',
    generated_at:new Date().toISOString(),
    overall_score:overallScore,
    machine_count:machineCount,
    running_count:runningCount,
    not_running_count:notRunningCount,
    active_alarm_total:activeAlarmTotal,
    machines_without_report:machinesWithoutReport,
    summary,
    findings,
    recommendations,
    machines:enriched
  };
}

async function saveSiteSmartAiReportIfPossible(report) {
  await ensureAiReportsHistorySchema();

  const telegramText = report.telegram_text || buildSiteTelegramDailyReportText(report);
  const saved = await one(
    `
    INSERT INTO ai_reports
      (machine_id, report_type, report_date, health_score, summary, summary_text, report_text, telegram_text, report_json, raw_payload, created_at)
    VALUES
      (NULL, $1, CURRENT_DATE, $2, $3, $3, $3, $4, $5::jsonb, $5::jsonb, now())
    RETURNING id, report_date, created_at
    `,
    [
      report.report_type,
      Number(report.overall_score || 0),
      report.summary,
      telegramText,
      JSON.stringify(report)
    ]
  );

  return {
    saved:true,
    report_id:saved.id,
    report_date:saved.report_date,
    created_at:saved.created_at
  };
}

async function createSiteDailyReport(siteCode, save) {
  const center = await getSiteReportCenterRows(siteCode);
  if (!center) return null;

  const report = buildSiteDailyReport(center);
  const telegram_text = buildSiteTelegramDailyReportText(report);
  const reportWithTelegram = {...report, telegram_text};
  const saveResult = save
    ? await saveSiteSmartAiReportIfPossible(reportWithTelegram)
    : {saved:false, reason:'save query not requested'};

  return {
    report:reportWithTelegram,
    telegram_text,
    saveResult
  };
}

app.get('/api/sites/:siteCode/ai/daily-report', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSiteDailyReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    res.json({
      status:'ok',
      ai_engine:'SmartAI Site Rule Engine',
      version:APP_VERSION,
      site_code:req.params.siteCode,
      saved_to_database:result.saveResult,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/daily-report/telegram', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSiteDailyReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    res.json({
      status:'ok',
      ai_engine:'SmartAI Site Rule Engine',
      version:APP_VERSION,
      site_code:req.params.siteCode,
      saved_to_database:result.saveResult,
      telegram_text:result.telegram_text,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});




app.get('/api/sites/:siteCode/ai/reports', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);

    const result = await pool.query(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        created_at,
        report_json
      FROM ai_reports
      WHERE machine_id IS NULL
        AND report_type='site_daily_production'
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json({
      status:'ok',
      version:APP_VERSION,
      site:{code:site.code, name:site.name, status:site.status},
      count:result.rows.length,
      reports:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/reports/latest', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    const report = await one(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        created_at,
        report_json
      FROM ai_reports
      WHERE machine_id IS NULL
        AND report_type='site_daily_production'
      ORDER BY created_at DESC
      LIMIT 1
      `
    );

    res.json({
      status:'ok',
      version:APP_VERSION,
      site:{code:site.code, name:site.name, status:site.status},
      report:report || null
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/reports/:id', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
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
      WHERE id::text=$1
        AND machine_id IS NULL
        AND report_type='site_daily_production'
      LIMIT 1
      `,
      [String(req.params.id)]
    );

    if (!report) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode, report_id:String(req.params.id)});
    }

    res.json({
      status:'ok',
      version:APP_VERSION,
      site:{code:site.code, name:site.name, status:site.status},
      report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});




function h(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtPrintDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('tr-TR');
}

function siteReportPrintHtml(site, report) {
  const payload = report.report_json || report.raw_payload || report || {};
  const machines = payload.machines || [];
  const findings = payload.findings || [];
  const recommendations = payload.recommendations || [];
  const score = report.health_score ?? payload.overall_score ?? '-';
  const summary = report.summary || payload.summary || '-';
  const createdAt = report.created_at || payload.generated_at || new Date().toISOString();
  const reportId = report.id || 'generated';
  const telegramText = report.telegram_text || payload.telegram_text || '';

  const machineRows = machines.length
    ? machines.map(m => `
      <tr>
        <td>${h(m.machine_code)}</td>
        <td>${h(m.state || '-')}</td>
        <td>${h(m.score ?? '-')} / 100</td>
        <td>${h(m.active_alarm_count ?? 0)}</td>
        <td>${h(m.temperature_c ?? '-')}</td>
        <td>${h(m.wifi_rssi ?? '-')}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="6">Makine verisi yok.</td></tr>`;

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>FactoryBox Site Raporu - ${h(site.code)} - ${h(reportId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #102033; margin: 0; background: #eef3f8; }
    .page { max-width: 980px; margin: 24px auto; background: #fff; padding: 34px; border-radius: 18px; box-shadow: 0 8px 26px rgba(16,32,51,.10); }
    .top { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #dfe7f2; padding-bottom: 18px; margin-bottom: 22px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin-top: 28px; border-bottom: 1px solid #dfe7f2; padding-bottom: 8px; font-size: 19px; }
    h3 { margin-top: 20px; font-size: 16px; }
    .muted { color: #6b7788; }
    .score { font-size: 34px; font-weight: 800; color: #0f8a5f; text-align: right; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
    .card { border: 1px solid #dfe7f2; border-radius: 14px; padding: 14px; background: #f8fbff; }
    .card span { display:block; color:#6b7788; font-size:12px; text-transform:uppercase; margin-bottom:6px; }
    .card strong { font-size: 20px; }
    .summary { font-size: 18px; line-height: 1.55; background: #f8fbff; border: 1px solid #dfe7f2; border-radius: 14px; padding: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #dfe7f2; text-align: left; padding: 10px; vertical-align: top; }
    th { background: #f8fbff; }
    li { margin: 8px 0; line-height: 1.45; }
    pre { white-space: pre-wrap; background: #0f172a; color: #dbeafe; padding: 16px; border-radius: 12px; overflow: auto; }
    .actions { position: sticky; top: 0; background: #eef3f8; padding: 12px; text-align: right; }
    .btn { border: 0; background: #123d64; color: white; padding: 11px 16px; border-radius: 10px; font-weight: 700; cursor: pointer; }
    .btn.secondary { background: #fff; color: #123d64; border: 1px solid #dfe7f2; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #dfe7f2; color: #6b7788; font-size: 12px; }
    @media print {
      body { background: #fff; }
      .actions { display: none; }
      .page { margin: 0; max-width: none; border-radius: 0; box-shadow: none; padding: 20mm; }
      .cards { grid-template-columns: repeat(4, 1fr); }
      h2 { break-after: avoid; }
      table, pre, .summary { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn" onclick="window.print()">PDF Olarak Kaydet / Yazdır</button>
    <button class="btn secondary" onclick="window.close()">Kapat</button>
  </div>

  <main class="page">
    <section class="top">
      <div>
        <h1>FactoryBox Günlük Yönetici Raporu</h1>
        <p class="muted">Site: ${h(site.name || site.code)} (${h(site.code)})</p>
        <p class="muted">Rapor ID: ${h(reportId)} - Tarih: ${h(fmtPrintDate(createdAt))}</p>
      </div>
      <div>
        <div class="score">${h(score)} / 100</div>
        <p class="muted">Genel Fabrika Skoru</p>
      </div>
    </section>

    <section class="cards">
      <div class="card"><span>Toplam Makine</span><strong>${h(payload.machine_count ?? machines.length ?? 0)}</strong></div>
      <div class="card"><span>Çalışan</span><strong>${h(payload.running_count ?? '-')}</strong></div>
      <div class="card"><span>Duruş/Bilinmiyor</span><strong>${h(payload.not_running_count ?? '-')}</strong></div>
      <div class="card"><span>Aktif Alarm</span><strong>${h(payload.active_alarm_total ?? '-')}</strong></div>
    </section>

    <h2>Özet</h2>
    <p class="summary">${h(summary)}</p>

    <h2>Makine Bazlı Özet</h2>
    <table>
      <thead>
        <tr>
          <th>Makine</th>
          <th>Durum</th>
          <th>Skor</th>
          <th>Alarm</th>
          <th>Sıcaklık</th>
          <th>RSSI</th>
        </tr>
      </thead>
      <tbody>${machineRows}</tbody>
    </table>

    <h2>Bulgular</h2>
    <ul>${findings.length ? findings.map(x => `<li>${h(x)}</li>`).join('') : '<li>Veri yok</li>'}</ul>

    <h2>Öneriler</h2>
    <ul>${recommendations.length ? recommendations.map(x => `<li>${h(x)}</li>`).join('') : '<li>Veri yok</li>'}</ul>

    ${telegramText ? `<h2>Telegram Mesajı</h2><pre>${h(telegramText)}</pre>` : ''}

    <div class="footer">
      FactoryBox / MiaDeviceOS - PDF Export View - v5.7.0
    </div>
  </main>
</body>
</html>`;
}

app.get('/api/sites/:siteCode/ai/reports/latest/print', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) return res.status(404).send('Site bulunamadı.');

    const report = await one(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        report_json,
        raw_payload,
        created_at
      FROM ai_reports
      WHERE machine_id IS NULL
        AND report_type='site_daily_production'
      ORDER BY created_at DESC
      LIMIT 1
      `
    );

    if (!report) return res.status(404).send('Kayıtlı site raporu yok.');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(siteReportPrintHtml(site, report));
  } catch(e) {
    res.status(500).send(h(e.message));
  }
});

app.get('/api/sites/:siteCode/ai/reports/:id/print', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) return res.status(404).send('Site bulunamadı.');

    const report = await one(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        report_json,
        raw_payload,
        created_at
      FROM ai_reports
      WHERE id::text=$1
        AND machine_id IS NULL
        AND report_type='site_daily_production'
      LIMIT 1
      `,
      [String(req.params.id)]
    );

    if (!report) return res.status(404).send('Rapor bulunamadı.');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(siteReportPrintHtml(site, report));
  } catch(e) {
    res.status(500).send(h(e.message));
  }
});

app.get('/api/sites/:siteCode/ai/daily-report/print', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSiteDailyReport(req.params.siteCode, shouldSave);

    if (!result) return res.status(404).send('Site raporu oluşturulamadı.');

    const report = {
      id: result.saveResult?.report_id || 'generated',
      report_type: result.report.report_type,
      report_date: result.saveResult?.report_date || new Date().toISOString(),
      health_score: result.report.overall_score,
      summary: result.report.summary,
      telegram_text: result.telegram_text,
      report_json: result.report,
      raw_payload: result.report,
      created_at: result.saveResult?.created_at || result.report.generated_at
    };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(siteReportPrintHtml(result.report.site || {code:req.params.siteCode, name:req.params.siteCode}, report));
  } catch(e) {
    res.status(500).send(h(e.message));
  }
});




function openAiConfig() {
  return {
    enabled: Boolean(process.env.OPENAI_API_KEY) && String(process.env.SMARTAI_OPENAI_ENABLED || 'true').toLowerCase() !== 'false',
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-5-mini'
  };
}

function extractOpenAiText(data) {
  if (!data) return '';

  if (typeof data.output_text === 'string') {
    return data.output_text;
  }

  const chunks = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (typeof item?.content === 'string') chunks.push(item.content);
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string') chunks.push(c.text);
          if (typeof c?.content === 'string') chunks.push(c.content);
          if (typeof c?.output_text === 'string') chunks.push(c.output_text);
        }
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseJsonFromText(text) {
  if (!text) return null;

  let clean = String(text).trim();
  clean = clean.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(clean);
  } catch {}

  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch {}
  }

  return null;
}

function buildOpenAiPrompt(baseReport) {
  const compact = {
    site: baseReport.site,
    overall_score: baseReport.overall_score,
    machine_count: baseReport.machine_count,
    running_count: baseReport.running_count,
    not_running_count: baseReport.not_running_count,
    active_alarm_total: baseReport.active_alarm_total,
    machines_without_report: baseReport.machines_without_report,
    summary: baseReport.summary,
    findings: baseReport.findings,
    recommendations: baseReport.recommendations,
    machines: baseReport.machines
  };

  return [
    'Sen FactoryBox üretim takip platformu için Türkçe yönetici raporu yazan bir endüstriyel üretim analistisin.',
    'Verilen JSON verisini kullan. Uydurma veri ekleme. Kısa, net, yönetici seviyesinde yaz.',
    'Sadece geçerli JSON döndür. Markdown kullanma.',
    'JSON şeması:',
    '{',
    '  "summary": "2-3 cümlelik yönetici özeti",',
    '  "executive_comment": "tek paragraf yönetici yorumu",',
    '  "findings": ["bulgu 1", "bulgu 2"],',
    '  "recommendations": ["öneri 1", "öneri 2"],',
    '  "risks": ["risk 1", "risk 2"],',
    '  "action_items": ["aksiyon 1", "aksiyon 2"]',
    '}',
    'Veri:',
    JSON.stringify(compact, null, 2)
  ].join('\n');
}

async function callOpenAiForSiteReport(baseReport) {
  const cfg = openAiConfig();

  if (!cfg.configured) {
    return {
      ok:false,
      reason:'OPENAI_API_KEY not configured',
      model:cfg.model,
      parsed:null,
      raw_text:null
    };
  }

  if (!cfg.enabled) {
    return {
      ok:false,
      reason:'SMARTAI_OPENAI_ENABLED=false',
      model:cfg.model,
      parsed:null,
      raw_text:null
    };
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      model:cfg.model,
      input:buildOpenAiPrompt(baseReport)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok:false,
      reason:data?.error?.message || `OpenAI API error ${response.status}`,
      model:cfg.model,
      parsed:null,
      raw_text:null,
      raw_response:data
    };
  }

  const text = extractOpenAiText(data);
  const parsed = parseJsonFromText(text);

  return {
    ok:Boolean(parsed),
    reason:parsed ? null : 'OpenAI response could not be parsed as JSON',
    model:cfg.model,
    parsed,
    raw_text:text,
    raw_response_id:data?.id || null
  };
}

function normalizeAiArray(value, fallback = []) {
  return Array.isArray(value)
    ? value.map(x => String(x)).filter(Boolean).slice(0, 8)
    : fallback;
}

function buildOpenAiTelegramSiteReportText(report) {
  const lines = [];
  lines.push('🏭 FactoryBox OpenAI SmartAI Yönetici Raporu');
  lines.push('');
  lines.push(`Site: ${report.site.name} (${report.site.code})`);
  lines.push(`Genel Skor: ${report.overall_score}/100`);
  lines.push(`AI Engine: ${report.ai_engine}`);
  if (report.openai_model) lines.push(`Model: ${report.openai_model}`);
  lines.push('');
  lines.push('📌 Yönetici Özeti');
  lines.push(report.summary);
  if (report.executive_comment) {
    lines.push('');
    lines.push('🧠 AI Yorumu');
    lines.push(report.executive_comment);
  }
  lines.push('');
  lines.push('⚙️ Durum');
  lines.push(`Toplam makine: ${report.machine_count}`);
  lines.push(`Çalışan: ${report.running_count}`);
  lines.push(`Duruşta/Bilinmiyor: ${report.not_running_count}`);
  lines.push(`Aktif alarm: ${report.active_alarm_total}`);
  lines.push('');
  lines.push('🔎 Bulgular');
  report.findings.forEach(x => lines.push(`• ${x}`));
  lines.push('');
  lines.push('✅ Öneriler');
  report.recommendations.forEach(x => lines.push(`• ${x}`));
  if (report.risks && report.risks.length) {
    lines.push('');
    lines.push('⚠️ Riskler');
    report.risks.forEach(x => lines.push(`• ${x}`));
  }
  if (report.action_items && report.action_items.length) {
    lines.push('');
    lines.push('📍 Aksiyonlar');
    report.action_items.forEach(x => lines.push(`• ${x}`));
  }
  lines.push('');
  lines.push(`Rapor zamanı: ${new Date(report.generated_at).toLocaleString('tr-TR')}`);
  return lines.join('\n');
}

async function createOpenAiSiteReport(siteCode, save) {
  const base = await createSiteDailyReport(siteCode, false);
  if (!base) return null;

  const baseReport = base.report;
  const ai = await callOpenAiForSiteReport(baseReport);

  const upgraded = {
    ...baseReport,
    ai_engine: ai.ok ? 'OpenAI Responses API + FactoryBox Rules' : 'FactoryBox Rules Fallback',
    openai_enabled: openAiConfig().enabled,
    openai_configured: openAiConfig().configured,
    openai_model: ai.model,
    openai_status: ai.ok ? 'ok' : 'fallback',
    openai_reason: ai.reason,
    openai_response_id: ai.raw_response_id || null,
    generated_at:new Date().toISOString(),
    summary: ai.parsed?.summary || baseReport.summary,
    executive_comment: ai.parsed?.executive_comment || null,
    findings: normalizeAiArray(ai.parsed?.findings, baseReport.findings),
    recommendations: normalizeAiArray(ai.parsed?.recommendations, baseReport.recommendations),
    risks: normalizeAiArray(ai.parsed?.risks, []),
    action_items: normalizeAiArray(ai.parsed?.action_items, []),
    base_rule_report: baseReport
  };

  const telegram_text = buildOpenAiTelegramSiteReportText(upgraded);
  const reportWithTelegram = {...upgraded, telegram_text};

  const saveResult = save
    ? await saveSiteSmartAiReportIfPossible(reportWithTelegram)
    : {saved:false, reason:'save query not requested'};

  return {
    report:reportWithTelegram,
    telegram_text,
    saveResult,
    openai: {
      ok:ai.ok,
      reason:ai.reason,
      model:ai.model,
      configured:openAiConfig().configured,
      enabled:openAiConfig().enabled
    }
  };
}

app.get('/api/ai/openai/status', async (req,res)=>{
  const cfg = openAiConfig();
  res.json({
    status:'ok',
    version:APP_VERSION,
    openai:{
      configured:cfg.configured,
      enabled:cfg.enabled,
      model:cfg.model,
      api_key_present:cfg.configured
    }
  });
});

app.get('/api/sites/:siteCode/ai/openai-report', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createOpenAiSiteReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    res.json({
      status:'ok',
      ai_engine:result.report.ai_engine,
      version:APP_VERSION,
      site_code:req.params.siteCode,
      openai:result.openai,
      saved_to_database:result.saveResult,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/openai-report/telegram', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createOpenAiSiteReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    res.json({
      status:'ok',
      ai_engine:result.report.ai_engine,
      version:APP_VERSION,
      site_code:req.params.siteCode,
      openai:result.openai,
      saved_to_database:result.saveResult,
      telegram_text:result.telegram_text,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});




function emailConfig() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secureEnv = String(process.env.SMTP_SECURE || '').toLowerCase();

  return {
    enabled: String(process.env.EMAIL_REPORTS_ENABLED || 'true').toLowerCase() !== 'false',
    host: process.env.SMTP_HOST || '',
    port,
    secure: secureEnv === 'true' || port === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    defaultTo: process.env.REPORT_EMAIL_TO || '',
    configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.SMTP_FROM || process.env.SMTP_USER))
  };
}

function splitEmails(value) {
  return String(value || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emailSubjectForReport(site, report, prefix = 'FactoryBox Günlük Rapor') {
  const score = report.health_score ?? report.overall_score ?? report.report_json?.overall_score ?? '-';
  const siteName = site?.name || site?.code || 'site';
  const date = new Date(report.created_at || report.generated_at || Date.now()).toLocaleDateString('tr-TR');
  return `${prefix} - ${siteName} - Skor ${score}/100 - ${date}`;
}

async function sendReportEmail({to, subject, html, text}) {
  const cfg = emailConfig();

  if (!cfg.enabled) {
    return {sent:false, reason:'EMAIL_REPORTS_ENABLED=false'};
  }

  if (!cfg.configured) {
    return {sent:false, reason:'SMTP settings not configured'};
  }

  const recipients = splitEmails(to || cfg.defaultTo);
  if (!recipients.length) {
    return {sent:false, reason:'Recipient email not configured'};
  }

  const transporter = nodemailer.createTransport({
    host:cfg.host,
    port:cfg.port,
    secure:cfg.secure,
    auth:{
      user:cfg.user,
      pass:cfg.pass
    }
  });

  const info = await transporter.sendMail({
    from:cfg.from,
    to:recipients.join(','),
    subject,
    text:text || stripHtml(html),
    html
  });

  return {
    sent:true,
    message_id:info.messageId || null,
    accepted:info.accepted || [],
    rejected:info.rejected || [],
    to:recipients
  };
}

function emailShellHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>${h(title)}</title>
</head>
<body style="margin:0;padding:0;background:#eef3f8;font-family:Arial,Helvetica,sans-serif;color:#102033;">
  <div style="max-width:980px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #dfe7f2;">
      ${bodyHtml}
    </div>
    <p style="color:#6b7788;font-size:12px;margin-top:14px;">FactoryBox / MiaDeviceOS - Email Report Delivery - v5.7.0</p>
  </div>
</body>
</html>`;
}

function siteReportEmailHtml(site, report) {
  const printHtml = siteReportPrintHtml(site, report);
  const bodyMatch = printHtml.match(/<main class="page">([\s\S]*?)<\/main>/i);
  const body = bodyMatch ? bodyMatch[1] : printHtml;
  const cleaned = body
    .replace(/<section class="top">/g, '<section>')
    .replace(/class="[^"]*"/g, '')
    .replace(/<button[\s\S]*?<\/button>/gi, '');
  return emailShellHtml('FactoryBox Günlük Yönetici Raporu', cleaned);
}

app.get('/api/email/status', async (req,res)=>{
  const cfg = emailConfig();
  res.json({
    status:'ok',
    version:APP_VERSION,
    email:{
      enabled:cfg.enabled,
      configured:cfg.configured,
      host:cfg.host ? 'set' : 'missing',
      port:cfg.port,
      secure:cfg.secure,
      from:cfg.from ? 'set' : 'missing',
      default_to:cfg.defaultTo ? 'set' : 'missing'
    }
  });
});

app.get('/api/sites/:siteCode/ai/reports/latest/email', async (req,res)=>{
  try {
    await ensureAiReportsHistorySchema();

    const site = await one(
      `SELECT id, code, name, status FROM sites WHERE code=$1 LIMIT 1`,
      [req.params.siteCode]
    );

    if (!site) return res.status(404).json({status:'not_found', site_code:req.params.siteCode});

    const report = await one(
      `
      SELECT
        id::text AS id,
        report_type,
        report_date,
        health_score,
        summary,
        telegram_text,
        report_json,
        raw_payload,
        created_at
      FROM ai_reports
      WHERE machine_id IS NULL
        AND report_type='site_daily_production'
      ORDER BY created_at DESC
      LIMIT 1
      `
    );

    if (!report) return res.status(404).json({status:'not_found', reason:'no saved site report'});

    const html = siteReportEmailHtml(site, report);
    const result = await sendReportEmail({
      to:req.query.to,
      subject:emailSubjectForReport(site, report),
      html
    });

    res.json({
      status:result.sent ? 'ok' : 'not_sent',
      version:APP_VERSION,
      site_code:req.params.siteCode,
      report_id:report.id,
      email:result
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/daily-report/email', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createSiteDailyReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    const report = {
      id:result.saveResult?.report_id || 'generated',
      report_type:result.report.report_type,
      report_date:result.saveResult?.report_date || new Date().toISOString(),
      health_score:result.report.overall_score,
      summary:result.report.summary,
      telegram_text:result.telegram_text,
      report_json:result.report,
      raw_payload:result.report,
      created_at:result.saveResult?.created_at || result.report.generated_at
    };

    const html = siteReportEmailHtml(result.report.site, report);
    const email = await sendReportEmail({
      to:req.query.to,
      subject:emailSubjectForReport(result.report.site, report),
      html
    });

    res.json({
      status:email.sent ? 'ok' : 'not_sent',
      version:APP_VERSION,
      site_code:req.params.siteCode,
      saved_to_database:result.saveResult,
      email,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});

app.get('/api/sites/:siteCode/ai/openai-report/email', async (req,res)=>{
  try {
    const shouldSave = req.query.save === 'true' || req.query.save === '1';
    const result = await createOpenAiSiteReport(req.params.siteCode, shouldSave);

    if (!result) {
      return res.status(404).json({status:'not_found', site_code:req.params.siteCode});
    }

    const report = {
      id:result.saveResult?.report_id || 'generated',
      report_type:result.report.report_type || 'site_daily_production',
      report_date:result.saveResult?.report_date || new Date().toISOString(),
      health_score:result.report.overall_score,
      summary:result.report.summary,
      telegram_text:result.telegram_text,
      report_json:result.report,
      raw_payload:result.report,
      created_at:result.saveResult?.created_at || result.report.generated_at
    };

    const html = siteReportEmailHtml(result.report.site, report);
    const email = await sendReportEmail({
      to:req.query.to,
      subject:emailSubjectForReport(result.report.site, report, 'FactoryBox OpenAI SmartAI Raporu'),
      html
    });

    res.json({
      status:email.sent ? 'ok' : 'not_sent',
      version:APP_VERSION,
      site_code:req.params.siteCode,
      openai:result.openai,
      saved_to_database:result.saveResult,
      email,
      report:result.report
    });
  } catch(e) {
    res.status(500).json({status:'error', message:e.message});
  }
});


async function start() {
  await pool.query('SELECT 1');
  await ensureEntities();
  await ensureSaasFoundation();
  await ensurePasswordResetSchema();
  await ensureAuditLogSchema();
  await ensureInviteSchema();
  await ensureBillingFoundation();
  await ensureDeviceRegistrySchema();
  await ensureAssetManagementFoundation();
  await ensureLiveMonitoringFoundation();
  const client = mqtt.connect(CFG.mqttUrl, { clientId:`factorybox-platform-backend-${Math.random().toString(16).slice(2)}`, clean:true, reconnectPeriod:3000 });
  client.on('connect',()=>{ mqttConnected=true; client.subscribe(`${CFG.baseTopic}/#`, (err)=> console.log(err ? err.message : `MQTT subscribed: ${CFG.baseTopic}/#`)); });
  client.on('close',()=>{ mqttConnected=false; });
  client.on('error',(e)=> console.error('MQTT error:', e.message));
  client.on('message', handleMessage);
  app.listen(PORT, ()=> console.log(`FactoryBox Platform Backend + SmartAI MVP: http://localhost:${PORT}`));
}
start().catch(e=>{ console.error('Backend start failed:', e); process.exit(1); });


