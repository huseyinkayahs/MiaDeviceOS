require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const mqtt = require('mqtt');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

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
app.disable('x-powered-by');
app.set('trust proxy', 1);

const apiRateBuckets = new Map();
const loginRateBuckets = new Map();
const mailGatewayMinuteBuckets = new Map();
const mailGatewayDailyBuckets = new Map();
let securityFoundationReady = false;
let securitySettingsCache = {
  session_hours:12,
  idle_timeout_minutes:30,
  max_failed_attempts:5,
  lockout_minutes:15,
  password_min_length:10,
  password_require_upper:true,
  password_require_lower:true,
  password_require_number:true,
  password_require_special:true,
  api_rate_limit_per_minute:300,
  login_rate_limit_per_15m:20,
  suspicious_login_telegram:true,
  secure_headers_enabled:true,
  csrf_origin_check_enabled:true
};

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    return parsed.origin.toLowerCase();
  } catch (_) {
    return null;
  }
}

function configuredCorsOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

function firstForwardedHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function effectiveRequestOrigin(req) {
  const forwardedProto = firstForwardedHeaderValue(req.headers['x-forwarded-proto']).toLowerCase();
  const forwardedHost = firstForwardedHeaderValue(req.headers['x-forwarded-host']).toLowerCase();
  const protocol = forwardedProto || (req.secure ? 'https' : String(req.protocol || 'http').toLowerCase());
  const host = forwardedHost || String(req.headers.host || '').trim().toLowerCase();
  if (!host) return null;
  return normalizeOrigin(`${protocol}://${host}`);
}

function isSameRequestOrigin(req, origin) {
  const normalized = normalizeOrigin(origin);
  const requestOrigin = effectiveRequestOrigin(req);
  return Boolean(normalized && requestOrigin && normalized === requestOrigin);
}

function isTryCloudflareHostname(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname === 'trycloudflare.com' || hostname.endsWith('.trycloudflare.com');
  } catch (_) {
    return false;
  }
}

function isTrustedQuickTunnelOriginForRequest(req, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const suffix = '.trycloudflare.com';
    const isQuickTunnel = parsed.protocol === 'https:'
      && !parsed.port
      && parsed.hostname.toLowerCase().endsWith(suffix)
      && parsed.hostname.length > suffix.length;
    return isQuickTunnel && isSameRequestOrigin(req, normalized);
  } catch (_) {
    return false;
  }
}

function isAllowedRequestOrigin(req, origin, { allowAnyWhenUnconfigured = false } = {}) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  // Quick Tunnel origins are accepted only over HTTPS and only when the
  // public tunnel host exactly matches the host currently serving the request.
  if (isTryCloudflareHostname(normalized)) {
    return isTrustedQuickTunnelOriginForRequest(req, normalized);
  }

  if (isSameRequestOrigin(req, normalized)) return true;
  if (configuredCorsOrigins().includes(normalized)) return true;
  return allowAnyWhenUnconfigured && configuredCorsOrigins().length === 0;
}

app.use((req,res,next)=>{
  if (securitySettingsCache.secure_headers_enabled !== false) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const forwardedProto=String(req.headers['x-forwarded-proto']||'').toLowerCase();
    if (req.secure || forwardedProto==='https') res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
  next();
});

app.use((req,res,next)=>{
  const origin=String(req.headers.origin||'').trim();
  const allowAnyWhenUnconfigured=configuredCorsOrigins().length===0;
  if (!origin || isAllowedRequestOrigin(req,origin,{allowAnyWhenUnconfigured})) return next();
  return res.status(403).json({
    status:'forbidden',
    code:'ORIGIN_NOT_ALLOWED',
    message:'Request origin is not allowed'
  });
});

app.use(cors({
  origin:true,
  methods:['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization','X-CSRF-Token'],
  maxAge:600
}));
app.use(express.json({limit:'1mb'}));

function consumeRateBucket(store,key,limit,windowMs) {
  const now=Date.now();
  let bucket=store.get(key);
  if (!bucket || now>=bucket.reset_at) bucket={count:0,reset_at:now+windowMs};
  bucket.count+=1;store.set(key,bucket);
  if (store.size>10000) for (const [k,v] of store.entries()) if (now>=v.reset_at) store.delete(k);
  return {allowed:bucket.count<=limit,remaining:Math.max(0,limit-bucket.count),reset_at:bucket.reset_at};
}

app.use('/api',(req,res,next)=>{
  const limit=Math.max(60,Number(securitySettingsCache.api_rate_limit_per_minute||300));
  const result=consumeRateBucket(apiRateBuckets,`${reqIp(req)}:${Math.floor(Date.now()/60000)}`,limit,60000);
  res.setHeader('X-RateLimit-Limit',String(limit));
  res.setHeader('X-RateLimit-Remaining',String(result.remaining));
  if (!result.allowed) return res.status(429).json({status:'rate_limited',message:'Too many API requests. Please try again shortly.'});
  next();
});

app.use('/api',(req,res,next)=>{
  if (!securitySettingsCache.csrf_origin_check_enabled || ['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin=String(req.headers.origin||'').trim();
  if (!origin) return next();
  if (isAllowedRequestOrigin(req,origin)) return next();
  return res.status(403).json({
    status:'forbidden',
    code:'ORIGIN_VERIFICATION_FAILED',
    message:'Request origin verification failed'
  });
});

function mailGatewayOnlyEnabled() {
  return String(process.env.MAIL_GATEWAY_ONLY || 'false').toLowerCase() === 'true';
}

// A central gateway deployment exposes only health and mail-gateway APIs.
app.use((req,res,next)=>{
  if (!mailGatewayOnlyEnabled()) return next();
  if (req.path === '/healthz' || req.path === '/readyz' || req.path.startsWith('/api/mail-gateway/')) return next();
  return res.status(404).json({
    status:'not_found',
    version:'6.11.0',
    service:'hukatech-central-mail-gateway'
  });
});

// Production entry point: always open the current Admin Panel instead of a legacy index.html.
app.get(['/', '/index.html'], (_req, res) => {
  res.redirect(302, '/admin.html');
});

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
let mqttClient = null;
let httpServer = null;
let lastMqttMessageAt = null;
let lastMqttTopic = null;
let ids = null;
let billingFoundationReady = false;
let inviteSchemaReady = false;
let deviceOnboardingFoundationReady = false;
let deviceCapabilityFoundationReady = false;
let organizationFoundationReady = false;
const authSessions = new Map();
const passwordResetRequestWindow = new Map();

const APP_VERSION = '6.13.2';


app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'factorybox-backend',
    version: APP_VERSION,
    uptime_sec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/readyz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ready',
      service: 'factorybox-backend',
      version: APP_VERSION,
      database: 'connected',
      mqtt: mqttConnected ? 'connected' : 'not_connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      service: 'factorybox-backend',
      version: APP_VERSION,
      database: 'disconnected',
      message: String(error.message || error),
      timestamp: new Date().toISOString()
    });
  }
});

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

function alarmEscalationQueueEnabled() {
  return String(process.env.ALARM_ESCALATION_QUEUE_ENABLED || 'true').toLowerCase() !== 'false';
}

let notificationRuntimeSettings = {};

function runtimeNotificationValue(key, fallback) {
  const value = notificationRuntimeSettings[key];
  return value === null || value === undefined ? fallback : value;
}

function runtimeBoolean(key, envName, fallback) {
  const value = runtimeNotificationValue(key, process.env[envName]);
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function alarmEscalationDeliveryEnabled() {
  return runtimeBoolean('delivery_enabled', 'ALARM_ESCALATION_DELIVERY_ENABLED', true);
}

function alarmEscalationAutoDeliveryEnabled() {
  return runtimeBoolean('auto_delivery_enabled', 'ALARM_ESCALATION_AUTO_DELIVERY_ENABLED', false);
}

function alarmEscalationDeliveryIntervalSec() {
  const value = Number(runtimeNotificationValue('interval_sec', process.env.ALARM_ESCALATION_DELIVERY_INTERVAL_SEC || 60));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15), 3600) : 60;
}

function alarmEscalationDeliveryBatchSize() {
  const value = Number(runtimeNotificationValue('batch_size', process.env.ALARM_ESCALATION_DELIVERY_BATCH_SIZE || 20));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 100) : 20;
}

function alarmAutomationSchedulerEnabled() {
  return runtimeBoolean('scheduler_enabled', 'ALARM_AUTOMATION_SCHEDULER_ENABLED', false);
}

function alarmAutomationSchedulerIntervalSec() {
  const value = Number(runtimeNotificationValue('scheduler_interval_sec', process.env.ALARM_AUTOMATION_SCHEDULER_INTERVAL_SEC || 60));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15), 3600) : 60;
}

function alarmEscalationRetryEnabled() {
  return runtimeBoolean('retry_enabled', 'ALARM_ESCALATION_RETRY_ENABLED', true);
}

function alarmEscalationRetryBaseDelaySec() {
  const value = Number(runtimeNotificationValue('retry_base_delay_sec', process.env.ALARM_ESCALATION_RETRY_BASE_DELAY_SEC || 60));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15), 86400) : 60;
}

function alarmEscalationRetryMaxDelaySec() {
  const base = alarmEscalationRetryBaseDelaySec();
  const value = Number(runtimeNotificationValue('retry_max_delay_sec', process.env.ALARM_ESCALATION_RETRY_MAX_DELAY_SEC || 3600));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), base), 604800) : Math.max(base, 3600);
}

function alarmEscalationRetryMaxAttempts() {
  const value = Number(runtimeNotificationValue('retry_max_attempts', process.env.ALARM_ESCALATION_RETRY_MAX_ATTEMPTS || 5));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 20) : 5;
}

function alarmReportSchedulerEnabled() {
  return runtimeBoolean('alarm_report_scheduler_enabled', 'ALARM_REPORT_SCHEDULER_ENABLED', false);
}

function validateAlarmReportTimezone(value) {
  const timezone = String(value || 'Europe/Istanbul').trim() || 'Europe/Istanbul';
  try {
    new Intl.DateTimeFormat('en-US', {timeZone:timezone}).format(new Date());
    return timezone;
  } catch {
    return 'Europe/Istanbul';
  }
}

function alarmReportTimezone() {
  return validateAlarmReportTimezone(runtimeNotificationValue('alarm_report_timezone', process.env.ALARM_REPORT_TIMEZONE || 'Europe/Istanbul'));
}

function alarmReportChannels() {
  const raw = String(runtimeNotificationValue('alarm_report_channels', process.env.ALARM_REPORT_CHANNELS || 'telegram') || 'telegram').toLowerCase();
  const channels = raw.split(/[,+]/).map(value => value.trim()).filter(value => ['telegram','email'].includes(value));
  return [...new Set(channels.length ? channels : ['telegram'])];
}

function alarmReportTelegramChatIds() {
  return String(runtimeNotificationValue('alarm_report_telegram_chat_ids', process.env.ALARM_REPORT_TELEGRAM_CHAT_IDS || '') || '').trim();
}

function alarmReportEmailRecipients() {
  return String(runtimeNotificationValue('alarm_report_email_recipients', process.env.ALARM_REPORT_EMAIL_RECIPIENTS || '') || '').trim();
}

function alarmReportDailyEnabled() {
  return runtimeBoolean('alarm_report_daily_enabled', 'ALARM_REPORT_DAILY_ENABLED', true);
}

function alarmReportDailyHour() {
  const value = Number(runtimeNotificationValue('alarm_report_daily_hour', process.env.ALARM_REPORT_DAILY_HOUR || 8));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 23) : 8;
}

function alarmReportWeeklyEnabled() {
  return runtimeBoolean('alarm_report_weekly_enabled', 'ALARM_REPORT_WEEKLY_ENABLED', true);
}

function alarmReportWeeklyDay() {
  const value = Number(runtimeNotificationValue('alarm_report_weekly_day', process.env.ALARM_REPORT_WEEKLY_DAY || 1));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 6) : 1;
}

function alarmReportWeeklyHour() {
  const value = Number(runtimeNotificationValue('alarm_report_weekly_hour', process.env.ALARM_REPORT_WEEKLY_HOUR || 8));
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 23) : 8;
}

function telegramEscalationConfig() {
  const token = String(runtimeNotificationValue('telegram_bot_token', process.env.TELEGRAM_BOT_TOKEN || '') || '').trim();
  const defaultChatId = String(runtimeNotificationValue('telegram_chat_id', process.env.TELEGRAM_CHAT_ID || '') || '').trim();
  return {
    enabled:runtimeBoolean('telegram_enabled', 'TELEGRAM_ESCALATION_ENABLED', true),
    token,
    defaultChatId,
    configured:Boolean(token && defaultChatId)
  };
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

function payloadDeviceUid(payload = {}) {
  const info = payload.device_info || payload.device || payload.info || {};
  return firstValue(
    payload.device_uid,
    payload.device_id,
    payload.deviceId,
    info.device_uid,
    info.device_id,
    info.uid,
    info.id
  );
}

async function resolveEntitiesFromPayload(payload = {}) {
  const rawDeviceUid = payloadDeviceUid(payload);

  // Legacy payloads without a device identity continue to use the configured
  // default entity. A payload that explicitly names an unknown device is never
  // written under the default device.
  if (rawDeviceUid === null || rawDeviceUid === undefined || rawDeviceUid === '') {
    return ensureEntities();
  }

  const deviceUid = String(rawDeviceUid);
  const row = await one(`
    SELECT
      d.id AS device_id,
      d.device_uid,
      d.model AS device_model,
      d.machine_id,
      m.code AS machine_code,
      m.name AS machine_name
    FROM devices d
    JOIN machines m ON m.id = d.machine_id
    WHERE d.device_uid = $1
    LIMIT 1
  `, [deviceUid]);

  if (!row) {
    console.warn('MQTT.device.unmapped', { device_uid: deviceUid });
    return null;
  }

  return {
    device: {
      id: row.device_id,
      device_uid: row.device_uid,
      model: row.device_model,
      machine_id: row.machine_id
    },
    machine: {
      id: row.machine_id,
      code: row.machine_code,
      name: row.machine_name
    }
  };
}

async function syncDeviceInfoFromPayload(payload = {}, source = 'mqtt') {
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return null;
  const { device } = entities;
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
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return;
  const { machine, device } = entities;
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
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return;
  const { machine, device } = entities;
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
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return;
  const { machine, device } = entities;

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
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return;
  const { machine } = entities;
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
  const entities = await resolveEntitiesFromPayload(payload);
  if (!entities) return;
  const { machine } = entities;
  await pool.query(`INSERT INTO workflow_events(workflow_name,machine_id,event_type,status,event_ts,raw_payload) VALUES('platform-backend-mvp',$1,$2,$3,now(),$4::jsonb)`, [machine.id, eventType, payload.status || 'done', JSON.stringify(payload)]);
}

async function commandStatus(payload) {
  await workflow(`command_status_${payload.command || 'unknown'}`, payload);
  if (payload.command === 'set_capabilities') await recordCapabilityCommandStatus(payload);
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
    'VIEW_DASHBOARD',
    'VIEW_MAINTENANCE',
    'MANAGE_MAINTENANCE'
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
    'VIEW_DASHBOARD',
    'VIEW_MAINTENANCE',
    'MANAGE_MAINTENANCE'
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
    'VIEW_DASHBOARD',
    'VIEW_MAINTENANCE',
    'MANAGE_MAINTENANCE'
  ],
  operator: [
    'SEND_REPORTS',
    'VIEW_REPORTS',
    'VIEW_DASHBOARD',
    'VIEW_MAINTENANCE',
    'MANAGE_MAINTENANCE'
  ],
  viewer: [
    'VIEW_REPORTS',
    'VIEW_DASHBOARD',
    'VIEW_MAINTENANCE'
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
    default_site_code:row.default_site_code,
    force_password_change:Boolean(row.force_password_change),
    locked_until:row.locked_until || null,
    last_login_at:row.last_login_at || null
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
  const now=Date.now();
  if (now > session.expires_at || now > session.idle_expires_at) {
    authSessions.delete(token);
    markSessionEnded(session,'expired',now>session.expires_at?'absolute_timeout':'idle_timeout').catch(()=>{});
    return null;
  }
  session.last_seen_at=now;
  session.idle_expires_at=Math.min(session.expires_at,now+Number(session.idle_timeout_minutes||30)*60*1000);
  if (now-Number(session.last_persisted_at||0)>60000) {
    session.last_persisted_at=now;
    pool.query(`UPDATE app_sessions SET last_seen_at=now(),idle_expires_at=$2,ip_address=$3 WHERE id=$1 AND status='active'`,[session.id,new Date(session.idle_expires_at),reqIp(req)]).catch(()=>{});
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

function normalizeConfiguredPublicAppUrl(value) {
  let raw = String(value || '').replace(/^\uFEFF/, '').trim();
  raw = raw.replace(/^(?:PUBLIC_APP_URL|PUBLIC_API_URL|FACTORYBOX_PUBLIC_URL|REMOTE_PUBLIC_URL)\s*=\s*/i, '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    parsed.search = '';
    parsed.hash = '';
    const pathName = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '';
    return `${parsed.origin}${pathName}`;
  } catch (_) {
    return '';
  }
}

function isInternalDockerPublicHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (['backend','mail-gateway','host.docker.internal','localhost','127.0.0.1','::1'].includes(host)) return true;
    const match = host.match(/^172\.(\d{1,3})\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch (_) {
    return true;
  }
}

function publicAppBaseUrl(req) {
  const configured = normalizeConfiguredPublicAppUrl(process.env.PUBLIC_APP_URL);
  if (configured && !isInternalDockerPublicHost(configured)) return configured;

  const proto = firstForwardedHeaderValue(req.headers['x-forwarded-proto']) || req.protocol || 'https';
  const host = firstForwardedHeaderValue(req.headers['x-forwarded-host']) || req.headers.host || '';
  const requestUrl = normalizeConfiguredPublicAppUrl(host ? `${proto}://${host}` : '');
  if (requestUrl && !isInternalDockerPublicHost(requestUrl)) return requestUrl;

  const remoteUrl = normalizeConfiguredPublicAppUrl(process.env.REMOTE_PUBLIC_URL);
  if (remoteUrl && !isInternalDockerPublicHost(remoteUrl)) return remoteUrl;

  const factoryUrl = normalizeConfiguredPublicAppUrl(process.env.FACTORYBOX_PUBLIC_URL);
  if (factoryUrl && !isInternalDockerPublicHost(factoryUrl)) return factoryUrl;

  return requestUrl || factoryUrl || 'http://localhost:3100';
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

function securityPasswordPolicy(settings=securitySettingsCache) {
  return {
    min_length:Math.max(8,Number(settings.password_min_length||10)),
    require_upper:Boolean(settings.password_require_upper),
    require_lower:Boolean(settings.password_require_lower),
    require_number:Boolean(settings.password_require_number),
    require_special:Boolean(settings.password_require_special)
  };
}

function validateNewPassword(password, settings=securitySettingsCache) {
  const clean = String(password || '');
  const policy=securityPasswordPolicy(settings);
  if (clean.length < policy.min_length) {
    const err = new Error(`Password must be at least ${policy.min_length} characters`);
    err.statusCode = 400;
    throw err;
  }
  if (clean.length > 128) {
    const err = new Error('Password must be at most 128 characters');
    err.statusCode = 400;
    throw err;
  }
  if (policy.require_upper && !/[A-Z]/.test(clean)) { const e=new Error('Password must include an uppercase letter');e.statusCode=400;throw e; }
  if (policy.require_lower && !/[a-z]/.test(clean)) { const e=new Error('Password must include a lowercase letter');e.statusCode=400;throw e; }
  if (policy.require_number && !/[0-9]/.test(clean)) { const e=new Error('Password must include a number');e.statusCode=400;throw e; }
  if (policy.require_special && !/[^A-Za-z0-9]/.test(clean)) { const e=new Error('Password must include a special character');e.statusCode=400;throw e; }
  return clean;
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token||'')).digest('hex');
}

function securityDeviceLabel(userAgent) {
  const ua=String(userAgent||'');
  const osLabel=/Windows/i.test(ua)?'Windows':/Android/i.test(ua)?'Android':/iPhone|iPad/i.test(ua)?'iOS':/Mac OS/i.test(ua)?'macOS':/Linux/i.test(ua)?'Linux':'Unknown OS';
  const browser=/Edg\//i.test(ua)?'Edge':/Chrome\//i.test(ua)?'Chrome':/Firefox\//i.test(ua)?'Firefox':/Safari\//i.test(ua)?'Safari':'Browser';
  return `${osLabel} · ${browser}`;
}

async function refreshSecuritySettingsCache() {
  if (!securityFoundationReady) return securitySettingsCache;
  const row=await one(`SELECT * FROM security_settings WHERE id=1`);
  if (row) securitySettingsCache={...securitySettingsCache,...row};
  return securitySettingsCache;
}

async function ensureSecurityFoundation() {
  if (securityFoundationReady) return;
  await pool.query(`
    ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until timestamptz,
      ADD COLUMN IF NOT EXISTS last_failed_login_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_failed_ip text,
      ADD COLUMN IF NOT EXISTS last_login_ip text,
      ADD COLUMN IF NOT EXISTS last_login_user_agent text,
      ADD COLUMN IF NOT EXISTS password_changed_at timestamptz,
      ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_settings (
      id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
      session_hours integer NOT NULL DEFAULT 12 CHECK(session_hours BETWEEN 1 AND 168),
      idle_timeout_minutes integer NOT NULL DEFAULT 30 CHECK(idle_timeout_minutes BETWEEN 5 AND 1440),
      max_failed_attempts integer NOT NULL DEFAULT 5 CHECK(max_failed_attempts BETWEEN 3 AND 20),
      lockout_minutes integer NOT NULL DEFAULT 15 CHECK(lockout_minutes BETWEEN 1 AND 1440),
      password_min_length integer NOT NULL DEFAULT 10 CHECK(password_min_length BETWEEN 8 AND 64),
      password_require_upper boolean NOT NULL DEFAULT true,
      password_require_lower boolean NOT NULL DEFAULT true,
      password_require_number boolean NOT NULL DEFAULT true,
      password_require_special boolean NOT NULL DEFAULT true,
      api_rate_limit_per_minute integer NOT NULL DEFAULT 300 CHECK(api_rate_limit_per_minute BETWEEN 60 AND 5000),
      login_rate_limit_per_15m integer NOT NULL DEFAULT 20 CHECK(login_rate_limit_per_15m BETWEEN 5 AND 200),
      suspicious_login_telegram boolean NOT NULL DEFAULT true,
      secure_headers_enabled boolean NOT NULL DEFAULT true,
      csrf_origin_check_enabled boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`INSERT INTO security_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      id text PRIMARY KEY,
      token_hash text NOT NULL UNIQUE,
      user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      idle_expires_at timestamptz NOT NULL,
      ip_address text,
      user_agent text,
      device_label text,
      status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
      revoked_at timestamptz,
      revoked_by text,
      revoke_reason text
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_sessions_user_status ON app_sessions(user_id,status,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(status,expires_at,idle_expires_at)`);
  await pool.query(`UPDATE app_sessions SET status='expired',revoke_reason=COALESCE(revoke_reason,'server_restart') WHERE status='active'`);
  securityFoundationReady=true;
  await refreshSecuritySettingsCache();
}

async function createManagedSession(req,user,tenant) {
  await ensureSecurityFoundation();
  const settings=await refreshSecuritySettingsCache();
  const token=crypto.randomBytes(32).toString('hex');
  const id=`ses_${crypto.randomBytes(12).toString('hex')}`;
  const now=Date.now();
  const sessionHours=Math.max(1,Number(settings.session_hours||authConfig().sessionHours||12));
  const idleMinutes=Math.max(5,Number(settings.idle_timeout_minutes||30));
  const expiresAt=now+sessionHours*60*60*1000;
  const idleExpiresAt=Math.min(expiresAt,now+idleMinutes*60*1000);
  const session={token,id,user,tenant,created_at:now,last_seen_at:now,last_persisted_at:now,expires_at:expiresAt,idle_expires_at:idleExpiresAt,idle_timeout_minutes:idleMinutes,ip_address:reqIp(req),user_agent:req.headers['user-agent']||'',device_label:securityDeviceLabel(req.headers['user-agent'])};
  authSessions.set(token,session);
  await pool.query(`INSERT INTO app_sessions(id,token_hash,user_id,created_at,last_seen_at,expires_at,idle_expires_at,ip_address,user_agent,device_label,status) VALUES($1,$2,$3,now(),now(),$4,$5,$6,$7,$8,'active')`,[id,sessionTokenHash(token),user.id,new Date(expiresAt),new Date(idleExpiresAt),session.ip_address,session.user_agent,session.device_label]);
  return session;
}

async function markSessionEnded(session,status='revoked',reason='revoked',actorEmail=null) {
  if (!session?.id) return;
  await pool.query(`UPDATE app_sessions SET status=$2,revoked_at=CASE WHEN $2='revoked' THEN now() ELSE revoked_at END,revoked_by=$3,revoke_reason=$4,last_seen_at=now() WHERE id=$1`,[session.id,status,actorEmail,reason]);
}

async function revokeSessionsForUser(userId,{preserveToken=null,actorEmail=null,reason='user_sessions_revoked'}={}) {
  let revoked=0;
  for (const [token,session] of authSessions.entries()) {
    if (String(session?.user?.id||'')===String(userId||'') && token!==preserveToken) { authSessions.delete(token);revoked+=1; }
  }
  await ensureSecurityFoundation();
  const result=await pool.query(`UPDATE app_sessions SET status='revoked',revoked_at=now(),revoked_by=$2,revoke_reason=$3 WHERE user_id=$1 AND status='active' ${preserveToken?"AND token_hash<>$4":""}`,[userId,actorEmail,reason,...(preserveToken?[sessionTokenHash(preserveToken)]:[])]);
  return Math.max(revoked,result.rowCount||0);
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
  return 'HukaTech şifre sıfırlama bağlantınız';
}

function passwordResetEmailHtml(user, resetUrl, expiresMinutes) {
  const name = user.full_name || user.email;
  return emailShellHtml('HukaTech Şifre Sıfırlama', `
    <h1 style="margin:0 0 12px 0;color:#102033;">Şifrenizi sıfırlayın</h1>
    <p style="font-size:15px;line-height:1.6;color:#334155;">
      Merhaba <strong>${h(name)}</strong>,<br>
      HukaTech Platform hesabınız için bir şifre sıfırlama isteği aldık.
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
    const existing = await one(`SELECT id FROM app_users WHERE lower(email)=lower($1) LIMIT 1`, [cfg.adminEmail]);
    if (!existing) {
      const salt = makeSalt();
      const passwordHash = hashPassword(cfg.adminPassword, salt);
      await pool.query(
        `INSERT INTO app_users(id,email,password_hash,password_salt,full_name,role,status,default_customer_code,default_site_code)
         VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
        [makeUserId(), cfg.adminEmail, passwordHash, salt, 'FactoryBox Admin', cfg.defaultRole, CFG.customerCode, CFG.siteCode]
      );
    } else {
      await pool.query(`UPDATE app_users SET role=$1,status='active',default_customer_code=$2,default_site_code=$3,updated_at=now() WHERE id=$4`,[cfg.defaultRole,CFG.customerCode,CFG.siteCode,existing.id]);
      if (String(process.env.FACTORYBOX_ADMIN_SYNC_PASSWORD||'false').toLowerCase()==='true') {
        const salt=makeSalt();const passwordHash=hashPassword(cfg.adminPassword,salt);
        await pool.query(`UPDATE app_users SET password_hash=$1,password_salt=$2,updated_at=now() WHERE id=$3`,[passwordHash,salt,existing.id]);
      }
    }

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

  // v6.4: If granular organization access exists for this user, use it as the source of truth.
  // Customer/factory/site/line scopes are expanded to site access so every existing API keeps
  // the same tenant-boundary behavior without breaking older app_user_tenant_access records.
  try {
    const locationPolicy = await one(`SELECT enabled FROM app_user_location_policy WHERE user_id=$1 LIMIT 1`,[user.id]);
    const granular = await pool.query(`
      SELECT
        ola.access_role,
        c.code AS customer_code,
        c.name AS customer_name,
        f.id::text AS factory_id,
        f.code AS factory_code,
        f.name AS factory_name,
        s.id::text AS site_id,
        s.code AS site_code,
        s.name AS site_name,
        pl.id::text AS production_line_id,
        pl.code AS production_line_code,
        pl.name AS production_line_name
      FROM app_user_location_access ola
      JOIN customers c ON c.id=ola.customer_id
      LEFT JOIN factories f ON f.id=ola.factory_id
      LEFT JOIN sites s ON s.id=ola.site_id
      LEFT JOIN production_lines pl ON pl.id=ola.production_line_id
      WHERE ola.user_id=$1 AND ola.status='active'
      ORDER BY c.code,f.code NULLS FIRST,s.code NULLS FIRST,pl.code NULLS FIRST
    `,[user.id]);
    if (locationPolicy?.enabled || granular.rows.length) {
      const customers=[];const sites=[];const productionLines=[];const customerSeen=new Set();const siteSeen=new Set();const lineSeen=new Set();let hasBroaderThanLineScope=false;
      for (const row of granular.rows) {
        if (!row.production_line_id) hasBroaderThanLineScope=true;
        if (row.production_line_id && !lineSeen.has(row.production_line_id)) {lineSeen.add(row.production_line_id);productionLines.push({id:row.production_line_id,code:row.production_line_code,name:row.production_line_name,site_code:row.site_code,customer_code:row.customer_code});}
        if (!customerSeen.has(row.customer_code)) {
          customerSeen.add(row.customer_code);
          customers.push({code:row.customer_code,name:row.customer_name||row.customer_code,role:row.access_role});
        }
        let expanded=[];
        if (row.site_id) expanded=[{code:row.site_code,name:row.site_name,customer_code:row.customer_code}];
        else if (row.production_line_id) expanded=(await pool.query(`SELECT s.code,s.name,c.code AS customer_code FROM production_lines pl JOIN sites s ON s.id=pl.site_id JOIN customers c ON c.id=s.customer_id WHERE pl.id=$1`,[row.production_line_id])).rows;
        else if (row.factory_id) expanded=(await pool.query(`SELECT s.code,s.name,c.code AS customer_code FROM sites s JOIN customers c ON c.id=s.customer_id WHERE s.factory_id=$1 ORDER BY s.name`,[row.factory_id])).rows;
        else expanded=(await pool.query(`SELECT s.code,s.name,c.code AS customer_code FROM sites s JOIN customers c ON c.id=s.customer_id WHERE c.code=$1 ORDER BY s.name`,[row.customer_code])).rows;
        for (const site of expanded) {
          const key=`${site.customer_code}:${site.code}`;
          if (!siteSeen.has(key)) {siteSeen.add(key);sites.push({...site,role:row.access_role});}
        }
      }
      return {
        auth_enabled:true,user:publicUser(user),
        current_customer:customers.find(x=>x.code===user.default_customer_code)||customers[0]||{code:user.default_customer_code||CFG.customerCode,name:user.default_customer_code||CFG.customerName},
        current_site:sites.find(x=>x.code===user.default_site_code)||sites[0]||{code:user.default_site_code||CFG.siteCode,name:user.default_site_code||CFG.siteName,customer_code:user.default_customer_code||CFG.customerCode},
        customers,sites,production_lines:productionLines,line_scope_restricted:!hasBroaderThanLineScope&&productionLines.length>0,granular_access:true,access_denied:customers.length===0
      };
    }
  } catch (error) {
    // Backward compatibility during first boot/migration: fall back to legacy tenant access.
    if (String(error.code||'') !== '42P01') console.warn('Granular location access fallback:', error.message);
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
    sites,
    production_lines:[],
    line_scope_restricted:false
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
  req.authSession = session;
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
    expires_at:new Date(session.expires_at).toISOString(),
    idle_expires_at:new Date(session.idle_expires_at).toISOString(),
    session_id:session.id,
    security:{force_password_change:Boolean(session.user?.force_password_change)}
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
        text:passwordResetEmailText(user, resetUrl, cfg.passwordResetTokenMinutes),
        purpose:'password_reset',
        metadata:{customer_code:user.default_customer_code || CFG.customerCode}
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
    await ensureSecurityFoundation();
    const password = validateNewPassword(req.body?.password, await refreshSecuritySettingsCache());

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
      `UPDATE app_users SET password_hash=$1, password_salt=$2, password_changed_at=now(), force_password_change=false, failed_login_count=0, locked_until=NULL, updated_at=now() WHERE id=$3`,
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

    const revokedSessions = await revokeSessionsForUser(reset.user_id,{reason:'password_reset'});

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

    const managedSession = await createManagedSession(req, created.user, created.tenant);
    const token = managedSession.token;
    const expiresAt = managedSession.expires_at;

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
      return res.json({status:'ok',version:APP_VERSION,authenticated:true,auth_enabled:false,token:null,message:'AUTH_ENABLED=false, login bypassed for local development'});
    }

    await ensureSecurityFoundation();
    const settings=await refreshSecuritySettingsCache();
    const rateLimit=Math.max(5,Number(settings.login_rate_limit_per_15m||20));
    const rate=consumeRateBucket(loginRateBuckets,`login:${reqIp(req)}`,rateLimit,15*60*1000);
    if (!rate.allowed) {
      await writeAuditLog(req,{action:'login_rate_limited',entity_type:'auth',entity_id:reqIp(req),old_values:null,new_values:null,metadata:{ip:reqIp(req),limit:rateLimit}});
      return res.status(429).json({status:'rate_limited',message:'Too many login attempts. Try again later.'});
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({status:'error',message:'Email and password required'});

    const user=await one(`SELECT * FROM app_users WHERE lower(email)=lower($1) AND status='active' LIMIT 1`,[email]);
    const now=new Date();
    if (user?.locked_until && new Date(user.locked_until)>now) {
      await writeAuditLog(req,{action:'login_blocked_locked_account',entity_type:'user',entity_id:user.id,old_values:null,new_values:null,metadata:{email,locked_until:user.locked_until}});
      return res.status(423).json({status:'locked',message:'Account is temporarily locked',locked_until:user.locked_until});
    }

    if (!user || !verifyPassword(password,user.password_salt,user.password_hash)) {
      let lockUntil=null;let failedCount=1;
      if (user) {
        failedCount=Number(user.failed_login_count||0)+1;
        if (failedCount>=Number(settings.max_failed_attempts||5)) lockUntil=new Date(Date.now()+Number(settings.lockout_minutes||15)*60*1000);
        await pool.query(`UPDATE app_users SET failed_login_count=$1,last_failed_login_at=now(),last_failed_ip=$2,locked_until=$3,updated_at=now() WHERE id=$4`,[failedCount,reqIp(req),lockUntil,user.id]);
      }
      await writeAuditLog(req,{action:lockUntil?'account_locked':'login_failed',entity_type:user?'user':'auth',entity_id:user?.id||email,old_values:null,new_values:null,metadata:{email,reason:'invalid_credentials',failed_count:failedCount,locked_until:lockUntil}});
      if (lockUntil && settings.suspicious_login_telegram) {
        sendSystemHealthTelegramAlert(`🔐 FactoryBox security alert\nAccount locked: ${email}\nIP: ${reqIp(req)}\nUntil: ${lockUntil.toISOString()}`).catch(()=>{});
      }
      return res.status(lockUntil?423:401).json({status:lockUntil?'locked':'unauthorized',message:lockUntil?'Account temporarily locked due to failed login attempts':'Invalid email or password',locked_until:lockUntil});
    }

    const tenant=await getTenantContextForUser(user);
    const managedSession=await createManagedSession(req,user,tenant);
    await pool.query(`UPDATE app_users SET last_login_at=now(),last_login_ip=$2,last_login_user_agent=$3,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1`,[user.id,reqIp(req),req.headers['user-agent']||null]);
    user.failed_login_count=0;user.locked_until=null;user.last_login_ip=reqIp(req);user.last_login_user_agent=req.headers['user-agent']||null;

    await writeAuditLog(req,{action:'login_success',entity_type:'user',entity_id:user.id,old_values:null,new_values:{last_login_at:nowIso()},metadata:{email:user.email,session_id:managedSession.id,device:managedSession.device_label,ip:reqIp(req),customer_code:tenant?.current_customer?.code||user.default_customer_code||null}});

    res.json({status:'ok',version:APP_VERSION,authenticated:true,token:managedSession.token,user:publicUser(user),tenant,subscription:await getSubscriptionSnapshot(tenant?.current_customer?.code||user.default_customer_code||CFG.customerCode),expires_at:new Date(managedSession.expires_at).toISOString(),idle_expires_at:new Date(managedSession.idle_expires_at).toISOString(),session_id:managedSession.id,force_password_change:Boolean(user.force_password_change)});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',message:e.message}); }
});

app.post('/api/auth/logout', async (req,res)=>{
  const token=bearerToken(req);const session=token?authSessions.get(token):null;
  if (token) authSessions.delete(token);
  if (session) await markSessionEnded(session,'revoked','user_logout',session.user?.email||null);
  if (session?.user) await writeAuditLog(req,{action:'logout',entity_type:'user',entity_id:session.user.id,old_values:null,new_values:{logged_out:true},metadata:{email:session.user.email,session_id:session.id}});
  res.json({status:'ok',version:APP_VERSION,logged_out:true});
});

app.post('/api/auth/change-password', authRequired, async (req,res)=>{
  try {
    await ensureSecurityFoundation();
    const current=String(req.body?.current_password||'');
    const next=validateNewPassword(req.body?.new_password,await refreshSecuritySettingsCache());
    const user=await one(`SELECT * FROM app_users WHERE id=$1 LIMIT 1`,[req.user.id]);
    if (!user || !verifyPassword(current,user.password_salt,user.password_hash)) return res.status(400).json({status:'error',message:'Current password is incorrect'});
    if (verifyPassword(next,user.password_salt,user.password_hash)) return res.status(400).json({status:'error',message:'New password must be different from the current password'});
    const salt=makeSalt();const hash=hashPassword(next,salt);
    await pool.query(`UPDATE app_users SET password_hash=$1,password_salt=$2,password_changed_at=now(),force_password_change=false,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$3`,[hash,salt,user.id]);
    const preserved=bearerToken(req);const revoked=await revokeSessionsForUser(user.id,{preserveToken:preserved,actorEmail:user.email,reason:'password_changed'});
    if (req.authSession) req.authSession.user.force_password_change=false;
    await writeAuditLog(req,{action:'change_own_password',entity_type:'user',entity_id:user.id,old_values:null,new_values:{password_changed:true,sessions_revoked:revoked},metadata:{session_id:req.authSession?.id||null}});
    res.json({status:'ok',version:APP_VERSION,password_changed:true,sessions_revoked:revoked});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',message:e.message}); }
});





app.get('/api/admin/security-center', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    await ensureSecurityFoundation();
    await pool.query(`UPDATE app_sessions SET status='expired',revoke_reason=COALESCE(revoke_reason,'timeout') WHERE status='active' AND (expires_at<now() OR idle_expires_at<now())`);
    const settings=await refreshSecuritySettingsCache();
    const sessions=(await pool.query(`SELECT s.id,s.user_id,u.email,u.full_name,u.role,s.created_at,s.last_seen_at,s.expires_at,s.idle_expires_at,s.ip_address,s.device_label,s.user_agent,s.status,s.revoked_at,s.revoked_by,s.revoke_reason FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.status='active' ORDER BY s.last_seen_at DESC LIMIT 300`)).rows;
    const lockedUsers=(await pool.query(`SELECT id,email,full_name,role,status,failed_login_count,locked_until,last_failed_login_at,last_failed_ip,last_login_at,last_login_ip,force_password_change,password_changed_at FROM app_users ORDER BY CASE WHEN locked_until>now() THEN 0 WHEN force_password_change THEN 1 WHEN failed_login_count>0 THEN 2 ELSE 3 END,locked_until DESC NULLS LAST,last_failed_login_at DESC NULLS LAST,email LIMIT 300`)).rows;
    const summary=await one(`SELECT (SELECT count(*) FROM app_sessions WHERE status='active' AND expires_at>now() AND idle_expires_at>now())::int active_sessions,(SELECT count(*) FROM app_users WHERE locked_until>now())::int locked_users,(SELECT count(*) FROM admin_audit_logs WHERE action IN ('login_failed','account_locked','login_rate_limited','login_blocked_locked_account') AND created_at>=now()-interval '24 hours')::int failed_logins_24h,(SELECT count(*) FROM app_users WHERE force_password_change=true)::int forced_password_changes`);
    const events=(await pool.query(`SELECT id::text,created_at,actor_email,action,entity_type,entity_id,ip_address,user_agent,metadata FROM admin_audit_logs WHERE action IN ('login_success','login_failed','account_locked','login_rate_limited','login_blocked_locked_account','logout','change_own_password','admin_reset_password','revoke_session','revoke_user_sessions','unlock_user','force_password_change') ORDER BY created_at DESC LIMIT 100`)).rows;
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),current_session_id:req.authSession?.id||null,settings,password_policy:securityPasswordPolicy(settings),summary,sessions,locked_users:lockedUsers,events});
  } catch(e) { res.status(500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.patch('/api/admin/security-center/settings', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    await ensureSecurityFoundation();const old=await refreshSecuritySettingsCache();const b=req.body||{};
    const int=(v,min,max,fallback)=>Math.min(max,Math.max(min,Number.isFinite(Number(v))?Math.round(Number(v)):fallback));
    const values={session_hours:int(b.session_hours,1,168,old.session_hours),idle_timeout_minutes:int(b.idle_timeout_minutes,5,1440,old.idle_timeout_minutes),max_failed_attempts:int(b.max_failed_attempts,3,20,old.max_failed_attempts),lockout_minutes:int(b.lockout_minutes,1,1440,old.lockout_minutes),password_min_length:int(b.password_min_length,8,64,old.password_min_length),password_require_upper:b.password_require_upper===undefined?old.password_require_upper:Boolean(b.password_require_upper),password_require_lower:b.password_require_lower===undefined?old.password_require_lower:Boolean(b.password_require_lower),password_require_number:b.password_require_number===undefined?old.password_require_number:Boolean(b.password_require_number),password_require_special:b.password_require_special===undefined?old.password_require_special:Boolean(b.password_require_special),api_rate_limit_per_minute:int(b.api_rate_limit_per_minute,60,5000,old.api_rate_limit_per_minute),login_rate_limit_per_15m:int(b.login_rate_limit_per_15m,5,200,old.login_rate_limit_per_15m),suspicious_login_telegram:b.suspicious_login_telegram===undefined?old.suspicious_login_telegram:Boolean(b.suspicious_login_telegram),secure_headers_enabled:b.secure_headers_enabled===undefined?old.secure_headers_enabled:Boolean(b.secure_headers_enabled),csrf_origin_check_enabled:b.csrf_origin_check_enabled===undefined?old.csrf_origin_check_enabled:Boolean(b.csrf_origin_check_enabled)};
    await pool.query(`UPDATE security_settings SET session_hours=$1,idle_timeout_minutes=$2,max_failed_attempts=$3,lockout_minutes=$4,password_min_length=$5,password_require_upper=$6,password_require_lower=$7,password_require_number=$8,password_require_special=$9,api_rate_limit_per_minute=$10,login_rate_limit_per_15m=$11,suspicious_login_telegram=$12,secure_headers_enabled=$13,csrf_origin_check_enabled=$14,updated_by=$15,updated_at=now() WHERE id=1`,[values.session_hours,values.idle_timeout_minutes,values.max_failed_attempts,values.lockout_minutes,values.password_min_length,values.password_require_upper,values.password_require_lower,values.password_require_number,values.password_require_special,values.api_rate_limit_per_minute,values.login_rate_limit_per_15m,values.suspicious_login_telegram,values.secure_headers_enabled,values.csrf_origin_check_enabled,req.user?.email||'local-admin']);
    const settings=await refreshSecuritySettingsCache();
    await writeAuditLog(req,{action:'update_security_settings',entity_type:'security_settings',entity_id:'global',old_values:old,new_values:settings,metadata:null});
    res.json({status:'ok',version:APP_VERSION,settings,password_policy:securityPasswordPolicy(settings)});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',message:e.message}); }
});

app.post('/api/admin/security-center/sessions/:id/revoke', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    await ensureSecurityFoundation();const id=String(req.params.id);const row=await one(`SELECT s.*,u.email FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.id=$1 LIMIT 1`,[id]);if(!row)return res.status(404).json({status:'not_found',message:'Session not found'});
    if (id===req.authSession?.id) return res.status(400).json({status:'error',message:'Use logout to close your current session'});
    for(const [token,session] of authSessions.entries()) if(session.id===id) authSessions.delete(token);
    await pool.query(`UPDATE app_sessions SET status='revoked',revoked_at=now(),revoked_by=$2,revoke_reason='admin_revoked' WHERE id=$1`,[id,req.user?.email||'local-admin']);
    await writeAuditLog(req,{action:'revoke_session',entity_type:'session',entity_id:id,old_values:{status:row.status},new_values:{status:'revoked'},metadata:{user_email:row.email}});
    res.json({status:'ok',version:APP_VERSION,revoked:true});
  } catch(e){res.status(500).json({status:'error',message:e.message});}
});

app.post('/api/admin/security-center/users/:id/revoke-sessions', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {const id=String(req.params.id);const preserve=String(req.user?.id||'')===id?bearerToken(req):null;const count=await revokeSessionsForUser(id,{preserveToken:preserve,actorEmail:req.user?.email||'local-admin',reason:'admin_revoked_user_sessions'});await writeAuditLog(req,{action:'revoke_user_sessions',entity_type:'user',entity_id:id,old_values:null,new_values:{revoked_sessions:count},metadata:{preserved_current:Boolean(preserve)}});res.json({status:'ok',version:APP_VERSION,revoked_sessions:count});} catch(e){res.status(500).json({status:'error',message:e.message});}
});

app.post('/api/admin/security-center/users/:id/unlock', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {const user=await one(`UPDATE app_users SET failed_login_count=0,locked_until=NULL,last_failed_login_at=NULL,last_failed_ip=NULL,updated_at=now() WHERE id=$1 RETURNING id,email,full_name,role,status`,[req.params.id]);if(!user)return res.status(404).json({status:'not_found',message:'User not found'});await writeAuditLog(req,{action:'unlock_user',entity_type:'user',entity_id:user.id,old_values:null,new_values:{unlocked:true},metadata:{email:user.email}});res.json({status:'ok',version:APP_VERSION,user});}catch(e){res.status(500).json({status:'error',message:e.message});}
});

app.post('/api/admin/security-center/users/:id/force-password-change', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {const force=req.body?.force===undefined?true:Boolean(req.body.force);const user=await one(`UPDATE app_users SET force_password_change=$1,updated_at=now() WHERE id=$2 RETURNING id,email,full_name,role,status,force_password_change`,[force,req.params.id]);if(!user)return res.status(404).json({status:'not_found',message:'User not found'});await writeAuditLog(req,{action:'force_password_change',entity_type:'user',entity_id:user.id,old_values:null,new_values:{force_password_change:force},metadata:{email:user.email}});res.json({status:'ok',version:APP_VERSION,user});}catch(e){res.status(500).json({status:'error',message:e.message});}
});

app.post('/api/admin/security-center/users/:id/reset-password', adminRequired, permissionRequired('MANAGE_USERS'), async (req,res)=>{
  try {
    await ensureSecurityFoundation();const password=validateNewPassword(req.body?.new_password,await refreshSecuritySettingsCache());const force=req.body?.force_change===undefined?true:Boolean(req.body.force_change);const user=await one(`SELECT id,email FROM app_users WHERE id=$1 LIMIT 1`,[req.params.id]);if(!user)return res.status(404).json({status:'not_found',message:'User not found'});const salt=makeSalt();const hash=hashPassword(password,salt);await pool.query(`UPDATE app_users SET password_hash=$1,password_salt=$2,password_changed_at=now(),force_password_change=$3,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$4`,[hash,salt,force,user.id]);const revoked=await revokeSessionsForUser(user.id,{actorEmail:req.user?.email||'local-admin',reason:'admin_password_reset'});await writeAuditLog(req,{action:'admin_reset_password',entity_type:'user',entity_id:user.id,old_values:null,new_values:{password_reset:true,force_password_change:force,sessions_revoked:revoked},metadata:{email:user.email}});res.json({status:'ok',version:APP_VERSION,password_reset:true,sessions_revoked:revoked,force_password_change:force});
  } catch(e){res.status(e.statusCode||500).json({status:'error',message:e.message});}
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
  req.authSession = session;
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


// -----------------------------------------------------------------------------
// v5.25.0 Mobile Operator Panel
// -----------------------------------------------------------------------------
function mobileOperatorRequired(req, res, next) {
  if (!authConfig().enabled) return next();
  if (!req.user) return res.status(401).json({status:'unauthorized', version:APP_VERSION, message:'Login required'});
  const allowed = hasPermission(req.user, 'VIEW_DASHBOARD') || hasPermission(req.user, 'VIEW_MAINTENANCE');
  if (!allowed) return res.status(403).json({status:'forbidden', version:APP_VERSION, message:'Operator panel access required'});
  return next();
}

function operatorScope(req) {
  if (!authConfig().enabled || req.user?.role === 'system_admin') return {all:true, customers:[], sites:[], productionLines:[]};
  if (req.tenant?.access_denied) return {all:false, customers:['__factorybox_no_access__'], sites:[], productionLines:[]};
  const customers = [...new Set((req.tenant?.customers || []).map(row => String(row.code || '').trim()).filter(Boolean))];
  const sites = [...new Set((req.tenant?.sites || []).map(row => String(row.code || '').trim()).filter(Boolean))];
  const productionLines = req.tenant?.line_scope_restricted
    ? [...new Set((req.tenant?.production_lines || []).map(row => String(row.id || '').trim()).filter(Boolean))]
    : [];
  if (!customers.length) customers.push(String(req.user?.default_customer_code || CFG.customerCode));
  return {all:false, customers, sites, productionLines};
}

function operatorScopeClause(req, customerAlias='c', siteAlias='s', startIndex=1, machineAlias='m') {
  const scope = operatorScope(req);
  if (scope.all) return {sql:'', params:[], scope};
  const params = [scope.customers];
  const clauses = [`${customerAlias}.code = ANY($${startIndex}::text[])`];
  if (scope.sites.length) {
    params.push(scope.sites);
    clauses.push(`${siteAlias}.code = ANY($${startIndex + params.length - 1}::text[])`);
  }
  if (scope.productionLines.length) {
    params.push(scope.productionLines);
    clauses.push(`${machineAlias}.production_line_id = ANY($${startIndex + params.length - 1}::uuid[])`);
  }
  return {sql:` AND ${clauses.join(' AND ')}`, params, scope};
}

async function operatorMachineAccess(req, machineId) {
  const scope = operatorScopeClause(req, 'c', 's', 2);
  const row = await one(`
    SELECT m.id::text, m.code AS machine_code, m.name AS machine_name,
           s.code AS site_code, c.code AS customer_code
    FROM machines m
    JOIN sites s ON s.id=m.site_id
    JOIN customers c ON c.id=s.customer_id
    WHERE m.id=$1 ${scope.sql}
    LIMIT 1
  `, [String(machineId || ''), ...scope.params]);
  if (!row) {
    const error = new Error('Machine not found or access denied');
    error.statusCode = 404;
    throw error;
  }
  return row;
}

async function operatorAlarmAccess(req, alarmId) {
  const scope = operatorScopeClause(req, 'c', 's', 2);
  const row = await one(`
    SELECT a.*, a.id::text, a.machine_id::text,
           m.code AS machine_code, m.name AS machine_name,
           s.code AS site_code, c.code AS customer_code
    FROM alarms a
    JOIN machines m ON m.id=a.machine_id
    JOIN sites s ON s.id=m.site_id
    JOIN customers c ON c.id=s.customer_id
    WHERE a.id=$1 ${scope.sql}
    LIMIT 1
  `, [String(alarmId || ''), ...scope.params]);
  if (!row) {
    const error = new Error('Alarm not found or access denied');
    error.statusCode = 404;
    throw error;
  }
  return row;
}

async function operatorTicketAccess(req, ticketId) {
  const scope = operatorScopeClause(req, 'c', 's', 2);
  const row = await one(`
    SELECT t.id::text
    FROM maintenance_tickets t
    JOIN machines m ON m.id=t.machine_id
    JOIN sites s ON s.id=m.site_id
    JOIN customers c ON c.id=s.customer_id
    WHERE t.id=$1 ${scope.sql}
    LIMIT 1
  `, [String(ticketId || ''), ...scope.params]);
  if (!row) {
    const error = new Error('Ticket not found or access denied');
    error.statusCode = 404;
    throw error;
  }
  return maintenanceTicketRow(row.id);
}

async function operatorWorkOrderAccess(req, workOrderId) {
  const scope = operatorScopeClause(req, 'c', 's', 2);
  const row = await one(`
    SELECT w.id::text
    FROM maintenance_work_orders w
    JOIN machines m ON m.id=w.machine_id
    JOIN sites s ON s.id=m.site_id
    JOIN customers c ON c.id=s.customer_id
    WHERE w.id=$1 ${scope.sql}
    LIMIT 1
  `, [String(workOrderId || ''), ...scope.params]);
  if (!row) {
    const error = new Error('Work order not found or access denied');
    error.statusCode = 404;
    throw error;
  }
  return maintenanceWorkOrderRow(row.id);
}

app.get('/api/operator/dashboard', authRequired, mobileOperatorRequired, async (req,res)=>{
  try {
    await ensureLiveMonitoringFoundation();
    await ensureDeviceInfoSyncSchema();
    await ensureAlarmCenterFoundation();
    await ensureMaintenanceFoundation();
    await ensurePreventiveMaintenanceFoundation();

    const scope = operatorScopeClause(req, 'c', 's', 1);
    const machineResult = await pool.query(`
      WITH latest_telemetry AS (
        SELECT DISTINCT ON (machine_id) machine_id,event_ts,current_amp,temperature_c,wifi_rssi,alarm_active
        FROM telemetry_events ORDER BY machine_id,event_ts DESC
      ), latest_state AS (
        SELECT DISTINCT ON (machine_id) machine_id,state,started_at,duration_sec
        FROM machine_state_events ORDER BY machine_id,started_at DESC
      ), device_rollup AS (
        SELECT machine_id,count(*)::int AS device_count,
          (count(*) FILTER(WHERE status='online'))::int AS online_device_count,
          max(last_seen_at) AS last_seen_at,max(updated_at) AS last_device_update_at
        FROM devices GROUP BY machine_id
      ), alarm_rollup AS (
        SELECT machine_id,(count(*) FILTER(WHERE status='active'))::int AS active_alarm_count,
          max(started_at) FILTER(WHERE status='active') AS latest_alarm_at
        FROM alarms GROUP BY machine_id
      ), ticket_rollup AS (
        SELECT machine_id,(count(*) FILTER(WHERE status IN ('open','in_progress','waiting')))::int AS active_ticket_count
        FROM maintenance_tickets GROUP BY machine_id
      ), work_rollup AS (
        SELECT machine_id,(count(*) FILTER(WHERE status NOT IN ('completed','cancelled')))::int AS active_work_order_count
        FROM maintenance_work_orders GROUP BY machine_id
      )
      SELECT m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,m.machine_type,m.status AS machine_status,
        s.code AS site_code,s.name AS site_name,c.code AS customer_code,c.name AS customer_name,
        COALESCE(dr.device_count,0)::int AS device_count,COALESCE(dr.online_device_count,0)::int AS online_device_count,
        dr.last_seen_at,lt.event_ts AS latest_telemetry_at,lt.current_amp,lt.temperature_c,lt.wifi_rssi,lt.alarm_active,
        ls.state AS latest_state,ls.started_at AS state_started_at,ls.duration_sec AS state_duration_sec,
        COALESCE(ar.active_alarm_count,0)::int AS active_alarm_count,ar.latest_alarm_at,
        COALESCE(tr.active_ticket_count,0)::int AS active_ticket_count,
        COALESCE(wr.active_work_order_count,0)::int AS active_work_order_count,
        GREATEST(0,EXTRACT(EPOCH FROM(now()-COALESCE(lt.event_ts,dr.last_seen_at,dr.last_device_update_at,m.updated_at,m.created_at)))::int) AS signal_age_sec
      FROM machines m
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      LEFT JOIN latest_telemetry lt ON lt.machine_id=m.id
      LEFT JOIN latest_state ls ON ls.machine_id=m.id
      LEFT JOIN device_rollup dr ON dr.machine_id=m.id
      LEFT JOIN alarm_rollup ar ON ar.machine_id=m.id
      LEFT JOIN ticket_rollup tr ON tr.machine_id=m.id
      LEFT JOIN work_rollup wr ON wr.machine_id=m.id
      WHERE COALESCE(m.status,'active') <> 'archived' ${scope.sql}
      ORDER BY c.code,s.code,m.name
      LIMIT 200
    `, scope.params);

    const machines = machineResult.rows.map(row => {
      const health = classifyLiveMachine(row);
      const connectionIssue = ['stale','offline','no_device'].includes(health);
      return {...row,health,visible_active_alarm_count:connectionIssue?0:Number(row.active_alarm_count||0)};
    });

    const alarmScope = operatorScopeClause(req, 'c', 's', 1);
    const alarms = await pool.query(`
      SELECT a.id::text,a.alarm_type,a.severity,a.status,a.started_at,a.acknowledged_at,a.acknowledged_by,a.message,
        m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,s.code AS site_code,c.code AS customer_code
      FROM alarms a
      JOIN machines m ON m.id=a.machine_id
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE a.status='active' ${alarmScope.sql}
      ORDER BY CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC,a.started_at DESC
      LIMIT 100
    `, alarmScope.params);

    const ticketScope = operatorScopeClause(req, 'c', 's', 1);
    const tickets = await pool.query(`
      SELECT t.id::text,t.ticket_no,t.title,t.priority,t.status,t.assignee,t.due_at,t.created_at,t.alarm_id::text,
        m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,
        (t.due_at IS NOT NULL AND t.due_at<now()) AS overdue
      FROM maintenance_tickets t
      JOIN machines m ON m.id=t.machine_id
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE t.status IN ('open','in_progress','waiting') ${ticketScope.sql}
      ORDER BY CASE t.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,t.due_at ASC NULLS LAST
      LIMIT 100
    `, ticketScope.params);

    const workScope = operatorScopeClause(req, 'c', 's', 1);
    const workOrders = await pool.query(`
      SELECT w.id::text,w.work_order_no,w.title,w.priority,w.status,w.assignee,w.due_at,w.started_at,w.checklist,w.checklist_results,
        m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,
        (w.due_at IS NOT NULL AND w.due_at<now()) AS overdue
      FROM maintenance_work_orders w
      JOIN machines m ON m.id=w.machine_id
      JOIN sites s ON s.id=m.site_id
      JOIN customers c ON c.id=s.customer_id
      WHERE w.status NOT IN ('completed','cancelled') ${workScope.sql}
      ORDER BY CASE w.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,w.due_at ASC NULLS LAST
      LIMIT 100
    `, workScope.params);

    const summary = {
      machines:machines.length,
      online:machines.filter(row=>row.health==='online').length,
      running:machines.filter(row=>String(row.latest_state||'').toUpperCase()==='RUNNING').length,
      stopped:machines.filter(row=>String(row.latest_state||'').toUpperCase()==='STOPPED').length,
      active_alarms:alarms.rows.length,
      unacknowledged_alarms:alarms.rows.filter(row=>!row.acknowledged_at).length,
      active_tickets:tickets.rows.length,
      active_work_orders:workOrders.rows.length,
      overdue_tasks:tickets.rows.filter(row=>row.overdue).length+workOrders.rows.filter(row=>row.overdue).length
    };

    res.json({
      status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),
      user:publicUser(req.user),tenant:req.tenant||null,permissions:publicPermissions(req.user),summary,machines,
      alarms:alarms.rows,tickets:tickets.rows,work_orders:workOrders.rows
    });
  } catch(e) {
    res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});

app.post('/api/operator/alarms/:id/acknowledge', authRequired, mobileOperatorRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmCenterFoundation();
    const alarm = await operatorAlarmAccess(req, req.params.id);
    const actor = req.user || getSession(req)?.user || {};
    const note = maintenanceText(req.body?.note, 'note', {max:1000}) || 'Mobil operatör panelinden onaylandı';
    const updated = await one(`
      UPDATE alarms SET acknowledged_at=COALESCE(acknowledged_at,now()),acknowledged_by=$2,acknowledge_note=$3,updated_at=now()
      WHERE id=$1 RETURNING *
    `,[alarm.id,actor.email||'operator',note]);
    await writeAuditLog(req,{action:'operator_acknowledge_alarm',entity_type:'alarm',entity_id:alarm.id,old_values:alarm,new_values:updated,metadata:{source:'mobile-operator',machine_code:alarm.machine_code}});
    res.json({status:'ok',version:APP_VERSION,alarm:updated});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/operator/alarms/:id/ticket', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const alarm = await operatorAlarmAccess(req, req.params.id);
    const existing = await one(`SELECT id::text,ticket_no,status FROM maintenance_tickets WHERE alarm_id=$1 AND status NOT IN ('closed','cancelled') ORDER BY created_at DESC LIMIT 1`,[alarm.id]);
    if (existing) return res.status(409).json({status:'duplicate',version:APP_VERSION,message:`Bu alarm için aktif ticket zaten var: ${existing.ticket_no}`,ticket:existing});
    const dueHours=alarm.severity==='critical'?4:(alarm.severity==='warning'?24:72);
    const ticket=await createMaintenanceTicketRecord(req,{
      source:'alarm',alarm_id:alarm.id,machine_id:alarm.machine_id,
      title:req.body?.title||`${alarm.alarm_type||'Alarm'} — ${alarm.machine_name||alarm.machine_code}`,
      description:req.body?.description||alarm.message||'Mobil operatör panelinden alarm ticketı',
      category:req.body?.category||'corrective',
      priority:req.body?.priority||(alarm.severity==='critical'?'critical':(alarm.severity==='warning'?'high':'medium')),
      assignee:req.body?.assignee||null,due_at:req.body?.due_at||new Date(Date.now()+dueHours*3600000).toISOString()
    });
    await writeAuditLog(req,{action:'operator_create_ticket_from_alarm',entity_type:'maintenance_ticket',entity_id:ticket.id,new_values:ticket,metadata:{source:'mobile-operator',alarm_id:alarm.id}});
    res.status(201).json({status:'ok',version:APP_VERSION,ticket});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/operator/tickets', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const machine=await operatorMachineAccess(req,req.body?.machine_id);
    const ticket=await createMaintenanceTicketRecord(req,{
      ...req.body,machine_id:machine.id,source:'manual',status:'open',
      title:req.body?.title||`Operatör bildirimi — ${machine.machine_name||machine.machine_code}`,
      description:req.body?.description||'Mobil operatör panelinden oluşturuldu',
      reported_by:req.user?.email||'operator'
    });
    await writeAuditLog(req,{action:'operator_create_quick_ticket',entity_type:'maintenance_ticket',entity_id:ticket.id,new_values:ticket,metadata:{source:'mobile-operator',machine_code:machine.machine_code}});
    res.status(201).json({status:'ok',version:APP_VERSION,ticket});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.patch('/api/operator/tickets/:id/status', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  let client;
  try {
    await ensureMaintenanceFoundation();
    const old=await operatorTicketAccess(req,req.params.id);
    const status=maintenanceChoice(req.body?.status||old.status,['open','in_progress','waiting','resolved'],'status');
    const note=maintenanceText(req.body?.note,'note',{max:2000});
    const actor=req.user||{};
    client=await pool.connect();await client.query('BEGIN');
    await client.query(`UPDATE maintenance_tickets SET status=$2,started_at=CASE WHEN $2='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,now()) WHEN $2 IN ('open','in_progress','waiting') THEN NULL ELSE resolved_at END,resolution_note=CASE WHEN $2='resolved' THEN COALESCE(NULLIF($3,''),resolution_note) ELSE resolution_note END,updated_at=now() WHERE id=$1`,[old.id,status,note||'']);
    await addMaintenanceTicketEvent(client,{ticketId:old.id,eventType:status!==old.status?'status_changed':'note',oldStatus:old.status,newStatus:status,note,actorEmail:actor.email||'operator',metadata:{source:'mobile-operator'}});
    await client.query('COMMIT');client.release();client=null;
    const ticket=await maintenanceTicketRow(old.id);
    await writeAuditLog(req,{action:'operator_update_ticket_status',entity_type:'maintenance_ticket',entity_id:old.id,old_values:old,new_values:ticket,metadata:{source:'mobile-operator'}});
    res.json({status:'ok',version:APP_VERSION,ticket});
  } catch(e) { if(client){try{await client.query('ROLLBACK')}catch{}client.release()} res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/operator/tickets/:id/notes', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const ticket=await operatorTicketAccess(req,req.params.id);
    const note=maintenanceText(req.body?.note,'note',{required:true,max:3000});
    await addMaintenanceTicketEvent(pool,{ticketId:ticket.id,eventType:'note',oldStatus:ticket.status,newStatus:ticket.status,note,actorEmail:req.user?.email||'operator',metadata:{source:'mobile-operator'}});
    await pool.query(`UPDATE maintenance_tickets SET updated_at=now() WHERE id=$1`,[ticket.id]);
    await writeAuditLog(req,{action:'operator_add_ticket_note',entity_type:'maintenance_ticket',entity_id:ticket.id,new_values:{note},metadata:{source:'mobile-operator'}});
    res.status(201).json({status:'ok',version:APP_VERSION});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.patch('/api/operator/work-orders/:id/status', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  let client;
  try {
    await ensurePreventiveMaintenanceFoundation();
    const old=await operatorWorkOrderAccess(req,req.params.id);
    const status=maintenanceChoice(req.body?.status||old.status,['scheduled','open','in_progress','waiting','completed'],'status');
    const note=maintenanceText(req.body?.note,'note',{max:3000});
    const actor=req.user||{};
    client=await pool.connect();await client.query('BEGIN');
    await client.query(`UPDATE maintenance_work_orders SET status=$2,started_at=CASE WHEN $2='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,now()) WHEN $2<>'completed' THEN NULL ELSE completed_at END,completion_note=CASE WHEN $2='completed' THEN COALESCE(NULLIF($3,''),completion_note) ELSE completion_note END,updated_by=$4,updated_at=now() WHERE id=$1`,[old.id,status,note||'',actor.email||'operator']);
    await addMaintenanceWorkOrderEvent(client,{workOrderId:old.id,eventType:status!==old.status?'status_changed':'note',oldStatus:old.status,newStatus:status,note,actorEmail:actor.email||'operator',metadata:{source:'mobile-operator'}});
    if(status==='completed'&&old.status!=='completed'&&old.plan_id){
      const plan=await maintenancePlanRow(old.plan_id);const runtime=await machineRuntimeHours(old.machine_id);
      const nextDue=plan.schedule_type==='runtime'?null:calculateMaintenanceNextDue(plan.schedule_type,plan.interval_value,new Date());
      const nextRuntime=plan.schedule_type==='runtime'?runtime+Number(plan.runtime_interval_hours||0):null;
      await client.query(`UPDATE maintenance_plans SET last_completed_at=now(),last_completed_runtime_hours=$2,last_work_order_id=$3,next_due_at=$4,next_due_runtime_hours=$5,updated_at=now(),updated_by=$6 WHERE id=$1`,[old.plan_id,runtime,old.id,nextDue,nextRuntime,actor.email||'operator']);
    }
    await client.query('COMMIT');client.release();client=null;
    const workOrder=await maintenanceWorkOrderRow(old.id);
    await writeAuditLog(req,{action:'operator_update_work_order_status',entity_type:'maintenance_work_order',entity_id:old.id,old_values:old,new_values:workOrder,metadata:{source:'mobile-operator'}});
    res.json({status:'ok',version:APP_VERSION,work_order:workOrder});
  } catch(e) { if(client){try{await client.query('ROLLBACK')}catch{}client.release()} res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/operator/work-orders/:id/notes', authRequired, mobileOperatorRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensurePreventiveMaintenanceFoundation();
    const order=await operatorWorkOrderAccess(req,req.params.id);
    const note=maintenanceText(req.body?.note,'note',{required:true,max:3000});
    await addMaintenanceWorkOrderEvent(pool,{workOrderId:order.id,eventType:'note',oldStatus:order.status,newStatus:order.status,note,actorEmail:req.user?.email||'operator',metadata:{source:'mobile-operator'}});
    await pool.query(`UPDATE maintenance_work_orders SET updated_at=now(),updated_by=$2 WHERE id=$1`,[order.id,req.user?.email||'operator']);
    await writeAuditLog(req,{action:'operator_add_work_order_note',entity_type:'maintenance_work_order',entity_id:order.id,new_values:{note},metadata:{source:'mobile-operator'}});
    res.status(201).json({status:'ok',version:APP_VERSION});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

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


const MAINTENANCE_TICKET_STATUSES = ['open','in_progress','waiting','resolved','closed','cancelled'];
const MAINTENANCE_TICKET_PRIORITIES = ['low','medium','high','critical'];
const MAINTENANCE_TICKET_CATEGORIES = ['preventive','corrective','inspection','electrical','mechanical','software','safety','other'];
const MAINTENANCE_TICKET_SOURCES = ['manual','alarm'];

function maintenanceTicketLimit(raw, fallback = 100, max = 500) {
  const value = Number(raw || fallback);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), max) : fallback;
}

function maintenanceChoice(value, allowed, label, fallback = null) {
  const clean = String(value ?? fallback ?? '').trim().toLowerCase();
  if (!allowed.includes(clean)) {
    const error = new Error(`${label} must be one of: ${allowed.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  return clean;
}

function maintenanceText(value, label, {required=false, max=4000} = {}) {
  const clean = String(value ?? '').trim();
  if (required && !clean) {
    const error = new Error(`${label} is required`);
    error.statusCode = 400;
    throw error;
  }
  if (clean.length > max) {
    const error = new Error(`${label} is too long (max ${max})`);
    error.statusCode = 400;
    throw error;
  }
  return clean || null;
}

function maintenanceDate(value, label='date') {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    throw error;
  }
  return date.toISOString();
}

function makeMaintenanceTicketNo() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `MT-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function ensureMaintenanceFoundation() {
  await ensureAlarmCenterFoundation();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id bigserial PRIMARY KEY,
      ticket_no text NOT NULL UNIQUE,
      customer_id uuid,
      site_id uuid,
      machine_id uuid,
      alarm_id bigint,
      source text NOT NULL DEFAULT 'manual',
      title text NOT NULL,
      description text,
      category text NOT NULL DEFAULT 'corrective',
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'open',
      assignee text,
      reported_by text,
      due_at timestamptz,
      started_at timestamptz,
      resolved_at timestamptz,
      closed_at timestamptz,
      resolution_note text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT maintenance_ticket_source_check CHECK (source IN ('manual','alarm')),
      CONSTRAINT maintenance_ticket_category_check CHECK (category IN ('preventive','corrective','inspection','electrical','mechanical','software','safety','other')),
      CONSTRAINT maintenance_ticket_priority_check CHECK (priority IN ('low','medium','high','critical')),
      CONSTRAINT maintenance_ticket_status_check CHECK (status IN ('open','in_progress','waiting','resolved','closed','cancelled'))
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_ticket_events (
      id bigserial PRIMARY KEY,
      ticket_id bigint NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
      event_type text NOT NULL,
      old_status text,
      new_status text,
      note text,
      actor_email text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status_due ON maintenance_tickets(status, due_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_machine_created ON maintenance_tickets(machine_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_alarm ON maintenance_tickets(alarm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_ticket ON maintenance_ticket_events(ticket_id, created_at DESC)`);
}

async function maintenanceMachineContext(machineId) {
  if (!machineId) return null;
  return one(`
    SELECT m.id::text, m.code AS machine_code, m.name AS machine_name,
           s.id::text AS site_id, s.code AS site_code,
           c.id::text AS customer_id, c.code AS customer_code
    FROM machines m
    LEFT JOIN sites s ON s.id=m.site_id
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE m.id=$1
    LIMIT 1
  `, [String(machineId)]);
}

async function maintenanceTicketRow(id) {
  return one(`
    SELECT
      t.id::text, t.ticket_no, t.source, t.title, t.description, t.category,
      t.priority, t.status, t.assignee, t.reported_by, t.due_at, t.started_at,
      t.resolved_at, t.closed_at, t.resolution_note, t.created_by,
      t.created_at, t.updated_at, t.alarm_id::text,
      m.id::text AS machine_id, m.code AS machine_code, m.name AS machine_name,
      s.code AS site_code, c.code AS customer_code,
      a.alarm_type, a.severity AS alarm_severity, a.status AS alarm_status,
      (t.due_at IS NOT NULL AND t.due_at < now() AND t.status IN ('open','in_progress','waiting')) AS overdue
    FROM maintenance_tickets t
    LEFT JOIN machines m ON m.id=t.machine_id
    LEFT JOIN sites s ON s.id=t.site_id
    LEFT JOIN customers c ON c.id=t.customer_id
    LEFT JOIN alarms a ON a.id=t.alarm_id
    WHERE t.id=$1
    LIMIT 1
  `, [String(id)]);
}

async function addMaintenanceTicketEvent(clientOrPool, {ticketId, eventType, oldStatus=null, newStatus=null, note=null, actorEmail=null, metadata=null}) {
  await clientOrPool.query(`
    INSERT INTO maintenance_ticket_events(ticket_id,event_type,old_status,new_status,note,actor_email,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
  `, [ticketId,eventType,oldStatus,newStatus,note,actorEmail,JSON.stringify(metadata || null)]);
}

async function createMaintenanceTicketRecord(req, values) {
  const actor = req.user || getSession(req)?.user || null;
  const title = maintenanceText(values.title, 'title', {required:true, max:240});
  const description = maintenanceText(values.description, 'description', {max:4000});
  const source = maintenanceChoice(values.source || 'manual', MAINTENANCE_TICKET_SOURCES, 'source');
  const category = maintenanceChoice(values.category || 'corrective', MAINTENANCE_TICKET_CATEGORIES, 'category');
  const priority = maintenanceChoice(values.priority || 'medium', MAINTENANCE_TICKET_PRIORITIES, 'priority');
  const status = maintenanceChoice(values.status || 'open', MAINTENANCE_TICKET_STATUSES, 'status');
  const assignee = maintenanceText(values.assignee, 'assignee', {max:200});
  const reportedBy = maintenanceText(values.reported_by || actor?.email || 'admin', 'reported_by', {max:200});
  const dueAt = maintenanceDate(values.due_at, 'due_at');
  const machine = await maintenanceMachineContext(values.machine_id);
  if (values.machine_id && !machine) {
    const error = new Error('Machine not found'); error.statusCode = 404; throw error;
  }

  const ticketNo = makeMaintenanceTicketNo();
  const inserted = await one(`
    INSERT INTO maintenance_tickets(
      ticket_no,customer_id,site_id,machine_id,alarm_id,source,title,description,
      category,priority,status,assignee,reported_by,due_at,created_by,started_at,
      resolved_at,closed_at,resolution_note
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      CASE WHEN $11='in_progress' THEN now() ELSE NULL END,
      CASE WHEN $11='resolved' THEN now() ELSE NULL END,
      CASE WHEN $11='closed' THEN now() ELSE NULL END,$16
    )
    RETURNING id::text
  `, [
    ticketNo,machine?.customer_id || values.customer_id || null,machine?.site_id || values.site_id || null,
    machine?.id || values.machine_id || null,values.alarm_id || null,source,title,description,
    category,priority,status,assignee,reportedBy,dueAt,actor?.email || 'admin',
    maintenanceText(values.resolution_note, 'resolution_note', {max:4000})
  ]);

  await addMaintenanceTicketEvent(pool, {
    ticketId:inserted.id,
    eventType:'created',
    oldStatus:null,
    newStatus:status,
    note:description,
    actorEmail:actor?.email || 'admin',
    metadata:{source, machine_id:machine?.id || null, alarm_id:values.alarm_id || null, priority, category}
  });
  return maintenanceTicketRow(inserted.id);
}

function maintenanceTicketQueryString(req) {
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  const status = String(req.query.status || 'active').trim().toLowerCase();
  if (status === 'active') where.push(`t.status IN ('open','in_progress','waiting')`);
  else if (status && status !== 'all') add('t.status=?', maintenanceChoice(status, MAINTENANCE_TICKET_STATUSES, 'status'));
  const priority = String(req.query.priority || 'all').trim().toLowerCase();
  if (priority && priority !== 'all') add('t.priority=?', maintenanceChoice(priority, MAINTENANCE_TICKET_PRIORITIES, 'priority'));
  const category = String(req.query.category || 'all').trim().toLowerCase();
  if (category && category !== 'all') add('t.category=?', maintenanceChoice(category, MAINTENANCE_TICKET_CATEGORIES, 'category'));
  const q = String(req.query.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    where.push(`(t.ticket_no ILIKE $${params.length} OR t.title ILIKE $${params.length} OR t.description ILIKE $${params.length} OR t.assignee ILIKE $${params.length} OR m.code ILIKE $${params.length} OR m.name ILIKE $${params.length})`);
  }
  return {params, whereSql:where.length ? `WHERE ${where.join(' AND ')}` : ''};
}

app.get('/api/admin/maintenance-tickets', adminRequired, permissionRequired('VIEW_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const {params, whereSql} = maintenanceTicketQueryString(req);
    const limit = maintenanceTicketLimit(req.query.limit, 100, 500);
    params.push(limit);

    const summary = await one(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status IN ('open','in_progress','waiting'))::int AS active,
        count(*) FILTER (WHERE status='in_progress')::int AS in_progress,
        count(*) FILTER (WHERE due_at < now() AND status IN ('open','in_progress','waiting'))::int AS overdue,
        count(*) FILTER (WHERE priority='critical' AND status IN ('open','in_progress','waiting'))::int AS critical_active,
        count(*) FILTER (WHERE COALESCE(NULLIF(assignee,''),'')='' AND status IN ('open','in_progress','waiting'))::int AS unassigned,
        count(*) FILTER (WHERE status IN ('resolved','closed') AND updated_at >= now() - interval '30 days')::int AS completed_30d
      FROM maintenance_tickets
    `);

    const rows = await pool.query(`
      SELECT
        t.id::text, t.ticket_no, t.source, t.title, t.description, t.category,
        t.priority, t.status, t.assignee, t.reported_by, t.due_at, t.started_at,
        t.resolved_at, t.closed_at, t.resolution_note, t.created_by,
        t.created_at, t.updated_at, t.alarm_id::text,
        m.id::text AS machine_id, m.code AS machine_code, m.name AS machine_name,
        s.code AS site_code, c.code AS customer_code,
        a.alarm_type, a.severity AS alarm_severity, a.status AS alarm_status,
        (t.due_at IS NOT NULL AND t.due_at < now() AND t.status IN ('open','in_progress','waiting')) AS overdue
      FROM maintenance_tickets t
      LEFT JOIN machines m ON m.id=t.machine_id
      LEFT JOIN sites s ON s.id=t.site_id
      LEFT JOIN customers c ON c.id=t.customer_id
      LEFT JOIN alarms a ON a.id=t.alarm_id
      ${whereSql}
      ORDER BY
        CASE t.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        t.due_at ASC NULLS LAST,
        t.created_at DESC
      LIMIT $${params.length}
    `, params);

    const machines = await pool.query(`
      SELECT m.id::text, m.code, m.name, s.code AS site_code, c.code AS customer_code
      FROM machines m
      LEFT JOIN sites s ON s.id=m.site_id
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE COALESCE(m.status,'active') <> 'archived'
      ORDER BY c.code, s.code, m.name
      LIMIT 500
    `);

    res.json({
      status:'ok', version:APP_VERSION, generated_at:new Date().toISOString(),
      can_manage:!authConfig().enabled || hasPermission(req.user, 'MANAGE_MAINTENANCE'),
      summary:summary || {}, tickets:rows.rows, machines:machines.rows,
      options:{statuses:MAINTENANCE_TICKET_STATUSES, priorities:MAINTENANCE_TICKET_PRIORITIES, categories:MAINTENANCE_TICKET_CATEGORIES}
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/maintenance-tickets', adminRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const ticket = await createMaintenanceTicketRecord(req, {...req.body, source:'manual'});
    await writeAuditLog(req, {action:'create_maintenance_ticket',entity_type:'maintenance_ticket',entity_id:ticket.id,old_values:null,new_values:ticket,metadata:{ticket_no:ticket.ticket_no,source:'manual'}});
    res.status(201).json({status:'ok', version:APP_VERSION, ticket});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/maintenance-tickets/from-alarm/:alarmId', adminRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const alarmId = String(req.params.alarmId || '').trim();
    const alarm = await one(`
      SELECT a.id::text, a.alarm_type, a.severity, a.status, a.message, a.machine_id::text,
             m.code AS machine_code, m.name AS machine_name
      FROM alarms a LEFT JOIN machines m ON m.id=a.machine_id
      WHERE a.id=$1 LIMIT 1
    `, [alarmId]);
    if (!alarm) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Alarm not found'});

    const existing = await one(`
      SELECT id::text, ticket_no, status FROM maintenance_tickets
      WHERE alarm_id=$1 AND status NOT IN ('closed','cancelled')
      ORDER BY created_at DESC LIMIT 1
    `, [alarmId]);
    if (existing) return res.status(409).json({status:'duplicate', version:APP_VERSION, message:`Bu alarm için aktif ticket zaten var: ${existing.ticket_no}`, ticket:existing});

    const dueHours = alarm.severity === 'critical' ? 4 : (alarm.severity === 'warning' ? 24 : 72);
    const ticket = await createMaintenanceTicketRecord(req, {
      source:'alarm', alarm_id:alarmId, machine_id:alarm.machine_id,
      title:req.body?.title || `${alarm.alarm_type || 'Alarm'} — ${alarm.machine_name || alarm.machine_code || 'Makine'}`,
      description:req.body?.description || alarm.message || `Alarm ${alarm.alarm_type || ''} için bakım talebi`,
      category:req.body?.category || 'corrective',
      priority:req.body?.priority || (alarm.severity === 'critical' ? 'critical' : (alarm.severity === 'warning' ? 'high' : 'medium')),
      assignee:req.body?.assignee || null,
      due_at:req.body?.due_at || new Date(Date.now() + dueHours * 3600000).toISOString()
    });
    await writeAuditLog(req, {action:'create_maintenance_ticket_from_alarm',entity_type:'maintenance_ticket',entity_id:ticket.id,old_values:null,new_values:ticket,metadata:{ticket_no:ticket.ticket_no,alarm_id:alarmId}});
    res.status(201).json({status:'ok', version:APP_VERSION, ticket});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.patch('/api/admin/maintenance-tickets/:id', adminRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  let client;
  try {
    await ensureMaintenanceFoundation();
    const id = String(req.params.id || '').trim();
    const oldTicket = await maintenanceTicketRow(id);
    if (!oldTicket) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Maintenance ticket not found'});

    const title = req.body?.title !== undefined ? maintenanceText(req.body.title, 'title', {required:true, max:240}) : oldTicket.title;
    const description = req.body?.description !== undefined ? maintenanceText(req.body.description, 'description', {max:4000}) : oldTicket.description;
    const category = req.body?.category !== undefined ? maintenanceChoice(req.body.category, MAINTENANCE_TICKET_CATEGORIES, 'category') : oldTicket.category;
    const priority = req.body?.priority !== undefined ? maintenanceChoice(req.body.priority, MAINTENANCE_TICKET_PRIORITIES, 'priority') : oldTicket.priority;
    const status = req.body?.status !== undefined ? maintenanceChoice(req.body.status, MAINTENANCE_TICKET_STATUSES, 'status') : oldTicket.status;
    const assignee = req.body?.assignee !== undefined ? maintenanceText(req.body.assignee, 'assignee', {max:200}) : oldTicket.assignee;
    const dueAt = req.body?.due_at !== undefined ? maintenanceDate(req.body.due_at, 'due_at') : oldTicket.due_at;
    const resolutionNote = req.body?.resolution_note !== undefined ? maintenanceText(req.body.resolution_note, 'resolution_note', {max:4000}) : oldTicket.resolution_note;
    const actor = req.user || getSession(req)?.user || null;

    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE maintenance_tickets
      SET title=$2, description=$3, category=$4, priority=$5, status=$6,
          assignee=$7, due_at=$8, resolution_note=$9,
          started_at=CASE WHEN $6='in_progress' THEN COALESCE(started_at,now()) WHEN $6='open' THEN NULL ELSE started_at END,
          resolved_at=CASE WHEN $6='resolved' THEN COALESCE(resolved_at,now()) WHEN $6 IN ('open','in_progress','waiting') THEN NULL ELSE resolved_at END,
          closed_at=CASE WHEN $6='closed' THEN COALESCE(closed_at,now()) WHEN $6 <> 'closed' THEN NULL ELSE closed_at END,
          updated_at=now()
      WHERE id=$1 RETURNING id::text
    `, [id,title,description,category,priority,status,assignee,dueAt,resolutionNote]);
    if (!result.rows[0]) { await client.query('ROLLBACK'); client.release(); client=null; return res.status(404).json({status:'not_found', message:'Maintenance ticket not found'}); }
    const changedStatus = status !== oldTicket.status;
    await addMaintenanceTicketEvent(client, {
      ticketId:id, eventType:changedStatus ? 'status_changed' : 'updated',
      oldStatus:oldTicket.status, newStatus:status,
      note:req.body?.note || (changedStatus ? resolutionNote : null), actorEmail:actor?.email || 'admin',
      metadata:{priority_before:oldTicket.priority,priority_after:priority,assignee_before:oldTicket.assignee,assignee_after:assignee,due_at:dueAt}
    });
    await client.query('COMMIT'); client.release(); client=null;
    const ticket = await maintenanceTicketRow(id);
    await writeAuditLog(req, {action:changedStatus ? 'change_maintenance_ticket_status' : 'update_maintenance_ticket',entity_type:'maintenance_ticket',entity_id:id,old_values:oldTicket,new_values:ticket,metadata:{ticket_no:ticket.ticket_no}});
    res.json({status:'ok', version:APP_VERSION, ticket});
  } catch(e) {
    if (client) { try { await client.query('ROLLBACK'); } catch(_) {} client.release(); }
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/maintenance-tickets/:id/notes', adminRequired, permissionRequired('MANAGE_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const id = String(req.params.id || '').trim();
    const ticket = await maintenanceTicketRow(id);
    if (!ticket) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Maintenance ticket not found'});
    const note = maintenanceText(req.body?.note, 'note', {required:true, max:4000});
    const actor = req.user || getSession(req)?.user || null;
    await addMaintenanceTicketEvent(pool, {ticketId:id,eventType:'note',oldStatus:ticket.status,newStatus:ticket.status,note,actorEmail:actor?.email || 'admin',metadata:null});
    await pool.query(`UPDATE maintenance_tickets SET updated_at=now() WHERE id=$1`, [id]);
    await writeAuditLog(req, {action:'add_maintenance_ticket_note',entity_type:'maintenance_ticket',entity_id:id,old_values:null,new_values:{note},metadata:{ticket_no:ticket.ticket_no}});
    res.status(201).json({status:'ok', version:APP_VERSION});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/maintenance-tickets/:id/history', adminRequired, permissionRequired('VIEW_MAINTENANCE'), async (req,res)=>{
  try {
    await ensureMaintenanceFoundation();
    const id = String(req.params.id || '').trim();
    const ticket = await maintenanceTicketRow(id);
    if (!ticket) return res.status(404).json({status:'not_found', version:APP_VERSION, message:'Maintenance ticket not found'});
    const events = await pool.query(`
      SELECT id::text,event_type,old_status,new_status,note,actor_email,metadata,created_at
      FROM maintenance_ticket_events WHERE ticket_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200
    `, [id]);
    res.json({status:'ok', version:APP_VERSION, ticket, events:events.rows});
  } catch(e) {
    res.status(e.statusCode || 500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});


const MAINTENANCE_PLAN_SCHEDULE_TYPES = ['daily','weekly','monthly','runtime'];
const MAINTENANCE_WORK_ORDER_STATUSES = ['scheduled','open','in_progress','waiting','completed','cancelled'];
const MAINTENANCE_WORK_ORDER_SOURCES = ['automatic','manual'];
let maintenanceSchedulerState = {
  running:false,
  last_run_at:null,
  last_result:null,
  next_run_at:null,
  last_error:null
};

function maintenanceNumber(value, label, {min=0,max=1000000,fallback=null,integer=false}={}) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    const error = new Error(`${label} must be between ${min} and ${max}`);
    error.statusCode = 400;
    throw error;
  }
  return integer ? Math.floor(n) : n;
}

function maintenanceJsonArray(value, label, maxItems=100) {
  if (value === null || value === undefined || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    const clean = value.trim();
    if (!clean) return [];
    try { parsed = JSON.parse(clean); }
    catch { parsed = clean.split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean); }
  }
  if (!Array.isArray(parsed)) {
    const error = new Error(`${label} must be an array`); error.statusCode=400; throw error;
  }
  return parsed.slice(0,maxItems).map(item => {
    if (typeof item === 'object' && item !== null) return item;
    return String(item).trim();
  }).filter(item => typeof item === 'object' || item);
}

function maintenanceChannels(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || 'dashboard');
  const channels = raw.toLowerCase().split(/[,+]/).map(v=>v.trim()).filter(v=>['dashboard','telegram','email'].includes(v));
  return [...new Set(channels.length ? channels : ['dashboard'])];
}

function makeMaintenancePlanNo() {
  const stamp = new Date().toISOString().slice(0,10).replaceAll('-','');
  return `MP-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function makeMaintenanceWorkOrderNo() {
  const stamp = new Date().toISOString().slice(0,10).replaceAll('-','');
  return `WO-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function calculateMaintenanceNextDue(scheduleType, intervalValue, fromValue=new Date()) {
  if (scheduleType === 'runtime') return null;
  const date = new Date(fromValue || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  const interval = Math.max(1, Number(intervalValue || 1));
  if (scheduleType === 'daily') date.setUTCDate(date.getUTCDate() + interval);
  if (scheduleType === 'weekly') date.setUTCDate(date.getUTCDate() + interval * 7);
  if (scheduleType === 'monthly') date.setUTCMonth(date.getUTCMonth() + interval);
  return date.toISOString();
}

async function machineRuntimeHours(machineId) {
  if (!machineId) return 0;
  const row = await one(`
    SELECT COALESCE(SUM(
      CASE
        WHEN state='RUNNING' AND ended_at IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM(now()-started_at)))
        WHEN state='RUNNING' THEN GREATEST(0,COALESCE(duration_sec,EXTRACT(EPOCH FROM(ended_at-started_at))))
        ELSE 0
      END
    ),0)::numeric / 3600 AS runtime_hours
    FROM machine_state_events WHERE machine_id=$1
  `,[String(machineId)]);
  return Number(row?.runtime_hours || 0);
}

async function ensurePreventiveMaintenanceFoundation() {
  await ensureMaintenanceFoundation();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_scheduler_settings (
      id smallint PRIMARY KEY DEFAULT 1,
      enabled boolean NOT NULL DEFAULT true,
      interval_sec integer NOT NULL DEFAULT 60,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT maintenance_scheduler_singleton CHECK (id=1)
    )
  `);
  await pool.query(`INSERT INTO maintenance_scheduler_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_plans (
      id bigserial PRIMARY KEY,
      plan_no text NOT NULL UNIQUE,
      customer_id uuid,
      site_id uuid,
      machine_id uuid NOT NULL,
      title text NOT NULL,
      description text,
      category text NOT NULL DEFAULT 'preventive',
      priority text NOT NULL DEFAULT 'medium',
      schedule_type text NOT NULL DEFAULT 'monthly',
      interval_value integer NOT NULL DEFAULT 1,
      runtime_interval_hours numeric(12,2),
      checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
      assignee text,
      estimated_minutes integer,
      reminder_days integer NOT NULL DEFAULT 3,
      notification_channels text NOT NULL DEFAULT 'dashboard',
      enabled boolean NOT NULL DEFAULT true,
      next_due_at timestamptz,
      next_due_runtime_hours numeric(12,2),
      last_completed_at timestamptz,
      last_completed_runtime_hours numeric(12,2),
      last_work_order_id bigint,
      created_by text,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT maintenance_plan_category_check CHECK (category IN ('preventive','inspection','electrical','mechanical','software','safety','other')),
      CONSTRAINT maintenance_plan_priority_check CHECK (priority IN ('low','medium','high','critical')),
      CONSTRAINT maintenance_plan_schedule_check CHECK (schedule_type IN ('daily','weekly','monthly','runtime'))
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_work_orders (
      id bigserial PRIMARY KEY,
      work_order_no text NOT NULL UNIQUE,
      plan_id bigint REFERENCES maintenance_plans(id) ON DELETE SET NULL,
      customer_id uuid,
      site_id uuid,
      machine_id uuid NOT NULL,
      source text NOT NULL DEFAULT 'automatic',
      title text NOT NULL,
      description text,
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'scheduled',
      assignee text,
      due_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      duration_minutes integer,
      checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
      checklist_results jsonb NOT NULL DEFAULT '[]'::jsonb,
      parts_used jsonb NOT NULL DEFAULT '[]'::jsonb,
      completion_note text,
      created_by text,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT maintenance_wo_priority_check CHECK (priority IN ('low','medium','high','critical')),
      CONSTRAINT maintenance_wo_status_check CHECK (status IN ('scheduled','open','in_progress','waiting','completed','cancelled')),
      CONSTRAINT maintenance_wo_source_check CHECK (source IN ('automatic','manual'))
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_work_order_events (
      id bigserial PRIMARY KEY,
      work_order_id bigint NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE CASCADE,
      event_type text NOT NULL,
      old_status text,
      new_status text,
      note text,
      actor_email text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_scheduler_runs (
      id bigserial PRIMARY KEY,
      trigger text NOT NULL,
      status text NOT NULL,
      reviewed_count integer NOT NULL DEFAULT 0,
      due_count integer NOT NULL DEFAULT 0,
      created_count integer NOT NULL DEFAULT 0,
      skipped_count integer NOT NULL DEFAULT 0,
      error_count integer NOT NULL DEFAULT 0,
      details jsonb,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_notification_deliveries (
      id bigserial PRIMARY KEY,
      work_order_id bigint REFERENCES maintenance_work_orders(id) ON DELETE CASCADE,
      channel text NOT NULL,
      status text NOT NULL,
      target text,
      provider_message_id text,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_plans_due ON maintenance_plans(enabled,next_due_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_plans_machine ON maintenance_plans(machine_id,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_wo_status_due ON maintenance_work_orders(status,due_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_wo_plan ON maintenance_work_orders(plan_id,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_wo_events ON maintenance_work_order_events(work_order_id,created_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_wo_active_plan ON maintenance_work_orders(plan_id) WHERE plan_id IS NOT NULL AND status NOT IN ('completed','cancelled')`);
}

async function maintenanceSchedulerSettings() {
  await ensurePreventiveMaintenanceFoundation();
  return await one(`SELECT enabled,interval_sec,updated_by,updated_at FROM maintenance_scheduler_settings WHERE id=1`) || {enabled:true,interval_sec:60};
}

async function maintenancePlanRow(id) {
  const row = await one(`
    SELECT p.id::text,p.plan_no,p.title,p.description,p.category,p.priority,p.schedule_type,p.interval_value,
      p.runtime_interval_hours,p.checklist,p.assignee,p.estimated_minutes,p.reminder_days,p.notification_channels,
      p.enabled,p.next_due_at,p.next_due_runtime_hours,p.last_completed_at,p.last_completed_runtime_hours,
      p.last_work_order_id::text,p.created_by,p.updated_by,p.created_at,p.updated_at,
      m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,s.code AS site_code,c.code AS customer_code,
      wo.id::text AS active_work_order_id,wo.work_order_no AS active_work_order_no,wo.status AS active_work_order_status,wo.due_at AS active_work_order_due
    FROM maintenance_plans p
    JOIN machines m ON m.id=p.machine_id
    LEFT JOIN sites s ON s.id=p.site_id
    LEFT JOIN customers c ON c.id=p.customer_id
    LEFT JOIN LATERAL (
      SELECT id,work_order_no,status,due_at FROM maintenance_work_orders w
      WHERE w.plan_id=p.id AND w.status NOT IN ('completed','cancelled') ORDER BY w.created_at DESC LIMIT 1
    ) wo ON true
    WHERE p.id=$1 LIMIT 1
  `,[String(id)]);
  if (row) {
    row.current_runtime_hours = await machineRuntimeHours(row.machine_id);
    row.runtime_due = row.schedule_type === 'runtime' && row.next_due_runtime_hours !== null
      ? row.current_runtime_hours >= Number(row.next_due_runtime_hours) : false;
    row.calendar_overdue = row.next_due_at ? new Date(row.next_due_at).getTime() < Date.now() : false;
  }
  return row;
}

async function maintenanceWorkOrderRow(id) {
  return one(`
    SELECT w.id::text,w.work_order_no,w.plan_id::text,w.source,w.title,w.description,w.priority,w.status,w.assignee,w.due_at,
      w.started_at,w.completed_at,w.duration_minutes,w.checklist,w.checklist_results,w.parts_used,w.completion_note,
      w.created_by,w.updated_by,w.created_at,w.updated_at,
      p.plan_no,p.schedule_type,p.interval_value,p.runtime_interval_hours,
      m.id::text AS machine_id,m.code AS machine_code,m.name AS machine_name,s.code AS site_code,c.code AS customer_code,
      (w.due_at IS NOT NULL AND w.due_at < now() AND w.status NOT IN ('completed','cancelled')) AS overdue
    FROM maintenance_work_orders w
    LEFT JOIN maintenance_plans p ON p.id=w.plan_id
    JOIN machines m ON m.id=w.machine_id
    LEFT JOIN sites s ON s.id=w.site_id
    LEFT JOIN customers c ON c.id=w.customer_id
    WHERE w.id=$1 LIMIT 1
  `,[String(id)]);
}

async function addMaintenanceWorkOrderEvent(clientOrPool,{workOrderId,eventType,oldStatus=null,newStatus=null,note=null,actorEmail='system',metadata=null}) {
  await clientOrPool.query(`INSERT INTO maintenance_work_order_events(work_order_id,event_type,old_status,new_status,note,actor_email,metadata) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [workOrderId,eventType,oldStatus,newStatus,note,actorEmail,JSON.stringify(metadata || null)]);
}

async function sendMaintenanceWorkOrderNotification(workOrder, channelsValue) {
  const channels = maintenanceChannels(channelsValue).filter(c=>c!=='dashboard');
  const results=[];
  const text = [
    '🛠️ FactoryBox Planlı Bakım İş Emri',
    `İş Emri: ${workOrder.work_order_no}`,
    `Plan: ${workOrder.plan_no || '-'}`,
    `Makine: ${workOrder.machine_name || workOrder.machine_code || '-'}`,
    `Başlık: ${workOrder.title}`,
    `Öncelik: ${workOrder.priority}`,
    `Termin: ${workOrder.due_at ? new Date(workOrder.due_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}) : '-'}`,
    `Atanan: ${workOrder.assignee || 'Atanmamış'}`
  ].join('\n');
  for (const channel of channels) {
    try {
      if (channel === 'telegram') {
        const cfg=telegramEscalationConfig();
        if (!cfg.enabled || !cfg.token || !cfg.defaultChatId) throw new Error('Telegram channel is not configured');
        const response=await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:cfg.defaultChatId,text})});
        const payload=await response.json().catch(()=>({}));
        if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram HTTP ${response.status}`);
        const messageId=String(payload.result?.message_id || '');
        await pool.query(`INSERT INTO maintenance_notification_deliveries(work_order_id,channel,status,target,provider_message_id) VALUES($1,'telegram','delivered',$2,$3)`,[workOrder.id,cfg.defaultChatId,messageId||null]);
        results.push({channel,status:'delivered',message_id:messageId||null});
      }
      if (channel === 'email') {
        const cfg=emailConfig();
        if (!cfg.enabled || !cfg.configured || !cfg.defaultTo) throw new Error('Email channel is not configured');
        const result=await sendReportEmail({to:cfg.defaultTo,subject:`FactoryBox Bakım İş Emri ${workOrder.work_order_no}`,text,html:`<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</pre>`,purpose:'maintenance',metadata:{event_id:workOrder.id,machine_code:workOrder.machine_code}});
        if (!result.sent) throw new Error(result.reason || 'Email not sent');
        await pool.query(`INSERT INTO maintenance_notification_deliveries(work_order_id,channel,status,target,provider_message_id) VALUES($1,'email','delivered',$2,$3)`,[workOrder.id,cfg.defaultTo,result.message_id||null]);
        results.push({channel,status:'delivered',message_id:result.message_id||null});
      }
    } catch(error) {
      await pool.query(`INSERT INTO maintenance_notification_deliveries(work_order_id,channel,status,error_message) VALUES($1,$2,'failed',$3)`,[workOrder.id,channel,String(error.message||error).slice(0,1000)]);
      results.push({channel,status:'failed',error:String(error.message||error)});
    }
  }
  return results;
}

async function createMaintenanceWorkOrderFromPlan(plan,{source='automatic',actorEmail='system',force=false}={}) {
  const existing=await one(`SELECT id::text,work_order_no,status FROM maintenance_work_orders WHERE plan_id=$1 AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 1`,[plan.id]);
  if (existing && !force) return {created:false,reason:'active_work_order_exists',work_order:existing};
  const machine=await maintenanceMachineContext(plan.machine_id);
  if (!machine) throw new Error('Maintenance plan machine not found');
  const inserted=await one(`
    INSERT INTO maintenance_work_orders(work_order_no,plan_id,customer_id,site_id,machine_id,source,title,description,priority,status,assignee,due_at,checklist,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$12::jsonb,$13,$13) RETURNING id::text
  `,[makeMaintenanceWorkOrderNo(),plan.id,machine.customer_id,machine.site_id,machine.id,source,plan.title,plan.description,plan.priority,plan.assignee,plan.next_due_at,JSON.stringify(plan.checklist||[]),actorEmail]);
  await addMaintenanceWorkOrderEvent(pool,{workOrderId:inserted.id,eventType:'created',newStatus:'scheduled',actorEmail,metadata:{plan_id:plan.id,plan_no:plan.plan_no,source}});
  const workOrder=await maintenanceWorkOrderRow(inserted.id);
  const delivery=await sendMaintenanceWorkOrderNotification(workOrder,plan.notification_channels);
  return {created:true,work_order:workOrder,delivery};
}

async function createMaintenancePlan(values,actorEmail='admin') {
  const machine=await maintenanceMachineContext(values.machine_id);
  if (!machine) { const e=new Error('Machine not found');e.statusCode=404;throw e; }
  const scheduleType=maintenanceChoice(values.schedule_type||'monthly',MAINTENANCE_PLAN_SCHEDULE_TYPES,'schedule_type');
  const intervalValue=maintenanceNumber(values.interval_value,'interval_value',{min:1,max:3650,fallback:1,integer:true});
  const runtimeInterval=scheduleType==='runtime' ? maintenanceNumber(values.runtime_interval_hours,'runtime_interval_hours',{min:0.1,max:100000,fallback:100}) : null;
  const currentRuntime=await machineRuntimeHours(machine.id);
  const nextDueAt=scheduleType==='runtime' ? null : (maintenanceDate(values.next_due_at,'next_due_at') || calculateMaintenanceNextDue(scheduleType,intervalValue,new Date()));
  const nextRuntime=scheduleType==='runtime' ? (maintenanceNumber(values.next_due_runtime_hours,'next_due_runtime_hours',{min:0,max:10000000,fallback:null}) ?? currentRuntime+runtimeInterval) : null;
  const id=await one(`
    INSERT INTO maintenance_plans(plan_no,customer_id,site_id,machine_id,title,description,category,priority,schedule_type,interval_value,runtime_interval_hours,
      checklist,assignee,estimated_minutes,reminder_days,notification_channels,enabled,next_due_at,next_due_runtime_hours,created_by,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING id::text
  `,[makeMaintenancePlanNo(),machine.customer_id,machine.site_id,machine.id,maintenanceText(values.title,'title',{required:true,max:240}),maintenanceText(values.description,'description',{max:4000}),
    maintenanceChoice(values.category||'preventive',['preventive','inspection','electrical','mechanical','software','safety','other'],'category'),
    maintenanceChoice(values.priority||'medium',MAINTENANCE_TICKET_PRIORITIES,'priority'),scheduleType,intervalValue,runtimeInterval,JSON.stringify(maintenanceJsonArray(values.checklist,'checklist')),
    maintenanceText(values.assignee,'assignee',{max:200}),maintenanceNumber(values.estimated_minutes,'estimated_minutes',{min:1,max:100000,fallback:null,integer:true}),
    maintenanceNumber(values.reminder_days,'reminder_days',{min:0,max:365,fallback:3,integer:true}),maintenanceChannels(values.notification_channels).join(','),
    values.enabled===undefined ? true : Boolean(values.enabled),nextDueAt,nextRuntime,actorEmail]);
  return maintenancePlanRow(id.id);
}

async function scanPreventiveMaintenance({trigger='manual'}={}) {
  if (maintenanceSchedulerState.running) return {status:'skipped',reason:'already_running'};
  maintenanceSchedulerState.running=true;
  maintenanceSchedulerState.last_error=null;
  const run=await one(`INSERT INTO maintenance_scheduler_runs(trigger,status) VALUES($1,'running') RETURNING id::text,started_at`,[trigger]);
  const result={status:'completed',reviewed_count:0,due_count:0,created_count:0,skipped_count:0,error_count:0,items:[]};
  try {
    const plans=(await pool.query(`SELECT * FROM maintenance_plans WHERE enabled=true ORDER BY next_due_at ASC NULLS LAST,id ASC LIMIT 1000`)).rows;
    result.reviewed_count=plans.length;
    for (const plan of plans) {
      try {
        const active=await one(`SELECT id::text,work_order_no,status FROM maintenance_work_orders WHERE plan_id=$1 AND status NOT IN ('completed','cancelled') LIMIT 1`,[plan.id]);
        if (active) {result.skipped_count++;result.items.push({plan_no:plan.plan_no,status:'skipped',reason:'active_work_order_exists',work_order_no:active.work_order_no});continue;}
        let due=false;
        let currentRuntime=null;
        if (plan.schedule_type==='runtime') {
          currentRuntime=await machineRuntimeHours(plan.machine_id);
          due=plan.next_due_runtime_hours!==null && currentRuntime>=Number(plan.next_due_runtime_hours);
        } else if (plan.next_due_at) {
          const dueAt=new Date(plan.next_due_at).getTime();
          due=dueAt <= Date.now() + Math.max(0,Number(plan.reminder_days||0))*86400000;
        }
        if (!due) {result.skipped_count++;continue;}
        result.due_count++;
        const created=await createMaintenanceWorkOrderFromPlan(plan,{source:'automatic',actorEmail:`scheduler:${trigger}`});
        if (created.created) {result.created_count++;result.items.push({plan_no:plan.plan_no,status:'created',work_order_no:created.work_order.work_order_no});}
        else {result.skipped_count++;result.items.push({plan_no:plan.plan_no,status:'skipped',reason:created.reason});}
      } catch(error) {
        result.error_count++;result.items.push({plan_no:plan.plan_no,status:'error',error:String(error.message||error)});
      }
    }
    await pool.query(`UPDATE maintenance_scheduler_runs SET status='completed',reviewed_count=$2,due_count=$3,created_count=$4,skipped_count=$5,error_count=$6,details=$7::jsonb,finished_at=now() WHERE id=$1`,
      [run.id,result.reviewed_count,result.due_count,result.created_count,result.skipped_count,result.error_count,JSON.stringify(result.items.slice(0,100))]);
    maintenanceSchedulerState.last_run_at=new Date().toISOString();
    maintenanceSchedulerState.last_result=result;
    return result;
  } catch(error) {
    maintenanceSchedulerState.last_error=String(error.message||error);
    await pool.query(`UPDATE maintenance_scheduler_runs SET status='failed',error_count=1,details=$2::jsonb,finished_at=now() WHERE id=$1`,[run.id,JSON.stringify({error:maintenanceSchedulerState.last_error})]);
    throw error;
  } finally { maintenanceSchedulerState.running=false; }
}

app.get('/api/admin/maintenance-plans',adminRequired,permissionRequired('VIEW_MAINTENANCE'),async(req,res)=>{
  try {
    await ensurePreventiveMaintenanceFoundation();
    const settings=await maintenanceSchedulerSettings();
    const rows=(await pool.query(`SELECT id::text FROM maintenance_plans ORDER BY enabled DESC,next_due_at ASC NULLS LAST,created_at DESC LIMIT 500`)).rows;
    const plans=[]; for(const row of rows) plans.push(await maintenancePlanRow(row.id));
    const machines=await pool.query(`SELECT m.id::text,m.code,m.name,s.code AS site_code,c.code AS customer_code FROM machines m LEFT JOIN sites s ON s.id=m.site_id LEFT JOIN customers c ON c.id=s.customer_id WHERE COALESCE(m.status,'active')<>'archived' ORDER BY c.code,s.code,m.name LIMIT 500`);
    const summary=await one(`SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int enabled,count(*) FILTER(WHERE enabled AND next_due_at<now())::int overdue_calendar,count(*) FILTER(WHERE enabled AND next_due_at BETWEEN now() AND now()+interval '7 days')::int due_7d FROM maintenance_plans`);
    const history=await pool.query(`SELECT id::text,trigger,status,reviewed_count,due_count,created_count,skipped_count,error_count,started_at,finished_at FROM maintenance_scheduler_runs ORDER BY started_at DESC LIMIT 20`);
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_MAINTENANCE'),summary,settings:{...settings,state:maintenanceSchedulerState},plans,machines:machines.rows,history:history.rows,options:{schedule_types:MAINTENANCE_PLAN_SCHEDULE_TYPES,priorities:MAINTENANCE_TICKET_PRIORITIES,categories:['preventive','inspection','electrical','mechanical','software','safety','other']}});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/maintenance-plans',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const actor=req.user||getSession(req)?.user||{};const plan=await createMaintenancePlan(req.body||{},actor.email||'admin');await writeAuditLog(req,{action:'create_maintenance_plan',entity_type:'maintenance_plan',entity_id:plan.id,old_values:null,new_values:plan,metadata:{plan_no:plan.plan_no}});res.status(201).json({status:'ok',version:APP_VERSION,plan});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/maintenance-plans/:id',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensurePreventiveMaintenanceFoundation();const id=String(req.params.id);const old=await maintenancePlanRow(id);if(!old)return res.status(404).json({status:'not_found',message:'Maintenance plan not found'});
    const body=req.body||{};const scheduleType=body.schedule_type!==undefined?maintenanceChoice(body.schedule_type,MAINTENANCE_PLAN_SCHEDULE_TYPES,'schedule_type'):old.schedule_type;
    const intervalValue=body.interval_value!==undefined?maintenanceNumber(body.interval_value,'interval_value',{min:1,max:3650,integer:true}):Number(old.interval_value);
    const runtimeInterval=scheduleType==='runtime'?(body.runtime_interval_hours!==undefined?maintenanceNumber(body.runtime_interval_hours,'runtime_interval_hours',{min:.1,max:100000}):Number(old.runtime_interval_hours||100)):null;
    let nextDueAt=scheduleType==='runtime'?null:(body.next_due_at!==undefined?maintenanceDate(body.next_due_at,'next_due_at'):old.next_due_at);
    let nextRuntime=scheduleType==='runtime'?(body.next_due_runtime_hours!==undefined?maintenanceNumber(body.next_due_runtime_hours,'next_due_runtime_hours',{min:0,max:10000000}):Number(old.next_due_runtime_hours||old.current_runtime_hours+runtimeInterval)):null;
    const actor=req.user||getSession(req)?.user||{};
    await pool.query(`UPDATE maintenance_plans SET title=$2,description=$3,category=$4,priority=$5,schedule_type=$6,interval_value=$7,runtime_interval_hours=$8,checklist=$9::jsonb,assignee=$10,estimated_minutes=$11,reminder_days=$12,notification_channels=$13,enabled=$14,next_due_at=$15,next_due_runtime_hours=$16,updated_by=$17,updated_at=now() WHERE id=$1`,[id,
      body.title!==undefined?maintenanceText(body.title,'title',{required:true,max:240}):old.title,body.description!==undefined?maintenanceText(body.description,'description',{max:4000}):old.description,
      body.category!==undefined?maintenanceChoice(body.category,['preventive','inspection','electrical','mechanical','software','safety','other'],'category'):old.category,
      body.priority!==undefined?maintenanceChoice(body.priority,MAINTENANCE_TICKET_PRIORITIES,'priority'):old.priority,scheduleType,intervalValue,runtimeInterval,
      JSON.stringify(body.checklist!==undefined?maintenanceJsonArray(body.checklist,'checklist'):old.checklist||[]),body.assignee!==undefined?maintenanceText(body.assignee,'assignee',{max:200}):old.assignee,
      body.estimated_minutes!==undefined?maintenanceNumber(body.estimated_minutes,'estimated_minutes',{min:1,max:100000,fallback:null,integer:true}):old.estimated_minutes,
      body.reminder_days!==undefined?maintenanceNumber(body.reminder_days,'reminder_days',{min:0,max:365,integer:true}):old.reminder_days,
      body.notification_channels!==undefined?maintenanceChannels(body.notification_channels).join(','):old.notification_channels,
      body.enabled!==undefined?Boolean(body.enabled):old.enabled,nextDueAt,nextRuntime,actor.email||'admin']);
    const plan=await maintenancePlanRow(id);await writeAuditLog(req,{action:'update_maintenance_plan',entity_type:'maintenance_plan',entity_id:id,old_values:old,new_values:plan,metadata:{plan_no:plan.plan_no}});restartMaintenanceScheduler();res.json({status:'ok',version:APP_VERSION,plan});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/maintenance-plans/:id/generate-work-order',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const plan=await maintenancePlanRow(req.params.id);if(!plan)return res.status(404).json({status:'not_found',message:'Maintenance plan not found'});const actor=req.user||getSession(req)?.user||{};const result=await createMaintenanceWorkOrderFromPlan(plan,{source:'manual',actorEmail:actor.email||'admin'});if(!result.created)return res.status(409).json({status:'duplicate',version:APP_VERSION,message:`Aktif iş emri zaten var: ${result.work_order?.work_order_no||'-'}`,result});await writeAuditLog(req,{action:'generate_maintenance_work_order',entity_type:'maintenance_work_order',entity_id:result.work_order.id,old_values:null,new_values:result.work_order,metadata:{plan_no:plan.plan_no}});res.status(201).json({status:'ok',version:APP_VERSION,...result});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/maintenance-scheduler',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const old=await maintenanceSchedulerSettings();const enabled=req.body?.enabled===undefined?old.enabled:Boolean(req.body.enabled);const interval=maintenanceNumber(req.body?.interval_sec,'interval_sec',{min:15,max:3600,fallback:Number(old.interval_sec||60),integer:true});const actor=req.user||getSession(req)?.user||{};await pool.query(`UPDATE maintenance_scheduler_settings SET enabled=$1,interval_sec=$2,updated_by=$3,updated_at=now() WHERE id=1`,[enabled,interval,actor.email||'admin']);const settings=await maintenanceSchedulerSettings();restartMaintenanceScheduler();await writeAuditLog(req,{action:'update_maintenance_scheduler',entity_type:'maintenance_scheduler',entity_id:'global',old_values:old,new_values:settings});res.json({status:'ok',version:APP_VERSION,settings});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/maintenance-scheduler/run-now',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const result=await scanPreventiveMaintenance({trigger:'manual'});await writeAuditLog(req,{action:'run_maintenance_scheduler',entity_type:'maintenance_scheduler',entity_id:'manual',new_values:result});res.json({status:'ok',version:APP_VERSION,result});}
  catch(e){res.status(500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.get('/api/admin/maintenance-work-orders',adminRequired,permissionRequired('VIEW_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const status=String(req.query.status||'active').toLowerCase();const q=String(req.query.q||'').trim();const params=[];const where=[];if(status==='active')where.push(`w.status NOT IN ('completed','cancelled')`);else if(status!=='all'){params.push(maintenanceChoice(status,MAINTENANCE_WORK_ORDER_STATUSES,'status'));where.push(`w.status=$${params.length}`);}if(q){params.push(`%${q}%`);where.push(`(w.work_order_no ILIKE $${params.length} OR w.title ILIKE $${params.length} OR w.assignee ILIKE $${params.length} OR m.code ILIKE $${params.length} OR m.name ILIKE $${params.length} OR p.plan_no ILIKE $${params.length})`);}const ids=await pool.query(`SELECT w.id::text FROM maintenance_work_orders w JOIN machines m ON m.id=w.machine_id LEFT JOIN maintenance_plans p ON p.id=w.plan_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY CASE w.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,w.due_at ASC NULLS LAST,w.created_at DESC LIMIT 500`,params);const orders=[];for(const row of ids.rows)orders.push(await maintenanceWorkOrderRow(row.id));const summary=await one(`SELECT count(*)::int total,count(*) FILTER(WHERE status NOT IN ('completed','cancelled'))::int active,count(*) FILTER(WHERE status='in_progress')::int in_progress,count(*) FILTER(WHERE due_at<now() AND status NOT IN ('completed','cancelled'))::int overdue,count(*) FILTER(WHERE status='completed' AND completed_at>=now()-interval '30 days')::int completed_30d FROM maintenance_work_orders`);res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_MAINTENANCE'),summary,work_orders:orders,options:{statuses:MAINTENANCE_WORK_ORDER_STATUSES,priorities:MAINTENANCE_TICKET_PRIORITIES}});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/maintenance-work-orders/:id',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  let client;
  try{
    await ensurePreventiveMaintenanceFoundation();const id=String(req.params.id);const old=await maintenanceWorkOrderRow(id);if(!old)return res.status(404).json({status:'not_found',message:'Work order not found'});const body=req.body||{};const status=body.status!==undefined?maintenanceChoice(body.status,MAINTENANCE_WORK_ORDER_STATUSES,'status'):old.status;const actor=req.user||getSession(req)?.user||{};const assignee=body.assignee!==undefined?maintenanceText(body.assignee,'assignee',{max:200}):old.assignee;const dueAt=body.due_at!==undefined?maintenanceDate(body.due_at,'due_at'):old.due_at;const duration=body.duration_minutes!==undefined?maintenanceNumber(body.duration_minutes,'duration_minutes',{min:0,max:100000,fallback:null,integer:true}):old.duration_minutes;const checklistResults=body.checklist_results!==undefined?maintenanceJsonArray(body.checklist_results,'checklist_results',200):old.checklist_results||[];const partsUsed=body.parts_used!==undefined?maintenanceJsonArray(body.parts_used,'parts_used',200):old.parts_used||[];const completionNote=body.completion_note!==undefined?maintenanceText(body.completion_note,'completion_note',{max:4000}):old.completion_note;
    client=await pool.connect();await client.query('BEGIN');await client.query(`UPDATE maintenance_work_orders SET status=$2,priority=$3,assignee=$4,due_at=$5,duration_minutes=$6,checklist_results=$7::jsonb,parts_used=$8::jsonb,completion_note=$9,started_at=CASE WHEN $2='in_progress' THEN COALESCE(started_at,now()) ELSE started_at END,completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,now()) WHEN $2<>'completed' THEN NULL ELSE completed_at END,updated_by=$10,updated_at=now() WHERE id=$1`,[id,status,body.priority!==undefined?maintenanceChoice(body.priority,MAINTENANCE_TICKET_PRIORITIES,'priority'):old.priority,assignee,dueAt,duration,JSON.stringify(checklistResults),JSON.stringify(partsUsed),completionNote,actor.email||'admin']);await addMaintenanceWorkOrderEvent(client,{workOrderId:id,eventType:status!==old.status?'status_changed':'updated',oldStatus:old.status,newStatus:status,note:body.note||completionNote,actorEmail:actor.email||'admin',metadata:{assignee,due_at:dueAt,duration_minutes:duration}});
    if(status==='completed'&&old.status!=='completed'&&old.plan_id){const plan=await maintenancePlanRow(old.plan_id);const runtime=await machineRuntimeHours(old.machine_id);const nextDue=plan.schedule_type==='runtime'?null:calculateMaintenanceNextDue(plan.schedule_type,plan.interval_value,new Date());const nextRuntime=plan.schedule_type==='runtime'?runtime+Number(plan.runtime_interval_hours||0):null;await client.query(`UPDATE maintenance_plans SET last_completed_at=now(),last_completed_runtime_hours=$2,last_work_order_id=$3,next_due_at=$4,next_due_runtime_hours=$5,updated_at=now(),updated_by=$6 WHERE id=$1`,[old.plan_id,runtime,id,nextDue,nextRuntime,actor.email||'admin']);}
    await client.query('COMMIT');client.release();client=null;const order=await maintenanceWorkOrderRow(id);await writeAuditLog(req,{action:status==='completed'?'complete_maintenance_work_order':'update_maintenance_work_order',entity_type:'maintenance_work_order',entity_id:id,old_values:old,new_values:order,metadata:{work_order_no:order.work_order_no}});res.json({status:'ok',version:APP_VERSION,work_order:order});
  }catch(e){if(client){try{await client.query('ROLLBACK')}catch{}client.release()}res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/maintenance-work-orders/:id/notes',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensurePreventiveMaintenanceFoundation();const order=await maintenanceWorkOrderRow(req.params.id);if(!order)return res.status(404).json({status:'not_found',message:'Work order not found'});const note=maintenanceText(req.body?.note,'note',{required:true,max:4000});const actor=req.user||getSession(req)?.user||{};await addMaintenanceWorkOrderEvent(pool,{workOrderId:order.id,eventType:'note',oldStatus:order.status,newStatus:order.status,note,actorEmail:actor.email||'admin'});res.status(201).json({status:'ok',version:APP_VERSION});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.get('/api/admin/maintenance-work-orders/:id/history',adminRequired,permissionRequired('VIEW_MAINTENANCE'),async(req,res)=>{
  try{await ensureInventoryFoundation();const order=await maintenanceWorkOrderRow(req.params.id);if(!order)return res.status(404).json({status:'not_found',message:'Work order not found'});const events=await pool.query(`SELECT id::text,event_type,old_status,new_status,note,actor_email,metadata,created_at FROM maintenance_work_order_events WHERE work_order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200`,[order.id]);const deliveries=await pool.query(`SELECT id::text,channel,status,target,provider_message_id,error_message,created_at FROM maintenance_notification_deliveries WHERE work_order_id=$1 ORDER BY created_at DESC`,[order.id]);const parts=await pool.query(`SELECT u.id::text,u.quantity::float8,u.unit_cost::float8,u.note,u.consumed_by,u.created_at,p.id::text AS part_id,p.part_no,p.sku,p.name AS part_name,p.unit,(u.quantity*u.unit_cost)::float8 AS total_cost FROM maintenance_work_order_parts u JOIN spare_parts p ON p.id=u.part_id WHERE u.work_order_id=$1 ORDER BY u.created_at DESC,u.id DESC`,[order.id]);res.json({status:'ok',version:APP_VERSION,work_order:order,events:events.rows,deliveries:deliveries.rows,parts_used:parts.rows});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});


// -----------------------------------------------------------------------------
// v5.23.0 Spare Parts & Inventory
// -----------------------------------------------------------------------------
const INVENTORY_MOVEMENT_TYPES = ['opening','purchase','consumption','return','adjustment'];

function makeSparePartNo() {
  const stamp = new Date().toISOString().slice(0,10).replaceAll('-','');
  return `SP-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function inventoryQuantity(value, label='quantity', {min=-100000000,max=100000000,allowZero=false,fallback=null}={}) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (!allowZero && n === 0)) {
    const error = new Error(`${label} must be ${allowZero ? 'between' : 'non-zero and between'} ${min} and ${max}`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(n * 1000) / 1000;
}

function inventoryMoney(value, label='unit_cost', fallback=null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000000000) {
    const error = new Error(`${label} must be between 0 and 1000000000`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(n * 10000) / 10000;
}

async function ensureInventoryFoundation() {
  await ensurePreventiveMaintenanceFoundation();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spare_parts (
      id bigserial PRIMARY KEY,
      part_no text NOT NULL UNIQUE,
      sku text,
      name text NOT NULL,
      description text,
      category text,
      unit text NOT NULL DEFAULT 'adet',
      location text,
      supplier text,
      unit_cost numeric(14,4) NOT NULL DEFAULT 0,
      current_stock numeric(14,3) NOT NULL DEFAULT 0,
      min_stock numeric(14,3) NOT NULL DEFAULT 0,
      reorder_qty numeric(14,3) NOT NULL DEFAULT 0,
      enabled boolean NOT NULL DEFAULT true,
      created_by text,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT spare_parts_stock_nonnegative CHECK (current_stock >= 0),
      CONSTRAINT spare_parts_min_stock_nonnegative CHECK (min_stock >= 0),
      CONSTRAINT spare_parts_reorder_nonnegative CHECK (reorder_qty >= 0),
      CONSTRAINT spare_parts_cost_nonnegative CHECK (unit_cost >= 0)
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_spare_parts_sku_lower ON spare_parts(lower(sku)) WHERE sku IS NOT NULL AND btrim(sku)<>''`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_spare_parts_stock ON spare_parts(enabled,current_stock,min_stock)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_spare_parts_name ON spare_parts(name)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id bigserial PRIMARY KEY,
      part_id bigint NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
      movement_type text NOT NULL,
      quantity_change numeric(14,3) NOT NULL,
      balance_before numeric(14,3) NOT NULL,
      balance_after numeric(14,3) NOT NULL,
      unit_cost numeric(14,4),
      reference_type text,
      reference_id text,
      reference_no text,
      note text,
      actor_email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT inventory_movement_type_check CHECK (movement_type IN ('opening','purchase','consumption','return','adjustment')),
      CONSTRAINT inventory_movement_quantity_nonzero CHECK (quantity_change <> 0),
      CONSTRAINT inventory_movement_balance_nonnegative CHECK (balance_after >= 0)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_part_created ON inventory_movements(part_id,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(reference_type,reference_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_work_order_parts (
      id bigserial PRIMARY KEY,
      work_order_id bigint NOT NULL REFERENCES maintenance_work_orders(id) ON DELETE CASCADE,
      part_id bigint NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
      movement_id bigint REFERENCES inventory_movements(id) ON DELETE SET NULL,
      quantity numeric(14,3) NOT NULL,
      unit_cost numeric(14,4) NOT NULL DEFAULT 0,
      note text,
      consumed_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT maintenance_work_order_part_quantity_positive CHECK (quantity > 0)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_work_order_parts_order ON maintenance_work_order_parts(work_order_id,created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_maintenance_work_order_parts_part ON maintenance_work_order_parts(part_id,created_at DESC)`);
}

async function inventoryPartRow(id, clientOrPool=pool) {
  return oneWith(clientOrPool, `
    SELECT p.id::text,p.part_no,p.sku,p.name,p.description,p.category,p.unit,p.location,p.supplier,
      p.unit_cost::float8 AS unit_cost,p.current_stock::float8 AS current_stock,p.min_stock::float8 AS min_stock,
      p.reorder_qty::float8 AS reorder_qty,p.enabled,p.created_by,p.updated_by,p.created_at,p.updated_at,
      (p.enabled AND p.current_stock <= p.min_stock) AS low_stock,
      (p.current_stock <= 0) AS out_of_stock,
      (p.current_stock * p.unit_cost)::float8 AS stock_value
    FROM spare_parts p WHERE p.id=$1 LIMIT 1
  `,[String(id)]);
}

async function oneWith(clientOrPool, query, params=[]) {
  const result = await clientOrPool.query(query, params);
  return result.rows[0] || null;
}

async function createInventoryMovement(client,{partId,movementType,quantityChange,unitCost=null,referenceType=null,referenceId=null,referenceNo=null,note=null,actorEmail='system'}) {
  const type = maintenanceChoice(movementType, INVENTORY_MOVEMENT_TYPES, 'movement_type');
  const change = inventoryQuantity(quantityChange, 'quantity_change');
  const part = await oneWith(client, `SELECT id::text,part_no,name,unit,current_stock::float8 AS current_stock,unit_cost::float8 AS unit_cost FROM spare_parts WHERE id=$1 FOR UPDATE`,[String(partId)]);
  if (!part) { const e=new Error('Spare part not found');e.statusCode=404;throw e; }
  const before = Number(part.current_stock || 0);
  const after = Math.round((before + change) * 1000) / 1000;
  if (after < 0) { const e=new Error(`Insufficient stock. Available: ${before} ${part.unit}`);e.statusCode=409;throw e; }
  const nextUnitCost = unitCost === null || unitCost === undefined || unitCost === '' ? Number(part.unit_cost || 0) : inventoryMoney(unitCost);
  await client.query(`UPDATE spare_parts SET current_stock=$2,unit_cost=$3,updated_by=$4,updated_at=now() WHERE id=$1`,[part.id,after,nextUnitCost,actorEmail]);
  const movement = await oneWith(client, `
    INSERT INTO inventory_movements(part_id,movement_type,quantity_change,balance_before,balance_after,unit_cost,reference_type,reference_id,reference_no,note,actor_email)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id::text,part_id::text,movement_type,quantity_change::float8,balance_before::float8,balance_after::float8,unit_cost::float8,reference_type,reference_id,reference_no,note,actor_email,created_at
  `,[part.id,type,change,before,after,nextUnitCost,referenceType,referenceId,referenceNo,note,actorEmail]);
  return {movement,part:{...part,current_stock:after,unit_cost:nextUnitCost}};
}

app.get('/api/admin/inventory',adminRequired,permissionRequired('VIEW_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureInventoryFoundation();
    const stock=String(req.query.stock||'all').toLowerCase();
    const category=String(req.query.category||'all').trim();
    const q=String(req.query.q||'').trim();
    const params=[];const where=[];
    if(stock==='low')where.push(`p.enabled=true AND p.current_stock<=p.min_stock`);
    else if(stock==='out')where.push(`p.current_stock<=0`);
    else if(stock==='in_stock')where.push(`p.current_stock>p.min_stock`);
    else if(stock==='disabled')where.push(`p.enabled=false`);
    else if(stock!=='all'){const e=new Error('Invalid stock filter');e.statusCode=400;throw e;}
    if(category&&category!=='all'){params.push(category);where.push(`COALESCE(p.category,'')=$${params.length}`);}
    if(q){params.push(`%${q}%`);where.push(`(p.part_no ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.location ILIKE $${params.length} OR p.supplier ILIKE $${params.length})`);}
    const rows=await pool.query(`
      SELECT p.id::text,p.part_no,p.sku,p.name,p.description,p.category,p.unit,p.location,p.supplier,
        p.unit_cost::float8 AS unit_cost,p.current_stock::float8 AS current_stock,p.min_stock::float8 AS min_stock,
        p.reorder_qty::float8 AS reorder_qty,p.enabled,p.created_at,p.updated_at,
        (p.enabled AND p.current_stock<=p.min_stock) AS low_stock,(p.current_stock<=0) AS out_of_stock,
        (p.current_stock*p.unit_cost)::float8 AS stock_value
      FROM spare_parts p ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY (p.enabled AND p.current_stock<=p.min_stock) DESC,p.enabled DESC,p.name ASC LIMIT 1000
    `,params);
    const summary=await one(`
      SELECT count(*)::int total,count(*) FILTER(WHERE enabled)::int enabled,
        count(*) FILTER(WHERE enabled AND current_stock<=min_stock)::int low_stock,
        count(*) FILTER(WHERE enabled AND current_stock<=0)::int out_of_stock,
        COALESCE(ROUND(SUM(current_stock*unit_cost)::numeric,2),0)::float8 AS stock_value
      FROM spare_parts
    `);
    const categories=(await pool.query(`SELECT DISTINCT category FROM spare_parts WHERE category IS NOT NULL AND btrim(category)<>'' ORDER BY category`)).rows.map(r=>r.category);
    const recent=(await pool.query(`
      SELECT m.id::text,m.movement_type,m.quantity_change::float8,m.balance_before::float8,m.balance_after::float8,m.unit_cost::float8,
        m.reference_type,m.reference_id,m.reference_no,m.note,m.actor_email,m.created_at,
        p.id::text AS part_id,p.part_no,p.name AS part_name,p.unit
      FROM inventory_movements m JOIN spare_parts p ON p.id=m.part_id ORDER BY m.created_at DESC,m.id DESC LIMIT 100
    `)).rows;
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_MAINTENANCE'),summary,parts:rows.rows,categories,recent_movements:recent,options:{movement_types:INVENTORY_MOVEMENT_TYPES}});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/inventory/parts',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  let client;
  try{
    await ensureInventoryFoundation();const body=req.body||{};const actor=req.user||getSession(req)?.user||{};
    const opening=inventoryQuantity(body.initial_stock,'initial_stock',{min:0,allowZero:true,fallback:0});
    client=await pool.connect();await client.query('BEGIN');
    const inserted=await oneWith(client,`INSERT INTO spare_parts(part_no,sku,name,description,category,unit,location,supplier,unit_cost,current_stock,min_stock,reorder_qty,enabled,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$13) RETURNING id::text`,[
      makeSparePartNo(),maintenanceText(body.sku,'sku',{max:120}),maintenanceText(body.name,'name',{required:true,max:240}),maintenanceText(body.description,'description',{max:4000}),maintenanceText(body.category,'category',{max:120}),maintenanceText(body.unit||'adet','unit',{required:true,max:40}),maintenanceText(body.location,'location',{max:200}),maintenanceText(body.supplier,'supplier',{max:240}),inventoryMoney(body.unit_cost,'unit_cost',0),inventoryQuantity(body.min_stock,'min_stock',{min:0,allowZero:true,fallback:0}),inventoryQuantity(body.reorder_qty,'reorder_qty',{min:0,allowZero:true,fallback:0}),body.enabled===undefined?true:Boolean(body.enabled),actor.email||'admin']);
    if(opening>0)await createInventoryMovement(client,{partId:inserted.id,movementType:'opening',quantityChange:opening,unitCost:body.unit_cost,referenceType:'opening_balance',referenceId:inserted.id,note:'Initial stock',actorEmail:actor.email||'admin'});
    await client.query('COMMIT');client.release();client=null;const part=await inventoryPartRow(inserted.id);await writeAuditLog(req,{action:'create_spare_part',entity_type:'spare_part',entity_id:part.id,new_values:part,metadata:{part_no:part.part_no}});res.status(201).json({status:'ok',version:APP_VERSION,part});
  }catch(e){if(client){try{await client.query('ROLLBACK')}catch{}client.release()}res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/inventory/parts/:id',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureInventoryFoundation();const id=String(req.params.id);const old=await inventoryPartRow(id);if(!old)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Spare part not found'});const b=req.body||{};const actor=req.user||getSession(req)?.user||{};
    await pool.query(`UPDATE spare_parts SET sku=$2,name=$3,description=$4,category=$5,unit=$6,location=$7,supplier=$8,unit_cost=$9,min_stock=$10,reorder_qty=$11,enabled=$12,updated_by=$13,updated_at=now() WHERE id=$1`,[
      id,b.sku!==undefined?maintenanceText(b.sku,'sku',{max:120}):old.sku,b.name!==undefined?maintenanceText(b.name,'name',{required:true,max:240}):old.name,b.description!==undefined?maintenanceText(b.description,'description',{max:4000}):old.description,b.category!==undefined?maintenanceText(b.category,'category',{max:120}):old.category,b.unit!==undefined?maintenanceText(b.unit,'unit',{required:true,max:40}):old.unit,b.location!==undefined?maintenanceText(b.location,'location',{max:200}):old.location,b.supplier!==undefined?maintenanceText(b.supplier,'supplier',{max:240}):old.supplier,b.unit_cost!==undefined?inventoryMoney(b.unit_cost,'unit_cost',0):old.unit_cost,b.min_stock!==undefined?inventoryQuantity(b.min_stock,'min_stock',{min:0,allowZero:true,fallback:0}):old.min_stock,b.reorder_qty!==undefined?inventoryQuantity(b.reorder_qty,'reorder_qty',{min:0,allowZero:true,fallback:0}):old.reorder_qty,b.enabled===undefined?old.enabled:Boolean(b.enabled),actor.email||'admin']);
    const part=await inventoryPartRow(id);await writeAuditLog(req,{action:'update_spare_part',entity_type:'spare_part',entity_id:id,old_values:old,new_values:part,metadata:{part_no:part.part_no}});res.json({status:'ok',version:APP_VERSION,part});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/inventory/parts/:id/movements',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  let client;
  try{
    await ensureInventoryFoundation();const id=String(req.params.id);const b=req.body||{};const actor=req.user||getSession(req)?.user||{};const type=maintenanceChoice(b.movement_type,INVENTORY_MOVEMENT_TYPES.filter(x=>x!=='opening'),'movement_type');
    client=await pool.connect();await client.query('BEGIN');const locked=await oneWith(client,`SELECT current_stock::float8 AS current_stock FROM spare_parts WHERE id=$1 FOR UPDATE`,[id]);if(!locked){const e=new Error('Spare part not found');e.statusCode=404;throw e;}
    let change;
    if(type==='adjustment'&&b.new_stock!==undefined&&b.new_stock!==null&&b.new_stock!==''){const target=inventoryQuantity(b.new_stock,'new_stock',{min:0,allowZero:true});change=Math.round((target-Number(locked.current_stock||0))*1000)/1000;if(change===0){const e=new Error('Adjustment does not change stock');e.statusCode=400;throw e;}}
    else {const qty=inventoryQuantity(b.quantity,'quantity',{min:type==='adjustment'?-100000000:0,allowZero:false});change=type==='consumption'?-Math.abs(qty):(type==='adjustment'?qty:Math.abs(qty));}
    const result=await createInventoryMovement(client,{partId:id,movementType:type,quantityChange:change,unitCost:b.unit_cost,referenceType:maintenanceText(b.reference_type,'reference_type',{max:120}),referenceId:maintenanceText(b.reference_id,'reference_id',{max:200}),referenceNo:maintenanceText(b.reference_no,'reference_no',{max:200}),note:maintenanceText(b.note,'note',{max:2000}),actorEmail:actor.email||'admin'});
    await client.query('COMMIT');client.release();client=null;const part=await inventoryPartRow(id);await writeAuditLog(req,{action:'create_inventory_movement',entity_type:'spare_part',entity_id:id,new_values:result.movement,metadata:{part_no:part.part_no,balance_after:part.current_stock}});res.status(201).json({status:'ok',version:APP_VERSION,part,movement:result.movement});
  }catch(e){if(client){try{await client.query('ROLLBACK')}catch{}client.release()}res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.get('/api/admin/inventory/parts/:id/history',adminRequired,permissionRequired('VIEW_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureInventoryFoundation();const part=await inventoryPartRow(req.params.id);if(!part)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Spare part not found'});
    const movements=(await pool.query(`SELECT id::text,movement_type,quantity_change::float8,balance_before::float8,balance_after::float8,unit_cost::float8,reference_type,reference_id,reference_no,note,actor_email,created_at FROM inventory_movements WHERE part_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`,[part.id])).rows;
    const usages=(await pool.query(`SELECT u.id::text,u.quantity::float8,u.unit_cost::float8,u.note,u.consumed_by,u.created_at,w.id::text AS work_order_id,w.work_order_no,w.title,w.status,m.code AS machine_code,m.name AS machine_name FROM maintenance_work_order_parts u JOIN maintenance_work_orders w ON w.id=u.work_order_id JOIN machines m ON m.id=w.machine_id WHERE u.part_id=$1 ORDER BY u.created_at DESC LIMIT 500`,[part.id])).rows;
    res.json({status:'ok',version:APP_VERSION,part,movements,work_order_usages:usages});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/maintenance-work-orders/:id/consume-part',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  let client;
  try{
    await ensureInventoryFoundation();const orderId=String(req.params.id);const b=req.body||{};const partId=String(b.part_id||'');const qty=inventoryQuantity(b.quantity,'quantity',{min:0});const note=maintenanceText(b.note,'note',{max:2000});const actor=req.user||getSession(req)?.user||{};
    client=await pool.connect();await client.query('BEGIN');const order=await oneWith(client,`SELECT id::text,work_order_no,title,status,parts_used FROM maintenance_work_orders WHERE id=$1 FOR UPDATE`,[orderId]);if(!order){const e=new Error('Work order not found');e.statusCode=404;throw e;}if(['completed','cancelled'].includes(order.status)){const e=new Error('Completed or cancelled work order cannot consume parts');e.statusCode=409;throw e;}
    const movementResult=await createInventoryMovement(client,{partId,movementType:'consumption',quantityChange:-Math.abs(qty),referenceType:'maintenance_work_order',referenceId:order.id,referenceNo:order.work_order_no,note:note||`Consumed for ${order.work_order_no}`,actorEmail:actor.email||'admin'});
    const usage=await oneWith(client,`INSERT INTO maintenance_work_order_parts(work_order_id,part_id,movement_id,quantity,unit_cost,note,consumed_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text,work_order_id::text,part_id::text,movement_id::text,quantity::float8,unit_cost::float8,note,consumed_by,created_at`,[order.id,partId,movementResult.movement.id,qty,movementResult.part.unit_cost,note,actor.email||'admin']);
    const partsUsed=Array.isArray(order.parts_used)?order.parts_used:[];partsUsed.push({part_id:partId,part_no:movementResult.part.part_no,name:movementResult.part.name,quantity:qty,unit:movementResult.part.unit,unit_cost:movementResult.part.unit_cost,usage_id:usage.id,consumed_at:usage.created_at,consumed_by:actor.email||'admin'});
    await client.query(`UPDATE maintenance_work_orders SET parts_used=$2::jsonb,updated_by=$3,updated_at=now() WHERE id=$1`,[order.id,JSON.stringify(partsUsed),actor.email||'admin']);
    await addMaintenanceWorkOrderEvent(client,{workOrderId:order.id,eventType:'part_consumed',oldStatus:order.status,newStatus:order.status,note,actorEmail:actor.email||'admin',metadata:{part_id:partId,part_no:movementResult.part.part_no,quantity:qty,unit:movementResult.part.unit,balance_after:movementResult.movement.balance_after}});
    await client.query('COMMIT');client.release();client=null;const workOrder=await maintenanceWorkOrderRow(order.id);const part=await inventoryPartRow(partId);await writeAuditLog(req,{action:'consume_spare_part',entity_type:'maintenance_work_order',entity_id:order.id,new_values:usage,metadata:{work_order_no:order.work_order_no,part_no:part.part_no,quantity:qty}});res.status(201).json({status:'ok',version:APP_VERSION,work_order:workOrder,part,usage});
  }catch(e){if(client){try{await client.query('ROLLBACK')}catch{}client.release()}res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});


// -----------------------------------------------------------------------------
// v5.24.0 Machine Downtime & OEE Analytics
// -----------------------------------------------------------------------------
const OEE_DOWNTIME_CATEGORIES = ['planned','unplanned'];
const OEE_PRODUCTION_SOURCES = ['manual','mqtt','import'];
const OEE_REASON_CODES = [
  'planned_maintenance','changeover','setup','material_wait','operator_wait',
  'breakdown','quality_stop','power','safety','signal_stop','other'
];

function oeeNumber(value, label, {min=0,max=1000000000,fallback=null,integer=false}={}) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label} must be between ${min} and ${max}`);
    error.statusCode = 400;
    throw error;
  }
  return integer ? Math.floor(number) : Math.round(number * 1000) / 1000;
}

function oeeDate(value, label='date', fallback=null) {
  const raw = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const error = new Error(`${label} must be YYYY-MM-DD`);
    error.statusCode = 400;
    throw error;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== raw) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

function oeeDateRange(fromRaw, toRaw) {
  const today = new Date();
  const todayText = today.toISOString().slice(0,10);
  const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6)).toISOString().slice(0,10);
  const from = oeeDate(fromRaw, 'from', defaultFrom);
  const to = oeeDate(toRaw, 'to', todayText);
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const days = Math.floor((toDate - fromDate) / 86400000) + 1;
  if (days < 1 || days > 31) {
    const error = new Error('OEE date range must be between 1 and 31 days');
    error.statusCode = 400;
    throw error;
  }
  return {from,to,days,fromDate,toDate,endExclusive:new Date(toDate.getTime()+86400000)};
}

function oeeTimestamp(value, label, {required=true}={}) {
  if ((value === null || value === undefined || value === '') && !required) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    throw error;
  }
  return date.toISOString();
}

function oeePct(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.min(Math.max(number,0),100) * 10) / 10;
}

function oeeOverlapSeconds(startValue, endValue, rangeStart, rangeEnd) {
  const start = new Date(startValue);
  const end = endValue ? new Date(endValue) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const left = Math.max(start.getTime(), rangeStart.getTime());
  const right = Math.min(end.getTime(), rangeEnd.getTime());
  return right > left ? Math.floor((right-left)/1000) : 0;
}

async function ensureOeeFoundation() {
  await ensureLiveMonitoringFoundation();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oee_machine_settings (
      machine_id uuid PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
      planned_minutes_per_day integer NOT NULL DEFAULT 480,
      ideal_cycle_sec numeric(12,3) NOT NULL DEFAULT 60,
      target_oee_pct numeric(5,2) NOT NULL DEFAULT 85,
      enabled boolean NOT NULL DEFAULT true,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT oee_planned_minutes_check CHECK (planned_minutes_per_day BETWEEN 1 AND 1440),
      CONSTRAINT oee_ideal_cycle_check CHECK (ideal_cycle_sec > 0),
      CONSTRAINT oee_target_check CHECK (target_oee_pct BETWEEN 1 AND 100)
    )
  `);
  await pool.query(`
    INSERT INTO oee_machine_settings(machine_id)
    SELECT id FROM machines
    ON CONFLICT(machine_id) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oee_production_records (
      id bigserial PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      production_date date NOT NULL DEFAULT CURRENT_DATE,
      shift_code text NOT NULL DEFAULT 'general',
      total_count integer NOT NULL,
      good_count integer NOT NULL,
      reject_count integer NOT NULL,
      source text NOT NULL DEFAULT 'manual',
      note text,
      recorded_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT oee_production_counts_nonnegative CHECK (total_count >= 0 AND good_count >= 0 AND reject_count >= 0),
      CONSTRAINT oee_production_count_consistency CHECK (total_count = good_count + reject_count),
      CONSTRAINT oee_production_source_check CHECK (source IN ('manual','mqtt','import'))
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oee_production_machine_date ON oee_production_records(machine_id,production_date DESC,created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oee_downtime_records (
      id bigserial PRIMARY KEY,
      machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      category text NOT NULL DEFAULT 'unplanned',
      reason_code text NOT NULL DEFAULT 'other',
      reason_text text,
      started_at timestamptz NOT NULL,
      ended_at timestamptz,
      duration_sec integer,
      source text NOT NULL DEFAULT 'manual',
      source_ref text,
      note text,
      recorded_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT oee_downtime_category_check CHECK (category IN ('planned','unplanned')),
      CONSTRAINT oee_downtime_duration_check CHECK (duration_sec IS NULL OR duration_sec >= 0),
      CONSTRAINT oee_downtime_time_check CHECK (ended_at IS NULL OR ended_at > started_at)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oee_downtime_machine_started ON oee_downtime_records(machine_id,started_at DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_oee_downtime_source_ref ON oee_downtime_records(source,source_ref) WHERE source_ref IS NOT NULL`);
}

function oeeMachineStatus(row) {
  if (Number(row.total_count || 0) <= 0) return 'no_production';
  const target = Number(row.target_oee_pct || 85);
  const oee = Number(row.oee_pct || 0);
  if (oee >= target) return 'on_target';
  if (oee >= target * 0.75) return 'watch';
  return 'critical';
}

function calculateOeeMachineRow(machine, setting, productions, downtimes, stateEvents, range) {
  const machineId = String(machine.id);
  const plannedMinutes = Number(setting?.planned_minutes_per_day || 480);
  const idealCycle = Number(setting?.ideal_cycle_sec || 60);
  const targetOee = Number(setting?.target_oee_pct || 85);
  const machineProductions = productions.filter(row => String(row.machine_id) === machineId);
  const machineDowntimes = downtimes.filter(row => String(row.machine_id) === machineId);
  const machineStates = stateEvents.filter(row => String(row.machine_id) === machineId);
  const totalCount = machineProductions.reduce((sum,row)=>sum+Number(row.total_count||0),0);
  const goodCount = machineProductions.reduce((sum,row)=>sum+Number(row.good_count||0),0);
  const rejectCount = machineProductions.reduce((sum,row)=>sum+Number(row.reject_count||0),0);
  let plannedDowntimeSec = 0;
  let unplannedDowntimeSec = 0;
  for (const row of machineDowntimes) {
    const seconds = oeeOverlapSeconds(row.started_at,row.ended_at,range.fromDate,range.endExclusive);
    if (row.category === 'planned') plannedDowntimeSec += seconds;
    else unplannedDowntimeSec += seconds;
  }
  let signalRunSec = 0;
  let signalStopSec = 0;
  for (const row of machineStates) {
    const seconds = oeeOverlapSeconds(row.started_at,row.ended_at,range.fromDate,range.endExclusive);
    if (String(row.state).toUpperCase() === 'RUNNING') signalRunSec += seconds;
    if (String(row.state).toUpperCase() === 'STOPPED') signalStopSec += seconds;
  }
  const grossPlannedSec = plannedMinutes * 60 * range.days;
  const netPlannedSec = Math.max(grossPlannedSec - plannedDowntimeSec, 0);
  const runTimeSec = Math.max(netPlannedSec - unplannedDowntimeSec, 0);
  const availabilityPct = netPlannedSec > 0 ? oeePct(runTimeSec / netPlannedSec * 100) : 0;
  const performancePct = runTimeSec > 0 && idealCycle > 0 ? oeePct((idealCycle * totalCount) / runTimeSec * 100) : 0;
  const qualityPct = totalCount > 0 ? oeePct(goodCount / totalCount * 100) : 0;
  const oeeValue = oeePct((availabilityPct / 100) * (performancePct / 100) * (qualityPct / 100) * 100);
  const row = {
    machine_id:machineId,
    machine_code:machine.code,
    machine_name:machine.name,
    site_code:machine.site_code,
    customer_code:machine.customer_code,
    planned_minutes_per_day:plannedMinutes,
    ideal_cycle_sec:idealCycle,
    target_oee_pct:targetOee,
    enabled:setting?.enabled !== false,
    total_count:totalCount,
    good_count:goodCount,
    reject_count:rejectCount,
    gross_planned_sec:grossPlannedSec,
    planned_downtime_sec:plannedDowntimeSec,
    net_planned_sec:netPlannedSec,
    unplanned_downtime_sec:unplannedDowntimeSec,
    run_time_sec:runTimeSec,
    signal_run_sec:signalRunSec,
    signal_stop_sec:signalStopSec,
    availability_pct:availabilityPct,
    performance_pct:performancePct,
    quality_pct:qualityPct,
    oee_pct:oeeValue
  };
  row.health = oeeMachineStatus(row);
  return row;
}

function calculateOeeSummary(rows) {
  const total = rows.reduce((acc,row)=>{
    acc.net_planned_sec += Number(row.net_planned_sec||0);
    acc.run_time_sec += Number(row.run_time_sec||0);
    acc.unplanned_downtime_sec += Number(row.unplanned_downtime_sec||0);
    acc.planned_downtime_sec += Number(row.planned_downtime_sec||0);
    acc.total_count += Number(row.total_count||0);
    acc.good_count += Number(row.good_count||0);
    acc.reject_count += Number(row.reject_count||0);
    acc.ideal_production_sec += Number(row.ideal_cycle_sec||0) * Number(row.total_count||0);
    return acc;
  },{net_planned_sec:0,run_time_sec:0,unplanned_downtime_sec:0,planned_downtime_sec:0,total_count:0,good_count:0,reject_count:0,ideal_production_sec:0});
  const availability = total.net_planned_sec > 0 ? oeePct(total.run_time_sec/total.net_planned_sec*100) : 0;
  const performance = total.run_time_sec > 0 ? oeePct(total.ideal_production_sec/total.run_time_sec*100) : 0;
  const quality = total.total_count > 0 ? oeePct(total.good_count/total.total_count*100) : 0;
  return {
    machine_count:rows.length,
    availability_pct:availability,
    performance_pct:performance,
    quality_pct:quality,
    oee_pct:oeePct((availability/100)*(performance/100)*(quality/100)*100),
    ...total
  };
}

async function loadOeeData(range, machineId=null) {
  const machineParams=[];
  let machineWhere='';
  if (machineId && machineId !== 'all') { machineParams.push(machineId); machineWhere=`WHERE m.id=$1`; }
  const machines=(await pool.query(`
    SELECT m.id::text,m.code,m.name,m.machine_type,m.status,s.code AS site_code,c.code AS customer_code,
      o.planned_minutes_per_day,o.ideal_cycle_sec::float8 AS ideal_cycle_sec,o.target_oee_pct::float8 AS target_oee_pct,o.enabled
    FROM machines m JOIN sites s ON s.id=m.site_id JOIN customers c ON c.id=s.customer_id
    LEFT JOIN oee_machine_settings o ON o.machine_id=m.id
    ${machineWhere}
    ORDER BY c.code,s.code,m.code
  `,machineParams)).rows;
  const ids=machines.map(row=>row.id);
  if (!ids.length) return {machines:[],productions:[],downtimes:[],states:[]};
  const productions=(await pool.query(`
    SELECT id::text,machine_id::text,production_date::text,shift_code,total_count,good_count,reject_count,source,note,recorded_by,created_at
    FROM oee_production_records
    WHERE machine_id=ANY($1::uuid[]) AND production_date BETWEEN $2::date AND $3::date
    ORDER BY production_date DESC,created_at DESC
  `,[ids,range.from,range.to])).rows;
  const downtimes=(await pool.query(`
    SELECT id::text,machine_id::text,category,reason_code,reason_text,started_at,ended_at,
      COALESCE(duration_sec,GREATEST(0,EXTRACT(EPOCH FROM(COALESCE(ended_at,now())-started_at))::int)) AS duration_sec,
      source,source_ref,note,recorded_by,created_at,updated_at
    FROM oee_downtime_records
    WHERE machine_id=ANY($1::uuid[]) AND started_at < ($3::date + interval '1 day') AND COALESCE(ended_at,now()) >= $2::date
    ORDER BY started_at DESC
  `,[ids,range.from,range.to])).rows;
  const states=(await pool.query(`
    SELECT id::text,machine_id::text,state,started_at,ended_at,duration_sec,source
    FROM machine_state_events
    WHERE machine_id=ANY($1::uuid[]) AND started_at < ($3::date + interval '1 day') AND COALESCE(ended_at,now()) >= $2::date
    ORDER BY started_at DESC
  `,[ids,range.from,range.to])).rows;
  return {machines,productions,downtimes,states};
}

async function syncOeeDowntimeFromMachineStates(range, actorEmail='system') {
  const result=await pool.query(`
    INSERT INTO oee_downtime_records(machine_id,category,reason_code,reason_text,started_at,ended_at,duration_sec,source,source_ref,note,recorded_by)
    SELECT e.machine_id,'unplanned','signal_stop','Makine STOPPED durum sinyali',e.started_at,e.ended_at,
      GREATEST(0,EXTRACT(EPOCH FROM(e.ended_at-e.started_at))::int),'machine_state',e.id::text,'Machine state event aktarımı',$3
    FROM machine_state_events e
    WHERE e.state='STOPPED' AND e.ended_at IS NOT NULL
      AND e.started_at < ($2::date + interval '1 day') AND e.ended_at >= $1::date
    ON CONFLICT DO NOTHING
    RETURNING id
  `,[range.from,range.to,actorEmail]);
  return {created_count:result.rowCount};
}

app.get('/api/admin/oee-analytics',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{
  try{
    await ensureOeeFoundation();
    const range=oeeDateRange(req.query.from,req.query.to);
    const machineId=String(req.query.machine_id||'all');
    const data=await loadOeeData(range,machineId);
    const rows=data.machines.map(machine=>calculateOeeMachineRow(machine,machine,data.productions,data.downtimes,data.states,range));
    const summary=calculateOeeSummary(rows);
    const dailyTrend=[];
    for(let day=0;day<range.days;day+=1){
      const date=new Date(range.fromDate.getTime()+day*86400000);const text=date.toISOString().slice(0,10);
      const dayRange={from:text,to:text,days:1,fromDate:date,endExclusive:new Date(date.getTime()+86400000)};
      const dayRows=data.machines.map(machine=>calculateOeeMachineRow(machine,machine,data.productions.filter(p=>p.production_date===text),data.downtimes,data.states,dayRange));
      dailyTrend.push({date:text,...calculateOeeSummary(dayRows)});
    }
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),range:{from:range.from,to:range.to,days:range.days},can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_MAINTENANCE'),summary,machines:rows,daily_trend:dailyTrend,production_records:data.productions.slice(0,100),downtime_records:data.downtimes.slice(0,100),options:{downtime_categories:OEE_DOWNTIME_CATEGORIES,reason_codes:OEE_REASON_CODES,production_sources:OEE_PRODUCTION_SOURCES}});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/oee/settings/:machineId',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const machineId=String(req.params.machineId);const old=await one(`SELECT machine_id::text,planned_minutes_per_day,ideal_cycle_sec::float8 AS ideal_cycle_sec,target_oee_pct::float8 AS target_oee_pct,enabled FROM oee_machine_settings WHERE machine_id=$1`,[machineId]);if(!old)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'OEE machine setting not found'});const b=req.body||{};const actor=req.user||getSession(req)?.user||{};
    const planned=oeeNumber(b.planned_minutes_per_day,'planned_minutes_per_day',{min:1,max:1440,fallback:old.planned_minutes_per_day,integer:true});const ideal=oeeNumber(b.ideal_cycle_sec,'ideal_cycle_sec',{min:0.001,max:86400,fallback:old.ideal_cycle_sec});const target=oeeNumber(b.target_oee_pct,'target_oee_pct',{min:1,max:100,fallback:old.target_oee_pct});const enabled=b.enabled===undefined?old.enabled:Boolean(b.enabled);
    const setting=await one(`UPDATE oee_machine_settings SET planned_minutes_per_day=$2,ideal_cycle_sec=$3,target_oee_pct=$4,enabled=$5,updated_by=$6,updated_at=now() WHERE machine_id=$1 RETURNING machine_id::text,planned_minutes_per_day,ideal_cycle_sec::float8 AS ideal_cycle_sec,target_oee_pct::float8 AS target_oee_pct,enabled,updated_by,updated_at`,[machineId,planned,ideal,target,enabled,actor.email||'admin']);
    await writeAuditLog(req,{action:'update_oee_machine_settings',entity_type:'machine',entity_id:machineId,old_values:old,new_values:setting});res.json({status:'ok',version:APP_VERSION,setting});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/oee/production',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const b=req.body||{};const machineId=String(b.machine_id||'');const machine=await one(`SELECT id::text,code,name FROM machines WHERE id=$1`,[machineId]);if(!machine)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Machine not found'});const total=oeeNumber(b.total_count,'total_count',{min:0,max:1000000000,integer:true});const good=oeeNumber(b.good_count,'good_count',{min:0,max:1000000000,integer:true});const reject=b.reject_count===undefined||b.reject_count===''?total-good:oeeNumber(b.reject_count,'reject_count',{min:0,max:1000000000,integer:true});if(good+reject!==total){const e=new Error('total_count must equal good_count + reject_count');e.statusCode=400;throw e;}const source=maintenanceChoice(b.source||'manual',OEE_PRODUCTION_SOURCES,'source');const actor=req.user||getSession(req)?.user||{};
    const productionDate=oeeDate(b.production_date,'production_date',new Date().toISOString().slice(0,10));
    const shiftCode=maintenanceText(b.shift_code,'shift_code',{max:60})||'general';
    const note=maintenanceText(b.note,'note',{max:2000});
    if(source==='manual'){
      const duplicate=await one(`SELECT id::text,created_at FROM oee_production_records WHERE machine_id=$1 AND production_date=$2::date AND shift_code=$3 AND total_count=$4 AND good_count=$5 AND reject_count=$6 AND source='manual' AND COALESCE(note,'')=COALESCE($7,'') AND created_at>=now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1`,[machineId,productionDate,shiftCode,total,good,reject,note]);
      if(duplicate)return res.status(409).json({status:'duplicate',version:APP_VERSION,message:'Aynı üretim kaydı son 5 dakika içinde zaten eklendi.',existing_record_id:duplicate.id});
    }
    const record=await one(`INSERT INTO oee_production_records(machine_id,production_date,shift_code,total_count,good_count,reject_count,source,note,recorded_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text,machine_id::text,production_date::text,shift_code,total_count,good_count,reject_count,source,note,recorded_by,created_at`,[machineId,productionDate,shiftCode,total,good,reject,source,note,actor.email||'admin']);
    await writeAuditLog(req,{action:'create_oee_production_record',entity_type:'machine',entity_id:machineId,new_values:record,metadata:{machine_code:machine.code}});res.status(201).json({status:'ok',version:APP_VERSION,record,machine});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/oee/downtime',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const b=req.body||{};const machineId=String(b.machine_id||'');const machine=await one(`SELECT id::text,code,name FROM machines WHERE id=$1`,[machineId]);if(!machine)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Machine not found'});const category=maintenanceChoice(b.category||'unplanned',OEE_DOWNTIME_CATEGORIES,'category');const reasonCode=maintenanceChoice(b.reason_code||'other',OEE_REASON_CODES,'reason_code');const startedAt=oeeTimestamp(b.started_at,'started_at');const endedAt=oeeTimestamp(b.ended_at,'ended_at',{required:false});if(endedAt&&new Date(endedAt)<=new Date(startedAt)){const e=new Error('ended_at must be after started_at');e.statusCode=400;throw e;}const duration=endedAt?Math.floor((new Date(endedAt)-new Date(startedAt))/1000):null;const actor=req.user||getSession(req)?.user||{};
    const reasonText=maintenanceText(b.reason_text,'reason_text',{max:240});
    const note=maintenanceText(b.note,'note',{max:2000});
    const duplicate=await one(`SELECT id::text,created_at FROM oee_downtime_records WHERE machine_id=$1 AND category=$2 AND reason_code=$3 AND COALESCE(reason_text,'')=COALESCE($4,'') AND started_at=$5::timestamptz AND ended_at IS NOT DISTINCT FROM $6::timestamptz AND source='manual' AND COALESCE(note,'')=COALESCE($7,'') AND created_at>=now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1`,[machineId,category,reasonCode,reasonText,startedAt,endedAt,note]);
    if(duplicate)return res.status(409).json({status:'duplicate',version:APP_VERSION,message:'Aynı duruş kaydı son 5 dakika içinde zaten eklendi.',existing_record_id:duplicate.id});
    const record=await one(`INSERT INTO oee_downtime_records(machine_id,category,reason_code,reason_text,started_at,ended_at,duration_sec,source,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9) RETURNING id::text,machine_id::text,category,reason_code,reason_text,started_at,ended_at,duration_sec,source,note,recorded_by,created_at`,[machineId,category,reasonCode,reasonText,startedAt,endedAt,duration,note,actor.email||'admin']);
    await writeAuditLog(req,{action:'create_oee_downtime',entity_type:'machine',entity_id:machineId,new_values:record,metadata:{machine_code:machine.code}});res.status(201).json({status:'ok',version:APP_VERSION,record,machine});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/oee/downtime/:id/close',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const id=String(req.params.id);const old=await one(`SELECT * FROM oee_downtime_records WHERE id=$1`,[id]);if(!old)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Downtime record not found'});if(old.ended_at)return res.status(409).json({status:'already_closed',version:APP_VERSION,message:'Downtime record is already closed'});const endedAt=oeeTimestamp(req.body?.ended_at||new Date().toISOString(),'ended_at');if(new Date(endedAt)<=new Date(old.started_at)){const e=new Error('ended_at must be after started_at');e.statusCode=400;throw e;}const actor=req.user||getSession(req)?.user||{};const record=await one(`UPDATE oee_downtime_records SET ended_at=$2,duration_sec=GREATEST(0,EXTRACT(EPOCH FROM($2::timestamptz-started_at))::int),updated_at=now() WHERE id=$1 RETURNING id::text,machine_id::text,category,reason_code,reason_text,started_at,ended_at,duration_sec,source,note,recorded_by,created_at,updated_at`,[id,endedAt]);await writeAuditLog(req,{action:'close_oee_downtime',entity_type:'oee_downtime',entity_id:id,old_values:old,new_values:record,metadata:{closed_by:actor.email||'admin'}});res.json({status:'ok',version:APP_VERSION,record});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});


app.delete('/api/admin/oee/production/:id',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const id=String(req.params.id);const old=await one(`SELECT id::text,machine_id::text,production_date::text,shift_code,total_count,good_count,reject_count,source,note,recorded_by,created_at FROM oee_production_records WHERE id=$1`,[id]);if(!old)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Production record not found'});
    await pool.query(`DELETE FROM oee_production_records WHERE id=$1`,[id]);
    await writeAuditLog(req,{action:'delete_oee_production_record',entity_type:'oee_production',entity_id:id,old_values:old});
    res.json({status:'ok',version:APP_VERSION,deleted:old});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.delete('/api/admin/oee/downtime/:id',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{
    await ensureOeeFoundation();const id=String(req.params.id);const old=await one(`SELECT id::text,machine_id::text,category,reason_code,reason_text,started_at,ended_at,duration_sec,source,source_ref,note,recorded_by,created_at FROM oee_downtime_records WHERE id=$1`,[id]);if(!old)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Downtime record not found'});
    await pool.query(`DELETE FROM oee_downtime_records WHERE id=$1`,[id]);
    await writeAuditLog(req,{action:'delete_oee_downtime_record',entity_type:'oee_downtime',entity_id:id,old_values:old});
    res.json({status:'ok',version:APP_VERSION,deleted:old});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/oee/cleanup-manual-records',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  const client=await pool.connect();
  try{
    await ensureOeeFoundation();const b=req.body||{};const machineId=String(b.machine_id||'');if(!machineId||machineId==='all'){const e=new Error('Temizleme için tek bir makine seçilmelidir.');e.statusCode=400;throw e;}const machine=await one(`SELECT id::text,code,name FROM machines WHERE id=$1`,[machineId]);if(!machine)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Machine not found'});const range=oeeDateRange(b.from,b.to);
    await client.query('BEGIN');
    const production=(await client.query(`DELETE FROM oee_production_records WHERE machine_id=$1 AND source='manual' AND production_date BETWEEN $2::date AND $3::date RETURNING id::text`,[machineId,range.from,range.to])).rows;
    const downtime=(await client.query(`DELETE FROM oee_downtime_records WHERE machine_id=$1 AND source='manual' AND started_at<($3::date+interval '1 day') AND COALESCE(ended_at,started_at)>=$2::date RETURNING id::text`,[machineId,range.from,range.to])).rows;
    await client.query('COMMIT');
    const result={machine_id:machineId,machine_code:machine.code,from:range.from,to:range.to,production_deleted:production.length,downtime_deleted:downtime.length,total_deleted:production.length+downtime.length};
    await writeAuditLog(req,{action:'cleanup_oee_manual_records',entity_type:'machine',entity_id:machineId,new_values:result});
    res.json({status:'ok',version:APP_VERSION,result});
  }catch(e){try{await client.query('ROLLBACK');}catch{}res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
  finally{client.release();}
});

app.post('/api/admin/oee/sync-machine-states',adminRequired,permissionRequired('MANAGE_MAINTENANCE'),async(req,res)=>{
  try{await ensureOeeFoundation();const range=oeeDateRange(req.body?.from,req.body?.to);const actor=req.user||getSession(req)?.user||{};const result=await syncOeeDowntimeFromMachineStates(range,actor.email||'admin');await writeAuditLog(req,{action:'sync_oee_machine_state_downtime',entity_type:'oee',entity_id:'global',new_values:{...result,range:{from:range.from,to:range.to}}});res.json({status:'ok',version:APP_VERSION,result,range:{from:range.from,to:range.to}});}
  catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarm_escalation_events (
      id bigserial PRIMARY KEY,
      event_key text NOT NULL UNIQUE,
      alarm_id bigint NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
      rule_id bigint REFERENCES alarm_escalation_rules(id) ON DELETE SET NULL,
      stage text NOT NULL,
      severity text NOT NULL DEFAULT 'warning',
      channel text NOT NULL DEFAULT 'dashboard',
      recipients text,
      delivery_status text NOT NULL DEFAULT 'pending',
      message text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      detected_at timestamptz NOT NULL DEFAULT now(),
      last_attempt_at timestamptz,
      next_attempt_at timestamptz,
      delivered_at timestamptz,
      failed_at timestamptz,
      provider_message_id text,
      last_error text,
      delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (stage IN ('ack_overdue','resolve_overdue')),
      CHECK (delivery_status IN ('pending','processing','delivered','failed','dead_letter','suppressed'))
    )
  `);

  await pool.query(`ALTER TABLE alarm_escalation_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz`);
  await pool.query(`ALTER TABLE alarm_escalation_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz`);
  await pool.query(`ALTER TABLE alarm_escalation_events ADD COLUMN IF NOT EXISTS provider_message_id text`);
  await pool.query(`ALTER TABLE alarm_escalation_events ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz`);
  await pool.query(`ALTER TABLE alarm_escalation_events ADD COLUMN IF NOT EXISTS delivery_metadata jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE alarm_escalation_events DROP CONSTRAINT IF EXISTS alarm_escalation_events_delivery_status_check`);
  await pool.query(`
    ALTER TABLE alarm_escalation_events
    ADD CONSTRAINT alarm_escalation_events_delivery_status_check
    CHECK (delivery_status IN ('pending','processing','delivered','failed','dead_letter','suppressed'))
  `);

  await pool.query(`
    UPDATE alarm_escalation_events
    SET delivery_status='pending',
        next_attempt_at=now(),
        last_error=COALESCE(last_error,'Stale processing lock recovered'),
        updated_at=now()
    WHERE delivery_status='processing'
      AND COALESCE(last_attempt_at,updated_at) < now() - interval '10 minutes'
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_escalation_events_status_created
    ON alarm_escalation_events(delivery_status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_escalation_events_alarm_stage
    ON alarm_escalation_events(alarm_id, stage)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_escalation_events_retry_due
    ON alarm_escalation_events(delivery_status, next_attempt_at, attempt_count)
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
  // Explicit rule priority must always win. Specificity is only a tie-breaker
  // between rules that have the same priority.
  let score = alarmRulePriority(rule.priority, 0) * 1000;

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
    score += weight;
  }

  const severity = String(rule.severity || 'all').toLowerCase();
  if (severity !== 'all') {
    if (severity !== String(alarm.severity || '').toLowerCase()) return -1;
    score += 16;
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


async function loadAlarmEscalationSnapshot() {
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

  return {rules:rulesResult.rows, activeAlarms, summary};
}

async function scanAlarmEscalationsToQueue({trigger = 'scheduler'} = {}) {
  if (!alarmEscalationQueueEnabled()) {
    return {enabled:false, scanned_active_count:0, overdue_count:0, created_count:0, duplicate_count:0, events:[]};
  }

  const snapshot = await loadAlarmEscalationSnapshot();
  const overdue = snapshot.activeAlarms.filter(row =>
    row.rule_id && ['ack_overdue','resolve_overdue'].includes(row.sla_status)
  );
  const created = [];

  for (const alarm of overdue) {
    const channel = String(alarm.escalation_channel || 'dashboard').trim() || 'dashboard';
    const deliveryStatus = channel === 'dashboard' ? 'delivered' : 'pending';
    const deliveredAt = deliveryStatus === 'delivered' ? new Date().toISOString() : null;
    const eventKey = `alarm-${alarm.id}-${alarm.sla_status}-rule-${alarm.rule_id}`;
    const metadata = JSON.stringify({
      customer_code:alarm.customer_code || null,
      site_code:alarm.site_code || null,
      machine_code:alarm.machine_code || null,
      rule_name:alarm.rule_name || null,
      acknowledge_sla_minutes:alarm.acknowledge_sla_minutes,
      resolve_sla_minutes:alarm.resolve_sla_minutes,
      age_minutes:alarm.age_minutes,
      trigger
    });

    const inserted = await one(`
      INSERT INTO alarm_escalation_events(
        event_key,alarm_id,rule_id,stage,severity,channel,recipients,
        delivery_status,message,detected_at,delivered_at,next_attempt_at,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,CASE WHEN $8='pending' THEN now() ELSE NULL END,$11::jsonb)
      ON CONFLICT(event_key) DO NOTHING
      RETURNING *
    `, [
      eventKey,
      alarm.id,
      alarm.rule_id,
      alarm.sla_status,
      alarm.severity || 'warning',
      channel,
      alarm.recipients || null,
      deliveryStatus,
      escalationEventMessage(alarm),
      deliveredAt,
      metadata
    ]);
    if (inserted) created.push(inserted);
  }

  return {
    enabled:true,
    scanned_active_count:snapshot.activeAlarms.length,
    overdue_count:overdue.length,
    created_count:created.length,
    duplicate_count:Math.max(0, overdue.length - created.length),
    events:created
  };
}



const GENERAL_SETTING_LANGUAGES = ['tr','en'];
const GENERAL_SETTING_DATE_FORMATS = ['DD.MM.YYYY','MM/DD/YYYY','YYYY-MM-DD'];
const GENERAL_SETTING_TIME_FORMATS = ['24h','12h'];
const GENERAL_SETTING_WEEK_STARTS = ['monday','sunday'];
const GENERAL_SETTING_DEFAULT_VIEWS = [
  'dashboard','live','oee','alarms','analytics','sla','escalations','maintenance',
  'maintenance-plans','work-orders','inventory','general','health','notifications','scheduler',
  'reports','remote-access','tenants','users','permissions','subscriptions','assets','devices','onboarding','security'
];
const GENERAL_SETTING_TIMEZONES = [
  'Europe/Istanbul','UTC','Europe/London','Europe/Berlin','Europe/Paris',
  'America/New_York','America/Chicago','America/Los_Angeles','Asia/Dubai','Asia/Tokyo'
];

async function ensureGeneralSettingsFoundation() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS general_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      organization_name text NOT NULL DEFAULT 'FactoryBox',
      site_name text NOT NULL DEFAULT 'Main Factory',
      language text NOT NULL DEFAULT 'tr',
      timezone text NOT NULL DEFAULT 'Europe/Istanbul',
      date_format text NOT NULL DEFAULT 'DD.MM.YYYY',
      time_format text NOT NULL DEFAULT '24h',
      week_start text NOT NULL DEFAULT 'monday',
      auto_refresh_sec integer NOT NULL DEFAULT 30,
      default_view text NOT NULL DEFAULT 'dashboard',
      compact_mode boolean NOT NULL DEFAULT false,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`INSERT INTO general_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS organization_name text NOT NULL DEFAULT 'FactoryBox'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS site_name text NOT NULL DEFAULT 'Main Factory'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'tr'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Istanbul'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'DD.MM.YYYY'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS time_format text NOT NULL DEFAULT '24h'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS week_start text NOT NULL DEFAULT 'monday'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS auto_refresh_sec integer NOT NULL DEFAULT 30`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS default_view text NOT NULL DEFAULT 'dashboard'`);
  await pool.query(`ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS compact_mode boolean NOT NULL DEFAULT false`);
}

function generalSettingChoice(value, allowed, field, fallback) {
  const clean=String(value ?? fallback ?? '').trim();
  if (!allowed.includes(clean)) {
    const error=new Error(`${field} is invalid`);
    error.statusCode=400;
    throw error;
  }
  return clean;
}

function generalSettingText(value, fallback, max=160) {
  if (value === undefined) return String(fallback || '').slice(0,max);
  return String(value || '').trim().slice(0,max);
}

function generalSettingTimezone(value, fallback='Europe/Istanbul') {
  const clean=generalSettingText(value,fallback,100) || fallback;
  try { new Intl.DateTimeFormat('en-US',{timeZone:clean}).format(new Date()); }
  catch { const error=new Error('timezone is invalid'); error.statusCode=400; throw error; }
  return clean;
}

async function generalSettingsSnapshot(actor=null) {
  await ensureGeneralSettingsFoundation();
  const settings=await one(`SELECT id,organization_name,site_name,language,timezone,date_format,time_format,week_start,auto_refresh_sec,default_view,compact_mode,updated_by,updated_at FROM general_settings WHERE id=1`);
  return {
    can_manage:!authConfig().enabled || hasPermission(actor,'MANAGE_SITES'),
    settings,
    options:{
      languages:GENERAL_SETTING_LANGUAGES,
      timezones:GENERAL_SETTING_TIMEZONES,
      date_formats:GENERAL_SETTING_DATE_FORMATS,
      time_formats:GENERAL_SETTING_TIME_FORMATS,
      week_starts:GENERAL_SETTING_WEEK_STARTS,
      auto_refresh_seconds:[0,15,30,60,120,300],
      default_views:GENERAL_SETTING_DEFAULT_VIEWS
    }
  };
}

app.get('/api/ui-settings', authRequired, async(req,res)=>{
  try {
    const snapshot=await generalSettingsSnapshot(req.user||getSession(req)?.user||null);
    res.json({status:'ok',version:APP_VERSION,settings:snapshot.settings});
  } catch(error) {
    res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});

app.get('/api/admin/general-settings', adminRequired, permissionRequired('VIEW_DASHBOARD'), async(req,res)=>{
  try {
    const snapshot=await generalSettingsSnapshot(req.user||getSession(req)?.user||null);
    res.json({status:'ok',version:APP_VERSION,...snapshot});
  } catch(error) {
    res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});

app.patch('/api/admin/general-settings', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try {
    await ensureGeneralSettingsFoundation();
    const old=await one(`SELECT * FROM general_settings WHERE id=1`);
    const body=req.body||{};
    const organizationName=generalSettingText(body.organization_name,old.organization_name,160)||'FactoryBox';
    const siteName=generalSettingText(body.site_name,old.site_name,160)||'Main Factory';
    const language=generalSettingChoice(body.language,GENERAL_SETTING_LANGUAGES,'language',old.language);
    const timezone=generalSettingTimezone(body.timezone,old.timezone);
    const dateFormat=generalSettingChoice(body.date_format,GENERAL_SETTING_DATE_FORMATS,'date_format',old.date_format);
    const timeFormat=generalSettingChoice(body.time_format,GENERAL_SETTING_TIME_FORMATS,'time_format',old.time_format);
    const weekStart=generalSettingChoice(body.week_start,GENERAL_SETTING_WEEK_STARTS,'week_start',old.week_start);
    const refreshRaw=body.auto_refresh_sec===undefined?old.auto_refresh_sec:Number(body.auto_refresh_sec);
    const autoRefresh=[0,15,30,60,120,300].includes(refreshRaw)?refreshRaw:30;
    const defaultView=generalSettingChoice(body.default_view,GENERAL_SETTING_DEFAULT_VIEWS,'default_view',old.default_view);
    const compactMode=body.compact_mode===undefined?Boolean(old.compact_mode):Boolean(body.compact_mode);
    const actor=req.user||getSession(req)?.user||{};
    const settings=await one(`
      UPDATE general_settings SET
        organization_name=$1,site_name=$2,language=$3,timezone=$4,date_format=$5,time_format=$6,
        week_start=$7,auto_refresh_sec=$8,default_view=$9,compact_mode=$10,updated_by=$11,updated_at=now()
      WHERE id=1
      RETURNING id,organization_name,site_name,language,timezone,date_format,time_format,week_start,auto_refresh_sec,default_view,compact_mode,updated_by,updated_at
    `,[organizationName,siteName,language,timezone,dateFormat,timeFormat,weekStart,autoRefresh,defaultView,compactMode,actor.email||'admin']);
    await writeAuditLog(req,{action:'update_general_settings',entity_type:'general_settings',entity_id:'global',old_values:old,new_values:settings});
    res.json({status:'ok',version:APP_VERSION,settings});
  } catch(error) {
    res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});




// v6.7.1 Quick Tunnel Origin / CORS Login Hotfix
const REMOTE_ACCESS_MODES = ['disabled','quick','named'];
let remoteAccessFoundationReady = false;
const remoteAccessRuntime = {
  last_check_at:null,
  last_check_ok:null,
  last_http_status:null,
  last_error:null,
  last_latency_ms:null
};

function remoteAccessEnvEnabled() {
  return String(process.env.REMOTE_ACCESS_ENABLED || '').trim().toLowerCase() === 'true';
}

function remoteAccessEnvMode() {
  const raw=String(process.env.REMOTE_ACCESS_MODE || '').trim().toLowerCase();
  return REMOTE_ACCESS_MODES.includes(raw)?raw:null;
}

function remoteAccessNormalizeUrl(value) {
  const clean=String(value||'').trim().replace(/\/+$/,'');
  if (!clean) return '';
  let parsed;
  try { parsed=new URL(clean); }
  catch { const error=new Error('public_url is invalid');error.statusCode=400;throw error; }
  if (!['https:','http:'].includes(parsed.protocol)) { const error=new Error('public_url must use HTTPS or HTTP');error.statusCode=400;throw error; }
  return parsed.toString().replace(/\/$/,'');
}

function remoteAccessDomains(value) {
  return String(value||'').split(/[\n,;]+/).map(v=>v.trim().toLowerCase()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,50).join(',');
}

async function ensureRemoteAccessFoundation() {
  if (remoteAccessFoundationReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remote_access_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      mode text NOT NULL DEFAULT 'disabled',
      public_url text NOT NULL DEFAULT '',
      access_protected boolean NOT NULL DEFAULT false,
      allowed_email_domains text NOT NULL DEFAULT '',
      technical_service_enabled boolean NOT NULL DEFAULT false,
      notes text NOT NULL DEFAULT '',
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`INSERT INTO remote_access_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'disabled'`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS public_url text NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS access_protected boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS allowed_email_domains text NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS technical_service_enabled boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE remote_access_settings ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT ''`);
  remoteAccessFoundationReady=true;
}

async function remoteAccessProbe(publicUrl) {
  const base=remoteAccessNormalizeUrl(publicUrl);
  if (!base) return {ok:false,status:null,latency_ms:null,error:'Public URL is not configured'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  const started=Date.now();
  try {
    const response=await fetch(`${base}/healthz`,{method:'GET',headers:{'accept':'application/json'},redirect:'follow',signal:controller.signal});
    const latency=Date.now()-started;
    let body=null;
    try { body=await response.json(); } catch {}
    return {ok:response.ok,status:response.status,latency_ms:latency,error:response.ok?null:`HTTP ${response.status}`,body};
  } catch(error) {
    return {ok:false,status:null,latency_ms:Date.now()-started,error:error.name==='AbortError'?'Remote access test timed out':error.message};
  } finally { clearTimeout(timer); }
}

async function remoteAccessSnapshot({probe=false}={}) {
  await ensureRemoteAccessFoundation();
  const settings=await one(`SELECT * FROM remote_access_settings WHERE id=1`);
  const envMode=remoteAccessEnvMode();
  const mode=envMode || (REMOTE_ACCESS_MODES.includes(settings.mode)?settings.mode:'disabled');
  const enabled=remoteAccessEnvEnabled() || mode!=='disabled';
  const envPublicUrl=String(process.env.REMOTE_PUBLIC_URL||'').trim();
  const publicUrl=envPublicUrl || String(settings.public_url||'').trim();
  const tokenConfigured=Boolean(String(process.env.CLOUDFLARE_TUNNEL_TOKEN||'').trim());
  let check=null;
  if (probe && publicUrl) {
    check=await remoteAccessProbe(publicUrl);
    remoteAccessRuntime.last_check_at=new Date().toISOString();
    remoteAccessRuntime.last_check_ok=check.ok;
    remoteAccessRuntime.last_http_status=check.status;
    remoteAccessRuntime.last_error=check.error;
    remoteAccessRuntime.last_latency_ms=check.latency_ms;
  }
  const effectiveCheck=check || (remoteAccessRuntime.last_check_at?{
    ok:remoteAccessRuntime.last_check_ok,status:remoteAccessRuntime.last_http_status,error:remoteAccessRuntime.last_error,latency_ms:remoteAccessRuntime.last_latency_ms
  }:null);
  const status=!enabled?'disabled':effectiveCheck?.ok?'online':publicUrl?'configured':'waiting_configuration';
  return {
    settings:{
      ...settings,
      mode,
      public_url:publicUrl,
      enabled,
      token_configured:tokenConfigured,
      origin_service:'http://nginx:8081'
    },
    runtime:{...remoteAccessRuntime,status},
    security:{
      auth_enabled:authConfig().enabled,
      https_public_url:Boolean(publicUrl && publicUrl.toLowerCase().startsWith('https://')),
      cloudflare_access_protected:Boolean(settings.access_protected),
      allowed_email_domains:String(settings.allowed_email_domains||'').split(',').filter(Boolean),
      token_exposed:false,
      inbound_router_port_required:false
    },
    checklist:[
      {key:'auth',ok:authConfig().enabled,message_tr:'FactoryBox kullanıcı girişi açık',message_en:'FactoryBox authentication is enabled'},
      {key:'https',ok:Boolean(publicUrl&&publicUrl.startsWith('https://')),message_tr:'Uzak adres HTTPS kullanıyor',message_en:'Remote URL uses HTTPS'},
      {key:'access',ok:Boolean(settings.access_protected),message_tr:'Cloudflare Access koruması işaretlendi',message_en:'Cloudflare Access protection is marked as enabled'},
      {key:'token',ok:mode==='quick'||tokenConfigured,message_tr:'Tunnel çalıştırma bilgisi hazır',message_en:'Tunnel runtime configuration is ready'}
    ]
  };
}

app.get('/api/admin/remote-access', adminRequired, permissionRequired('VIEW_DASHBOARD'), async(req,res)=>{
  try { res.json({status:'ok',version:APP_VERSION,can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_SITES'),...(await remoteAccessSnapshot({probe:req.query.probe==='1'}))}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.patch('/api/admin/remote-access', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try {
    await ensureRemoteAccessFoundation();
    const old=await one(`SELECT * FROM remote_access_settings WHERE id=1`);
    const body=req.body||{};
    const mode=REMOTE_ACCESS_MODES.includes(String(body.mode||old.mode).toLowerCase())?String(body.mode||old.mode).toLowerCase():old.mode;
    const publicUrl=body.public_url===undefined?old.public_url:remoteAccessNormalizeUrl(body.public_url);
    const accessProtected=body.access_protected===undefined?Boolean(old.access_protected):Boolean(body.access_protected);
    const allowedDomains=body.allowed_email_domains===undefined?old.allowed_email_domains:remoteAccessDomains(body.allowed_email_domains);
    const technical=body.technical_service_enabled===undefined?Boolean(old.technical_service_enabled):Boolean(body.technical_service_enabled);
    const notes=body.notes===undefined?old.notes:String(body.notes||'').trim().slice(0,1000);
    const actor=req.user||getSession(req)?.user||{};
    const settings=await one(`UPDATE remote_access_settings SET mode=$1,public_url=$2,access_protected=$3,allowed_email_domains=$4,technical_service_enabled=$5,notes=$6,updated_by=$7,updated_at=now() WHERE id=1 RETURNING *`,[mode,publicUrl,accessProtected,allowedDomains,technical,notes,actor.email||'admin']);
    await writeAuditLog(req,{action:'update_remote_access_settings',entity_type:'remote_access',entity_id:'global',old_values:old,new_values:settings,metadata:{token_changed:false}});
    res.json({status:'ok',version:APP_VERSION,...(await remoteAccessSnapshot())});
  } catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/remote-access/test', adminRequired, permissionRequired('VIEW_DASHBOARD'), async(req,res)=>{
  try {
    const snapshot=await remoteAccessSnapshot();
    const publicUrl=remoteAccessNormalizeUrl(req.body?.public_url||snapshot.settings.public_url);
    const result=await remoteAccessProbe(publicUrl);
    remoteAccessRuntime.last_check_at=new Date().toISOString();remoteAccessRuntime.last_check_ok=result.ok;remoteAccessRuntime.last_http_status=result.status;remoteAccessRuntime.last_error=result.error;remoteAccessRuntime.last_latency_ms=result.latency_ms;
    await writeAuditLog(req,{action:'test_remote_access',entity_type:'remote_access',entity_id:'global',new_values:{public_url:publicUrl,ok:result.ok,http_status:result.status,latency_ms:result.latency_ms}});
    res.status(result.ok?200:502).json({status:result.ok?'ok':'unreachable',version:APP_VERSION,public_url:publicUrl,result});
  } catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});


// v6.1.2 Docker PostgreSQL Backup & System Health Accuracy Hotfix
let systemHealthFoundationReady = false;
let systemHealthBackupTimer = null;
let systemHealthMonitorTimer = null;
let systemHealthToolCache = { checked_at:0, pg_dump:null, pg_restore:null };
const systemHealthRuntime = {
  started_at:new Date().toISOString(),
  last_check_at:null,
  last_overall_status:'unknown',
  last_critical_signature:null,
  last_critical_alert_at:null,
  backup_running:false,
  monitor_running:false,
  last_backup_attempt_at:null
};

function systemBackupRootDir() {
  return path.resolve(String(process.env.FACTORYBOX_BACKUP_DIR || path.resolve(__dirname, '../../Backups')));
}

function systemHealthSafeNumber(value, fallback, min, max) {
  const number=Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number),min),max);
}

async function ensureSystemHealthFoundation() {
  if (systemHealthFoundationReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_health_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      backup_enabled boolean NOT NULL DEFAULT false,
      backup_hour smallint NOT NULL DEFAULT 2,
      retention_days integer NOT NULL DEFAULT 14,
      max_backups integer NOT NULL DEFAULT 30,
      critical_telegram_enabled boolean NOT NULL DEFAULT true,
      last_scheduled_backup_date text,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`INSERT INTO system_health_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS backup_enabled boolean NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS backup_hour smallint NOT NULL DEFAULT 2`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 14`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS max_backups integer NOT NULL DEFAULT 30`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS critical_telegram_enabled boolean NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS last_scheduled_backup_date text`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS updated_by text`);
  await pool.query(`ALTER TABLE system_health_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_backup_history (
      id bigserial PRIMARY KEY,
      filename text NOT NULL,
      file_path text NOT NULL,
      backup_type text NOT NULL DEFAULT 'manual',
      status text NOT NULL DEFAULT 'running',
      size_bytes bigint NOT NULL DEFAULT 0,
      sha256 text,
      verification_status text NOT NULL DEFAULT 'not_checked',
      verification_message text,
      error_message text,
      created_by text,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      verified_at timestamptz,
      deleted_at timestamptz
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_backup_history_started ON system_backup_history(started_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_backup_history_status ON system_backup_history(status,started_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_health_logs (
      id bigserial PRIMARY KEY,
      level text NOT NULL DEFAULT 'info',
      component text NOT NULL DEFAULT 'system',
      message text NOT NULL,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_health_logs_created ON system_health_logs(created_at DESC)`);
  systemHealthFoundationReady=true;
}

async function systemHealthLog(level, component, message, metadata=null) {
  try {
    await ensureSystemHealthFoundation();
    await pool.query(`INSERT INTO system_health_logs(level,component,message,metadata) VALUES($1,$2,$3,$4::jsonb)`,[
      String(level||'info').slice(0,20),String(component||'system').slice(0,80),String(message||'').slice(0,1500),JSON.stringify(metadata||null)
    ]);
  } catch(error) {
    console.error('System health log error:', error.message);
  }
}

async function systemHealthSettings() {
  await ensureSystemHealthFoundation();
  return one(`SELECT id,backup_enabled,backup_hour,retention_days,max_backups,critical_telegram_enabled,last_scheduled_backup_date,updated_by,updated_at FROM system_health_settings WHERE id=1`);
}

function systemHealthToolCandidates(tool) {
  const envName=tool==='pg_dump'?'PG_DUMP_PATH':'PG_RESTORE_PATH';
  const values=[];
  if (process.env[envName]) values.push(String(process.env[envName]));
  values.push(tool);
  if (process.platform==='win32') {
    for (const version of ['18','17','16','15','14','13']) {
      values.push(`C:\\Program Files\\PostgreSQL\\${version}\\bin\\${tool}.exe`);
    }
  }
  return [...new Set(values.filter(Boolean))];
}

function systemHealthDockerConfig() {
  return {
    cli:String(process.env.DOCKER_CLI_PATH||'docker').trim()||'docker',
    container:String(process.env.FACTORYBOX_POSTGRES_CONTAINER||'factorybox-postgres').trim()||'factorybox-postgres',
    host:String(process.env.FACTORYBOX_POSTGRES_INTERNAL_HOST||'127.0.0.1').trim()||'127.0.0.1',
    port:systemHealthSafeNumber(process.env.FACTORYBOX_POSTGRES_INTERNAL_PORT,5432,1,65535)
  };
}

async function resolveDockerPostgresTool(tool) {
  const cfg=systemHealthDockerConfig();
  try {
    const inspect=await execFileAsync(cfg.cli,['inspect','-f','{{.State.Running}}',cfg.container],{timeout:8000,windowsHide:true,maxBuffer:1024*1024});
    if (String(inspect.stdout||'').trim().toLowerCase()!=='true') return null;
    const result=await execFileAsync(cfg.cli,['exec',cfg.container,tool,'--version'],{timeout:8000,windowsHide:true,maxBuffer:1024*1024});
    const raw=String(result.stdout||result.stderr||'').trim();
    return {ready:true,mode:'docker',path:cfg.cli,container:cfg.container,internal_host:cfg.host,internal_port:cfg.port,version:`${raw} · Docker: ${cfg.container}`};
  } catch { return null; }
}

async function resolveSystemHealthTool(tool, force=false) {
  const now=Date.now();
  if (!force && now-systemHealthToolCache.checked_at < 300000 && systemHealthToolCache[tool]) return systemHealthToolCache[tool];
  for (const candidate of systemHealthToolCandidates(tool)) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      const result=await execFileAsync(candidate,['--version'],{timeout:5000,windowsHide:true,maxBuffer:1024*1024});
      const resolved={ready:true,mode:'local',path:candidate,version:String(result.stdout||result.stderr||'').trim()};
      systemHealthToolCache={...systemHealthToolCache,checked_at:now,[tool]:resolved};
      return resolved;
    } catch {}
  }
  const dockerResolved=await resolveDockerPostgresTool(tool);
  if (dockerResolved) {
    systemHealthToolCache={...systemHealthToolCache,checked_at:now,[tool]:dockerResolved};
    return dockerResolved;
  }
  const resolved={ready:false,mode:'missing',path:null,version:null,container:systemHealthDockerConfig().container};
  systemHealthToolCache={...systemHealthToolCache,checked_at:now,[tool]:resolved};
  return resolved;
}

function systemHealthDockerTempPath(filename,prefix='factorybox') {
  const safe=String(filename||'backup.dump').replace(/[^a-zA-Z0-9._-]/g,'_');
  return `/tmp/${prefix}_${process.pid}_${Date.now()}_${safe}`;
}

async function runDockerPostgresDump(tool,filePath) {
  const cfg={...systemHealthDockerConfig(),...tool};
  const containerPath=systemHealthDockerTempPath(path.basename(filePath),'factorybox_backup');
  const user=String(process.env.PGUSER||'factorybox');
  const database=String(process.env.PGDATABASE||'factorybox');
  const password=String(process.env.PGPASSWORD||'factorybox_dev_pass');
  try {
    await execFileAsync(cfg.path,[
      'exec','-e',`PGPASSWORD=${password}`,cfg.container,'pg_dump',
      '--format=custom','--compress=6','--no-owner','--no-acl','--file',containerPath,
      '--host',cfg.internal_host||'127.0.0.1','--port',String(cfg.internal_port||5432),'--username',user,database
    ],{timeout:30*60*1000,windowsHide:true,maxBuffer:8*1024*1024});
    await execFileAsync(cfg.path,['cp',`${cfg.container}:${containerPath}`,filePath],{timeout:10*60*1000,windowsHide:true,maxBuffer:4*1024*1024});
  } finally {
    try { await execFileAsync(cfg.path,['exec',cfg.container,'rm','-f',containerPath],{timeout:10000,windowsHide:true,maxBuffer:1024*1024}); } catch {}
  }
}

async function verifyDockerPostgresArchive(tool,filePath) {
  const cfg={...systemHealthDockerConfig(),...tool};
  const containerPath=systemHealthDockerTempPath(path.basename(filePath),'factorybox_verify');
  try {
    await execFileAsync(cfg.path,['cp',filePath,`${cfg.container}:${containerPath}`],{timeout:10*60*1000,windowsHide:true,maxBuffer:4*1024*1024});
    await execFileAsync(cfg.path,['exec',cfg.container,'pg_restore','--list',containerPath],{timeout:120000,windowsHide:true,maxBuffer:8*1024*1024});
  } finally {
    try { await execFileAsync(cfg.path,['exec',cfg.container,'rm','-f',containerPath],{timeout:10000,windowsHide:true,maxBuffer:1024*1024}); } catch {}
  }
}

function systemBackupTimestamp(date=new Date()) {
  const pad=value=>String(value).padStart(2,'0');
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function systemBackupSafePath(filePath) {
  const root=systemBackupRootDir();
  const resolved=path.resolve(String(filePath||''));
  if (resolved!==root && !resolved.startsWith(root+path.sep)) {
    const error=new Error('Backup file path is outside the configured backup directory');
    error.statusCode=400;
    throw error;
  }
  return resolved;
}

async function systemFileSha256(filePath) {
  return new Promise((resolve,reject)=>{
    const hash=crypto.createHash('sha256');
    const stream=fs.createReadStream(filePath);
    stream.on('error',reject);
    stream.on('data',chunk=>hash.update(chunk));
    stream.on('end',()=>resolve(hash.digest('hex')));
  });
}

async function verifySystemBackupRecord(recordOrId) {
  await ensureSystemHealthFoundation();
  const record=typeof recordOrId==='object'?recordOrId:await one(`SELECT * FROM system_backup_history WHERE id=$1`,[String(recordOrId)]);
  if (!record) { const error=new Error('Backup record not found'); error.statusCode=404; throw error; }
  const filePath=systemBackupSafePath(record.file_path);
  if (!fs.existsSync(filePath)) {
    const updated=await one(`UPDATE system_backup_history SET verification_status='failed',verification_message='Backup file not found',verified_at=now() WHERE id=$1 RETURNING *`,[record.id]);
    return {record:updated,valid:false,mode:'file'};
  }
  const stat=fs.statSync(filePath);
  if (!stat.isFile() || stat.size<128) {
    const updated=await one(`UPDATE system_backup_history SET verification_status='failed',verification_message='Backup file is empty or invalid',verified_at=now() WHERE id=$1 RETURNING *`,[record.id]);
    return {record:updated,valid:false,mode:'file'};
  }
  const sha256=await systemFileSha256(filePath);
  if (record.sha256 && record.sha256!==sha256) {
    const updated=await one(`UPDATE system_backup_history SET verification_status='failed',verification_message='SHA256 checksum mismatch',verified_at=now() WHERE id=$1 RETURNING *`,[record.id]);
    return {record:updated,valid:false,mode:'checksum'};
  }
  const restore=await resolveSystemHealthTool('pg_restore');
  let mode='checksum';
  let message=`File and SHA256 verified (${stat.size} bytes)`;
  if (restore.ready) {
    try {
      if (restore.mode==='docker') await verifyDockerPostgresArchive(restore,filePath);
      else await execFileAsync(restore.path,['--list',filePath],{timeout:120000,windowsHide:true,maxBuffer:4*1024*1024});
      mode=restore.mode==='docker'?'docker_pg_restore':'pg_restore';
      message=restore.mode==='docker'?`Backup archive verified with pg_restore in Docker container ${restore.container}`:'Backup archive catalog verified with pg_restore';
    } catch(error) {
      const updated=await one(`UPDATE system_backup_history SET verification_status='failed',verification_message=$2,verified_at=now() WHERE id=$1 RETURNING *`,[record.id,String(error.stderr||error.message||error).slice(0,1000)]);
      return {record:updated,valid:false,mode:restore.mode==='docker'?'docker_pg_restore':'pg_restore'};
    }
  }
  const updated=await one(`UPDATE system_backup_history SET size_bytes=$2,sha256=$3,verification_status='verified',verification_message=$4,verified_at=now() WHERE id=$1 RETURNING *`,[record.id,stat.size,sha256,message]);
  return {record:updated,valid:true,mode};
}

async function sendSystemHealthTelegramAlert(text) {
  const cfg=telegramEscalationConfig();
  if (!cfg.enabled || !cfg.token || !cfg.defaultChatId) return {sent:false,reason:'Telegram is not configured'};
  const response=await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id:cfg.defaultChatId,text:String(text),disable_web_page_preview:true})
  });
  const payload=await response.json().catch(()=>({}));
  if (!response.ok || payload.ok===false) throw new Error(payload.description||`Telegram HTTP ${response.status}`);
  return {sent:true,message_id:payload.result?.message_id||null};
}

async function cleanupSystemBackups({actor='system',writeLog=true}={}) {
  const settings=await systemHealthSettings();
  const rows=(await pool.query(`SELECT * FROM system_backup_history WHERE status='completed' AND deleted_at IS NULL ORDER BY completed_at DESC NULLS LAST,started_at DESC`)).rows;
  const now=Date.now();
  const retentionMs=Number(settings.retention_days||14)*86400000;
  const maxBackups=Number(settings.max_backups||30);
  const candidates=rows.filter((row,index)=>index>=maxBackups || now-new Date(row.completed_at||row.started_at).getTime()>retentionMs);
  let deleted=0;
  const errors=[];
  for (const row of candidates) {
    try {
      const filePath=systemBackupSafePath(row.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await pool.query(`UPDATE system_backup_history SET status='deleted',deleted_at=now() WHERE id=$1`,[row.id]);
      deleted++;
    } catch(error) { errors.push({id:row.id,error:String(error.message||error)}); }
  }
  const result={deleted_count:deleted,error_count:errors.length,errors};
  if (writeLog) await systemHealthLog(errors.length?'warning':'info','backup',`Backup cleanup completed: ${deleted} deleted`,{actor,...result});
  return result;
}

async function createSystemDatabaseBackup({trigger='manual',actor='admin'}={}) {
  await ensureSystemHealthFoundation();
  if (systemHealthRuntime.backup_running) { const error=new Error('A database backup is already running'); error.statusCode=409; throw error; }
  systemHealthRuntime.backup_running=true;
  const backupDir=systemBackupRootDir();
  fs.mkdirSync(backupDir,{recursive:true});
  const filename=`FactoryBox_DB_${systemBackupTimestamp()}.dump`;
  const filePath=path.join(backupDir,filename);
  const record=await one(`INSERT INTO system_backup_history(filename,file_path,backup_type,status,created_by) VALUES($1,$2,$3,'running',$4) RETURNING *`,[filename,filePath,trigger,actor]);
  try {
    const tool=await resolveSystemHealthTool('pg_dump',true);
    if (!tool.ready) throw new Error(`pg_dump was not found locally or in Docker container ${systemHealthDockerConfig().container}. Set PG_DUMP_PATH or FACTORYBOX_POSTGRES_CONTAINER.`);
    if (tool.mode==='docker') {
      await runDockerPostgresDump(tool,filePath);
    } else {
      const args=['--format=custom','--compress=6','--no-owner','--no-acl','--file',filePath,'--host',String(process.env.PGHOST||'localhost'),'--port',String(process.env.PGPORT||5433),'--username',String(process.env.PGUSER||'factorybox'),String(process.env.PGDATABASE||'factorybox')];
      await execFileAsync(tool.path,args,{timeout:30*60*1000,windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,PGPASSWORD:String(process.env.PGPASSWORD||'factorybox_dev_pass')}});
    }
    const stat=fs.statSync(filePath);
    const sha256=await systemFileSha256(filePath);
    let completed=await one(`UPDATE system_backup_history SET status='completed',size_bytes=$2,sha256=$3,completed_at=now() WHERE id=$1 RETURNING *`,[record.id,stat.size,sha256]);
    const verification=await verifySystemBackupRecord(completed);
    completed=verification.record;
    await systemHealthLog('info','backup',`Database backup completed: ${filename}`,{trigger,actor,size_bytes:stat.size,verification:verification.mode});
    await cleanupSystemBackups({actor,writeLog:false});
    return {backup:completed,verification};
  } catch(error) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    const failed=await one(`UPDATE system_backup_history SET status='failed',error_message=$2,completed_at=now() WHERE id=$1 RETURNING *`,[record.id,String(error.stderr||error.message||error).slice(0,2000)]);
    await systemHealthLog('error','backup',`Database backup failed: ${String(error.message||error)}`,{trigger,actor});
    throw Object.assign(new Error(failed.error_message||'Backup failed'),{backup_record:failed});
  } finally { systemHealthRuntime.backup_running=false; }
}

function systemDiskSnapshot(targetPath) {
  try {
    fs.mkdirSync(targetPath,{recursive:true});
    if (typeof fs.statfsSync!=='function') return {status:'unsupported',path:targetPath};
    const stat=fs.statfsSync(targetPath);
    const total=Number(stat.blocks)*Number(stat.bsize);
    const free=Number(stat.bavail)*Number(stat.bsize);
    const used=Math.max(total-free,0);
    return {status:'ok',path:targetPath,total_bytes:total,free_bytes:free,used_bytes:used,used_percent:total?Number((used/total*100).toFixed(1)):0};
  } catch(error) { return {status:'error',path:targetPath,error:error.message}; }
}

function systemEnvironmentChecks(notification, tools) {
  const auth=authConfig();
  const checks=[];
  const add=(key,labelTr,labelEn,status,messageTr,messageEn)=>checks.push({key,label:labelEn,label_tr:labelTr,label_en:labelEn,status,message:messageEn,message_tr:messageTr,message_en:messageEn});
  add('auth','Kimlik Doğrulama','Authentication',auth.enabled?'ok':'warning',auth.enabled?'AUTH_ENABLED=true':'Üretim kullanımı öncesinde AUTH_ENABLED=true yapılmalıdır',auth.enabled?'AUTH_ENABLED=true':'AUTH_ENABLED is false; enable it before production use');
  add('admin_credentials','Admin Bilgileri','Admin Credentials',!auth.enabled?'disabled':(auth.adminEmail&&auth.adminPassword?'ok':'critical'),!auth.enabled?'Kimlik doğrulama kapalı':(auth.adminEmail&&auth.adminPassword?'Yapılandırıldı':'FACTORYBOX_ADMIN_EMAIL / FACTORYBOX_ADMIN_PASSWORD eksik'),!auth.enabled?'Authentication disabled':(auth.adminEmail&&auth.adminPassword?'Configured':'FACTORYBOX_ADMIN_EMAIL / FACTORYBOX_ADMIN_PASSWORD missing'));
  add('database_password','Veritabanı Şifresi','Database Password',process.env.PGPASSWORD&&process.env.PGPASSWORD!=='factorybox_dev_pass'?'ok':'warning','Üretimde güçlü ve varsayılan olmayan bir PGPASSWORD kullanın','Use a strong non-default PGPASSWORD in production');
  add('mqtt_url','MQTT Adresi','MQTT URL',process.env.MQTT_URL?'ok':'warning',process.env.MQTT_URL?'Yapılandırıldı':'Varsayılan genel MQTT adresi kullanılıyor',process.env.MQTT_URL?'Configured':'Using default public MQTT URL');
  add('telegram','Telegram','Telegram',notification.telegram.enabled?(notification.telegram.configured?'ok':'warning'):'disabled',notification.telegram.enabled?(notification.telegram.configured?'Yapılandırıldı':'Aktif fakat ayarlar eksik'):'Kapalı',notification.telegram.enabled?(notification.telegram.configured?'Configured':'Enabled but incomplete'):'Disabled');
  add('email','E-posta / SMTP','Email / SMTP',notification.email.enabled?(notification.email.configured?'ok':'warning'):'disabled',notification.email.enabled?(notification.email.configured?'Yapılandırıldı':'Aktif fakat ayarlar eksik'):'Kapalı',notification.email.enabled?(notification.email.configured?'Configured':'Enabled but incomplete'):'Disabled');
  add('pg_dump','pg_dump','pg_dump',tools.pg_dump.ready?'ok':'warning',tools.pg_dump.ready?tools.pg_dump.version:`Yerelde veya Docker container ${systemHealthDockerConfig().container} içinde bulunamadı; otomatik veritabanı yedeği çalışamaz`,tools.pg_dump.ready?tools.pg_dump.version:`Not found locally or in Docker container ${systemHealthDockerConfig().container}; automatic database backup cannot run`);
  add('pg_restore','pg_restore','pg_restore',tools.pg_restore.ready?'ok':'warning',tools.pg_restore.ready?tools.pg_restore.version:`Yerelde veya Docker container ${systemHealthDockerConfig().container} içinde bulunamadı; arşiv doğrulaması yalnızca checksum ile yapılır`,tools.pg_restore.ready?tools.pg_restore.version:`Not found locally or in Docker container ${systemHealthDockerConfig().container}; archive catalog verification will use checksum only`);
  return checks;
}

async function systemHealthSnapshot({forceTools=false,includeLogs=true}={}) {
  await ensureSystemHealthFoundation();
  const started=Date.now();
  let database={status:'critical',connected:false,error:null};
  try {
    const result=await pool.query(`SELECT current_database() database,current_user db_user,version() version,pg_database_size(current_database())::bigint size_bytes,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()) active_connections,now() checked_at`);
    database={status:'ok',connected:true,...result.rows[0],latency_ms:Date.now()-started};
  } catch(error) { database.error=error.message; }

  const tools={pg_dump:await resolveSystemHealthTool('pg_dump',forceTools),pg_restore:await resolveSystemHealthTool('pg_restore',forceTools)};
  let notification={telegram:{enabled:false,configured:false},email:{enabled:false,configured:false}};
  try { notification=await notificationSettingsSnapshot(null); } catch(error) { notification.error=error.message; }
  let maintenanceSettings={enabled:false,interval_sec:null};
  try { maintenanceSettings=await maintenanceSchedulerSettings(); } catch(error) { maintenanceSettings.error=error.message; }
  const settings=await systemHealthSettings();
  const environment=systemEnvironmentChecks(notification,tools);
  const backups=(await pool.query(`SELECT id::text,filename,file_path,backup_type,status,size_bytes::bigint,sha256,verification_status,verification_message,error_message,created_by,started_at,completed_at,verified_at,deleted_at FROM system_backup_history ORDER BY started_at DESC LIMIT 40`)).rows;
  const logs=includeLogs?(await pool.query(`SELECT id::text,level,component,message,metadata,created_at FROM system_health_logs ORDER BY created_at DESC LIMIT 80`)).rows:[];
  const disk=systemDiskSnapshot(systemBackupRootDir());
  const memory=process.memoryUsage();
  const mqttConfigured=Boolean(String(process.env.MQTT_URL||'').trim());
  const mqttStaleSec=Math.min(Math.max(Number(process.env.MQTT_HEALTH_STALE_SEC||180),30),86400);
  const mqttMessageAgeSec=lastMqttMessageAt?Math.max(0,Math.floor((Date.now()-new Date(lastMqttMessageAt).getTime())/1000)):null;
  const mqttDeviceActive=Boolean(mqttConfigured&&mqttConnected&&mqttMessageAgeSec!==null&&mqttMessageAgeSec<=mqttStaleSec);
  const mqttStatus=!mqttConfigured?'unconfigured':!mqttConnected?'offline':mqttDeviceActive?'ok':'stale';
  const mqtt={status:mqttStatus,configured:mqttConfigured,connected:Boolean(mqttConfigured&&mqttConnected),broker_connected:Boolean(mqttConnected),using_default_public_broker:!mqttConfigured,device_active:mqttDeviceActive,stale_after_sec:mqttStaleSec,message_age_sec:mqttMessageAgeSec,url:CFG.mqttUrl,base_topic:CFG.baseTopic,last_message_at:lastMqttMessageAt,last_topic:lastMqttTopic};
  const services={
    alarm_delivery:{enabled:alarmEscalationDeliveryEnabled(),automatic:alarmEscalationAutoDeliveryEnabled(),running:alarmEscalationDeliveryRunning},
    automation_scheduler:{enabled:alarmAutomationSchedulerEnabled(),running:alarmAutomationSchedulerState.running,last_status:alarmAutomationSchedulerState.last_run_status,last_run_at:alarmAutomationSchedulerState.last_run_finished_at,next_run_at:alarmAutomationSchedulerState.next_run_at,last_error:alarmAutomationSchedulerState.last_error},
    alarm_reports:{enabled:alarmReportSchedulerEnabled(),running:alarmReportSchedulerState.running,last_run_at:alarmReportSchedulerState.last_check_at,next_run_at:alarmReportSchedulerState.next_check_at,last_result:alarmReportSchedulerState.last_result},
    maintenance:{enabled:Boolean(maintenanceSettings.enabled),running:maintenanceSchedulerState.running,last_run_at:maintenanceSchedulerState.last_run_at,next_run_at:maintenanceSchedulerState.next_run_at,last_error:maintenanceSchedulerState.last_error},
    backup:{enabled:Boolean(settings.backup_enabled),running:systemHealthRuntime.backup_running,backup_hour:Number(settings.backup_hour),last_scheduled_backup_date:settings.last_scheduled_backup_date}
  };
  const critical=[];const warnings=[];const critical_tr=[];const warnings_tr=[];
  if (!database.connected) { critical.push('PostgreSQL connection failed');critical_tr.push('PostgreSQL bağlantısı başarısız'); }
  for (const item of environment) {
    if (item.status==='critical') { critical.push(item.message_en||item.message);critical_tr.push(item.message_tr||item.message); }
    else if (item.status==='warning') { warnings.push(item.message_en||item.message);warnings_tr.push(item.message_tr||item.message); }
  }
  if (!mqttConfigured) {
    warnings.push('MQTT_URL is not configured; the default public demo broker is not accepted as a production connection');
    warnings_tr.push('MQTT_URL yapılandırılmadı; varsayılan genel demo broker üretim bağlantısı olarak kabul edilmiyor');
  } else if (!mqttConnected) {
    warnings.push('MQTT broker is disconnected');
    warnings_tr.push('MQTT broker bağlantısı kesik');
  } else if (!mqttDeviceActive) {
    if (lastMqttMessageAt) {
      warnings.push(`MQTT broker is connected, but device traffic is stale (${mqttMessageAgeSec} sec)`);
      warnings_tr.push(`MQTT broker bağlı ancak cihaz trafiği eski (${mqttMessageAgeSec} sn)`);
    } else {
      warnings.push('MQTT broker is connected, but no device message has been received');
      warnings_tr.push('MQTT broker bağlı ancak henüz cihaz mesajı alınmadı');
    }
  }
  if (disk.status==='ok' && disk.used_percent>=95) { critical.push(`Disk usage is ${disk.used_percent}%`);critical_tr.push(`Disk kullanımı %${disk.used_percent}`); }
  else if (disk.status==='ok' && disk.used_percent>=85) { warnings.push(`Disk usage is ${disk.used_percent}%`);warnings_tr.push(`Disk kullanımı %${disk.used_percent}`); }
  const overall_status=critical.length?'critical':warnings.length?'warning':'healthy';
  systemHealthRuntime.last_check_at=new Date().toISOString();
  systemHealthRuntime.last_overall_status=overall_status;
  return {
    generated_at:new Date().toISOString(),overall_status,critical,warnings,critical_tr,warnings_tr,
    backend:{status:'ok',version:APP_VERSION,pid:process.pid,platform:process.platform,node_version:process.version,hostname:os.hostname(),started_at:systemHealthRuntime.started_at,uptime_sec:Math.floor(process.uptime()),memory:{rss_bytes:memory.rss,heap_used_bytes:memory.heapUsed,heap_total_bytes:memory.heapTotal},load_average:os.loadavg()},
    database,mqtt,notification:{telegram:notification.telegram,email:notification.email,latest_delivery:notification.latest_delivery||null},services,disk,tools,environment,settings,backups,logs
  };
}

async function maybeSendSystemCriticalAlert(snapshot) {
  const settings=await systemHealthSettings();
  if (!settings.critical_telegram_enabled || snapshot.overall_status!=='critical') return {sent:false,reason:'not_required'};
  const signature=crypto.createHash('sha256').update(JSON.stringify(snapshot.critical)).digest('hex');
  const lastAt=systemHealthRuntime.last_critical_alert_at?new Date(systemHealthRuntime.last_critical_alert_at).getTime():0;
  if (signature===systemHealthRuntime.last_critical_signature && Date.now()-lastAt<1800000) return {sent:false,reason:'throttled'};
  const text=['🚨 FactoryBox System Health Critical',`Version: v${APP_VERSION}`,`Host: ${os.hostname()}`,...snapshot.critical.map(item=>`- ${item}`),`Time: ${new Date().toISOString()}`].join('\n');
  try {
    const result=await sendSystemHealthTelegramAlert(text);
    if (result.sent) { systemHealthRuntime.last_critical_signature=signature;systemHealthRuntime.last_critical_alert_at=new Date().toISOString(); }
    await systemHealthLog(result.sent?'warning':'info','health-alert',result.sent?'Critical health alert sent to Telegram':`Critical alert not sent: ${result.reason}`,{critical:snapshot.critical});
    return result;
  } catch(error) { await systemHealthLog('error','health-alert',`Telegram critical alert failed: ${error.message}`);return {sent:false,error:error.message}; }
}

async function runSystemHealthMonitor() {
  if (systemHealthRuntime.monitor_running) return;
  systemHealthRuntime.monitor_running=true;
  try { const snapshot=await systemHealthSnapshot({includeLogs:false});await maybeSendSystemCriticalAlert(snapshot); }
  catch(error) { console.error('System health monitor error:',error.message); }
  finally { systemHealthRuntime.monitor_running=false; }
}

async function runSystemBackupSchedule() {
  try {
    const settings=await systemHealthSettings();
    if (!settings.backup_enabled || systemHealthRuntime.backup_running) return;
    const lastAttempt=systemHealthRuntime.last_backup_attempt_at?new Date(systemHealthRuntime.last_backup_attempt_at).getTime():0;
    if (Date.now()-lastAttempt<15*60*1000) return;
    const general=await one(`SELECT timezone FROM general_settings WHERE id=1`);
    const clock=zonedClockParts(new Date(),general?.timezone||'Europe/Istanbul');
    if (clock.hour!==Number(settings.backup_hour) || settings.last_scheduled_backup_date===clock.date_key) return;
    systemHealthRuntime.last_backup_attempt_at=new Date().toISOString();
    await createSystemDatabaseBackup({trigger:'scheduled',actor:'system-scheduler'});
    await pool.query(`UPDATE system_health_settings SET last_scheduled_backup_date=$1,updated_at=now() WHERE id=1`,[clock.date_key]);
  } catch(error) { console.error('Automatic database backup error:',error.message); }
}

function stopSystemHealthSchedulers() {
  if (systemHealthBackupTimer) clearInterval(systemHealthBackupTimer);
  if (systemHealthMonitorTimer) clearInterval(systemHealthMonitorTimer);
  systemHealthBackupTimer = null;
  systemHealthMonitorTimer = null;
}

function restartSystemHealthSchedulers() {
  stopSystemHealthSchedulers();
  systemHealthBackupTimer=setInterval(runSystemBackupSchedule,60000);systemHealthBackupTimer.unref?.();
  systemHealthMonitorTimer=setInterval(runSystemHealthMonitor,300000);systemHealthMonitorTimer.unref?.();
  setTimeout(runSystemHealthMonitor,5000).unref?.();
  setTimeout(runSystemBackupSchedule,8000).unref?.();
}

app.get('/api/admin/system-health', adminRequired, permissionRequired('VIEW_DASHBOARD'), async(req,res)=>{
  try { const snapshot=await systemHealthSnapshot({forceTools:req.query.force==='1'});res.json({status:'ok',version:APP_VERSION,can_manage:!authConfig().enabled||hasPermission(req.user,'MANAGE_SITES'),...snapshot}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/system-health/check', adminRequired, permissionRequired('VIEW_DASHBOARD'), async(req,res)=>{
  try { const snapshot=await systemHealthSnapshot({forceTools:true});const alert=await maybeSendSystemCriticalAlert(snapshot);await systemHealthLog(snapshot.overall_status==='critical'?'error':snapshot.overall_status==='warning'?'warning':'info','health-check',`Manual system health check: ${snapshot.overall_status}`,{actor:req.user?.email||'admin',critical:snapshot.critical,warnings:snapshot.warnings,critical_tr:snapshot.critical_tr,warnings_tr:snapshot.warnings_tr,message_tr:`Manuel sistem sağlık kontrolü: ${snapshot.overall_status==='critical'?'kritik':snapshot.overall_status==='warning'?'uyarı':'sağlıklı'}`});res.json({status:'ok',version:APP_VERSION,alert,...snapshot}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.patch('/api/admin/system-health/settings', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try {
    const old=await systemHealthSettings();const body=req.body||{};const actor=req.user||getSession(req)?.user||{};
    const settings=await one(`UPDATE system_health_settings SET backup_enabled=$1,backup_hour=$2,retention_days=$3,max_backups=$4,critical_telegram_enabled=$5,updated_by=$6,updated_at=now() WHERE id=1 RETURNING *`,[
      body.backup_enabled===undefined?old.backup_enabled:Boolean(body.backup_enabled),systemHealthSafeNumber(body.backup_hour,old.backup_hour,0,23),systemHealthSafeNumber(body.retention_days,old.retention_days,1,3650),systemHealthSafeNumber(body.max_backups,old.max_backups,1,500),body.critical_telegram_enabled===undefined?old.critical_telegram_enabled:Boolean(body.critical_telegram_enabled),actor.email||'admin'
    ]);
    await writeAuditLog(req,{action:'update_system_health_settings',entity_type:'system_health_settings',entity_id:'global',old_values:old,new_values:settings});
    await systemHealthLog('info','settings','System health and backup settings updated',{actor:actor.email||'admin'});restartSystemHealthSchedulers();
    res.json({status:'ok',version:APP_VERSION,settings});
  } catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/system-health/backups', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try { const actor=req.user||getSession(req)?.user||{};const result=await createSystemDatabaseBackup({trigger:'manual',actor:actor.email||'admin'});await writeAuditLog(req,{action:'create_database_backup',entity_type:'system_backup',entity_id:String(result.backup.id),new_values:{filename:result.backup.filename,size_bytes:result.backup.size_bytes,verification_status:result.backup.verification_status}});res.status(201).json({status:'ok',version:APP_VERSION,...result}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message,backup:error.backup_record||null}); }
});

app.post('/api/admin/system-health/backups/:id/verify', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try { const result=await verifySystemBackupRecord(req.params.id);await writeAuditLog(req,{action:'verify_database_backup',entity_type:'system_backup',entity_id:String(req.params.id),new_values:{valid:result.valid,mode:result.mode,verification_status:result.record.verification_status}});res.json({status:'ok',version:APP_VERSION,...result}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/system-health/backups/cleanup', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try { const actor=req.user||getSession(req)?.user||{};const result=await cleanupSystemBackups({actor:actor.email||'admin'});await writeAuditLog(req,{action:'cleanup_database_backups',entity_type:'system_backup',entity_id:'global',new_values:result});res.json({status:'ok',version:APP_VERSION,result}); }
  catch(error) { res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.get('/api/admin/system-health/backups/:id/download', adminRequired, permissionRequired('MANAGE_SITES'), async(req,res)=>{
  try { const record=await one(`SELECT * FROM system_backup_history WHERE id=$1 AND status='completed' AND deleted_at IS NULL`,[String(req.params.id)]);if(!record)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Backup not found'});const filePath=systemBackupSafePath(record.file_path);if(!fs.existsSync(filePath))return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Backup file not found'});res.download(filePath,record.filename); }
  catch(error) { if(!res.headersSent)res.status(error.statusCode||500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

async function ensureNotificationSettingsFoundation() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
      delivery_enabled boolean,
      auto_delivery_enabled boolean,
      interval_sec integer,
      batch_size integer,
      telegram_enabled boolean,
      telegram_bot_token text,
      telegram_chat_id text,
      email_enabled boolean,
      smtp_host text,
      smtp_port integer,
      smtp_secure boolean,
      smtp_user text,
      smtp_pass text,
      smtp_from text,
      email_default_to text,
      email_mode text,
      email_sender_name text,
      mail_gateway_url text,
      mail_gateway_installation_id text,
      mail_gateway_api_key text,
      mail_gateway_allow_smtp_fallback boolean,
      scheduler_enabled boolean,
      scheduler_interval_sec integer,
      retry_enabled boolean,
      retry_base_delay_sec integer,
      retry_max_delay_sec integer,
      retry_max_attempts integer,
      alarm_report_scheduler_enabled boolean,
      alarm_report_timezone text,
      alarm_report_channels text,
      alarm_report_telegram_chat_ids text,
      alarm_report_email_recipients text,
      alarm_report_daily_enabled boolean,
      alarm_report_daily_hour integer,
      alarm_report_weekly_enabled boolean,
      alarm_report_weekly_day integer,
      alarm_report_weekly_hour integer,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`INSERT INTO notification_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_mode text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS email_sender_name text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS mail_gateway_url text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS mail_gateway_installation_id text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS mail_gateway_api_key text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS mail_gateway_allow_smtp_fallback boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS scheduler_enabled boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS scheduler_interval_sec integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS retry_enabled boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS retry_base_delay_sec integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS retry_max_delay_sec integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS retry_max_attempts integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_scheduler_enabled boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_timezone text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_channels text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_telegram_chat_ids text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_email_recipients text`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_daily_enabled boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_daily_hour integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_weekly_enabled boolean`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_weekly_day integer`);
  await pool.query(`ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS alarm_report_weekly_hour integer`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_email_deliveries (
      id bigserial PRIMARY KEY,
      request_id text NOT NULL UNIQUE,
      purpose text NOT NULL,
      mode text NOT NULL,
      provider text,
      recipient_count integer NOT NULL DEFAULT 0,
      recipients_masked jsonb NOT NULL DEFAULT '[]'::jsonb,
      subject text,
      status text NOT NULL CHECK (status IN ('processing','delivered','failed')),
      provider_message_id text,
      error_message text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbound_email_deliveries_created
    ON outbound_email_deliveries(created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_outbound_email_deliveries_status
    ON outbound_email_deliveries(status, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarm_report_deliveries (
      id bigserial PRIMARY KEY,
      report_key text NOT NULL UNIQUE,
      report_type text NOT NULL CHECK (report_type IN ('daily','weekly')),
      trigger text NOT NULL,
      period_start timestamptz NOT NULL,
      period_end timestamptz NOT NULL,
      timezone text NOT NULL,
      channels text NOT NULL,
      recipients jsonb NOT NULL DEFAULT '{}'::jsonb,
      status text NOT NULL CHECK (status IN ('processing','delivered','partial','failed','skipped')),
      attempt_count integer NOT NULL DEFAULT 0,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      provider_message_id text,
      error_message text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_report_deliveries_created
    ON alarm_report_deliveries(created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_report_deliveries_status
    ON alarm_report_deliveries(status, created_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarm_automation_scheduler_runs (
      id bigserial PRIMARY KEY,
      trigger text NOT NULL,
      status text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      scanned_active_count integer NOT NULL DEFAULT 0,
      overdue_count integer NOT NULL DEFAULT 0,
      created_count integer NOT NULL DEFAULT 0,
      duplicate_count integer NOT NULL DEFAULT 0,
      retried_count integer NOT NULL DEFAULT 0,
      delivered_count integer NOT NULL DEFAULT 0,
      failed_count integer NOT NULL DEFAULT 0,
      dead_letter_count integer NOT NULL DEFAULT 0,
      error_message text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_alarm_automation_scheduler_runs_started
    ON alarm_automation_scheduler_runs(started_at DESC)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_channel_tests (
      id bigserial PRIMARY KEY,
      channel text NOT NULL,
      status text NOT NULL,
      target_masked text,
      provider_message_id text,
      error_message text,
      actor_email text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notification_channel_tests_channel_created
    ON notification_channel_tests(channel, created_at DESC)
  `);
  await loadNotificationRuntimeSettings();
}


async function ensureMailGatewayFoundation() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_gateway_deliveries (
      id bigserial PRIMARY KEY,
      installation_id text NOT NULL,
      request_id text NOT NULL,
      purpose text NOT NULL,
      recipient_count integer NOT NULL DEFAULT 0,
      recipients_masked jsonb NOT NULL DEFAULT '[]'::jsonb,
      subject text,
      status text NOT NULL CHECK (status IN ('processing','delivered','failed')),
      provider_message_id text,
      error_message text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(installation_id, request_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_gateway_deliveries_created
    ON mail_gateway_deliveries(created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mail_gateway_deliveries_installation
    ON mail_gateway_deliveries(installation_id, created_at DESC)
  `);
}

async function loadNotificationRuntimeSettings() {
  const row = await one(`SELECT * FROM notification_settings WHERE id=1`);
  notificationRuntimeSettings = row || {};
  return notificationRuntimeSettings;
}

function notificationBoolInput(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function notificationEmailModeInput(value, fallback = 'direct_smtp') {
  const clean = String(value === undefined ? fallback : value || '').trim().toLowerCase();
  return ['gateway','direct_smtp','disabled'].includes(clean) ? clean : 'direct_smtp';
}

function notificationIntInput(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}

function notificationTextInput(value, fallback = '', max = 1000) {
  if (value === undefined) return fallback;
  return String(value || '').trim().slice(0, max);
}

function notificationSecretInput(value, fallback = '') {
  const clean = String(value || '').trim();
  if (!clean || clean.includes('••••') || clean === '********') return fallback;
  return clean.slice(0, 4000);
}

function maskNotificationValue(value, visibleEnd = 4) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (clean.length <= visibleEnd) return '••••';
  return `${'•'.repeat(Math.min(12, Math.max(6, clean.length - visibleEnd)))}${clean.slice(-visibleEnd)}`;
}

async function lastNotificationTests() {
  const result = await pool.query(`
    SELECT DISTINCT ON (channel)
      channel,status,target_masked,provider_message_id,error_message,actor_email,created_at
    FROM notification_channel_tests
    ORDER BY channel, created_at DESC
  `);
  return Object.fromEntries(result.rows.map(row => [row.channel, row]));
}

async function recordNotificationTest({channel, status, target, providerMessageId = null, errorMessage = null, actorEmail = null}) {
  return one(`
    INSERT INTO notification_channel_tests(channel,status,target_masked,provider_message_id,error_message,actor_email)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [channel, status, maskNotificationValue(target), providerMessageId, errorMessage, actorEmail]);
}

async function notificationSettingsSnapshot(actor = null) {
  await ensureNotificationSettingsFoundation();
  const email = emailConfig();
  const telegram = telegramEscalationConfig();
  const lastTests = await lastNotificationTests();
  const latestDelivery = await one(`
    SELECT delivery_status,channel,provider_message_id,last_error,delivered_at,failed_at,last_attempt_at
    FROM alarm_escalation_events
    WHERE last_attempt_at IS NOT NULL
    ORDER BY last_attempt_at DESC
    LIMIT 1
  `);
  const overrideKeys = [
    'delivery_enabled','auto_delivery_enabled','interval_sec','batch_size',
    'telegram_enabled','telegram_bot_token','telegram_chat_id',
    'email_enabled','email_mode','email_sender_name','mail_gateway_url','mail_gateway_installation_id','mail_gateway_api_key','mail_gateway_allow_smtp_fallback',
    'smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from','email_default_to',
    'scheduler_enabled','scheduler_interval_sec','retry_enabled','retry_base_delay_sec','retry_max_delay_sec','retry_max_attempts',
    'alarm_report_scheduler_enabled','alarm_report_timezone','alarm_report_channels',
    'alarm_report_telegram_chat_ids','alarm_report_email_recipients',
    'alarm_report_daily_enabled','alarm_report_daily_hour',
    'alarm_report_weekly_enabled','alarm_report_weekly_day','alarm_report_weekly_hour'
  ];
  const hasOverrides = overrideKeys.some(key => notificationRuntimeSettings[key] !== null && notificationRuntimeSettings[key] !== undefined);
  return {
    can_manage:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
    settings_source:hasOverrides ? 'database' : 'environment',
    delivery:{
      enabled:alarmEscalationDeliveryEnabled(),
      auto_enabled:alarmEscalationAutoDeliveryEnabled(),
      interval_sec:alarmEscalationDeliveryIntervalSec(),
      batch_size:alarmEscalationDeliveryBatchSize()
    },
    telegram:{
      enabled:telegram.enabled,
      configured:telegram.configured,
      token_configured:Boolean(telegram.token),
      token_masked:maskNotificationValue(telegram.token),
      chat_id_configured:Boolean(telegram.defaultChatId),
      chat_id_masked:maskNotificationValue(telegram.defaultChatId),
      last_test:lastTests.telegram || null
    },
    email:{
      enabled:email.enabled,
      configured:email.configured,
      mode:email.mode,
      sender_name:email.senderName,
      host:email.host,
      port:email.port,
      secure:email.secure,
      user:email.user,
      password_configured:Boolean(email.pass),
      password_masked:maskNotificationValue(email.pass),
      from:email.from,
      default_to:email.defaultTo,
      smtp_configured:email.smtpConfigured,
      gateway:{
        configured:email.gateway.configured,
        url:email.gateway.url,
        installation_id:email.gateway.installationId,
        api_key_configured:Boolean(email.gateway.apiKey),
        api_key_masked:maskNotificationValue(email.gateway.apiKey),
        allow_smtp_fallback:email.gateway.allowSmtpFallback
      },
      last_test:lastTests.email || null
    },
    latest_delivery:latestDelivery || null,
    updated_at:notificationRuntimeSettings.updated_at || null,
    updated_by:notificationRuntimeSettings.updated_by || null
  };
}

function escalationEventLimit(raw, fallback = 100, max = 500) {
  const value = Number(raw || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

function escalationEventStatus(raw) {
  const value = String(raw || 'all').trim().toLowerCase();
  return ['all','pending','processing','delivered','failed','dead_letter','suppressed'].includes(value) ? value : 'all';
}

function escalationEventStage(raw) {
  const value = String(raw || 'all').trim().toLowerCase();
  return ['all','ack_overdue','resolve_overdue'].includes(value) ? value : 'all';
}

function escalationEventMessage(alarm) {
  const stageText = alarm.sla_status === 'resolve_overdue' ? 'Çözüm SLA süresi aşıldı' : 'Acknowledge SLA süresi aşıldı';
  return `${stageText}: ${alarm.machine_code || 'unassigned'} / ${alarm.alarm_type || 'unknown'} / ${alarm.severity || 'warning'}`;
}

function splitRecipientValues(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function escalationDeliverySubject(event) {
  const stage = event.stage === 'resolve_overdue' ? 'Çözüm SLA Aşımı' : 'Müdahale SLA Aşımı';
  return `FactoryBox ${stage} - ${event.machine_code || 'Makine'} - ${event.alarm_type || 'Alarm'}`;
}

function escalationDeliveryText(event) {
  return [
    'FactoryBox Alarm Escalation',
    '',
    `Durum: ${event.message || '-'}`,
    `Makine: ${event.machine_name || '-'} (${event.machine_code || '-'})`,
    `Alarm: ${event.alarm_type || '-'} / ${event.severity || '-'}`,
    `Aşama: ${event.stage || '-'}`,
    `Alarm başlangıcı: ${event.alarm_started_at ? new Date(event.alarm_started_at).toLocaleString('tr-TR') : '-'}`,
    `Olay ID: ${event.id}`
  ].join('\n');
}

function escalationDeliveryEmailHtml(event) {
  return emailShellHtml('FactoryBox Alarm Escalation', `
    <h1 style="margin:0 0 14px;color:#102033;">${h(escalationDeliverySubject(event))}</h1>
    <p style="font-size:16px;line-height:1.6;color:#334155;">${h(event.message || '-')}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:18px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Makine</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${h(event.machine_name || '-')} (${h(event.machine_code || '-')})</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Alarm</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${h(event.alarm_type || '-')} / ${h(event.severity || '-')}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Aşama</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${h(event.stage || '-')}</td></tr>
      <tr><td style="padding:8px;"><strong>Olay ID</strong></td><td style="padding:8px;">${h(event.id)}</td></tr>
    </table>
  `);
}

async function sendEscalationEmail(event) {
  const result = await sendReportEmail({
    to:event.recipients,
    subject:escalationDeliverySubject(event),
    html:escalationDeliveryEmailHtml(event),
    text:escalationDeliveryText(event),
    purpose:'alarm',
    metadata:{event_id:event.id,machine_code:event.machine_code}
  });
  if (!result.sent) throw new Error(result.reason || 'Escalation email could not be sent');
  return {
    provider:'email',
    message_id:result.message_id || null,
    recipients:result.to || [],
    accepted:result.accepted || [],
    rejected:result.rejected || []
  };
}

async function sendEscalationTelegram(event) {
  const cfg = telegramEscalationConfig();
  if (!cfg.enabled) throw new Error('TELEGRAM_ESCALATION_ENABLED=false');
  if (!cfg.token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const chatIds = splitRecipientValues(event.recipients || cfg.defaultChatId);
  if (!chatIds.length) throw new Error('Telegram chat id is not configured');

  const delivered = [];
  for (const chatId of chatIds) {
    const response = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        chat_id:chatId,
        text:escalationDeliveryText(event),
        disable_web_page_preview:true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.description || `Telegram HTTP ${response.status}`);
    }
    delivered.push({chat_id:chatId, message_id:payload.result?.message_id || null});
  }

  return {
    provider:'telegram',
    message_id:delivered.map(item => item.message_id).filter(Boolean).join(',') || null,
    delivered
  };
}

async function deliverEscalationEvent(event) {
  const channels = String(event.channel || 'dashboard')
    .toLowerCase()
    .split(/[,+]/)
    .map(value => value.trim())
    .filter(Boolean);
  const uniqueChannels = [...new Set(channels.length ? channels : ['dashboard'])];
  const results = [];

  for (const channel of uniqueChannels) {
    if (channel === 'dashboard') {
      results.push({provider:'dashboard', message_id:`dashboard-${event.id}`});
    } else if (channel === 'email') {
      results.push(await sendEscalationEmail(event));
    } else if (channel === 'telegram') {
      results.push(await sendEscalationTelegram(event));
    } else {
      throw new Error(`Unsupported escalation channel: ${channel}`);
    }
  }

  return {
    sent:true,
    providers:results,
    message_id:results.map(item => item.message_id).filter(Boolean).join(',') || null
  };
}

function escalationRetryDelaySec(attemptCount) {
  const exponent = Math.max(0, Number(attemptCount || 1) - 1);
  const delay = alarmEscalationRetryBaseDelaySec() * (2 ** Math.min(exponent, 20));
  return Math.min(Math.floor(delay), alarmEscalationRetryMaxDelaySec());
}

async function prepareDueEscalationRetries() {
  await ensureAlarmEscalationFoundation();
  if (!alarmEscalationRetryEnabled()) return {enabled:false, retried_count:0, dead_letter_count:0};

  const maxAttempts = alarmEscalationRetryMaxAttempts();
  const dead = await pool.query(`
    UPDATE alarm_escalation_events
    SET delivery_status='dead_letter',
        dead_letter_at=COALESCE(dead_letter_at,now()),
        next_attempt_at=NULL,
        updated_at=now()
    WHERE delivery_status='failed'
      AND attempt_count >= $1
    RETURNING id
  `, [maxAttempts]);

  const retried = await pool.query(`
    UPDATE alarm_escalation_events
    SET delivery_status='pending',
        failed_at=NULL,
        next_attempt_at=now(),
        updated_at=now()
    WHERE delivery_status='failed'
      AND attempt_count < $1
      AND COALESCE(next_attempt_at,failed_at,updated_at) <= now()
    RETURNING id
  `, [maxAttempts]);

  return {enabled:true, retried_count:retried.rowCount, dead_letter_count:dead.rowCount};
}

async function claimEscalationEvents(limit, eventId = null) {
  await ensureAlarmEscalationFoundation();
  const safeLimit = escalationEventLimit(limit, alarmEscalationDeliveryBatchSize(), 100);
  let claimed;

  if (eventId) {
    claimed = await pool.query(`
      UPDATE alarm_escalation_events
      SET delivery_status='processing',
          attempt_count=attempt_count+1,
          last_attempt_at=now(),
          last_error=NULL,
          updated_at=now()
      WHERE id=$1
        AND delivery_status IN ('pending','failed')
      RETURNING id::text
    `, [String(eventId)]);
  } else {
    claimed = await pool.query(`
      WITH candidates AS (
        SELECT id
        FROM alarm_escalation_events
        WHERE delivery_status='pending'
          AND (next_attempt_at IS NULL OR next_attempt_at<=now())
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE alarm_escalation_events e
      SET delivery_status='processing',
          attempt_count=e.attempt_count+1,
          last_attempt_at=now(),
          last_error=NULL,
          updated_at=now()
      FROM candidates c
      WHERE e.id=c.id
      RETURNING e.id::text
    `, [safeLimit]);
  }

  const ids = claimed.rows.map(row => row.id);
  if (!ids.length) return [];

  const result = await pool.query(`
    SELECT
      e.*,
      e.id::text AS id,
      e.alarm_id::text,
      e.rule_id::text,
      a.alarm_type,
      a.status AS alarm_status,
      a.started_at AS alarm_started_at,
      m.code AS machine_code,
      m.name AS machine_name,
      r.name AS rule_name
    FROM alarm_escalation_events e
    JOIN alarms a ON a.id=e.alarm_id
    LEFT JOIN machines m ON m.id=a.machine_id
    LEFT JOIN alarm_escalation_rules r ON r.id=e.rule_id
    WHERE e.id=ANY($1::bigint[])
    ORDER BY e.created_at ASC
  `, [ids]);
  return result.rows;
}

async function processAlarmEscalationDeliveries({limit, eventId = null, trigger = 'manual'} = {}) {
  if (!alarmEscalationDeliveryEnabled()) {
    return {enabled:false, claimed_count:0, delivered_count:0, failed_count:0, results:[]};
  }

  const events = await claimEscalationEvents(limit, eventId);
  const results = [];

  for (const event of events) {
    try {
      const delivery = await deliverEscalationEvent(event);
      const updated = await one(`
        UPDATE alarm_escalation_events
        SET delivery_status='delivered',
            delivered_at=now(),
            failed_at=NULL,
            provider_message_id=$2,
            last_error=NULL,
            delivery_metadata=COALESCE(delivery_metadata,'{}'::jsonb) || $3::jsonb,
            updated_at=now()
        WHERE id=$1
        RETURNING *
      `, [event.id, delivery.message_id, JSON.stringify({trigger, delivery})]);
      results.push({id:event.id, status:'delivered', event:updated});
    } catch (error) {
      const message = String(error?.message || error || 'Unknown delivery error').slice(0, 500);
      const retryEnabled = alarmEscalationRetryEnabled();
      const maxAttempts = alarmEscalationRetryMaxAttempts();
      const deadLetter = retryEnabled && Number(event.attempt_count || 0) >= maxAttempts;
      const retryDelaySec = retryEnabled && !deadLetter ? escalationRetryDelaySec(event.attempt_count) : null;
      const nextStatus = deadLetter ? 'dead_letter' : 'failed';
      const updated = await one(`
        UPDATE alarm_escalation_events
        SET delivery_status=$2,
            failed_at=now(),
            dead_letter_at=CASE WHEN $2='dead_letter' THEN now() ELSE NULL END,
            delivered_at=NULL,
            next_attempt_at=CASE WHEN $3::int IS NULL THEN NULL ELSE now() + ($3::int * interval '1 second') END,
            last_error=$4,
            delivery_metadata=COALESCE(delivery_metadata,'{}'::jsonb) || $5::jsonb,
            updated_at=now()
        WHERE id=$1
        RETURNING *
      `, [event.id, nextStatus, retryDelaySec, message, JSON.stringify({trigger, failed_at:new Date().toISOString(), retry_delay_sec:retryDelaySec, max_attempts:maxAttempts})]);
      results.push({id:event.id, status:nextStatus, error:message, retry_delay_sec:retryDelaySec, event:updated});
    }
  }

  return {
    enabled:true,
    claimed_count:events.length,
    delivered_count:results.filter(item => item.status === 'delivered').length,
    failed_count:results.filter(item => item.status === 'failed').length,
    dead_letter_count:results.filter(item => item.status === 'dead_letter').length,
    results
  };
}


const alarmAutomationSchedulerState = {
  running:false,
  last_run_started_at:null,
  last_run_finished_at:null,
  last_run_status:null,
  last_error:null,
  next_run_at:null
};

async function runAlarmAutomationCycle({trigger = 'manual'} = {}) {
  if (alarmAutomationSchedulerState.running) {
    return {status:'skipped', reason:'scheduler_already_running'};
  }

  alarmAutomationSchedulerState.running = true;
  alarmAutomationSchedulerState.last_run_started_at = new Date().toISOString();
  alarmAutomationSchedulerState.last_error = null;
  const runRow = await one(`
    INSERT INTO alarm_automation_scheduler_runs(trigger,status,started_at)
    VALUES($1,'running',now())
    RETURNING id::text
  `, [trigger]);

  try {
    const scan = await scanAlarmEscalationsToQueue({trigger});
    const retry = await prepareDueEscalationRetries();
    const delivery = await processAlarmEscalationDeliveries({
      limit:alarmEscalationDeliveryBatchSize(),
      trigger:`scheduler:${trigger}`
    });
    const result = {
      status:'completed',
      trigger,
      scan,
      retry,
      delivery,
      dead_letter_count:Number(retry.dead_letter_count || 0) + Number(delivery.dead_letter_count || 0)
    };

    await pool.query(`
      UPDATE alarm_automation_scheduler_runs SET
        status='completed', finished_at=now(),
        scanned_active_count=$2, overdue_count=$3, created_count=$4, duplicate_count=$5,
        retried_count=$6, delivered_count=$7, failed_count=$8, dead_letter_count=$9,
        metadata=$10::jsonb
      WHERE id=$1
    `, [
      runRow.id,
      scan.scanned_active_count || 0,
      scan.overdue_count || 0,
      scan.created_count || 0,
      scan.duplicate_count || 0,
      retry.retried_count || 0,
      delivery.delivered_count || 0,
      delivery.failed_count || 0,
      result.dead_letter_count,
      JSON.stringify({delivery_enabled:delivery.enabled, claimed_count:delivery.claimed_count || 0})
    ]);

    alarmAutomationSchedulerState.last_run_status = 'completed';
    return result;
  } catch (error) {
    const message = String(error?.message || error || 'Unknown scheduler error').slice(0, 1000);
    await pool.query(`
      UPDATE alarm_automation_scheduler_runs
      SET status='failed', finished_at=now(), error_message=$2
      WHERE id=$1
    `, [runRow.id, message]).catch(()=>{});
    alarmAutomationSchedulerState.last_run_status = 'failed';
    alarmAutomationSchedulerState.last_error = message;
    throw error;
  } finally {
    alarmAutomationSchedulerState.running = false;
    alarmAutomationSchedulerState.last_run_finished_at = new Date().toISOString();
    alarmAutomationSchedulerState.next_run_at = alarmAutomationSchedulerEnabled()
      ? new Date(Date.now() + alarmAutomationSchedulerIntervalSec() * 1000).toISOString()
      : null;
  }
}

async function alarmAutomationSchedulerSnapshot(actor = null) {
  await ensureNotificationSettingsFoundation();
  await ensureAlarmEscalationFoundation();
  const history = await pool.query(`
    SELECT id::text,trigger,status,started_at,finished_at,scanned_active_count,overdue_count,
           created_count,duplicate_count,retried_count,delivered_count,failed_count,
           dead_letter_count,error_message
    FROM alarm_automation_scheduler_runs
    ORDER BY started_at DESC
    LIMIT 20
  `);
  const queue = await one(`
    SELECT
      count(*) FILTER (WHERE delivery_status='pending')::int AS pending,
      count(*) FILTER (WHERE delivery_status='processing')::int AS processing,
      count(*) FILTER (WHERE delivery_status='failed')::int AS failed,
      count(*) FILTER (WHERE delivery_status='failed' AND COALESCE(next_attempt_at,failed_at,updated_at)<=now())::int AS retry_due,
      count(*) FILTER (WHERE delivery_status='dead_letter')::int AS dead_letter,
      count(*) FILTER (WHERE delivery_status='delivered')::int AS delivered
    FROM alarm_escalation_events
  `);
  return {
    can_manage:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
    scheduler:{
      enabled:alarmAutomationSchedulerEnabled(),
      interval_sec:alarmAutomationSchedulerIntervalSec(),
      running:alarmAutomationSchedulerState.running,
      last_run_started_at:alarmAutomationSchedulerState.last_run_started_at,
      last_run_finished_at:alarmAutomationSchedulerState.last_run_finished_at,
      last_run_status:alarmAutomationSchedulerState.last_run_status,
      last_error:alarmAutomationSchedulerState.last_error,
      next_run_at:alarmAutomationSchedulerState.next_run_at
    },
    retry:{
      enabled:alarmEscalationRetryEnabled(),
      base_delay_sec:alarmEscalationRetryBaseDelaySec(),
      max_delay_sec:alarmEscalationRetryMaxDelaySec(),
      max_attempts:alarmEscalationRetryMaxAttempts()
    },
    queue:queue || {},
    history:history.rows
  };
}

app.get('/api/admin/automation-scheduler', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    const snapshot = await alarmAutomationSchedulerSnapshot(req.user || getSession(req)?.user || null);
    res.json({status:'ok',version:APP_VERSION,...snapshot});
  } catch(e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});

app.patch('/api/admin/automation-scheduler', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureNotificationSettingsFoundation();
    const current = notificationRuntimeSettings || {};
    const body = req.body || {};
    const next = {
      scheduler_enabled:notificationBoolInput(body.scheduler_enabled,current.scheduler_enabled),
      scheduler_interval_sec:notificationIntInput(body.scheduler_interval_sec,current.scheduler_interval_sec,15,3600),
      retry_enabled:notificationBoolInput(body.retry_enabled,current.retry_enabled),
      retry_base_delay_sec:notificationIntInput(body.retry_base_delay_sec,current.retry_base_delay_sec,15,86400),
      retry_max_delay_sec:notificationIntInput(body.retry_max_delay_sec,current.retry_max_delay_sec,15,604800),
      retry_max_attempts:notificationIntInput(body.retry_max_attempts,current.retry_max_attempts,1,20)
    };
    if (next.retry_max_delay_sec < next.retry_base_delay_sec) next.retry_max_delay_sec = next.retry_base_delay_sec;
    const actorEmail = req.user?.email || getSession(req)?.user?.email || 'system';
    const before = await alarmAutomationSchedulerSnapshot(req.user || null);
    await pool.query(`
      UPDATE notification_settings SET
        scheduler_enabled=$1,scheduler_interval_sec=$2,retry_enabled=$3,
        retry_base_delay_sec=$4,retry_max_delay_sec=$5,retry_max_attempts=$6,
        updated_by=$7,updated_at=now()
      WHERE id=1
    `, [next.scheduler_enabled,next.scheduler_interval_sec,next.retry_enabled,next.retry_base_delay_sec,next.retry_max_delay_sec,next.retry_max_attempts,actorEmail]);
    await loadNotificationRuntimeSettings();
    restartAlarmAutomationScheduler();
    restartAlarmEscalationDeliveryWorker();
    const snapshot = await alarmAutomationSchedulerSnapshot(req.user || null);
    await writeAuditLog(req,{
      action:'update_alarm_automation_scheduler',entity_type:'automation_scheduler',entity_id:'global',
      old_values:{scheduler:before.scheduler,retry:before.retry},new_values:{scheduler:snapshot.scheduler,retry:snapshot.retry}
    });
    res.json({status:'ok',version:APP_VERSION,...snapshot});
  } catch(e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});

app.post('/api/admin/automation-scheduler/run-now', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    const result = await runAlarmAutomationCycle({trigger:'admin-panel'});
    await writeAuditLog(req,{
      action:'run_alarm_automation_scheduler',entity_type:'automation_scheduler',entity_id:'manual-run',
      old_values:null,new_values:{status:result.status,created_count:result.scan?.created_count || 0,retried_count:result.retry?.retried_count || 0,delivered_count:result.delivery?.delivered_count || 0,failed_count:result.delivery?.failed_count || 0,dead_letter_count:result.dead_letter_count || 0}
    });
    res.json({status:'ok',version:APP_VERSION,...result});
  } catch(e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});


const alarmReportSchedulerState = {
  running:false,
  last_check_at:null,
  last_result:null,
  next_check_at:null
};

function alarmReportType(raw) {
  const value = String(raw || 'daily').trim().toLowerCase();
  return value === 'weekly' ? 'weekly' : 'daily';
}

function alarmReportWeekdayName(day) {
  return ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'][Number(day) || 0] || 'Pazartesi';
}

function zonedClockParts(date = new Date(), timezone = alarmReportTimezone()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone:timezone,
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',
    weekday:'short',hourCycle:'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdayMap = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {
    year:Number(values.year),month:Number(values.month),day:Number(values.day),
    hour:Number(values.hour),minute:Number(values.minute),second:Number(values.second),
    weekday:weekdayMap[values.weekday] ?? 0,
    date_key:`${values.year}-${values.month}-${values.day}`
  };
}

function addDaysToDateKey(dateKey, days) {
  const [year,month,day] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return date.toISOString().slice(0,10);
}

async function localScheduleToUtc(dateKey, hour, timezone) {
  const row = await one(`
    SELECT (($1::date + ($2::int * interval '1 hour')) AT TIME ZONE $3)::timestamptz AS run_at
  `, [dateKey, Number(hour || 0), timezone]);
  return row?.run_at ? new Date(row.run_at).toISOString() : null;
}

async function nextAlarmReportSchedule(type, now = new Date()) {
  const timezone = alarmReportTimezone();
  const parts = zonedClockParts(now, timezone);
  if (type === 'daily') {
    if (!alarmReportDailyEnabled()) return null;
    const hour = alarmReportDailyHour();
    const dateKey = parts.hour < hour ? parts.date_key : addDaysToDateKey(parts.date_key, 1);
    return localScheduleToUtc(dateKey, hour, timezone);
  }
  if (!alarmReportWeeklyEnabled()) return null;
  const hour = alarmReportWeeklyHour();
  const targetDay = alarmReportWeeklyDay();
  let dayOffset = (targetDay - parts.weekday + 7) % 7;
  if (dayOffset === 0 && parts.hour >= hour) dayOffset = 7;
  return localScheduleToUtc(addDaysToDateKey(parts.date_key, dayOffset), hour, timezone);
}

async function alarmReportPeriod(type, now = new Date()) {
  const reportType = alarmReportType(type);
  const timezone = alarmReportTimezone();
  const localToday = zonedClockParts(now, timezone).date_key;
  const periodEndDate = localToday;
  const periodStartDate = addDaysToDateKey(periodEndDate, reportType === 'weekly' ? -7 : -1);
  const row = await one(`
    SELECT
      ($1::date::timestamp AT TIME ZONE $3)::timestamptz AS period_start,
      ($2::date::timestamp AT TIME ZONE $3)::timestamptz AS period_end
  `, [periodStartDate, periodEndDate, timezone]);
  return {
    report_type:reportType,
    timezone,
    local_start_date:periodStartDate,
    local_end_date:periodEndDate,
    period_start:new Date(row.period_start).toISOString(),
    period_end:new Date(row.period_end).toISOString(),
    label:reportType === 'weekly'
      ? `${periodStartDate} – ${addDaysToDateKey(periodEndDate, -1)}`
      : periodStartDate
  };
}

function reportNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

async function buildAlarmReport(type, now = new Date()) {
  await ensureAlarmEscalationFoundation();
  const period = await alarmReportPeriod(type, now);
  const params = [period.period_start, period.period_end];
  const [metricsResult, topTypesResult, topMachinesResult, criticalResult] = await Promise.all([
    one(`
      SELECT
        (SELECT count(*)::int FROM alarms WHERE started_at >= $1 AND started_at < $2) AS total_alarms,
        (SELECT count(*)::int FROM alarms WHERE started_at >= $1 AND started_at < $2 AND lower(severity)='critical') AS critical_count,
        (SELECT count(*)::int FROM alarms WHERE started_at >= $1 AND started_at < $2 AND lower(severity)='warning') AS warning_count,
        (SELECT count(*)::int FROM alarms WHERE started_at >= $1 AND started_at < $2 AND lower(severity)='info') AS info_count,
        (SELECT count(*)::int FROM alarms WHERE cleared_at >= $1 AND cleared_at < $2) AS cleared_count,
        (SELECT count(*)::int FROM alarms WHERE status='active') AS active_now,
        (SELECT count(*)::int FROM alarms WHERE started_at >= $1 AND started_at < $2 AND acknowledged_at IS NOT NULL) AS acknowledged_count,
        (SELECT round(avg(EXTRACT(EPOCH FROM (acknowledged_at-started_at))/60.0)::numeric,1) FROM alarms WHERE started_at >= $1 AND started_at < $2 AND acknowledged_at IS NOT NULL) AS avg_ack_minutes,
        (SELECT round(avg(EXTRACT(EPOCH FROM (cleared_at-started_at))/60.0)::numeric,1) FROM alarms WHERE started_at >= $1 AND started_at < $2 AND cleared_at IS NOT NULL) AS avg_resolve_minutes,
        (SELECT count(*)::int FROM alarm_escalation_events WHERE detected_at >= $1 AND detected_at < $2) AS escalation_count,
        (SELECT count(*)::int FROM alarm_escalation_events WHERE detected_at >= $1 AND detected_at < $2 AND delivery_status='delivered') AS escalation_delivered,
        (SELECT count(*)::int FROM alarm_escalation_events WHERE detected_at >= $1 AND detected_at < $2 AND delivery_status IN ('failed','dead_letter')) AS escalation_failed
    `, params),
    pool.query(`
      SELECT alarm_type, count(*)::int AS alarm_count,
             (count(*) FILTER (WHERE lower(severity)='critical'))::int AS critical_count
      FROM alarms
      WHERE started_at >= $1 AND started_at < $2
      GROUP BY alarm_type
      ORDER BY alarm_count DESC, critical_count DESC, alarm_type
      LIMIT 5
    `, params),
    pool.query(`
      SELECT COALESCE(m.name,m.code,'Atanmamış') AS machine_name,
             COALESCE(m.code,'-') AS machine_code,
             count(*)::int AS alarm_count,
             (count(*) FILTER (WHERE lower(a.severity)='critical'))::int AS critical_count
      FROM alarms a
      LEFT JOIN machines m ON m.id=a.machine_id
      WHERE a.started_at >= $1 AND a.started_at < $2
      GROUP BY m.id,m.name,m.code
      ORDER BY alarm_count DESC, critical_count DESC, machine_name
      LIMIT 5
    `, params),
    pool.query(`
      SELECT a.alarm_type,a.severity,a.status,a.started_at,a.cleared_at,a.message,
             COALESCE(m.name,m.code,'Atanmamış') AS machine_name,
             COALESCE(m.code,'-') AS machine_code
      FROM alarms a
      LEFT JOIN machines m ON m.id=a.machine_id
      WHERE a.started_at >= $1 AND a.started_at < $2 AND lower(a.severity)='critical'
      ORDER BY a.started_at DESC
      LIMIT 5
    `, params)
  ]);

  const raw = metricsResult || {};
  const metrics = {
    total_alarms:Number(raw.total_alarms || 0),
    critical_count:Number(raw.critical_count || 0),
    warning_count:Number(raw.warning_count || 0),
    info_count:Number(raw.info_count || 0),
    cleared_count:Number(raw.cleared_count || 0),
    active_now:Number(raw.active_now || 0),
    acknowledged_count:Number(raw.acknowledged_count || 0),
    avg_ack_minutes:reportNumber(raw.avg_ack_minutes),
    avg_resolve_minutes:reportNumber(raw.avg_resolve_minutes),
    escalation_count:Number(raw.escalation_count || 0),
    escalation_delivered:Number(raw.escalation_delivered || 0),
    escalation_failed:Number(raw.escalation_failed || 0)
  };

  return {
    report_type:period.report_type,
    title:period.report_type === 'weekly' ? 'Haftalık Alarm Raporu' : 'Günlük Alarm Raporu',
    generated_at:new Date().toISOString(),
    period,
    metrics,
    top_alarm_types:topTypesResult.rows,
    top_machines:topMachinesResult.rows,
    recent_critical:criticalResult.rows
  };
}

function alarmReportText(report) {
  const m = report.metrics || {};
  const typeLines = (report.top_alarm_types || []).map((row,index) => `${index+1}. ${row.alarm_type}: ${row.alarm_count}`).join('\n') || '-';
  const machineLines = (report.top_machines || []).map((row,index) => `${index+1}. ${row.machine_name}: ${row.alarm_count}`).join('\n') || '-';
  return [
    `FactoryBox ${report.title}`,
    `Dönem: ${report.period?.label || '-'}`,
    `Saat dilimi: ${report.period?.timezone || '-'}`,
    '',
    `Toplam alarm: ${m.total_alarms || 0}`,
    `Critical / Warning / Info: ${m.critical_count || 0} / ${m.warning_count || 0} / ${m.info_count || 0}`,
    `Temizlenen: ${m.cleared_count || 0}`,
    `Şu an aktif: ${m.active_now || 0}`,
    `Ort. acknowledge: ${m.avg_ack_minutes || 0} dk`,
    `Ort. çözüm: ${m.avg_resolve_minutes || 0} dk`,
    `SLA escalation: ${m.escalation_count || 0} (${m.escalation_delivered || 0} delivered / ${m.escalation_failed || 0} failed)`,
    '',
    'En sık alarm tipleri:',
    typeLines,
    '',
    'En yoğun makineler:',
    machineLines,
    '',
    `Oluşturulma: ${new Date(report.generated_at).toLocaleString('tr-TR')}`
  ].join('\n').slice(0, 4000);
}

function alarmReportEmailHtml(report) {
  const m = report.metrics || {};
  const rows = (report.top_alarm_types || []).map(row => `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${h(row.alarm_type)}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(row.alarm_count)}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(row.critical_count)}</td></tr>`).join('') || '<tr><td colspan="3" style="padding:10px;">Alarm kaydı yok.</td></tr>';
  const machineRows = (report.top_machines || []).map(row => `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;">${h(row.machine_name)} (${h(row.machine_code)})</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(row.alarm_count)}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(row.critical_count)}</td></tr>`).join('') || '<tr><td colspan="3" style="padding:10px;">Makine kaydı yok.</td></tr>';
  return emailShellHtml(`FactoryBox ${report.title}`, `
    <h1 style="margin:0 0 8px;color:#102033;">FactoryBox ${h(report.title)}</h1>
    <p style="margin:0 0 18px;color:#64748b;">Dönem: ${h(report.period?.label || '-')} · ${h(report.period?.timezone || '-')}</p>
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px 18px;">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;"><strong style="font-size:24px;">${h(m.total_alarms || 0)}</strong><br>Toplam alarm</td>
        <td style="background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:14px;"><strong style="font-size:24px;">${h(m.critical_count || 0)}</strong><br>Critical</td>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;"><strong style="font-size:24px;">${h(m.active_now || 0)}</strong><br>Şu an aktif</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Critical / Warning / Info</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(m.critical_count || 0)} / ${h(m.warning_count || 0)} / ${h(m.info_count || 0)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Temizlenen</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(m.cleared_count || 0)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Ortalama acknowledge</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(m.avg_ack_minutes || 0)} dk</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>Ortalama çözüm</strong></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${h(m.avg_resolve_minutes || 0)} dk</td></tr>
      <tr><td style="padding:8px;"><strong>SLA escalation</strong></td><td style="padding:8px;text-align:right;">${h(m.escalation_count || 0)} (${h(m.escalation_delivered || 0)} delivered / ${h(m.escalation_failed || 0)} failed)</td></tr>
    </table>
    <h2 style="font-size:18px;">En sık alarm tipleri</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><thead><tr><th style="text-align:left;padding:8px;background:#f1f5f9;">Alarm</th><th style="text-align:right;padding:8px;background:#f1f5f9;">Adet</th><th style="text-align:right;padding:8px;background:#f1f5f9;">Critical</th></tr></thead><tbody>${rows}</tbody></table>
    <h2 style="font-size:18px;">En yoğun makineler</h2>
    <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="text-align:left;padding:8px;background:#f1f5f9;">Makine</th><th style="text-align:right;padding:8px;background:#f1f5f9;">Adet</th><th style="text-align:right;padding:8px;background:#f1f5f9;">Critical</th></tr></thead><tbody>${machineRows}</tbody></table>
  `);
}

async function sendAlarmReportTelegram(report, targetValue = '') {
  const cfg = telegramEscalationConfig();
  if (!cfg.enabled) throw new Error('Telegram kanalı kapalı');
  if (!cfg.token) throw new Error('Telegram bot token ayarlanmamış');
  const chatIds = splitRecipientValues(targetValue || alarmReportTelegramChatIds() || cfg.defaultChatId);
  if (!chatIds.length) throw new Error('Telegram chat ID ayarlanmamış');
  const delivered = [];
  for (const chatId of chatIds) {
    const response = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:chatId,text:alarmReportText(report),disable_web_page_preview:true})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.description || `Telegram HTTP ${response.status}`);
    delivered.push({chat_id:chatId,message_id:payload.result?.message_id || null});
  }
  return {provider:'telegram',message_id:delivered.map(row => row.message_id).filter(Boolean).join(',') || null,delivered};
}

async function sendAlarmReportEmail(report, recipientValue = '') {
  const result = await sendReportEmail({
    to:recipientValue || alarmReportEmailRecipients(),
    subject:`FactoryBox ${report.title} - ${report.period?.label || ''}`,
    html:alarmReportEmailHtml(report),
    text:alarmReportText(report),
    purpose:'alarm_report',
    metadata:{report_type:report.report_type || report.title}
  });
  if (!result.sent) throw new Error(result.reason || 'Alarm raporu e-postası gönderilemedi');
  return {provider:'email',message_id:result.message_id || null,to:result.to || [],accepted:result.accepted || [],rejected:result.rejected || []};
}

async function deliverAlarmReport(report, options = {}) {
  const channels = Array.isArray(options.channels) && options.channels.length ? options.channels : alarmReportChannels();
  const results = [];
  const errors = [];
  for (const channel of channels) {
    try {
      if (channel === 'telegram') results.push(await sendAlarmReportTelegram(report, options.telegram_chat_ids));
      else if (channel === 'email') results.push(await sendAlarmReportEmail(report, options.email_recipients));
    } catch (error) {
      errors.push({channel,message:String(error.message || error)});
    }
  }
  if (!results.length) throw new Error(errors.map(row => `${row.channel}: ${row.message}`).join(' | ') || 'Aktif rapor kanalı bulunamadı');
  return {
    status:errors.length ? 'partial' : 'delivered',
    providers:results,
    errors,
    message_id:results.map(row => row.message_id).filter(Boolean).join(',') || null
  };
}

async function runAlarmReportDelivery({reportType = 'daily', trigger = 'manual', scheduled = false, now = new Date()} = {}) {
  await ensureNotificationSettingsFoundation();
  const type = alarmReportType(reportType);
  const period = await alarmReportPeriod(type, now);
  const reportKey = scheduled ? `scheduled-${type}-${period.local_end_date}` : `manual-${type}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const recipients = {telegram_chat_ids:alarmReportTelegramChatIds() || null,email_recipients:alarmReportEmailRecipients() || null};
  const inserted = await one(`
    INSERT INTO alarm_report_deliveries(
      report_key,report_type,trigger,period_start,period_end,timezone,channels,recipients,status,attempt_count
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'processing',1)
    ON CONFLICT(report_key) DO NOTHING
    RETURNING *
  `, [reportKey,type,trigger,period.period_start,period.period_end,period.timezone,alarmReportChannels().join(','),JSON.stringify(recipients)]);
  if (!inserted) return {status:'skipped',duplicate:true,report_key:reportKey,report_type:type,period};

  try {
    const report = await buildAlarmReport(type, now);
    const delivery = await deliverAlarmReport(report, recipients);
    const updated = await one(`
      UPDATE alarm_report_deliveries SET
        status=$2,summary=$3::jsonb,provider_message_id=$4,error_message=$5,
        finished_at=now(),delivered_at=now(),updated_at=now()
      WHERE id=$1
      RETURNING *
    `, [inserted.id,delivery.status,JSON.stringify(report),delivery.message_id,delivery.errors.length ? JSON.stringify(delivery.errors) : null]);
    return {status:delivery.status,duplicate:false,delivery_id:String(updated.id),report_key:reportKey,report,delivery};
  } catch (error) {
    await pool.query(`
      UPDATE alarm_report_deliveries SET status='failed',error_message=$2,finished_at=now(),updated_at=now()
      WHERE id=$1
    `, [inserted.id,String(error.message || error).slice(0,2000)]);
    error.alarm_report_delivery_id = String(inserted.id);
    throw error;
  }
}

async function runDueAlarmReports({trigger = 'auto-report-scheduler', now = new Date()} = {}) {
  if (!alarmReportSchedulerEnabled()) return {enabled:false,status:'disabled',results:[]};
  if (alarmReportSchedulerState.running) return {enabled:true,status:'skipped',reason:'already_running',results:[]};
  alarmReportSchedulerState.running = true;
  alarmReportSchedulerState.last_check_at = new Date().toISOString();
  const timezone = alarmReportTimezone();
  const parts = zonedClockParts(now, timezone);
  const due = [];
  if (alarmReportDailyEnabled() && parts.hour >= alarmReportDailyHour()) due.push('daily');
  if (alarmReportWeeklyEnabled() && parts.weekday === alarmReportWeeklyDay() && parts.hour >= alarmReportWeeklyHour()) due.push('weekly');
  const results = [];
  try {
    for (const type of due) {
      try {
        results.push(await runAlarmReportDelivery({reportType:type,trigger,scheduled:true,now}));
      } catch (error) {
        results.push({status:'failed',report_type:type,message:String(error.message || error),delivery_id:error.alarm_report_delivery_id || null});
      }
    }
    const result = {enabled:true,status:'completed',timezone,due,results,checked_at:new Date().toISOString()};
    alarmReportSchedulerState.last_result = result;
    return result;
  } finally {
    alarmReportSchedulerState.running = false;
  }
}

async function alarmReportSettingsSnapshot(actor = null) {
  await ensureNotificationSettingsFoundation();
  const [dailyNext, weeklyNext, historyResult, counts] = await Promise.all([
    nextAlarmReportSchedule('daily'),
    nextAlarmReportSchedule('weekly'),
    pool.query(`
      SELECT id::text,report_key,report_type,trigger,period_start,period_end,timezone,channels,
             recipients,status,attempt_count,provider_message_id,error_message,started_at,finished_at,delivered_at,created_at,summary
      FROM alarm_report_deliveries
      ORDER BY created_at DESC
      LIMIT 30
    `),
    one(`
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE status='delivered'))::int AS delivered,
             (count(*) FILTER (WHERE status='partial'))::int AS partial,
             (count(*) FILTER (WHERE status='failed'))::int AS failed
      FROM alarm_report_deliveries
    `)
  ]);
  const telegram = telegramEscalationConfig();
  const email = emailConfig();
  return {
    can_manage:!authConfig().enabled || hasPermission(actor,'MANAGE_SITES'),
    scheduler:{
      enabled:alarmReportSchedulerEnabled(),
      check_interval_sec:60,
      timezone:alarmReportTimezone(),
      channels:alarmReportChannels(),
      telegram_chat_ids:alarmReportTelegramChatIds(),
      email_recipients:alarmReportEmailRecipients(),
      daily:{enabled:alarmReportDailyEnabled(),hour:alarmReportDailyHour(),next_run_at:dailyNext},
      weekly:{enabled:alarmReportWeeklyEnabled(),day:alarmReportWeeklyDay(),day_name:alarmReportWeekdayName(alarmReportWeeklyDay()),hour:alarmReportWeeklyHour(),next_run_at:weeklyNext},
      state:alarmReportSchedulerState
    },
    channel_readiness:{
      telegram:{enabled:telegram.enabled,configured:telegram.configured,target_configured:Boolean(alarmReportTelegramChatIds() || telegram.defaultChatId)},
      email:{enabled:email.enabled,configured:email.configured,target_configured:Boolean(alarmReportEmailRecipients() || email.defaultTo)}
    },
    summary:counts || {total:0,delivered:0,partial:0,failed:0},
    history:historyResult.rows,
    latest_report:historyResult.rows.find(row => row.summary && Object.keys(row.summary).length) || null,
    updated_at:notificationRuntimeSettings.updated_at || null,
    updated_by:notificationRuntimeSettings.updated_by || null
  };
}

app.get('/api/admin/alarm-reports', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    const snapshot = await alarmReportSettingsSnapshot(req.user || getSession(req)?.user || null);
    res.json({status:'ok',version:APP_VERSION,...snapshot});
  } catch (e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});

app.patch('/api/admin/alarm-reports/settings', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureNotificationSettingsFoundation();
    const body = req.body || {};
    const current = notificationRuntimeSettings || {};
    const rawChannels = Array.isArray(body.channels) ? body.channels.join(',') : String(body.channels || current.alarm_report_channels || 'telegram');
    const channels = [...new Set(rawChannels.toLowerCase().split(/[,+]/).map(value => value.trim()).filter(value => ['telegram','email'].includes(value)))];
    if (!channels.length) throw new Error('En az bir kanal seçilmelidir: telegram veya email');
    const requestedTimezone = notificationTextInput(body.timezone,current.alarm_report_timezone || 'Europe/Istanbul',100);
    const timezone = validateAlarmReportTimezone(requestedTimezone);
    if (timezone !== requestedTimezone) throw new Error('Geçersiz saat dilimi. Örnek: Europe/Istanbul');
    const next = {
      scheduler_enabled:notificationBoolInput(body.scheduler_enabled,current.alarm_report_scheduler_enabled),
      timezone,
      channels:channels.join(','),
      telegram_chat_ids:notificationTextInput(body.telegram_chat_ids,current.alarm_report_telegram_chat_ids || '',1000),
      email_recipients:notificationTextInput(body.email_recipients,current.alarm_report_email_recipients || '',2000),
      daily_enabled:notificationBoolInput(body.daily_enabled,current.alarm_report_daily_enabled),
      daily_hour:notificationIntInput(body.daily_hour,current.alarm_report_daily_hour,0,23),
      weekly_enabled:notificationBoolInput(body.weekly_enabled,current.alarm_report_weekly_enabled),
      weekly_day:notificationIntInput(body.weekly_day,current.alarm_report_weekly_day,0,6),
      weekly_hour:notificationIntInput(body.weekly_hour,current.alarm_report_weekly_hour,0,23)
    };
    const before = await alarmReportSettingsSnapshot(req.user || null);
    const actorEmail = req.user?.email || getSession(req)?.user?.email || 'system';
    await pool.query(`
      UPDATE notification_settings SET
        alarm_report_scheduler_enabled=$1,alarm_report_timezone=$2,alarm_report_channels=$3,
        alarm_report_telegram_chat_ids=$4,alarm_report_email_recipients=$5,
        alarm_report_daily_enabled=$6,alarm_report_daily_hour=$7,
        alarm_report_weekly_enabled=$8,alarm_report_weekly_day=$9,alarm_report_weekly_hour=$10,
        updated_by=$11,updated_at=now()
      WHERE id=1
    `, [next.scheduler_enabled,next.timezone,next.channels,next.telegram_chat_ids,next.email_recipients,next.daily_enabled,next.daily_hour,next.weekly_enabled,next.weekly_day,next.weekly_hour,actorEmail]);
    await loadNotificationRuntimeSettings();
    restartAlarmReportScheduler();
    const snapshot = await alarmReportSettingsSnapshot(req.user || null);
    await writeAuditLog(req,{action:'update_alarm_report_settings',entity_type:'alarm_report_settings',entity_id:'global',old_values:{scheduler:before.scheduler},new_values:{scheduler:snapshot.scheduler}});
    res.json({status:'ok',version:APP_VERSION,...snapshot});
  } catch (e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message});
  }
});

app.post('/api/admin/alarm-reports/run-now', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    const reportType = alarmReportType(req.body?.report_type);
    const result = await runAlarmReportDelivery({reportType,trigger:'admin-panel',scheduled:false});
    await writeAuditLog(req,{action:'run_alarm_report_now',entity_type:'alarm_report_delivery',entity_id:result.delivery_id || result.report_key,old_values:null,new_values:{report_type:reportType,status:result.status,provider_message_id:result.delivery?.message_id || null}});
    res.json({status:'ok',version:APP_VERSION,...result});
  } catch (e) {
    res.status(500).json({status:'error',version:APP_VERSION,message:e.message,delivery_id:e.alarm_report_delivery_id || null});
  }
});

app.get('/api/admin/notification-settings', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    const actor = req.user || getSession(req)?.user || null;
    const snapshot = await notificationSettingsSnapshot(actor);
    res.json({status:'ok', version:APP_VERSION, ...snapshot});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.patch('/api/admin/notification-settings', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureNotificationSettingsFoundation();
    const current = notificationRuntimeSettings || {};
    const body = req.body || {};
    const gatewayLocked = environmentMailGatewayEnforced();
    const next = {
      delivery_enabled:notificationBoolInput(body.delivery_enabled, current.delivery_enabled),
      auto_delivery_enabled:notificationBoolInput(body.auto_delivery_enabled, current.auto_delivery_enabled),
      interval_sec:notificationIntInput(body.interval_sec, current.interval_sec, 15, 3600),
      batch_size:notificationIntInput(body.batch_size, current.batch_size, 1, 100),
      telegram_enabled:notificationBoolInput(body.telegram_enabled, current.telegram_enabled),
      telegram_bot_token:notificationSecretInput(body.telegram_bot_token, current.telegram_bot_token),
      telegram_chat_id:notificationSecretInput(body.telegram_chat_id, current.telegram_chat_id),
      email_enabled:notificationBoolInput(body.email_enabled, current.email_enabled),
      email_mode:gatewayLocked ? 'gateway' : notificationEmailModeInput(body.email_mode, current.email_mode),
      email_sender_name:gatewayLocked ? String(process.env.FACTORYBOX_MAIL_SENDER_NAME || 'HukaTech').trim().slice(0,200) : notificationTextInput(body.email_sender_name, current.email_sender_name, 200),
      mail_gateway_url:gatewayLocked ? '' : notificationTextInput(body.mail_gateway_url, current.mail_gateway_url, 1000),
      mail_gateway_installation_id:gatewayLocked ? '' : notificationTextInput(body.mail_gateway_installation_id, current.mail_gateway_installation_id, 200),
      mail_gateway_api_key:gatewayLocked ? '' : notificationSecretInput(body.mail_gateway_api_key, current.mail_gateway_api_key),
      mail_gateway_allow_smtp_fallback:gatewayLocked ? false : notificationBoolInput(body.mail_gateway_allow_smtp_fallback, current.mail_gateway_allow_smtp_fallback),
      smtp_host:gatewayLocked ? '' : notificationTextInput(body.smtp_host, current.smtp_host, 500),
      smtp_port:gatewayLocked ? 587 : notificationIntInput(body.smtp_port, current.smtp_port, 1, 65535),
      smtp_secure:gatewayLocked ? false : notificationBoolInput(body.smtp_secure, current.smtp_secure),
      smtp_user:gatewayLocked ? '' : notificationTextInput(body.smtp_user, current.smtp_user, 500),
      smtp_pass:gatewayLocked ? '' : notificationSecretInput(body.smtp_pass, current.smtp_pass),
      smtp_from:gatewayLocked ? '' : notificationTextInput(body.smtp_from, current.smtp_from, 500),
      email_default_to:notificationTextInput(body.email_default_to, current.email_default_to, 2000)
    };
    const actorEmail = req.user?.email || getSession(req)?.user?.email || 'system';
    const oldSnapshot = await notificationSettingsSnapshot(req.user || null);
    await pool.query(`
      UPDATE notification_settings SET
        delivery_enabled=$1, auto_delivery_enabled=$2, interval_sec=$3, batch_size=$4,
        telegram_enabled=$5, telegram_bot_token=$6, telegram_chat_id=$7,
        email_enabled=$8, email_mode=$9, email_sender_name=$10,
        mail_gateway_url=$11, mail_gateway_installation_id=$12, mail_gateway_api_key=$13,
        mail_gateway_allow_smtp_fallback=$14,
        smtp_host=$15, smtp_port=$16, smtp_secure=$17,
        smtp_user=$18, smtp_pass=$19, smtp_from=$20, email_default_to=$21,
        updated_by=$22, updated_at=now()
      WHERE id=1
    `, [
      next.delivery_enabled,next.auto_delivery_enabled,next.interval_sec,next.batch_size,
      next.telegram_enabled,next.telegram_bot_token,next.telegram_chat_id,
      next.email_enabled,next.email_mode,next.email_sender_name,
      next.mail_gateway_url,next.mail_gateway_installation_id,next.mail_gateway_api_key,
      next.mail_gateway_allow_smtp_fallback,
      next.smtp_host,next.smtp_port,next.smtp_secure,
      next.smtp_user,next.smtp_pass,next.smtp_from,next.email_default_to,actorEmail
    ]);
    await loadNotificationRuntimeSettings();
    restartAlarmEscalationDeliveryWorker();
    restartAlarmAutomationScheduler();
    const snapshot = await notificationSettingsSnapshot(req.user || null);
    await writeAuditLog(req, {
      action:'update_notification_settings',
      entity_type:'notification_settings',
      entity_id:'global',
      old_values:{delivery:oldSnapshot.delivery,telegram:{enabled:oldSnapshot.telegram.enabled,configured:oldSnapshot.telegram.configured},email:{enabled:oldSnapshot.email.enabled,configured:oldSnapshot.email.configured,mode:oldSnapshot.email.mode}},
      new_values:{delivery:snapshot.delivery,telegram:{enabled:snapshot.telegram.enabled,configured:snapshot.telegram.configured},email:{enabled:snapshot.email.enabled,configured:snapshot.email.configured,mode:snapshot.email.mode}},
      metadata:{secrets_changed:Boolean(body.telegram_bot_token || body.smtp_pass || body.mail_gateway_api_key)}
    });
    res.json({status:'ok', version:APP_VERSION, ...snapshot});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/notification-settings/test-telegram', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  const actorEmail = req.user?.email || getSession(req)?.user?.email || 'system';
  const cfg = telegramEscalationConfig();
  const target = notificationTextInput(req.body?.chat_id, cfg.defaultChatId, 500);
  try {
    if (!cfg.enabled) throw new Error('Telegram channel is disabled');
    if (!cfg.token) throw new Error('Telegram bot token is not configured');
    if (!target) throw new Error('Telegram chat id is not configured');
    const response = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        chat_id:target,
        text:`FactoryBox v${APP_VERSION} test mesajı\n\nTelegram bildirim kanalı hazır ve çalışıyor.`,
        disable_web_page_preview:true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.description || `Telegram HTTP ${response.status}`);
    const messageId = payload.result?.message_id ? String(payload.result.message_id) : null;
    const test = await recordNotificationTest({channel:'telegram',status:'delivered',target,providerMessageId:messageId,actorEmail});
    await writeAuditLog(req, {action:'test_telegram_notification',entity_type:'notification_channel',entity_id:'telegram',old_values:null,new_values:{status:'delivered',message_id:messageId},metadata:{target:maskNotificationValue(target)}});
    res.json({status:'ok',version:APP_VERSION,sent:true,message_id:messageId,test});
  } catch(e) {
    const message = String(e.message || e).slice(0,500);
    const test = await recordNotificationTest({channel:'telegram',status:'failed',target,errorMessage:message,actorEmail});
    res.status(500).json({status:'error',version:APP_VERSION,sent:false,message,test});
  }
});

app.post('/api/admin/notification-settings/test-email', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  const actorEmail = req.user?.email || getSession(req)?.user?.email || 'system';
  const cfg = emailConfig();
  const target = notificationTextInput(req.body?.to, cfg.defaultTo, 2000);
  try {
    const result = await sendReportEmail({
      to:target,
      subject:`FactoryBox v${APP_VERSION} Email Test`,
      html:emailShellHtml('FactoryBox Email Test', `<h1 style="margin:0 0 12px;color:#102033;">Bildirim kanalı hazır</h1><p>FactoryBox v${APP_VERSION} test e-postası başarıyla gönderildi.</p>`),
      text:`FactoryBox v${APP_VERSION} test e-postası. Email bildirim kanalı hazır ve çalışıyor.`,
      purpose:'test',
      metadata:{customer_code:CFG.customerCode,site_code:CFG.siteCode}
    });
    if (!result.sent) throw new Error(result.reason || 'Email could not be sent');
    const test = await recordNotificationTest({channel:'email',status:'delivered',target,providerMessageId:result.message_id,actorEmail});
    await writeAuditLog(req, {action:'test_email_notification',entity_type:'notification_channel',entity_id:'email',old_values:null,new_values:{status:'delivered',message_id:result.message_id},metadata:{target:maskNotificationValue(target)}});
    res.json({status:'ok',version:APP_VERSION,sent:true,email:result,test});
  } catch(e) {
    const message = String(e.message || e).slice(0,500);
    const test = await recordNotificationTest({channel:'email',status:'failed',target,errorMessage:message,actorEmail});
    res.status(500).json({status:'error',version:APP_VERSION,sent:false,message,test});
  }
});

app.get('/api/admin/alarm-escalation/delivery-status', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();
    const email = emailConfig();
    const telegram = telegramEscalationConfig();
    const queue = await one(`
      SELECT
        count(*) FILTER (WHERE delivery_status='pending')::int AS pending,
        count(*) FILTER (WHERE delivery_status='processing')::int AS processing,
        count(*) FILTER (WHERE delivery_status='failed')::int AS failed,
        count(*) FILTER (WHERE delivery_status='dead_letter')::int AS dead_letter,
        count(*) FILTER (WHERE delivery_status='delivered')::int AS delivered
      FROM alarm_escalation_events
    `);
    const actor = req.user || getSession(req)?.user || null;
    res.json({
      status:'ok',
      version:APP_VERSION,
      delivery_enabled:alarmEscalationDeliveryEnabled(),
      auto_delivery_enabled:alarmEscalationAutoDeliveryEnabled(),
      interval_sec:alarmEscalationDeliveryIntervalSec(),
      batch_size:alarmEscalationDeliveryBatchSize(),
      can_deliver:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
      email:{enabled:email.enabled, configured:email.configured, default_to:Boolean(email.defaultTo)},
      telegram:{enabled:telegram.enabled, configured:telegram.configured, default_chat_id:Boolean(telegram.defaultChatId)},
      queue:queue || {}
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/alarm-escalation/deliver', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    const result = await processAlarmEscalationDeliveries({
      limit:req.body?.limit,
      eventId:req.body?.event_id || null,
      trigger:'admin-panel'
    });
    await writeAuditLog(req, {
      action:'deliver_alarm_escalations',
      entity_type:'alarm_escalation_delivery',
      entity_id:req.body?.event_id ? String(req.body.event_id) : 'batch',
      old_values:null,
      new_values:{claimed_count:result.claimed_count, delivered_count:result.delivered_count, failed_count:result.failed_count},
      metadata:{delivery_enabled:result.enabled}
    });
    res.json({status:'ok', version:APP_VERSION, ...result});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/alarm-escalation', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    const snapshot = await loadAlarmEscalationSnapshot();
    const actor = req.user || getSession(req)?.user || null;
    res.json({
      status:'ok',
      version:APP_VERSION,
      alarm_escalation_enabled:alarmEscalationEnabled(),
      can_manage_rules:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
      generated_at:new Date().toISOString(),
      summary:snapshot.summary,
      rules:snapshot.rules,
      active_alarms:snapshot.activeAlarms
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.get('/api/admin/alarm-escalation/events', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();
    const limit = escalationEventLimit(req.query.limit, 100, 500);
    const status = escalationEventStatus(req.query.status);
    const stage = escalationEventStage(req.query.stage);
    const where = [];
    const params = [];

    if (status !== 'all') {
      params.push(status);
      where.push(`e.delivery_status=$${params.length}`);
    }
    if (stage !== 'all') {
      params.push(stage);
      where.push(`e.stage=$${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit);

    const result = await pool.query(`
      SELECT
        e.id::text,
        e.event_key,
        e.alarm_id::text,
        e.rule_id::text,
        e.stage,
        e.severity,
        e.channel,
        e.recipients,
        e.delivery_status,
        e.message,
        e.attempt_count,
        e.detected_at,
        e.last_attempt_at,
        e.next_attempt_at,
        e.delivered_at,
        e.failed_at,
        e.dead_letter_at,
        e.provider_message_id,
        e.last_error,
        e.delivery_metadata,
        e.created_at,
        e.updated_at,
        a.alarm_type,
        a.status AS alarm_status,
        a.started_at AS alarm_started_at,
        m.code AS machine_code,
        m.name AS machine_name,
        r.name AS rule_name
      FROM alarm_escalation_events e
      JOIN alarms a ON a.id=e.alarm_id
      LEFT JOIN machines m ON m.id=a.machine_id
      LEFT JOIN alarm_escalation_rules r ON r.id=e.rule_id
      ${whereSql}
      ORDER BY e.created_at DESC
      LIMIT $${params.length}
    `, params);

    const summary = await one(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE delivery_status='pending')::int AS pending,
        count(*) FILTER (WHERE delivery_status='processing')::int AS processing,
        count(*) FILTER (WHERE delivery_status='delivered')::int AS delivered,
        count(*) FILTER (WHERE delivery_status='failed')::int AS failed,
        count(*) FILTER (WHERE delivery_status='dead_letter')::int AS dead_letter,
        count(*) FILTER (WHERE delivery_status='suppressed')::int AS suppressed,
        count(*) FILTER (WHERE stage='ack_overdue')::int AS ack_overdue,
        count(*) FILTER (WHERE stage='resolve_overdue')::int AS resolve_overdue
      FROM alarm_escalation_events
    `);

    const actor = req.user || getSession(req)?.user || null;
    res.json({
      status:'ok',
      version:APP_VERSION,
      alarm_escalation_queue_enabled:alarmEscalationQueueEnabled(),
      can_manage_events:!authConfig().enabled || hasPermission(actor, 'MANAGE_SITES'),
      generated_at:new Date().toISOString(),
      filters:{status, stage, limit},
      summary:summary || {},
      events:result.rows
    });
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.post('/api/admin/alarm-escalation/scan', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    if (!alarmEscalationQueueEnabled()) {
      return res.status(503).json({status:'disabled', version:APP_VERSION, message:'Alarm escalation queue is disabled'});
    }
    const result = await scanAlarmEscalationsToQueue({trigger:'admin-panel'});
    await writeAuditLog(req, {
      action:'scan_alarm_escalations',
      entity_type:'alarm_escalation_queue',
      entity_id:'manual-scan',
      old_values:null,
      new_values:{overdue_count:result.overdue_count, created_count:result.created_count},
      metadata:{duplicate_count:result.duplicate_count}
    });
    res.json({status:'ok',version:APP_VERSION,...result});
  } catch(e) {
    res.status(500).json({status:'error', version:APP_VERSION, message:e.message});
  }
});

app.patch('/api/admin/alarm-escalation/events/:id/status', adminRequired, permissionRequired('MANAGE_SITES'), async (req,res)=>{
  try {
    await ensureAlarmEscalationFoundation();
    const id = String(req.params.id || '').trim();
    const status = escalationEventStatus(req.body?.status);
    if (status === 'all') {
      return res.status(400).json({status:'invalid_request', message:'Valid delivery status is required'});
    }
    const oldEvent = await one(`SELECT * FROM alarm_escalation_events WHERE id=$1`, [id]);
    if (!oldEvent) return res.status(404).json({status:'not_found', message:'Escalation event not found'});

    const errorText = String(req.body?.last_error || '').trim().slice(0, 500) || null;
    const updated = await one(`
      UPDATE alarm_escalation_events
      SET delivery_status=$2,
          delivered_at=CASE WHEN $2='delivered' THEN COALESCE(delivered_at,now()) ELSE NULL END,
          failed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END,
          dead_letter_at=CASE WHEN $2='dead_letter' THEN COALESCE(dead_letter_at,now()) ELSE NULL END,
          last_error=CASE WHEN $2 IN ('failed','dead_letter') THEN $3 ELSE NULL END,
          attempt_count=CASE WHEN $2='pending' THEN 0 ELSE attempt_count END,
          next_attempt_at=CASE WHEN $2='pending' THEN now() ELSE NULL END,
          updated_at=now()
      WHERE id=$1
      RETURNING *
    `, [id, status, errorText]);

    await writeAuditLog(req, {
      action:'update_alarm_escalation_event_status',
      entity_type:'alarm_escalation_event',
      entity_id:id,
      old_values:oldEvent,
      new_values:updated,
      metadata:{from_status:oldEvent.delivery_status, to_status:status}
    });

    res.json({status:'ok', version:APP_VERSION, event:updated});
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





// -----------------------------------------------------------------------------
// v6.4 Multi-Site / Multi-Factory Management
// -----------------------------------------------------------------------------
const ORGANIZATION_STATUSES=['active','pilot','trial','inactive','passive','suspended','archived'];
const ORGANIZATION_ACCESS_ROLES=['viewer','operator','admin','owner'];

function organizationTimezone(value) {
  const timezone=String(value||'Europe/Istanbul').trim()||'Europe/Istanbul';
  try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(new Date()); return timezone; }
  catch { const e=new Error('Invalid timezone');e.statusCode=400;throw e; }
}

function organizationCode(value,label='code') { return normalizeAssetCode(value,label); }
function organizationName(value,label='name') { return cleanAssetName(value,label); }
function organizationStatus(value,fallback='active') { return validateChoice(value||fallback,ORGANIZATION_STATUSES,'status'); }

async function organizationBackfillHierarchy() {
  await pool.query(`
    INSERT INTO factories(customer_id,code,name,location,country,timezone,status,metadata)
    SELECT c.id,'main',c.name||' Ana Fabrika',NULL,'Türkiye','Europe/Istanbul',
      CASE WHEN c.status IN ('active','pilot','trial') THEN 'active' ELSE 'inactive' END,
      jsonb_build_object('auto_created',true,'migration_version','6.4.0')
    FROM customers c
    ON CONFLICT(customer_id,code) DO NOTHING
  `);
  await pool.query(`UPDATE sites s SET factory_id=f.id,timezone=COALESCE(NULLIF(s.timezone,''),'Europe/Istanbul') FROM factories f WHERE s.customer_id=f.customer_id AND f.code='main' AND s.factory_id IS NULL`);
  await pool.query(`
    INSERT INTO production_lines(site_id,code,name,description,status,shift_pattern)
    SELECT s.id,'general','Genel Üretim Hattı','v6.4 otomatik oluşturulan varsayılan hat','active','{}'::jsonb
    FROM sites s ON CONFLICT(site_id,code) DO NOTHING
  `);
  await pool.query(`UPDATE machines m SET production_line_id=pl.id FROM production_lines pl WHERE pl.site_id=m.site_id AND pl.code='general' AND m.production_line_id IS NULL`);
}

async function ensureOrganizationFoundation() {
  if (organizationFoundationReady) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS factories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      location text,
      country text NOT NULL DEFAULT 'Türkiye',
      timezone text NOT NULL DEFAULT 'Europe/Istanbul',
      status text NOT NULL DEFAULT 'active',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(customer_id,code)
    )
  `);
  await pool.query(`
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS factory_id uuid REFERENCES factories(id) ON DELETE SET NULL;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Istanbul';
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS address text;
    ALTER TABLE sites ADD COLUMN IF NOT EXISTS workweek_start smallint NOT NULL DEFAULT 1;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS production_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      code text NOT NULL,
      name text NOT NULL,
      description text,
      status text NOT NULL DEFAULT 'active',
      shift_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(site_id,code)
    )
  `);
  await pool.query(`ALTER TABLE machines ADD COLUMN IF NOT EXISTS production_line_id uuid REFERENCES production_lines(id) ON DELETE SET NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_location_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      factory_id uuid REFERENCES factories(id) ON DELETE CASCADE,
      site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
      production_line_id uuid REFERENCES production_lines(id) ON DELETE CASCADE,
      access_role text NOT NULL DEFAULT 'viewer',
      status text NOT NULL DEFAULT 'active',
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user_location_policy (
      user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT true,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_location_access_scope ON app_user_location_access(user_id,customer_id,COALESCE(factory_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(site_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(production_line_id,'00000000-0000-0000-0000-000000000000'::uuid))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_factories_customer_status ON factories(customer_id,status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sites_factory_status ON sites(factory_id,status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_production_lines_site_status ON production_lines(site_id,status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_machines_production_line ON machines(production_line_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_location_access_user ON app_user_location_access(user_id,status)`);

  // Backward-compatible migration and continuous backfill for assets created through older screens.
  await organizationBackfillHierarchy();
  organizationFoundationReady=true;
}

function organizationAllowedCustomerCodes(req) {
  if (!authConfig().enabled || req.user?.role==='system_admin') return null;
  if (req.tenant?.access_denied) return [];
  return [...new Set((req.tenant?.customers||[]).map(row=>String(row.code||'').trim()).filter(Boolean))];
}

async function organizationAssertCustomer(req,requestedCode) {
  const code=organizationCode(requestedCode||req.tenant?.current_customer?.code||CFG.customerCode,'customer code');
  const allowed=organizationAllowedCustomerCodes(req);
  if (allowed && !allowed.includes(code)) {const e=new Error('User does not have access to this company');e.statusCode=403;throw e;}
  const customer=await one(`SELECT id::text,code,name,status FROM customers WHERE code=$1 LIMIT 1`,[code]);
  if(!customer){const e=new Error('Company not found');e.statusCode=404;throw e;}
  return customer;
}

async function organizationAccessRowsForRequest(req,customerId) {
  if (!authConfig().enabled || req.user?.role==='system_admin') return [];
  return (await pool.query(`SELECT factory_id::text,site_id::text,production_line_id::text FROM app_user_location_access WHERE user_id=$1 AND customer_id=$2 AND status='active'`,[req.user.id,customerId])).rows;
}

function organizationScopeFilter(rows) {
  if (!rows.length) return {restricted:false,factories:new Set(),sites:new Set(),lines:new Set()};
  const scope={restricted:true,factories:new Set(),sites:new Set(),lines:new Set(),customerWide:false};
  for(const row of rows){
    if(!row.factory_id&&!row.site_id&&!row.production_line_id)scope.customerWide=true;
    if(row.factory_id)scope.factories.add(String(row.factory_id));
    if(row.site_id)scope.sites.add(String(row.site_id));
    if(row.production_line_id)scope.lines.add(String(row.production_line_id));
  }
  return scope;
}

async function organizationHierarchySnapshot(req,customerCode) {
  await ensureOrganizationFoundation();
  await organizationBackfillHierarchy();
  const customer=await organizationAssertCustomer(req,customerCode);
  const accessScope=organizationScopeFilter(await organizationAccessRowsForRequest(req,customer.id));
  const factories=(await pool.query(`
    SELECT f.id::text,f.code,f.name,f.location,f.country,f.timezone,f.status,f.metadata,f.created_at,f.updated_at,
      count(DISTINCT s.id)::int AS site_count,count(DISTINCT pl.id)::int AS line_count,count(DISTINCT m.id)::int AS machine_count,count(DISTINCT d.id)::int AS device_count
    FROM factories f LEFT JOIN sites s ON s.factory_id=f.id LEFT JOIN production_lines pl ON pl.site_id=s.id LEFT JOIN machines m ON m.site_id=s.id LEFT JOIN devices d ON d.machine_id=m.id
    WHERE f.customer_id=$1 GROUP BY f.id ORDER BY f.name
  `,[customer.id])).rows;
  const sites=(await pool.query(`
    SELECT s.id::text,s.factory_id::text,s.code,s.name,s.location,s.address,s.timezone,s.workweek_start,s.status,s.created_at,s.updated_at,
      count(DISTINCT pl.id)::int AS line_count,count(DISTINCT m.id)::int AS machine_count,count(DISTINCT d.id)::int AS device_count
    FROM sites s LEFT JOIN production_lines pl ON pl.site_id=s.id LEFT JOIN machines m ON m.site_id=s.id LEFT JOIN devices d ON d.machine_id=m.id
    WHERE s.customer_id=$1 GROUP BY s.id ORDER BY s.name
  `,[customer.id])).rows;
  const lines=(await pool.query(`
    SELECT pl.id::text,pl.site_id::text,pl.code,pl.name,pl.description,pl.status,pl.shift_pattern,pl.created_at,pl.updated_at,
      count(DISTINCT m.id)::int AS machine_count,count(DISTINCT d.id)::int AS device_count
    FROM production_lines pl JOIN sites s ON s.id=pl.site_id LEFT JOIN machines m ON m.production_line_id=pl.id LEFT JOIN devices d ON d.machine_id=m.id
    WHERE s.customer_id=$1 GROUP BY pl.id ORDER BY pl.name
  `,[customer.id])).rows;
  const machines=(await pool.query(`
    SELECT m.id::text,m.site_id::text,m.production_line_id::text,m.code,m.name,m.machine_type,m.status,m.created_at,m.updated_at,
      count(DISTINCT d.id)::int AS device_count,count(DISTINCT d.id) FILTER(WHERE d.status='online')::int AS online_device_count
    FROM machines m JOIN sites s ON s.id=m.site_id LEFT JOIN devices d ON d.machine_id=m.id WHERE s.customer_id=$1
    GROUP BY m.id ORDER BY m.name
  `,[customer.id])).rows;
  if (accessScope.restricted&&!accessScope.customerWide) {
    const allowedSiteIds=new Set(accessScope.sites);const allowedLineIds=new Set(accessScope.lines);const allowedFactoryIds=new Set(accessScope.factories);
    for(const line of lines)if(allowedLineIds.has(line.id))allowedSiteIds.add(line.site_id);
    for(const site of sites)if(allowedFactoryIds.has(site.factory_id))allowedSiteIds.add(site.id);
    const filteredSites=sites.filter(site=>allowedSiteIds.has(site.id));const filteredSiteIds=new Set(filteredSites.map(x=>x.id));
    const filteredLines=lines.filter(line=>filteredSiteIds.has(line.site_id)&&(allowedLineIds.size===0||allowedLineIds.has(line.id)||accessScope.factories.has(sites.find(s=>s.id===line.site_id)?.factory_id)||accessScope.sites.has(line.site_id)));
    const filteredLineIds=new Set(filteredLines.map(x=>x.id));
    const filteredMachines=machines.filter(machine=>filteredSiteIds.has(machine.site_id)&&(!machine.production_line_id||filteredLineIds.has(machine.production_line_id)||accessScope.sites.has(machine.site_id)||accessScope.factories.has(sites.find(s=>s.id===machine.site_id)?.factory_id)));
    const filteredFactoryIds=new Set(filteredSites.map(x=>x.factory_id));
    return {customer,factories:factories.filter(x=>filteredFactoryIds.has(x.id)),sites:filteredSites,lines:filteredLines,machines:filteredMachines,scope_restricted:true};
  }
  return {customer,factories,sites,lines,machines,scope_restricted:false};
}

function nestOrganizationHierarchy(snapshot) {
  const machinesByLine=new Map(),machinesWithoutLineBySite=new Map(),linesBySite=new Map(),sitesByFactory=new Map();
  for(const m of snapshot.machines){if(m.production_line_id){if(!machinesByLine.has(m.production_line_id))machinesByLine.set(m.production_line_id,[]);machinesByLine.get(m.production_line_id).push(m);}else{if(!machinesWithoutLineBySite.has(m.site_id))machinesWithoutLineBySite.set(m.site_id,[]);machinesWithoutLineBySite.get(m.site_id).push(m);}}
  for(const line of snapshot.lines){if(!linesBySite.has(line.site_id))linesBySite.set(line.site_id,[]);linesBySite.get(line.site_id).push({...line,machines:machinesByLine.get(line.id)||[]});}
  for(const site of snapshot.sites){if(!sitesByFactory.has(site.factory_id))sitesByFactory.set(site.factory_id,[]);sitesByFactory.get(site.factory_id).push({...site,production_lines:linesBySite.get(site.id)||[],unassigned_machines:machinesWithoutLineBySite.get(site.id)||[]});}
  return snapshot.factories.map(factory=>({...factory,sites:sitesByFactory.get(factory.id)||[]}));
}

app.get('/api/admin/organization/hierarchy',adminRequired,async(req,res)=>{
  try{
    const snapshot=await organizationHierarchySnapshot(req,req.query.customer_code);
    const allowed=organizationAllowedCustomerCodes(req);const params=[];let where='';
    if(allowed){params.push(allowed);where='WHERE code=ANY($1::text[])';}
    const companies=(await pool.query(`SELECT id::text,code,name,status FROM customers ${where} ORDER BY name`,params)).rows;
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),customer:snapshot.customer,companies,scope_restricted:snapshot.scope_restricted,summary:{factories:snapshot.factories.length,sites:snapshot.sites.length,production_lines:snapshot.lines.length,machines:snapshot.machines.length,devices:snapshot.machines.reduce((n,x)=>n+Number(x.device_count||0),0)},factories:nestOrganizationHierarchy(snapshot),flat:{factories:snapshot.factories,sites:snapshot.sites,production_lines:snapshot.lines,machines:snapshot.machines}});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/organization/factories',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const customer=await organizationAssertCustomer(req,req.body?.customer_code);const created=await one(`INSERT INTO factories(customer_id,code,name,location,country,timezone,status,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id::text,code,name,location,country,timezone,status,metadata,created_at,updated_at`,[customer.id,organizationCode(req.body?.code,'factory code'),organizationName(req.body?.name,'factory name'),cleanOptionalText(req.body?.location,220),cleanOptionalText(req.body?.country,100)||'Türkiye',organizationTimezone(req.body?.timezone),organizationStatus(req.body?.status,'active'),JSON.stringify(req.body?.metadata||{})]);await writeAuditLog(req,{action:'create_factory',entity_type:'factory',entity_id:created.id,new_values:created,metadata:{customer_code:customer.code}});res.status(201).json({status:'ok',version:APP_VERSION,factory:created});}catch(e){res.status(e.code==='23505'?409:(e.statusCode||500)).json({status:'error',version:APP_VERSION,message:e.code==='23505'?'Factory code already exists for this company':e.message});}
});

app.patch('/api/admin/organization/factories/:id',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const old=await one(`SELECT f.id::text,f.code,f.name,f.location,f.country,f.timezone,f.status,c.code AS customer_code FROM factories f JOIN customers c ON c.id=f.customer_id WHERE f.id=$1`,[req.params.id]);if(!old)return res.status(404).json({status:'not_found',message:'Factory not found'});await organizationAssertCustomer(req,old.customer_code);const updated=await one(`UPDATE factories SET name=$2,location=$3,country=$4,timezone=$5,status=$6,updated_at=now() WHERE id=$1 RETURNING id::text,code,name,location,country,timezone,status,metadata,created_at,updated_at`,[req.params.id,req.body?.name!==undefined?organizationName(req.body.name,'factory name'):old.name,req.body?.location!==undefined?cleanOptionalText(req.body.location,220):old.location,req.body?.country!==undefined?(cleanOptionalText(req.body.country,100)||'Türkiye'):old.country,req.body?.timezone!==undefined?organizationTimezone(req.body.timezone):old.timezone,req.body?.status!==undefined?organizationStatus(req.body.status):old.status]);await writeAuditLog(req,{action:'update_factory',entity_type:'factory',entity_id:updated.id,old_values:old,new_values:updated});res.json({status:'ok',version:APP_VERSION,factory:updated});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/organization/sites',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const customer=await organizationAssertCustomer(req,req.body?.customer_code);await assertSubscriptionCapacity(customer.code,'sites',1,false);const factory=await one(`SELECT id::text,code,name,timezone FROM factories WHERE id=$1 AND customer_id=$2`,[req.body?.factory_id,customer.id]);if(!factory)return res.status(404).json({status:'not_found',message:'Factory not found'});const created=await one(`INSERT INTO sites(customer_id,factory_id,code,name,location,address,timezone,workweek_start,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text,factory_id::text,code,name,location,address,timezone,workweek_start,status,created_at,updated_at`,[customer.id,factory.id,organizationCode(req.body?.code,'site code'),organizationName(req.body?.name,'site name'),cleanOptionalText(req.body?.location,220),cleanOptionalText(req.body?.address,500),organizationTimezone(req.body?.timezone||factory.timezone),Math.min(Math.max(Number(req.body?.workweek_start??1),0),6),organizationStatus(req.body?.status,'active')]);const line=await one(`INSERT INTO production_lines(site_id,code,name,status) VALUES($1,'general','Genel Üretim Hattı','active') ON CONFLICT(site_id,code) DO UPDATE SET updated_at=now() RETURNING id::text,code,name,status`,[created.id]);await writeAuditLog(req,{action:'create_organization_site',entity_type:'site',entity_id:created.id,new_values:created,metadata:{customer_code:customer.code,factory_id:factory.id,default_line_id:line.id}});res.status(201).json({status:'ok',version:APP_VERSION,site:created,default_line:line});}catch(e){res.status(e.code==='23505'?409:(e.statusCode||500)).json({status:'error',version:APP_VERSION,message:e.code==='23505'?'Site code already exists for this company':e.message});}
});

app.patch('/api/admin/organization/sites/:id',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const old=await one(`SELECT s.id::text,s.factory_id::text,s.code,s.name,s.location,s.address,s.timezone,s.workweek_start,s.status,c.code AS customer_code FROM sites s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`,[req.params.id]);if(!old)return res.status(404).json({status:'not_found',message:'Site not found'});await organizationAssertCustomer(req,old.customer_code);let factoryId=old.factory_id;if(req.body?.factory_id!==undefined){const f=await one(`SELECT f.id::text FROM factories f JOIN customers c ON c.id=f.customer_id WHERE f.id=$1 AND c.code=$2`,[req.body.factory_id,old.customer_code]);if(!f)return res.status(404).json({status:'not_found',message:'Factory not found'});factoryId=f.id;}const updated=await one(`UPDATE sites SET factory_id=$2,name=$3,location=$4,address=$5,timezone=$6,workweek_start=$7,status=$8,updated_at=now() WHERE id=$1 RETURNING id::text,factory_id::text,code,name,location,address,timezone,workweek_start,status,created_at,updated_at`,[req.params.id,factoryId,req.body?.name!==undefined?organizationName(req.body.name,'site name'):old.name,req.body?.location!==undefined?cleanOptionalText(req.body.location,220):old.location,req.body?.address!==undefined?cleanOptionalText(req.body.address,500):old.address,req.body?.timezone!==undefined?organizationTimezone(req.body.timezone):old.timezone,req.body?.workweek_start!==undefined?Math.min(Math.max(Number(req.body.workweek_start),0),6):old.workweek_start,req.body?.status!==undefined?organizationStatus(req.body.status):old.status]);await writeAuditLog(req,{action:'update_organization_site',entity_type:'site',entity_id:updated.id,old_values:old,new_values:updated});res.json({status:'ok',version:APP_VERSION,site:updated});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/organization/production-lines',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const site=await one(`SELECT s.id::text,s.code AS site_code,c.code AS customer_code FROM sites s JOIN customers c ON c.id=s.customer_id WHERE s.id=$1`,[req.body?.site_id]);if(!site)return res.status(404).json({status:'not_found',message:'Site not found'});await organizationAssertCustomer(req,site.customer_code);const shiftPattern={shift_count:Math.min(Math.max(Number(req.body?.shift_count||1),1),4),workdays:Array.isArray(req.body?.workdays)?req.body.workdays:[1,2,3,4,5]};const created=await one(`INSERT INTO production_lines(site_id,code,name,description,status,shift_pattern) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id::text,site_id::text,code,name,description,status,shift_pattern,created_at,updated_at`,[site.id,organizationCode(req.body?.code,'line code'),organizationName(req.body?.name,'line name'),cleanOptionalText(req.body?.description,500),organizationStatus(req.body?.status,'active'),JSON.stringify(shiftPattern)]);await writeAuditLog(req,{action:'create_production_line',entity_type:'production_line',entity_id:created.id,new_values:created,metadata:{customer_code:site.customer_code,site_code:site.site_code}});res.status(201).json({status:'ok',version:APP_VERSION,production_line:created});}catch(e){res.status(e.code==='23505'?409:(e.statusCode||500)).json({status:'error',version:APP_VERSION,message:e.code==='23505'?'Production line code already exists for this site':e.message});}
});

app.patch('/api/admin/organization/production-lines/:id',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const old=await one(`SELECT pl.id::text,pl.site_id::text,pl.code,pl.name,pl.description,pl.status,pl.shift_pattern,c.code AS customer_code FROM production_lines pl JOIN sites s ON s.id=pl.site_id JOIN customers c ON c.id=s.customer_id WHERE pl.id=$1`,[req.params.id]);if(!old)return res.status(404).json({status:'not_found',message:'Production line not found'});await organizationAssertCustomer(req,old.customer_code);const shiftPattern=req.body?.shift_pattern!==undefined?req.body.shift_pattern:old.shift_pattern;const updated=await one(`UPDATE production_lines SET name=$2,description=$3,status=$4,shift_pattern=$5::jsonb,updated_at=now() WHERE id=$1 RETURNING id::text,site_id::text,code,name,description,status,shift_pattern,created_at,updated_at`,[req.params.id,req.body?.name!==undefined?organizationName(req.body.name,'line name'):old.name,req.body?.description!==undefined?cleanOptionalText(req.body.description,500):old.description,req.body?.status!==undefined?organizationStatus(req.body.status):old.status,JSON.stringify(shiftPattern||{})]);await writeAuditLog(req,{action:'update_production_line',entity_type:'production_line',entity_id:updated.id,old_values:old,new_values:updated});res.json({status:'ok',version:APP_VERSION,production_line:updated});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.patch('/api/admin/organization/machines/:id/assignment',adminRequired,permissionRequired('MANAGE_SITES'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const old=await one(`SELECT m.id::text,m.site_id::text,m.production_line_id::text,m.code,m.name,c.code AS customer_code FROM machines m JOIN sites s ON s.id=m.site_id JOIN customers c ON c.id=s.customer_id WHERE m.id=$1`,[req.params.id]);if(!old)return res.status(404).json({status:'not_found',message:'Machine not found'});await organizationAssertCustomer(req,old.customer_code);const line=await one(`SELECT pl.id::text,pl.site_id::text,pl.code,pl.name,c.code AS customer_code FROM production_lines pl JOIN sites s ON s.id=pl.site_id JOIN customers c ON c.id=s.customer_id WHERE pl.id=$1`,[req.body?.production_line_id]);if(!line)return res.status(404).json({status:'not_found',message:'Production line not found'});if(line.customer_code!==old.customer_code){const e=new Error('Machine and production line must belong to the same company');e.statusCode=409;throw e;}const updated=await one(`UPDATE machines SET site_id=$2,production_line_id=$3,updated_at=now() WHERE id=$1 RETURNING id::text,site_id::text,production_line_id::text,code,name,machine_type,status,updated_at`,[req.params.id,line.site_id,line.id]);await writeAuditLog(req,{action:'assign_machine_production_line',entity_type:'machine',entity_id:updated.id,old_values:old,new_values:updated,metadata:{line_code:line.code}});res.json({status:'ok',version:APP_VERSION,machine:updated});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.get('/api/admin/organization/access',adminRequired,permissionRequired('MANAGE_USERS'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const allowed=organizationAllowedCustomerCodes(req);const params=[];let where='';if(allowed){params.push(allowed);where='WHERE c.code=ANY($1::text[])';}const rows=(await pool.query(`SELECT ola.id::text,ola.user_id,u.email,u.full_name,u.role AS user_role,ola.customer_id::text,c.code AS customer_code,c.name AS customer_name,ola.factory_id::text,f.code AS factory_code,f.name AS factory_name,ola.site_id::text,s.code AS site_code,s.name AS site_name,ola.production_line_id::text,pl.code AS production_line_code,pl.name AS production_line_name,ola.access_role,ola.status,ola.created_at,ola.updated_at FROM app_user_location_access ola JOIN app_users u ON u.id=ola.user_id JOIN customers c ON c.id=ola.customer_id LEFT JOIN factories f ON f.id=ola.factory_id LEFT JOIN sites s ON s.id=ola.site_id LEFT JOIN production_lines pl ON pl.id=ola.production_line_id ${where} ORDER BY u.email,c.name,f.name NULLS FIRST,s.name NULLS FIRST,pl.name NULLS FIRST`,params)).rows;const users=(await pool.query(`SELECT id,email,full_name,role,status FROM app_users WHERE status='active' ORDER BY email`)).rows;res.json({status:'ok',version:APP_VERSION,count:rows.length,access:rows,users});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/organization/access',adminRequired,permissionRequired('MANAGE_USERS'),async(req,res)=>{
  try{
    await ensureOrganizationFoundation();
    const user=await one(`SELECT id,email,full_name,role,status FROM app_users WHERE id=$1`,[req.body?.user_id]);
    if(!user)return res.status(404).json({status:'not_found',message:'User not found'});
    const customer=await organizationAssertCustomer(req,req.body?.customer_code);
    const factoryId=req.body?.factory_id||null;
    const siteId=req.body?.site_id||null;
    const lineId=req.body?.production_line_id||null;
    const role=validateChoice(req.body?.access_role||'viewer',ORGANIZATION_ACCESS_ROLES,'access role');
    if(lineId){const x=await one(`SELECT pl.id FROM production_lines pl JOIN sites s ON s.id=pl.site_id WHERE pl.id=$1 AND s.customer_id=$2`,[lineId,customer.id]);if(!x){const e=new Error('Production line does not belong to company');e.statusCode=409;throw e;}}
    if(siteId){const x=await one(`SELECT id FROM sites WHERE id=$1 AND customer_id=$2`,[siteId,customer.id]);if(!x){const e=new Error('Site does not belong to company');e.statusCode=409;throw e;}}
    if(factoryId){const x=await one(`SELECT id FROM factories WHERE id=$1 AND customer_id=$2`,[factoryId,customer.id]);if(!x){const e=new Error('Factory does not belong to company');e.statusCode=409;throw e;}}
    const existing=await one(`SELECT id::text FROM app_user_location_access WHERE user_id=$1 AND customer_id=$2 AND factory_id IS NOT DISTINCT FROM $3::uuid AND site_id IS NOT DISTINCT FROM $4::uuid AND production_line_id IS NOT DISTINCT FROM $5::uuid LIMIT 1`,[user.id,customer.id,factoryId,siteId,lineId]);
    const created=existing
      ? await one(`UPDATE app_user_location_access SET access_role=$2,status='active',created_by=$3,updated_at=now() WHERE id=$1 RETURNING id::text,user_id,customer_id::text,factory_id::text,site_id::text,production_line_id::text,access_role,status,created_at,updated_at`,[existing.id,role,req.user?.email||'admin'])
      : await one(`INSERT INTO app_user_location_access(user_id,customer_id,factory_id,site_id,production_line_id,access_role,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'active',$7) RETURNING id::text,user_id,customer_id::text,factory_id::text,site_id::text,production_line_id::text,access_role,status,created_at,updated_at`,[user.id,customer.id,factoryId,siteId,lineId,role,req.user?.email||'admin']);
    await pool.query(`INSERT INTO app_user_location_policy(user_id,enabled,updated_by) VALUES($1,true,$2) ON CONFLICT(user_id) DO UPDATE SET enabled=true,updated_by=EXCLUDED.updated_by,updated_at=now()`,[user.id,req.user?.email||'admin']);
    await revokeSessionsForUser(user.id,{actorEmail:req.user?.email||'admin',reason:'organization_access_changed'});
    await writeAuditLog(req,{action:'grant_location_access',entity_type:'user',entity_id:user.id,new_values:created,metadata:{user_email:user.email,customer_code:customer.code}});
    res.status(existing?200:201).json({status:'ok',version:APP_VERSION,access:created,updated:Boolean(existing)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.delete('/api/admin/organization/access/:id' ,adminRequired,permissionRequired('MANAGE_USERS'),async(req,res)=>{
  try{await ensureOrganizationFoundation();const old=await one(`SELECT ola.*,u.email,c.code AS customer_code FROM app_user_location_access ola JOIN app_users u ON u.id=ola.user_id JOIN customers c ON c.id=ola.customer_id WHERE ola.id=$1`,[req.params.id]);if(!old)return res.status(404).json({status:'not_found',message:'Access record not found'});await organizationAssertCustomer(req,old.customer_code);await pool.query(`DELETE FROM app_user_location_access WHERE id=$1`,[req.params.id]);await revokeSessionsForUser(old.user_id,{actorEmail:req.user?.email||'admin',reason:'organization_access_removed'});await writeAuditLog(req,{action:'revoke_location_access',entity_type:'user',entity_id:old.user_id,old_values:old,metadata:{user_email:old.email,customer_code:old.customer_code}});res.json({status:'ok',version:APP_VERSION,deleted:true});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.get('/api/admin/organization/comparison',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{
  try{
    await ensureOrganizationFoundation();
    await ensureOeeFoundation();
    const snapshot=await organizationHierarchySnapshot(req,req.query.customer_code);
    const range=oeeDateRange(req.query.from,req.query.to);
    const allowedMachineIds=snapshot.machines.map(row=>String(row.id));
    if(!snapshot.factories.length){
      return res.json({status:'ok',version:APP_VERSION,customer:snapshot.customer,range:{from:range.from,to:range.to,days:range.days},summary:{factory_count:0,site_count:0,machine_count:0,device_count:0,active_alarm_count:0,total_count:0,best_factory:null},factories:[]});
    }
    const oeeData=await loadOeeData(range);
    const oeeMachineMap=new Map((oeeData.machines||[]).map(row=>[String(row.id),row]));
    const oeeRows=[];
    for(const machine of snapshot.machines){
      const base=oeeMachineMap.get(String(machine.id));
      if(!base)continue;
      oeeRows.push(calculateOeeMachineRow(base,base,oeeData.productions||[],oeeData.downtimes||[],oeeData.states||[],range));
    }
    let alarmRows=[];
    if(allowedMachineIds.length){
      alarmRows=(await pool.query(`SELECT machine_id::text,count(*)::int AS active_count FROM alarms WHERE status='active' AND machine_id=ANY($1::uuid[]) GROUP BY machine_id`,[allowedMachineIds])).rows;
    }
    const activeAlarmMap=new Map(alarmRows.map(row=>[String(row.machine_id),Number(row.active_count||0)]));
    const siteMap=new Map(snapshot.sites.map(site=>[String(site.id),site]));
    const factories=snapshot.factories.map(factory=>{
      const factorySiteIds=new Set(snapshot.sites.filter(site=>String(site.factory_id)===String(factory.id)).map(site=>String(site.id)));
      const factoryMachines=snapshot.machines.filter(machine=>factorySiteIds.has(String(machine.site_id)));
      const machineIds=new Set(factoryMachines.map(machine=>String(machine.id)));
      const factoryOeeRows=oeeRows.filter(row=>machineIds.has(String(row.machine_id)));
      const oeeSummary=calculateOeeSummary(factoryOeeRows);
      const deviceCount=factoryMachines.reduce((sum,row)=>sum+Number(row.device_count||0),0);
      const onlineDeviceCount=factoryMachines.reduce((sum,row)=>sum+Number(row.online_device_count||0),0);
      const activeAlarmCount=factoryMachines.reduce((sum,row)=>sum+Number(activeAlarmMap.get(String(row.id))||0),0);
      return {
        id:factory.id,code:factory.code,name:factory.name,location:factory.location,timezone:factory.timezone,status:factory.status,
        site_count:factorySiteIds.size,machine_count:factoryMachines.length,device_count:deviceCount,online_device_count:onlineDeviceCount,
        online_pct:deviceCount>0?oeePct(onlineDeviceCount/deviceCount*100):0,active_alarm_count:activeAlarmCount,
        total_count:oeeSummary.total_count||0,good_count:oeeSummary.good_count||0,reject_count:oeeSummary.reject_count||0,
        downtime_sec:oeeSummary.unplanned_downtime_sec||0,planned_downtime_sec:oeeSummary.planned_downtime_sec||0,
        availability_pct:oeeSummary.availability_pct||0,performance_pct:oeeSummary.performance_pct||0,quality_pct:oeeSummary.quality_pct||0,oee_pct:oeeSummary.oee_pct||0
      };
    });
    const summary={
      factory_count:factories.length,
      site_count:snapshot.sites.length,
      machine_count:snapshot.machines.length,
      device_count:snapshot.machines.reduce((n,x)=>n+Number(x.device_count||0),0),
      active_alarm_count:factories.reduce((n,x)=>n+Number(x.active_alarm_count||0),0),
      total_count:factories.reduce((n,x)=>n+Number(x.total_count||0),0),
      best_factory:factories.slice().sort((a,b)=>Number(b.oee_pct)-Number(a.oee_pct))[0]||null
    };
    res.json({status:'ok',version:APP_VERSION,generated_at:new Date().toISOString(),customer:snapshot.customer,range:{from:range.from,to:range.to,days:range.days},summary,factories});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
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

    await ensureDeviceOnboardingFoundation();
    await pool.query(`
      UPDATE device_onboarding_sessions
      SET status='connected',current_step=5,connection_test='passed',connection_test_at=now(),last_error=NULL,updated_at=now()
      WHERE device_uid=$1
    `,[updated.device_uid]);

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



const DEVICE_CAPABILITY_CATALOG = [
  {type:'current_measurement',label_tr:'Akım Ölçümü',label_en:'Current Measurement',data_type:'number',unit:'A',telemetry_key:'current',sensor_suggestions:['SCT-013-30A','SCT-013-100A','ACS712','Modbus Energy Meter'],channel_suggestions:['analog_1','analog_2','modbus_1'],min_value:0,max_value:30},
  {type:'temperature_measurement',label_tr:'Sıcaklık Ölçümü',label_en:'Temperature Measurement',data_type:'number',unit:'°C',telemetry_key:'temperature',sensor_suggestions:['DS18B20','PT100 + MAX31865','NTC 10K','Modbus Temperature'],channel_suggestions:['onewire_1','analog_1','modbus_1'],min_value:-20,max_value:100},
  {type:'energy_measurement',label_tr:'Enerji Tüketimi',label_en:'Energy Consumption',data_type:'number',unit:'kWh',telemetry_key:'energy_kwh',sensor_suggestions:['Modbus Energy Meter','PZEM-004T'],channel_suggestions:['modbus_1','uart_1'],min_value:0,max_value:null},
  {type:'running_status',label_tr:'Çalışıyor / Durdu Algılama',label_en:'Running / Stopped Detection',data_type:'boolean',unit:'',telemetry_key:'machine_running',sensor_suggestions:['Digital Input','Current Threshold','PLC Signal'],channel_suggestions:['digital_1','digital_2','virtual_current'],min_value:null,max_value:null},
  {type:'vibration_measurement',label_tr:'Titreşim Ölçümü',label_en:'Vibration Measurement',data_type:'number',unit:'mm/s',telemetry_key:'vibration',sensor_suggestions:['ADXL345','MPU6050','Industrial Vibration Sensor'],channel_suggestions:['i2c_1','analog_1','modbus_1'],min_value:0,max_value:null},
  {type:'pressure_measurement',label_tr:'Basınç Ölçümü',label_en:'Pressure Measurement',data_type:'number',unit:'bar',telemetry_key:'pressure',sensor_suggestions:['4-20mA Pressure Sensor','0-10V Pressure Sensor','Modbus Pressure'],channel_suggestions:['analog_1','analog_2','modbus_1'],min_value:0,max_value:null},
  {type:'digital_input',label_tr:'Dijital Giriş',label_en:'Digital Input',data_type:'boolean',unit:'',telemetry_key:'digital_input',sensor_suggestions:['Dry Contact','24V PLC Signal','Limit Switch'],channel_suggestions:['digital_1','digital_2','digital_3','digital_4'],min_value:null,max_value:null},
  {type:'analog_input',label_tr:'Analog Giriş',label_en:'Analog Input',data_type:'number',unit:'',telemetry_key:'analog_input',sensor_suggestions:['0-10V Sensor','4-20mA Sensor','Generic Analog'],channel_suggestions:['analog_1','analog_2'],min_value:null,max_value:null},
  {type:'relay_output',label_tr:'Röle Çıkışı',label_en:'Relay Output',data_type:'boolean',unit:'',telemetry_key:'relay_state',sensor_suggestions:['Relay Output'],channel_suggestions:['relay_1','relay_2'],min_value:null,max_value:null},
  {type:'modbus_read',label_tr:'Modbus Okuma',label_en:'Modbus Read',data_type:'number',unit:'',telemetry_key:'modbus_value',sensor_suggestions:['Modbus RTU Device','Modbus TCP Device'],channel_suggestions:['modbus_1','modbus_2'],min_value:null,max_value:null},
  {type:'alarm_generation',label_tr:'Alarm Üretme',label_en:'Alarm Generation',data_type:'event',unit:'',telemetry_key:'alarm',sensor_suggestions:['Rule Engine'],channel_suggestions:['virtual_1'],min_value:null,max_value:null},
  {type:'remote_control',label_tr:'Uzaktan Kontrol',label_en:'Remote Control',data_type:'boolean',unit:'',telemetry_key:'remote_control',sensor_suggestions:['Relay Output','PLC Command'],channel_suggestions:['relay_1','relay_2','modbus_1'],min_value:null,max_value:null},
  {type:'custom',label_tr:'Özel Yetkinlik',label_en:'Custom Capability',data_type:'number',unit:'',telemetry_key:'custom_value',sensor_suggestions:[],channel_suggestions:[],min_value:null,max_value:null}
];

const DEVICE_CAPABILITY_PROFILES = [
  {key:'laser_cutting',label_tr:'FactoryBox One – Lazer Kesim',label_en:'FactoryBox One – Laser Cutting',capabilities:[
    {capability_key:'machine_current',capability_type:'current_measurement',display_name:'Makine Akımı',telemetry_key:'current',sensor_model:'SCT-013-30A',physical_channel:'analog_1',unit:'A',min_value:0,max_value:30,alarm_high:20},
    {capability_key:'cabinet_temperature',capability_type:'temperature_measurement',display_name:'Kabin Sıcaklığı',telemetry_key:'temperature',sensor_model:'DS18B20',physical_channel:'onewire_1',unit:'°C',min_value:-20,max_value:100,alarm_high:70},
    {capability_key:'machine_running',capability_type:'running_status',display_name:'Makine Çalışma Durumu',telemetry_key:'machine_running',sensor_model:'Current Threshold',physical_channel:'virtual_current',data_type:'boolean'},
    {capability_key:'door_input',capability_type:'digital_input',display_name:'Kapak / Güvenlik Girişi',telemetry_key:'door_closed',sensor_model:'Dry Contact',physical_channel:'digital_1',data_type:'boolean'},
    {capability_key:'exhaust_fan',capability_type:'relay_output',display_name:'Egzoz Fanı Rölesi',telemetry_key:'exhaust_fan',sensor_model:'Relay Output',physical_channel:'relay_1',data_type:'boolean'}
  ]},
  {key:'cnc',label_tr:'FactoryBox One – CNC',label_en:'FactoryBox One – CNC',capabilities:[
    {capability_key:'spindle_current',capability_type:'current_measurement',display_name:'Spindle Akımı',telemetry_key:'spindle_current',sensor_model:'SCT-013-30A',physical_channel:'analog_1',unit:'A',min_value:0,max_value:30},
    {capability_key:'spindle_temperature',capability_type:'temperature_measurement',display_name:'Spindle Sıcaklığı',telemetry_key:'spindle_temperature',sensor_model:'DS18B20',physical_channel:'onewire_1',unit:'°C',alarm_high:75},
    {capability_key:'machine_running',capability_type:'running_status',display_name:'Makine Çalışma Durumu',telemetry_key:'machine_running',sensor_model:'PLC Signal',physical_channel:'digital_1',data_type:'boolean'},
    {capability_key:'vibration',capability_type:'vibration_measurement',display_name:'Titreşim',telemetry_key:'vibration',sensor_model:'ADXL345',physical_channel:'i2c_1',unit:'mm/s'}
  ]},
  {key:'plastic_injection',label_tr:'FactoryBox One – Plastik Enjeksiyon',label_en:'FactoryBox One – Plastic Injection',capabilities:[
    {capability_key:'heater_current',capability_type:'current_measurement',display_name:'Isıtıcı Akımı',telemetry_key:'heater_current',sensor_model:'SCT-013-100A',physical_channel:'analog_1',unit:'A'},
    {capability_key:'barrel_temperature',capability_type:'temperature_measurement',display_name:'Kovan Sıcaklığı',telemetry_key:'barrel_temperature',sensor_model:'PT100 + MAX31865',physical_channel:'spi_1',unit:'°C',alarm_high:280},
    {capability_key:'hydraulic_pressure',capability_type:'pressure_measurement',display_name:'Hidrolik Basınç',telemetry_key:'pressure',sensor_model:'4-20mA Pressure Sensor',physical_channel:'analog_2',unit:'bar'},
    {capability_key:'cycle_input',capability_type:'digital_input',display_name:'Çevrim Sinyali',telemetry_key:'cycle_signal',sensor_model:'PLC Signal',physical_channel:'digital_1',data_type:'boolean'}
  ]},
  {key:'general_monitoring',label_tr:'FactoryBox One – Genel Makine İzleme',label_en:'FactoryBox One – General Machine Monitoring',capabilities:[
    {capability_key:'machine_current',capability_type:'current_measurement',display_name:'Makine Akımı',telemetry_key:'current',sensor_model:'SCT-013-30A',physical_channel:'analog_1',unit:'A'},
    {capability_key:'temperature',capability_type:'temperature_measurement',display_name:'Sıcaklık',telemetry_key:'temperature',sensor_model:'DS18B20',physical_channel:'onewire_1',unit:'°C'},
    {capability_key:'machine_running',capability_type:'running_status',display_name:'Makine Çalışma Durumu',telemetry_key:'machine_running',sensor_model:'Current Threshold',physical_channel:'virtual_current',data_type:'boolean'}
  ]},
  {key:'custom',label_tr:'Özel Profil',label_en:'Custom Profile',capabilities:[]}
];

async function ensureDeviceCapabilityFoundation() {
  if (deviceCapabilityFoundationReady) return;
  await ensureDeviceRegistrySchema();
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS permanent_qr_slug text`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS permanent_qr_token_hash text`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS permanent_qr_issued_at timestamptz`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS capability_profile text NOT NULL DEFAULT 'custom'`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS capability_config_version integer NOT NULL DEFAULT 0`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_permanent_qr_slug ON devices(permanent_qr_slug) WHERE permanent_qr_slug IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_capabilities (
      id text PRIMARY KEY,
      device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      capability_key text NOT NULL,
      capability_type text NOT NULL,
      display_name text NOT NULL,
      telemetry_key text,
      unit text,
      sensor_model text,
      physical_channel text,
      data_type text NOT NULL DEFAULT 'number',
      min_value double precision,
      max_value double precision,
      calibration_factor double precision NOT NULL DEFAULT 1,
      alarm_low double precision,
      alarm_high double precision,
      alarm_delay_sec integer NOT NULL DEFAULT 0,
      sample_interval_sec integer NOT NULL DEFAULT 1,
      send_interval_sec integer NOT NULL DEFAULT 10,
      enabled boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      custom_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by_email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(device_id, capability_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_capabilities_device ON device_capabilities(device_id,sort_order,created_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_capability_config_versions (
      id text PRIMARY KEY,
      device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      config_version integer NOT NULL,
      profile_key text NOT NULL DEFAULT 'custom',
      capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'saved',
      source text NOT NULL DEFAULT 'admin',
      created_by_email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      publish_command_id text,
      device_status text,
      device_message text,
      device_response jsonb,
      acknowledged_at timestamptz,
      UNIQUE(device_id,config_version)
    )
  `);
  await pool.query(`ALTER TABLE device_capability_config_versions ADD COLUMN IF NOT EXISTS publish_command_id text`);
  await pool.query(`ALTER TABLE device_capability_config_versions ADD COLUMN IF NOT EXISTS device_status text`);
  await pool.query(`ALTER TABLE device_capability_config_versions ADD COLUMN IF NOT EXISTS device_message text`);
  await pool.query(`ALTER TABLE device_capability_config_versions ADD COLUMN IF NOT EXISTS device_response jsonb`);
  await pool.query(`ALTER TABLE device_capability_config_versions ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_capability_versions_command ON device_capability_config_versions(publish_command_id) WHERE publish_command_id IS NOT NULL`);
  deviceCapabilityFoundationReady=true;
}

function capabilityNumber(value, fallback=null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number=Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function capabilityInteger(value, fallback, min, max) {
  const number=Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number,min),max);
}

function capabilityText(value,max=160) {
  return String(value??'').trim().slice(0,max);
}

function capabilityKey(value,index=0) {
  const normalized=String(value||`capability_${index+1}`).trim().toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64);
  return normalized && /^[a-z][a-z0-9_]*$/.test(normalized) ? normalized : `capability_${index+1}`;
}

function normalizeDeviceCapability(raw,index=0) {
  const catalog=DEVICE_CAPABILITY_CATALOG.find(row=>row.type===String(raw?.capability_type||raw?.type||''))||DEVICE_CAPABILITY_CATALOG.at(-1);
  const type=catalog.type;
  const dataType=['number','boolean','text','event'].includes(String(raw?.data_type||catalog.data_type))?String(raw?.data_type||catalog.data_type):catalog.data_type;
  return {
    id:capabilityText(raw?.id,80)||crypto.randomUUID(),
    capability_key:capabilityKey(raw?.capability_key||raw?.key||raw?.telemetry_key,index),
    capability_type:type,
    display_name:capabilityText(raw?.display_name||raw?.name||catalog.label_tr,120)||catalog.label_tr,
    telemetry_key:capabilityKey(raw?.telemetry_key||catalog.telemetry_key,index),
    unit:capabilityText(raw?.unit??catalog.unit,24),
    sensor_model:capabilityText(raw?.sensor_model||raw?.sensor,120),
    physical_channel:capabilityText(raw?.physical_channel||raw?.channel,80),
    data_type:dataType,
    min_value:capabilityNumber(raw?.min_value,catalog.min_value),
    max_value:capabilityNumber(raw?.max_value,catalog.max_value),
    calibration_factor:capabilityNumber(raw?.calibration_factor,1)??1,
    alarm_low:capabilityNumber(raw?.alarm_low,null),
    alarm_high:capabilityNumber(raw?.alarm_high,null),
    alarm_delay_sec:capabilityInteger(raw?.alarm_delay_sec,0,0,86400),
    sample_interval_sec:capabilityInteger(raw?.sample_interval_sec,1,1,86400),
    send_interval_sec:capabilityInteger(raw?.send_interval_sec,10,1,86400),
    enabled:raw?.enabled!==false,
    sort_order:capabilityInteger(raw?.sort_order,index,0,999),
    custom_definition:raw?.custom_definition&&typeof raw.custom_definition==='object'?raw.custom_definition:{}
  };
}

function publicCapabilityCatalog() {
  return DEVICE_CAPABILITY_CATALOG.map(row=>({...row}));
}

function publicCapabilityProfiles() {
  return DEVICE_CAPABILITY_PROFILES.map(row=>({...row,capabilities:row.capabilities.map((cap,index)=>normalizeDeviceCapability(cap,index))}));
}

async function capabilityDeviceByUid(uid) {
  await ensureDeviceCapabilityFoundation();
  return one(`
    SELECT d.id::text,d.device_uid,d.model,d.serial_no,d.status,d.mqtt_base_topic,d.last_seen_at,
      d.permanent_qr_slug,d.permanent_qr_issued_at,d.capability_profile,d.capability_config_version,
      m.code AS machine_code,m.name AS machine_name,m.machine_type,
      s.code AS site_code,s.name AS site_name,c.code AS customer_code,c.name AS customer_name
    FROM devices d
    LEFT JOIN machines m ON m.id=d.machine_id
    LEFT JOIN sites s ON s.id=m.site_id
    LEFT JOIN customers c ON c.id=s.customer_id
    WHERE d.device_uid=$1 LIMIT 1
  `,[String(uid||'').trim()]);
}

function deviceAllowedForRequest(req,device) {
  if (!authConfig().enabled || !req.user || req.user.role==='system_admin') return true;
  const allowedCustomers=(req.tenant?.customers||[]).map(row=>row.code);
  if (!device?.customer_code || !allowedCustomers.length) return true;
  return allowedCustomers.includes(device.customer_code);
}

async function deviceCapabilitiesByUid(uid) {
  const device=await capabilityDeviceByUid(uid);
  if (!device) return null;
  const rows=await pool.query(`
    SELECT id,capability_key,capability_type,display_name,telemetry_key,unit,sensor_model,physical_channel,data_type,
      min_value,max_value,calibration_factor,alarm_low,alarm_high,alarm_delay_sec,sample_interval_sec,send_interval_sec,
      enabled,sort_order,custom_definition,created_by_email,created_at,updated_at
    FROM device_capabilities WHERE device_id=$1::uuid ORDER BY sort_order,created_at
  `,[device.id]);
  return {device,capabilities:rows.rows};
}

function capabilityConfiguration(device,capabilities,version=device?.capability_config_version||0) {
  return {
    schema:'factorybox-device-capabilities-v1',
    generated_at:new Date().toISOString(),
    config_version:Number(version||0),
    device_uid:device.device_uid,
    serial_no:device.serial_no||null,
    model:device.model||'FactoryBox One',
    customer_code:device.customer_code||null,
    site_code:device.site_code||null,
    machine_code:device.machine_code||null,
    mqtt_base_topic:device.mqtt_base_topic||null,
    capability_profile:device.capability_profile||'custom',
    capabilities:capabilities.map(row=>({
      key:row.capability_key,type:row.capability_type,name:row.display_name,telemetry_key:row.telemetry_key,
      unit:row.unit||'',sensor:row.sensor_model||null,channel:row.physical_channel||null,data_type:row.data_type,
      range:{min:row.min_value,max:row.max_value},calibration_factor:Number(row.calibration_factor??1),
      alarms:{low:row.alarm_low,high:row.alarm_high,delay_sec:Number(row.alarm_delay_sec||0)},
      intervals:{sample_sec:Number(row.sample_interval_sec||1),send_sec:Number(row.send_interval_sec||10)},
      enabled:Boolean(row.enabled),custom:row.custom_definition||{}
    }))
  };
}


function normalizeCapabilityTransferState(value) {
  const status=String(value||'').trim().toLowerCase();
  if (['done','ok','success','successful','applied','completed'].includes(status)) return 'applied';
  if (['error','failed','failure','rejected','invalid','invalid_or_expired_token'].includes(status)) return 'failed';
  if (['pending','published','sent','queued','processing','received'].includes(status)) return 'pending';
  if (status==='saved' || !status) return 'saved';
  return status;
}

function publicCapabilityTransferStatus(versionRow,eventRow,currentVersion=0) {
  const version=versionRow||null;
  const eventPayload=eventRow?.raw_payload&&typeof eventRow.raw_payload==='object'?eventRow.raw_payload:null;
  const storedPayload=version?.device_response&&typeof version.device_response==='object'?version.device_response:null;
  const response=storedPayload||eventPayload||null;
  const responseVersion=Number(response?.config_version||0);
  const current=Number(currentVersion||version?.config_version||0);
  const responseMatchesCurrent=!responseVersion||!current||responseVersion===current;
  const rawStatus=version?.device_status||response?.status||version?.status||'saved';
  let state=normalizeCapabilityTransferState(rawStatus);
  if (!responseMatchesCurrent && state==='applied') state=normalizeCapabilityTransferState(version?.status||'saved');
  if (state==='published') state='pending';
  const capabilityCount=Number(response?.capability_count ?? version?.capability_count ?? 0);
  return {
    state,
    status:String(rawStatus||state),
    config_version:Number(version?.config_version||current||responseVersion||0),
    capability_count:Number.isFinite(capabilityCount)?capabilityCount:0,
    command_id:String(version?.publish_command_id||response?.command_id||response?.request_id||''),
    sent_at:version?.published_at||null,
    response_at:version?.acknowledged_at||eventRow?.event_ts||null,
    message:String(version?.device_message||response?.message||''),
    persisted:response?.persisted===undefined?null:Boolean(response.persisted),
    storage_bytes:Number.isFinite(Number(response?.storage_bytes))?Number(response.storage_bytes):null,
    apply_mode:response?.apply_mode||null,
    hardware_runtime_updated:response?.hardware_runtime_updated===undefined?null:Boolean(response.hardware_runtime_updated),
    response_matches_current_version:responseMatchesCurrent,
    response:response||null
  };
}

async function capabilityTransferStatusByUid(uid) {
  await ensureDeviceCapabilityFoundation();
  const device=await capabilityDeviceByUid(uid);
  if (!device) return null;
  const version=await one(`
    SELECT id,config_version,status,created_at,published_at,publish_command_id,device_status,device_message,device_response,acknowledged_at,
      jsonb_array_length(capabilities)::int AS capability_count
    FROM device_capability_config_versions
    WHERE device_id=$1::uuid
    ORDER BY config_version DESC
    LIMIT 1
  `,[device.id]);
  const currentVersion=Number(device.capability_config_version||version?.config_version||0);
  const event=await one(`
    SELECT event_type,status,event_ts,raw_payload
    FROM workflow_events
    WHERE event_type='command_status_set_capabilities'
      AND (raw_payload->>'device_id'=$1 OR raw_payload->>'device_uid'=$1)
    ORDER BY
      CASE
        WHEN (raw_payload->>'config_version') ~ '^[0-9]+$'
         AND (raw_payload->>'config_version')::int=$2 THEN 0
        ELSE 1
      END,
      event_ts DESC
    LIMIT 1
  `,[String(uid||'').trim(),currentVersion]);
  const eventCommandId=String(event?.raw_payload?.command_id||event?.raw_payload?.request_id||'');
  const eventMatchesCommand=!version?.publish_command_id||eventCommandId===String(version.publish_command_id);
  const eventAfterPublish=!version?.published_at||!event?.event_ts||new Date(event.event_ts).getTime()>=new Date(version.published_at).getTime();
  const usableEvent=eventMatchesCommand&&eventAfterPublish?event:null;
  return {device,transfer_status:publicCapabilityTransferStatus(version,usableEvent,currentVersion)};
}

async function recordCapabilityCommandStatus(payload) {
  if (String(payload?.command||'')!=='set_capabilities') return null;
  await ensureDeviceCapabilityFoundation();
  const commandId=String(payload?.command_id||payload?.request_id||'').trim();
  const deviceUid=String(payload?.device_id||payload?.device_uid||'').trim();
  const configVersion=Number(payload?.config_version||0);
  const state=normalizeCapabilityTransferState(payload?.status);
  const message=String(payload?.message||'').trim().slice(0,500);
  const responseJson=JSON.stringify(payload||{});
  let updated=null;
  if (commandId) {
    updated=await one(`
      UPDATE device_capability_config_versions
      SET status=$1,device_status=$2,device_message=$3,device_response=$4::jsonb,acknowledged_at=now()
      WHERE publish_command_id=$5
      RETURNING id,device_id::text,config_version,status,publish_command_id,acknowledged_at
    `,[state,state,message,responseJson,commandId]);
  }
  if (!updated && deviceUid) {
    updated=await one(`
      UPDATE device_capability_config_versions cv
      SET status=$1,device_status=$2,device_message=$3,device_response=$4::jsonb,acknowledged_at=now()
      WHERE cv.id=(
        SELECT cv2.id
        FROM device_capability_config_versions cv2
        JOIN devices d ON d.id=cv2.device_id
        WHERE d.device_uid=$5
          AND ($6::int<=0 OR cv2.config_version=$6)
        ORDER BY cv2.config_version DESC
        LIMIT 1
      )
      RETURNING cv.id,cv.device_id::text,cv.config_version,cv.status,cv.publish_command_id,cv.acknowledged_at
    `,[state,state,message,responseJson,deviceUid,configVersion]);
  }
  return updated;
}

async function saveDeviceCapabilities({uid,profileKey='custom',capabilities=[],source='admin',actorEmail='local-admin'}) {
  await ensureDeviceCapabilityFoundation();
  const normalizedProfile=DEVICE_CAPABILITY_PROFILES.some(row=>row.key===profileKey)?profileKey:'custom';
  if (!Array.isArray(capabilities)) throw Object.assign(new Error('capabilities must be an array'),{statusCode:400});
  if (capabilities.length>40) throw Object.assign(new Error('Maximum 40 capabilities are supported per device'),{statusCode:400});
  const normalized=capabilities.map(normalizeDeviceCapability);
  const keys=new Set();
  for (const row of normalized) {
    if (keys.has(row.capability_key)) throw Object.assign(new Error(`Duplicate capability key: ${row.capability_key}`),{statusCode:400});
    keys.add(row.capability_key);
  }
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const deviceResult=await client.query(`SELECT id::text,device_uid,capability_config_version FROM devices WHERE device_uid=$1 FOR UPDATE`,[String(uid||'').trim()]);
    if (!deviceResult.rows[0]) throw Object.assign(new Error('Device not found'),{statusCode:404});
    const device=deviceResult.rows[0];
    const nextVersion=Number(device.capability_config_version||0)+1;
    await client.query(`DELETE FROM device_capabilities WHERE device_id=$1::uuid`,[device.id]);
    for (let index=0;index<normalized.length;index++) {
      const row=normalized[index];
      await client.query(`
        INSERT INTO device_capabilities(id,device_id,capability_key,capability_type,display_name,telemetry_key,unit,sensor_model,physical_channel,data_type,
          min_value,max_value,calibration_factor,alarm_low,alarm_high,alarm_delay_sec,sample_interval_sec,send_interval_sec,enabled,sort_order,custom_definition,created_by_email)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
      `,[row.id,device.id,row.capability_key,row.capability_type,row.display_name,row.telemetry_key,row.unit||null,row.sensor_model||null,row.physical_channel||null,row.data_type,
        row.min_value,row.max_value,row.calibration_factor,row.alarm_low,row.alarm_high,row.alarm_delay_sec,row.sample_interval_sec,row.send_interval_sec,row.enabled,index,JSON.stringify(row.custom_definition||{}),actorEmail]);
    }
    await client.query(`UPDATE devices SET capability_profile=$1,capability_config_version=$2,updated_at=now() WHERE id=$3::uuid`,[normalizedProfile,nextVersion,device.id]);
    await client.query(`
      INSERT INTO device_capability_config_versions(id,device_id,config_version,profile_key,capabilities,status,source,created_by_email)
      VALUES($1,$2::uuid,$3,$4,$5::jsonb,'saved',$6,$7)
    `,[crypto.randomUUID(),device.id,nextVersion,normalizedProfile,JSON.stringify(normalized),capabilityText(source,24)||'admin',actorEmail]);
    await client.query('COMMIT');
    return deviceCapabilitiesByUid(uid);
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}

function makePermanentQrToken() { return `fbq_${crypto.randomBytes(12).toString('hex')}`; }
function makePermanentQrSlug() { return crypto.randomBytes(8).toString('base64url'); }
function permanentQrBaseUrl(req,raw) {
  const value=String(raw||publicAppBaseUrl(req)).trim().replace(/\/+$/,'');
  try { const parsed=new URL(value); if(!['http:','https:'].includes(parsed.protocol))throw new Error(); return parsed.origin; }
  catch { throw Object.assign(new Error('Valid HTTP/HTTPS base_url is required'),{statusCode:400}); }
}

app.get('/i/:slug/:token',(req,res)=>{
  const slug=encodeURIComponent(String(req.params.slug||''));
  const token=encodeURIComponent(String(req.params.token||''));
  res.redirect(302,`/installer.html?slug=${slug}&token=${token}`);
});

app.get('/api/admin/device-capabilities',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    await ensureDeviceCapabilityFoundation();
    const devices=await pool.query(`
      SELECT d.device_uid,d.model,d.serial_no,d.status,d.capability_profile,d.capability_config_version,d.permanent_qr_slug,d.permanent_qr_issued_at,
        m.code AS machine_code,m.name AS machine_name,s.code AS site_code,c.code AS customer_code,
        COUNT(dc.id)::int AS capability_count
      FROM devices d
      LEFT JOIN machines m ON m.id=d.machine_id LEFT JOIN sites s ON s.id=m.site_id LEFT JOIN customers c ON c.id=s.customer_id
      LEFT JOIN device_capabilities dc ON dc.device_id=d.id
      GROUP BY d.id,m.code,m.name,s.code,c.code ORDER BY d.updated_at DESC
    `);
    res.json({status:'ok',version:APP_VERSION,devices:devices.rows,catalog:publicCapabilityCatalog(),profiles:publicCapabilityProfiles()});
  } catch(e) { res.status(500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.get('/api/admin/device-capabilities/:uid',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const data=await deviceCapabilitiesByUid(req.params.uid);
    if(!data)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Device not found'});
    if(!deviceAllowedForRequest(req,data.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    const transfer=await capabilityTransferStatusByUid(req.params.uid);
    res.json({status:'ok',version:APP_VERSION,...data,catalog:publicCapabilityCatalog(),profiles:publicCapabilityProfiles(),configuration:capabilityConfiguration(data.device,data.capabilities),transfer_status:transfer?.transfer_status||null});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.get('/api/admin/device-capabilities/:uid/transfer-status',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const transfer=await capabilityTransferStatusByUid(req.params.uid);
    if(!transfer)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Device not found'});
    if(!deviceAllowedForRequest(req,transfer.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    res.json({status:'ok',version:APP_VERSION,device:transfer.device,transfer_status:transfer.transfer_status});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.put('/api/admin/device-capabilities/:uid',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const before=await deviceCapabilitiesByUid(req.params.uid);
    if(!before)return res.status(404).json({status:'not_found',message:'Device not found'});
    if(!deviceAllowedForRequest(req,before.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    const saved=await saveDeviceCapabilities({uid:req.params.uid,profileKey:String(req.body?.profile_key||'custom'),capabilities:req.body?.capabilities||[],source:'admin',actorEmail:req.user?.email||'local-admin'});
    await writeAuditLog(req,{action:'save_device_capabilities',entity_type:'device',entity_id:req.params.uid,old_values:{profile:before.device.capability_profile,count:before.capabilities.length,version:before.device.capability_config_version},new_values:{profile:saved.device.capability_profile,count:saved.capabilities.length,version:saved.device.capability_config_version},metadata:{source:'admin'}});
    res.json({status:'ok',version:APP_VERSION,...saved,configuration:capabilityConfiguration(saved.device,saved.capabilities)});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/admin/device-capabilities/:uid/publish',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const data=await deviceCapabilitiesByUid(req.params.uid);
    if(!data)return res.status(404).json({status:'not_found',message:'Device not found'});
    if(!mqttConnected||!mqttClient)return res.status(409).json({status:'mqtt_offline',message:'MQTT broker is not connected'});
    const configuration=capabilityConfiguration(data.device,data.capabilities);
    const topic=`${String(data.device.mqtt_base_topic||'').replace(/\/+$/,'')}/command`;
    if(!data.device.mqtt_base_topic)return res.status(409).json({status:'missing_topic',message:'Device MQTT base topic is missing'});
    const payload={command:'set_capabilities',command_id:`cap-${Date.now()}`,source:'factorybox-capability-center',configuration,ts:new Date().toISOString()};
    await pool.query(`
      UPDATE device_capability_config_versions
      SET status='pending',published_at=now(),publish_command_id=$3,device_status=NULL,device_message=NULL,device_response=NULL,acknowledged_at=NULL
      WHERE device_id=$1::uuid AND config_version=$2
    `,[data.device.id,data.device.capability_config_version,payload.command_id]);
    try {
      await new Promise((resolve,reject)=>mqttClient.publish(topic,JSON.stringify(payload),{qos:0,retain:false},error=>error?reject(error):resolve()));
    } catch(error) {
      await pool.query(`
        UPDATE device_capability_config_versions
        SET status='failed',device_status='failed',device_message=$3,acknowledged_at=now()
        WHERE device_id=$1::uuid AND config_version=$2
      `,[data.device.id,data.device.capability_config_version,String(error.message||error).slice(0,500)]);
      throw error;
    }
    await writeAuditLog(req,{action:'publish_device_capabilities',entity_type:'device',entity_id:req.params.uid,old_values:null,new_values:{topic,command_id:payload.command_id,config_version:data.device.capability_config_version,count:data.capabilities.length},metadata:{source:'admin'}});
    const transfer=await capabilityTransferStatusByUid(req.params.uid);
    res.json({status:'ok',version:APP_VERSION,topic,command_id:payload.command_id,configuration,transfer_status:transfer?.transfer_status||null});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/admin/devices/:uid/permanent-qr',adminRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    await ensureDeviceCapabilityFoundation();
    const device=await capabilityDeviceByUid(req.params.uid);
    if(!device)return res.status(404).json({status:'not_found',message:'Device not found'});
    if(!deviceAllowedForRequest(req,device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    const token=makePermanentQrToken();
    const tokenHash=hashProvisioningToken(token);
    const slug=device.permanent_qr_slug||makePermanentQrSlug();
    await pool.query(`UPDATE devices SET permanent_qr_slug=$1,permanent_qr_token_hash=$2,permanent_qr_issued_at=now(),updated_at=now() WHERE device_uid=$3`,[slug,tokenHash,device.device_uid]);
    const baseUrl=permanentQrBaseUrl(req,req.body?.base_url);
    const qrUrl=`${baseUrl}/i/${encodeURIComponent(slug)}/${encodeURIComponent(token)}`;
    const refreshed=await capabilityDeviceByUid(device.device_uid);
    await writeAuditLog(req,{action:'issue_permanent_device_qr',entity_type:'device',entity_id:device.device_uid,old_values:{qr_issued_at:device.permanent_qr_issued_at},new_values:{qr_issued_at:refreshed.permanent_qr_issued_at,slug},metadata:{base_url:baseUrl,token:'stored_as_hash'}});
    res.json({status:'ok',version:APP_VERSION,device:refreshed,permanent_qr:{url:qrUrl,slug,token,qr_svg:onboardingQrSvg(qrUrl),token_visible_once:true}});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.get('/api/device-installer/resolve',authRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    await ensureDeviceCapabilityFoundation();
    const slug=String(req.query.slug||'').trim();
    const token=String(req.query.token||'').trim();
    const tokenHash=hashProvisioningToken(token);
    const device=await one(`
      SELECT d.device_uid FROM devices d WHERE d.permanent_qr_slug=$1 AND d.permanent_qr_token_hash=$2 LIMIT 1
    `,[slug,tokenHash]);
    if(!device)return res.status(404).json({status:'invalid_qr',version:APP_VERSION,message:'QR code is invalid or has been rotated'});
    const data=await deviceCapabilitiesByUid(device.device_uid);
    if(!deviceAllowedForRequest(req,data.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    res.json({status:'ok',version:APP_VERSION,...data,catalog:publicCapabilityCatalog(),profiles:publicCapabilityProfiles(),configuration:capabilityConfiguration(data.device,data.capabilities)});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.put('/api/device-installer/devices/:uid/capabilities',authRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const before=await deviceCapabilitiesByUid(req.params.uid);
    if(!before)return res.status(404).json({status:'not_found',message:'Device not found'});
    if(!deviceAllowedForRequest(req,before.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    const saved=await saveDeviceCapabilities({uid:req.params.uid,profileKey:String(req.body?.profile_key||'custom'),capabilities:req.body?.capabilities||[],source:'mobile',actorEmail:req.user?.email||'mobile-installer'});
    await writeAuditLog(req,{action:'save_device_capabilities',entity_type:'device',entity_id:req.params.uid,old_values:{profile:before.device.capability_profile,count:before.capabilities.length,version:before.device.capability_config_version},new_values:{profile:saved.device.capability_profile,count:saved.capabilities.length,version:saved.device.capability_config_version},metadata:{source:'mobile'}});
    res.json({status:'ok',version:APP_VERSION,...saved,configuration:capabilityConfiguration(saved.device,saved.capabilities)});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});

app.post('/api/device-installer/devices/:uid/publish',authRequired,permissionRequired('MANAGE_DEVICES'),async(req,res)=>{
  try {
    const data=await deviceCapabilitiesByUid(req.params.uid);
    if(!data)return res.status(404).json({status:'not_found',message:'Device not found'});
    if(!deviceAllowedForRequest(req,data.device))return res.status(403).json({status:'forbidden',message:'Device tenant access denied'});
    if(!mqttConnected||!mqttClient)return res.status(409).json({status:'mqtt_offline',message:'MQTT broker is not connected'});
    if(!data.device.mqtt_base_topic)return res.status(409).json({status:'missing_topic',message:'Device MQTT base topic is missing'});
    const configuration=capabilityConfiguration(data.device,data.capabilities);
    const topic=`${String(data.device.mqtt_base_topic).replace(/\/+$/,'')}/command`;
    const payload={command:'set_capabilities',command_id:`cap-mobile-${Date.now()}`,source:'factorybox-mobile-installer',configuration,ts:new Date().toISOString()};
    await new Promise((resolve,reject)=>mqttClient.publish(topic,JSON.stringify(payload),{qos:0,retain:false},error=>error?reject(error):resolve()));
    await pool.query(`UPDATE device_capability_config_versions SET status='published',published_at=now() WHERE device_id=$1::uuid AND config_version=$2`,[data.device.id,data.device.capability_config_version]);
    await writeAuditLog(req,{action:'publish_device_capabilities',entity_type:'device',entity_id:req.params.uid,old_values:null,new_values:{topic,config_version:data.device.capability_config_version,count:data.capabilities.length},metadata:{source:'mobile'}});
    res.json({status:'ok',version:APP_VERSION,topic,configuration});
  } catch(e) { res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message}); }
});


async function ensureDeviceOnboardingFoundation() {
  if (deviceOnboardingFoundationReady) return;
  await ensureDeviceRegistrySchema();
  await ensureDeviceInfoSyncSchema();
  await ensureAssetManagementFoundation();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_onboarding_sessions (
      id text PRIMARY KEY,
      device_uid text NOT NULL UNIQUE,
      serial_no text,
      model text NOT NULL DEFAULT 'FactoryBox One',
      expected_firmware text,
      customer_code text NOT NULL,
      site_code text NOT NULL,
      machine_code text NOT NULL,
      machine_name text,
      machine_type text,
      network_mode text NOT NULL DEFAULT 'ethernet',
      wifi_ssid text,
      mqtt_url text,
      mqtt_base_topic text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      current_step integer NOT NULL DEFAULT 1,
      connection_test text NOT NULL DEFAULT 'pending',
      heartbeat_test text NOT NULL DEFAULT 'pending',
      telemetry_test text NOT NULL DEFAULT 'pending',
      firmware_test text NOT NULL DEFAULT 'pending',
      alarm_test text NOT NULL DEFAULT 'pending',
      connection_test_at timestamptz,
      heartbeat_test_at timestamptz,
      telemetry_test_at timestamptz,
      firmware_test_at timestamptz,
      alarm_test_at timestamptz,
      activation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_error text,
      created_by_email text,
      activated_at timestamptz,
      deactivated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS expected_firmware text`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS firmware_test text NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS firmware_test_at timestamptz`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS network_mode text NOT NULL DEFAULT 'ethernet'`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS wifi_ssid text`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS mqtt_url text`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS activation_report jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE device_onboarding_sessions ADD COLUMN IF NOT EXISTS last_error text`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_onboarding_status_updated ON device_onboarding_sessions(status,updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_device_onboarding_customer_site ON device_onboarding_sessions(customer_code,site_code,updated_at DESC)`);
  deviceOnboardingFoundationReady = true;
}

function onboardingChoice(value, choices, fallback) {
  const normalized=String(value || fallback || '').trim().toLowerCase();
  return choices.includes(normalized) ? normalized : fallback;
}

function onboardingStaleSec() {
  const value=Number(process.env.DEVICE_ONBOARDING_STALE_SEC || 180);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value),30),3600) : 180;
}

function onboardingTokenMinutes(raw) {
  const value=Number(raw || 60);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value),5),1440) : 60;
}

async function deviceOnboardingOptions() {
  const [customers,sites,machines]=await Promise.all([
    pool.query(`SELECT code,name,status FROM customers ORDER BY name,code`),
    pool.query(`SELECT s.code,s.name,s.status,c.code AS customer_code FROM sites s JOIN customers c ON c.id=s.customer_id ORDER BY c.name,s.name`),
    pool.query(`SELECT m.id::text,m.code,m.name,m.machine_type,m.status,s.code AS site_code,c.code AS customer_code FROM machines m JOIN sites s ON s.id=m.site_id JOIN customers c ON c.id=s.customer_id ORDER BY c.name,s.name,m.name`)
  ]);
  return {
    customers:customers.rows,
    sites:sites.rows,
    machines:machines.rows,
    defaults:{
      customer_code:CFG.customerCode,
      site_code:CFG.siteCode,
      machine_code:CFG.machineCode,
      machine_type:CFG.machineType,
      model:CFG.deviceModel,
      mqtt_url:CFG.mqttUrl,
      mqtt_base_topic:CFG.baseTopic
    },
    stale_sec:onboardingStaleSec()
  };
}

async function deviceOnboardingRows({id=null,limit=200}={}) {
  const args=[];
  let where='';
  if (id) { args.push(String(id)); where=`WHERE o.id=$${args.length}`; }
  args.push(Math.min(Math.max(Number(limit||200),1),500));
  const result=await pool.query(`
    SELECT
      o.*,
      d.id::text AS device_id,
      d.status AS device_status,
      d.provisioning_status,
      d.provisioning_token_expires_at,
      d.provisioned_at,
      d.last_seen_at,
      d.firmware_version,
      d.hardware_revision,
      d.platform_name,
      d.build_type,
      d.firmware_build,
      m.id::text AS machine_id,
      m.name AS linked_machine_name,
      s.name AS site_name,
      c.name AS customer_name,
      lt.event_ts AS latest_telemetry_at,
      lt.current_amp AS latest_current_amp,
      lt.temperature_c AS latest_temperature_c,
      lt.wifi_rssi AS latest_wifi_rssi,
      lt.uptime_ms AS latest_uptime_ms,
      la.started_at AS latest_alarm_at,
      la.alarm_type AS latest_alarm_type,
      la.status AS latest_alarm_status
    FROM device_onboarding_sessions o
    LEFT JOIN devices d ON d.device_uid=o.device_uid
    LEFT JOIN machines m ON m.id=d.machine_id
    LEFT JOIN sites s ON s.id=m.site_id
    LEFT JOIN customers c ON c.id=s.customer_id
    LEFT JOIN LATERAL (
      SELECT event_ts,current_amp,temperature_c,wifi_rssi,uptime_ms
      FROM telemetry_events
      WHERE device_id=d.id
      ORDER BY event_ts DESC
      LIMIT 1
    ) lt ON true
    LEFT JOIN LATERAL (
      SELECT started_at,alarm_type,status
      FROM alarms
      WHERE device_id=d.id AND started_at>=o.created_at
      ORDER BY started_at DESC
      LIMIT 1
    ) la ON true
    ${where}
    ORDER BY o.updated_at DESC,o.created_at DESC
    LIMIT $${args.length}
  `,args);
  const now=Date.now();
  return result.rows.map(row=>{
    const lastSeenMs=row.last_seen_at?new Date(row.last_seen_at).getTime():0;
    const telemetryMs=row.latest_telemetry_at?new Date(row.latest_telemetry_at).getTime():0;
    const staleSec=onboardingStaleSec();
    const signalAgeSec=lastSeenMs?Math.max(0,Math.floor((now-lastSeenMs)/1000)):null;
    const telemetryAgeSec=telemetryMs?Math.max(0,Math.floor((now-telemetryMs)/1000)):null;
    return {
      ...row,
      signal_age_sec:signalAgeSec,
      telemetry_age_sec:telemetryAgeSec,
      broker_connected:Boolean(mqttConnected),
      connection_live:Boolean(row.provisioning_status==='paired' && signalAgeSec!==null && signalAgeSec<=staleSec),
      heartbeat_live:Boolean(telemetryAgeSec!==null && telemetryAgeSec<=staleSec),
      telemetry_available:Boolean(row.latest_telemetry_at),
      alarm_available:Boolean(row.latest_alarm_at),
      ready_for_activation:row.connection_test==='passed' &&
        row.heartbeat_test==='passed' &&
        row.telemetry_test==='passed' &&
        ['passed','skipped'].includes(row.firmware_test) &&
        ['passed','skipped'].includes(row.alarm_test)
    };
  });
}

async function deviceOnboardingRow(id) {
  const rows=await deviceOnboardingRows({id,limit:1});
  return rows[0]||null;
}

function qrGfMultiply(x,y) {
  let z=0;
  for(let i=7;i>=0;i--){
    z=(z<<1)^((z>>>7)*0x11D);
    if(((y>>>i)&1)!==0) z^=x;
  }
  return z&0xFF;
}

function qrRsDivisor(degree) {
  const result=new Array(degree).fill(0);
  result[degree-1]=1;
  let root=1;
  for(let i=0;i<degree;i++){
    for(let j=0;j<degree;j++){
      result[j]=qrGfMultiply(result[j],root);
      if(j+1<degree) result[j]^=result[j+1];
    }
    root=qrGfMultiply(root,2);
  }
  return result;
}

function qrRsRemainder(data,divisor) {
  const result=new Array(divisor.length).fill(0);
  for(const byte of data){
    const factor=byte^result[0];
    result.shift();
    result.push(0);
    for(let i=0;i<divisor.length;i++) result[i]^=qrGfMultiply(divisor[i],factor);
  }
  return result;
}

function onboardingQrSvg(payload) {
  const bytes=Buffer.from(String(payload||''),'utf8');
  if(bytes.length>106) throw new Error('QR payload is too long');
  const bits=[];
  const append=(value,count)=>{for(let i=count-1;i>=0;i--)bits.push((value>>>i)&1);};
  append(0b0100,4);
  append(bytes.length,8);
  for(const byte of bytes) append(byte,8);
  const capacity=108*8;
  for(let i=0;i<Math.min(4,capacity-bits.length);i++) bits.push(0);
  while(bits.length%8)bits.push(0);
  const data=[];
  for(let i=0;i<bits.length;i+=8){
    let value=0;
    for(let j=0;j<8;j++) value=(value<<1)|(bits[i+j]||0);
    data.push(value);
  }
  const pads=[0xEC,0x11];
  let padIndex=0;
  while(data.length<108)data.push(pads[(padIndex++)%2]);
  const codewords=[...data,...qrRsRemainder(data,qrRsDivisor(26))];
  const size=37;
  const matrix=Array.from({length:size},()=>Array(size).fill(false));
  const func=Array.from({length:size},()=>Array(size).fill(false));
  const setFunction=(x,y,value)=>{
    if(x>=0&&x<size&&y>=0&&y<size){matrix[y][x]=Boolean(value);func[y][x]=true;}
  };
  const finder=(cx,cy)=>{
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const x=cx+dx,y=cy+dy;
      if(x>=0&&x<size&&y>=0&&y<size){
        const dist=Math.max(Math.abs(dx),Math.abs(dy));
        setFunction(x,y,dist!==2&&dist!==4);
      }
    }
  };
  finder(3,3);finder(size-4,3);finder(3,size-4);
  for(let i=8;i<size-8;i++){
    if(!func[6][i])setFunction(i,6,i%2===0);
    if(!func[i][6])setFunction(6,i,i%2===0);
  }
  for(const cy of [6,30])for(const cx of [6,30]){
    if(func[cy][cx])continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)setFunction(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  const formatData=(1<<3);
  let remainder=formatData;
  for(let i=0;i<10;i++)remainder=(remainder<<1)^((((remainder>>>9)&1)!==0)?0x537:0);
  const formatBits=((formatData<<10)|remainder)^0x5412;
  const formatBit=i=>((formatBits>>>i)&1)!==0;
  for(let i=0;i<6;i++)setFunction(8,i,formatBit(i));
  setFunction(8,7,formatBit(6));setFunction(8,8,formatBit(7));setFunction(7,8,formatBit(8));
  for(let i=9;i<15;i++)setFunction(14-i,8,formatBit(i));
  for(let i=0;i<8;i++)setFunction(size-1-i,8,formatBit(i));
  for(let i=8;i<15;i++)setFunction(8,size-15+i,formatBit(i));
  setFunction(8,size-8,true);
  const allBits=[];
  for(const codeword of codewords)for(let i=7;i>=0;i--)allBits.push((codeword>>>i)&1);
  let index=0;
  let upward=true;
  for(let right=size-1;right>=1;right-=2){
    if(right===6)right--;
    for(let vertical=0;vertical<size;vertical++){
      const y=upward?size-1-vertical:vertical;
      for(let j=0;j<2;j++){
        const x=right-j;
        if(func[y][x])continue;
        let value=allBits[index++]||0;
        if((x+y)%2===0)value^=1;
        matrix[y][x]=Boolean(value);
      }
    }
    upward=!upward;
  }
  const border=4;
  let paths='';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(matrix[y][x])paths+=`M${x+border} ${y+border}h1v1h-1z`;
  const total=size+border*2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="FactoryBox provisioning QR"><rect width="100%" height="100%" fill="#fff"/><path d="${paths}" fill="#111827"/></svg>`;
}

app.get('/api/admin/device-onboarding', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const sessions=await deviceOnboardingRows({limit:req.query.limit||200});
    const options=await deviceOnboardingOptions();
    const summary={
      total:sessions.length,
      draft:sessions.filter(x=>x.status==='draft').length,
      waiting:sessions.filter(x=>['token_issued','waiting_device'].includes(x.status)).length,
      connected:sessions.filter(x=>['connected','tested'].includes(x.status)).length,
      active:sessions.filter(x=>x.status==='active').length,
      failed:sessions.filter(x=>x.status==='failed').length
    };
    res.json({status:'ok',version:APP_VERSION,summary,options,sessions});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/device-onboarding', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    if(!deviceProvisioningEnabled())return res.status(403).json({status:'disabled',version:APP_VERSION,message:'Device provisioning is disabled'});
    const customerCode=cleanCode(req.body?.customer_code||CFG.customerCode);
    const siteCode=cleanCode(req.body?.site_code||CFG.siteCode);
    const machineCode=cleanCode(req.body?.machine_code||req.body?.device_uid||CFG.machineCode);
    const machineName=cleanCode(req.body?.machine_name||machineCode);
    const machineType=cleanCode(req.body?.machine_type||CFG.machineType);
    const deviceUid=cleanCode(req.body?.device_uid);
    const serialNo=cleanCode(req.body?.serial_no);
    const model=cleanCode(req.body?.model||CFG.deviceModel);
    const expectedFirmware=cleanCode(req.body?.expected_firmware);
    const networkMode=onboardingChoice(req.body?.network_mode,['wifi','ethernet'],'ethernet');
    const wifiSsid=networkMode==='wifi'?cleanCode(req.body?.wifi_ssid):'';
    const mqttUrl=cleanCode(req.body?.mqtt_url||CFG.mqttUrl);
    const mqttBaseTopic=cleanCode(req.body?.mqtt_base_topic||`${customerCode}/${siteCode}/${machineCode}`);
    if(!deviceUid)return res.status(400).json({status:'error',version:APP_VERSION,message:'device_uid is required'});
    if(!customerCode||!siteCode||!machineCode)return res.status(400).json({status:'error',version:APP_VERSION,message:'customer_code, site_code and machine_code are required'});
    const activeExisting=await one(`SELECT id,status FROM device_onboarding_sessions WHERE device_uid=$1 LIMIT 1`,[deviceUid]);
    if(activeExisting && activeExisting.status==='active' && !Boolean(req.body?.reset_active))return res.status(409).json({status:'active_session_exists',version:APP_VERSION,message:'This device already has an active onboarding session'});
    const existingDevice=await deviceTenantRowByUid(deviceUid);
    const additionalDevice=existingDevice&&existingDevice.status!=='archived'?0:1;
    await assertSubscriptionCapacity(customerCode,'devices',additionalDevice,false);
    const {machine}=await resolveDeviceTarget(customerCode,siteCode,machineCode,machineName,machineType);
    await pool.query(`
      INSERT INTO devices(machine_id,device_uid,model,serial_no,mqtt_base_topic,status,provisioning_status,device_notes)
      VALUES($1,$2,$3,$4,$5,'offline','pending',$6)
      ON CONFLICT(device_uid) DO UPDATE SET machine_id=EXCLUDED.machine_id,model=EXCLUDED.model,
        serial_no=COALESCE(NULLIF(EXCLUDED.serial_no,''),devices.serial_no),mqtt_base_topic=EXCLUDED.mqtt_base_topic,
        status=CASE WHEN devices.status='archived' THEN 'offline' ELSE devices.status END,
        provisioning_status=CASE WHEN devices.provisioning_status='paired' THEN devices.provisioning_status ELSE 'pending' END,
        deactivated_at=NULL,updated_at=now()
    `,[machine.id,deviceUid,model,serialNo||null,mqttBaseTopic,`Onboarding network=${networkMode}`]);
    const id=activeExisting?.id||crypto.randomUUID();
    const session=await one(`
      INSERT INTO device_onboarding_sessions(
        id,device_uid,serial_no,model,expected_firmware,customer_code,site_code,machine_code,machine_name,machine_type,
        network_mode,wifi_ssid,mqtt_url,mqtt_base_topic,status,current_step,created_by_email
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',1,$15)
      ON CONFLICT(device_uid) DO UPDATE SET
        serial_no=EXCLUDED.serial_no,model=EXCLUDED.model,expected_firmware=EXCLUDED.expected_firmware,customer_code=EXCLUDED.customer_code,site_code=EXCLUDED.site_code,
        machine_code=EXCLUDED.machine_code,machine_name=EXCLUDED.machine_name,machine_type=EXCLUDED.machine_type,
        network_mode=EXCLUDED.network_mode,wifi_ssid=EXCLUDED.wifi_ssid,mqtt_url=EXCLUDED.mqtt_url,mqtt_base_topic=EXCLUDED.mqtt_base_topic,
        status='draft',current_step=1,connection_test='pending',heartbeat_test='pending',telemetry_test='pending',firmware_test='pending',alarm_test='pending',
        connection_test_at=NULL,heartbeat_test_at=NULL,telemetry_test_at=NULL,firmware_test_at=NULL,alarm_test_at=NULL,activation_report='{}'::jsonb,
        last_error=NULL,activated_at=NULL,deactivated_at=NULL,updated_at=now()
      RETURNING *
    `,[id,deviceUid,serialNo||null,model,expectedFirmware||null,customerCode,siteCode,machineCode,machineName,machineType,networkMode,wifiSsid||null,mqttUrl,mqttBaseTopic,req.user?.email||'local-admin']);
    await writeAuditLog(req,{action:'create_device_onboarding',entity_type:'device_onboarding',entity_id:session.id,old_values:activeExisting,new_values:session,metadata:{device_uid:deviceUid,customer_code:customerCode,site_code:siteCode,machine_code:machineCode}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message,resource:e.resource||null,usage:e.usage||null});}
});

app.post('/api/admin/device-onboarding/:id/provision-token', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Onboarding session not found'});
    if(session.status==='deactivated')return res.status(409).json({status:'deactivated',version:APP_VERSION,message:'Reopen the onboarding session first'});
    const token=makeProvisioningToken();
    const minutes=onboardingTokenMinutes(req.body?.token_minutes);
    const tokenHash=hashProvisioningToken(token);
    await pool.query(`
      UPDATE devices SET provisioning_status='pending',provisioning_token_hash=$1,
        provisioning_token_expires_at=now()+make_interval(mins=>$2),status='offline',updated_at=now()
      WHERE device_uid=$3
    `,[tokenHash,minutes,session.device_uid]);
    await pool.query(`UPDATE device_onboarding_sessions SET status='token_issued',current_step=4,last_error=NULL,updated_at=now() WHERE id=$1`,[session.id]);
    const origin=`${req.protocol}://${req.get('host')}`;
    const claimUrl=`${origin}/api/device/provision/claim`;
    const qrPayload=`FB1|${token}`;
    const configuration={
      schema:'factorybox-device-onboarding-v1',
      generated_at:new Date().toISOString(),
      claim_url:claimUrl,
      token,
      device_uid:session.device_uid,
      serial_no:session.serial_no||null,
      model:session.model,
      network:{mode:session.network_mode,ssid:session.wifi_ssid||null,password:null},
      mqtt:{url:session.mqtt_url,base_topic:session.mqtt_base_topic},
      capabilities:(await deviceCapabilitiesByUid(session.device_uid))?.capabilities||[]
    };
    await writeAuditLog(req,{action:'issue_onboarding_provision_token',entity_type:'device_onboarding',entity_id:session.id,old_values:{status:session.status},new_values:{status:'token_issued',token:'issued_once'},metadata:{device_uid:session.device_uid,expires_minutes:minutes}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id),provisioning:{token,expires_minutes:minutes,claim_url:claimUrl,qr_payload:qrPayload,qr_svg:onboardingQrSvg(qrPayload),configuration,token_visible_once:true}});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/device-command', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    const command=onboardingChoice(req.body?.command,['get_status','get_device_info','test_alarm'],'get_status');
    if(!mqttClient||!mqttConnected)return res.status(503).json({status:'mqtt_offline',version:APP_VERSION,message:'MQTT broker is not connected'});
    const topic=`${String(session.mqtt_base_topic||'').replace(/\/+$/,'')}/command`;
    const commandId=`onb-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const payload={command,command_id:commandId,source:'factorybox-onboarding',device_uid:session.device_uid,ts:new Date().toISOString()};
    await new Promise((resolve,reject)=>mqttClient.publish(topic,JSON.stringify(payload),{qos:0,retain:false},error=>error?reject(error):resolve()));
    await writeAuditLog(req,{action:'send_onboarding_device_command',entity_type:'device_onboarding',entity_id:session.id,old_values:null,new_values:{topic,command,command_id:commandId},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,topic,payload});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/tests', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    const stale=onboardingStaleSec();
    const connection=session.provisioning_status==='paired'&&session.signal_age_sec!==null&&session.signal_age_sec<=stale?'passed':'failed';
    const heartbeat=session.telemetry_age_sec!==null&&session.telemetry_age_sec<=stale?'passed':'failed';
    const telemetry=session.latest_telemetry_at?'passed':'failed';
    const actualFirmware=String(session.firmware_version||session.firmware_build||'').trim();
    const expectedFirmware=String(session.expected_firmware||'').trim();
    const firmware=!expectedFirmware?'skipped':(actualFirmware===expectedFirmware?'passed':'failed');
    const alarm=session.latest_alarm_at?'passed':(session.alarm_test==='skipped'?'skipped':'failed');
    const tested=connection==='passed'&&heartbeat==='passed'&&telemetry==='passed'&&['passed','skipped'].includes(firmware)&&['passed','skipped'].includes(alarm);
    const nextStatus=tested?'tested':connection==='passed'?'connected':session.provisioning_status==='paired'?'connected':'waiting_device';
    const errorParts=[];
    if(connection!=='passed')errorParts.push('device connection not detected');
    if(heartbeat!=='passed')errorParts.push('fresh heartbeat/telemetry not detected');
    if(telemetry!=='passed')errorParts.push('telemetry record not detected');
    if(!['passed','skipped'].includes(firmware))errorParts.push(`firmware mismatch: expected ${expectedFirmware}, actual ${actualFirmware||'unknown'}`);
    if(!['passed','skipped'].includes(alarm))errorParts.push('alarm test not detected');
    await pool.query(`
      UPDATE device_onboarding_sessions SET
        connection_test=$1,heartbeat_test=$2,telemetry_test=$3,firmware_test=$4,alarm_test=$5,
        connection_test_at=now(),heartbeat_test_at=now(),telemetry_test_at=now(),firmware_test_at=now(),alarm_test_at=now(),
        status=$6,current_step=5,last_error=$7,updated_at=now()
      WHERE id=$8
    `,[connection,heartbeat,telemetry,firmware,alarm,nextStatus,errorParts.join('; ')||null,session.id]);
    const updated=await deviceOnboardingRow(session.id);
    await writeAuditLog(req,{action:'run_device_onboarding_tests',entity_type:'device_onboarding',entity_id:session.id,old_values:{connection_test:session.connection_test,heartbeat_test:session.heartbeat_test,telemetry_test:session.telemetry_test,firmware_test:session.firmware_test,alarm_test:session.alarm_test},new_values:{connection_test:connection,heartbeat_test:heartbeat,telemetry_test:telemetry,firmware_test:firmware,alarm_test:alarm,status:nextStatus},metadata:{device_uid:session.device_uid,stale_sec:stale}});
    res.json({status:'ok',version:APP_VERSION,session:updated});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/skip-firmware-test', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    await pool.query(`UPDATE device_onboarding_sessions SET firmware_test='skipped',firmware_test_at=now(),updated_at=now() WHERE id=$1`,[session.id]);
    await writeAuditLog(req,{action:'skip_onboarding_firmware_test',entity_type:'device_onboarding',entity_id:session.id,old_values:{firmware_test:session.firmware_test},new_values:{firmware_test:'skipped'},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/skip-alarm-test', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    await pool.query(`UPDATE device_onboarding_sessions SET alarm_test='skipped',alarm_test_at=now(),updated_at=now() WHERE id=$1`,[session.id]);
    await writeAuditLog(req,{action:'skip_onboarding_alarm_test',entity_type:'device_onboarding',entity_id:session.id,old_values:{alarm_test:session.alarm_test},new_values:{alarm_test:'skipped'},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/activate', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    const requiredPassed=session.connection_test==='passed'&&session.heartbeat_test==='passed'&&session.telemetry_test==='passed'&&['passed','skipped'].includes(session.firmware_test)&&['passed','skipped'].includes(session.alarm_test);
    if(!requiredPassed)return res.status(409).json({status:'tests_required',version:APP_VERSION,message:'Connection, heartbeat and telemetry tests must pass. Firmware and alarm tests must pass or be skipped.'});
    const report={
      completed_at:new Date().toISOString(),
      device_uid:session.device_uid,
      serial_no:session.serial_no||null,
      model:session.model,
      customer_code:session.customer_code,
      site_code:session.site_code,
      machine_code:session.machine_code,
      network_mode:session.network_mode,
      mqtt_base_topic:session.mqtt_base_topic,
      firmware_version:session.firmware_version||null,
      hardware_revision:session.hardware_revision||null,
      wifi_rssi:session.latest_wifi_rssi??null,
      tests:{connection:session.connection_test,heartbeat:session.heartbeat_test,telemetry:session.telemetry_test,firmware:session.firmware_test,alarm:session.alarm_test},
      activated_by:req.user?.email||'local-admin'
    };
    await pool.query(`UPDATE device_onboarding_sessions SET status='active',current_step=6,activation_report=$1::jsonb,activated_at=now(),deactivated_at=NULL,last_error=NULL,updated_at=now() WHERE id=$2`,[JSON.stringify(report),session.id]);
    await pool.query(`UPDATE devices SET status='online',provisioning_status='paired',deactivated_at=NULL,updated_at=now() WHERE device_uid=$1`,[session.device_uid]);
    await writeAuditLog(req,{action:'activate_device_onboarding',entity_type:'device_onboarding',entity_id:session.id,old_values:{status:session.status},new_values:{status:'active',activation_report:report},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id),report});
  }catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/reopen', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    await pool.query(`UPDATE device_onboarding_sessions SET status='draft',current_step=1,connection_test='pending',heartbeat_test='pending',telemetry_test='pending',firmware_test='pending',alarm_test='pending',connection_test_at=NULL,heartbeat_test_at=NULL,telemetry_test_at=NULL,firmware_test_at=NULL,alarm_test_at=NULL,activation_report='{}'::jsonb,last_error=NULL,activated_at=NULL,deactivated_at=NULL,updated_at=now() WHERE id=$1`,[session.id]);
    await pool.query(`UPDATE devices SET status='offline',provisioning_status='pending',provisioning_token_hash=NULL,provisioning_token_expires_at=NULL,deactivated_at=NULL,updated_at=now() WHERE device_uid=$1`,[session.device_uid]);
    await writeAuditLog(req,{action:'reopen_device_onboarding',entity_type:'device_onboarding',entity_id:session.id,old_values:{status:session.status},new_values:{status:'draft'},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',message:e.message});}
});

app.post('/api/admin/device-onboarding/:id/deactivate', adminRequired, permissionRequired('MANAGE_DEVICES'), async (req,res)=>{
  try{
    await ensureDeviceOnboardingFoundation();
    const session=await deviceOnboardingRow(req.params.id);
    if(!session)return res.status(404).json({status:'not_found',message:'Onboarding session not found'});
    await pool.query(`UPDATE device_onboarding_sessions SET status='deactivated',deactivated_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`,[session.id]);
    await pool.query(`UPDATE devices SET status='archived',provisioning_status='revoked',provisioning_token_hash=NULL,provisioning_token_expires_at=NULL,deactivated_at=now(),updated_at=now() WHERE device_uid=$1`,[session.device_uid]);
    await writeAuditLog(req,{action:'deactivate_device_onboarding',entity_type:'device_onboarding',entity_id:session.id,old_values:{status:session.status},new_values:{status:'deactivated'},metadata:{device_uid:session.device_uid}});
    res.json({status:'ok',version:APP_VERSION,session:await deviceOnboardingRow(session.id)});
  }catch(e){res.status(e.statusCode||500).json({status:'error',message:e.message});}
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
      text:inviteText(invite, inviteUrl),
      purpose:'user_invite',
      metadata:{customer_code:invite.customer_code,site_code:invite.site_code}
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
    const managedSession = await createManagedSession(req,user,tenant);
    const sessionToken = managedSession.token;
    const expiresAt = managedSession.expires_at;

    await pool.query(`UPDATE app_users SET last_login_at=now(),last_login_ip=$2,last_login_user_agent=$3,failed_login_count=0,locked_until=NULL,updated_at=now() WHERE id=$1`, [user.id,reqIp(req),req.headers['user-agent']||null]);

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

    let revokedSessions = 0;
    if (status !== 'active') revokedSessions = await revokeSessionsForUser(user.id,{actorEmail:req.user.email,reason:`user_status_${status}`});

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
      user,
      revoked_sessions:revokedSessions
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

    const revokedSessions = await revokeSessionsForUser(user.id,{preserveToken:String(req.user?.id||'')===String(user.id)?bearerToken(req):null,actorEmail:req.user.email,reason:'role_changed'});

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
      user,
      revoked_sessions:revokedSessions
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

  // Machine-to-machine endpoints authenticate with a provisioning token or
  // installation API key. They must not be intercepted by browser login auth.
  if (req.path === '/public/installations/provision/exchange') return next();
  if (req.path === '/central-mail/v1/status') return next();
  if (req.path === '/central-mail/v1/deployment/confirm') return next();
  if (req.path === '/central-mail/v1/send') return next();

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
    const mqttConfigured=Boolean(String(process.env.MQTT_URL||'').trim());
    res.json({ status:'ok', service:'factorybox-platform-backend', version:APP_VERSION, database_time: db.rows[0].now, mqtt_connected:Boolean(mqttConfigured&&mqttConnected), mqtt_broker_connected:Boolean(mqttConnected), mqtt_configured:mqttConfigured, mqtt_base_topic:CFG.baseTopic, last_mqtt_message_at:lastMqttMessageAt, last_mqtt_topic:lastMqttTopic, counts });
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




function mailGatewayModeValue(value, fallback = 'direct_smtp') {
  const clean = String(value || fallback || '').trim().toLowerCase();
  return ['gateway','direct_smtp','disabled'].includes(clean) ? clean : fallback;
}

function normalizeMailGatewayBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const localHosts = new Set(['localhost','127.0.0.1','::1','backend','mail-gateway','host.docker.internal']);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHosts.has(parsed.hostname.toLowerCase()))) return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function environmentMailGatewayEnforced() {
  return String(process.env.FACTORYBOX_MAIL_MODE || '').trim().toLowerCase() === 'gateway';
}

function emailConfig() {
  const envMode = String(process.env.FACTORYBOX_MAIL_MODE || '').trim().toLowerCase();
  const envModeConfigured = ['gateway','direct_smtp','disabled'].includes(envMode);
  const mode = envModeConfigured
    ? envMode
    : mailGatewayModeValue(runtimeNotificationValue('email_mode', 'direct_smtp'));
  const gatewayEnforced = mode === 'gateway' && envModeConfigured;

  const host = gatewayEnforced ? '' : String(runtimeNotificationValue('smtp_host', process.env.SMTP_HOST || '') || '').trim();
  const port = gatewayEnforced ? 587 : Number(runtimeNotificationValue('smtp_port', process.env.SMTP_PORT || 587));
  const secureRaw = gatewayEnforced ? false : runtimeNotificationValue('smtp_secure', process.env.SMTP_SECURE || '');
  const user = gatewayEnforced ? '' : String(runtimeNotificationValue('smtp_user', process.env.SMTP_USER || '') || '').trim();
  const pass = gatewayEnforced ? '' : String(runtimeNotificationValue('smtp_pass', process.env.SMTP_PASS || '') || '');
  const from = gatewayEnforced ? '' : String(runtimeNotificationValue('smtp_from', process.env.SMTP_FROM || user) || '').trim();
  const defaultTo = String(runtimeNotificationValue('email_default_to', process.env.REPORT_EMAIL_TO || '') || '').trim();
  const secure = String(secureRaw).toLowerCase() === 'true' || port === 465;
  const enabled = runtimeBoolean('email_enabled', 'EMAIL_REPORTS_ENABLED', true);

  const senderNameSource = gatewayEnforced
    ? (process.env.FACTORYBOX_MAIL_SENDER_NAME || 'HukaTech')
    : runtimeNotificationValue('email_sender_name', process.env.FACTORYBOX_MAIL_SENDER_NAME || `FactoryBox | ${CFG.customerName}`);
  const senderName = String(senderNameSource || 'HukaTech').trim().slice(0, 200);

  const gatewayUrlSource = gatewayEnforced
    ? process.env.FACTORYBOX_MAIL_GATEWAY_URL
    : runtimeNotificationValue('mail_gateway_url', process.env.FACTORYBOX_MAIL_GATEWAY_URL || '');
  const gatewayInstallationIdSource = gatewayEnforced
    ? process.env.FACTORYBOX_MAIL_INSTALLATION_ID
    : runtimeNotificationValue('mail_gateway_installation_id', process.env.FACTORYBOX_MAIL_INSTALLATION_ID || CFG.customerCode);
  const gatewayApiKeySource = gatewayEnforced
    ? process.env.FACTORYBOX_MAIL_API_KEY
    : runtimeNotificationValue('mail_gateway_api_key', process.env.FACTORYBOX_MAIL_API_KEY || '');

  const gatewayUrl = normalizeMailGatewayBaseUrl(gatewayUrlSource);
  const gatewayInstallationId = String(gatewayInstallationIdSource || '').trim().slice(0, 200);
  const gatewayApiKey = String(gatewayApiKeySource || '').trim();
  const gatewayAllowSmtpFallback = gatewayEnforced
    ? false
    : runtimeBoolean('mail_gateway_allow_smtp_fallback', 'FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK', false);

  const smtpConfigured = Boolean(host && user && pass && from);
  const gatewayConfigured = Boolean(gatewayUrl && gatewayInstallationId && gatewayApiKey);
  const configured = mode === 'gateway'
    ? gatewayConfigured
    : mode === 'direct_smtp'
      ? smtpConfigured
      : false;

  return {
    enabled,
    mode,
    configured,
    senderName,
    host,
    port:Number.isFinite(port) ? port : 587,
    secure,
    user,
    pass,
    from,
    defaultTo,
    smtpConfigured,
    gatewayEnforced,
    gateway:{
      url:gatewayUrl,
      installationId:gatewayInstallationId,
      apiKey:gatewayApiKey,
      allowSmtpFallback:gatewayAllowSmtpFallback,
      configured:gatewayConfigured,
      timeoutMs:Math.min(Math.max(Number(process.env.FACTORYBOX_MAIL_GATEWAY_TIMEOUT_MS || 15000), 2000), 60000)
    }
  };
}

function splitEmails(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean))];
}

function isValidEmailRecipient(value) {
  const clean = String(value || '').trim();
  return clean.length <= 320
    && !/[\r\n]/.test(clean)
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
}

function validatedEmailRecipients(value, max = 50) {
  const recipients = splitEmails(value);
  if (recipients.length > max) throw new Error(`Too many email recipients; maximum is ${max}`);
  const invalid = recipients.filter(item => !isValidEmailRecipient(item));
  if (invalid.length) throw new Error('One or more recipient email addresses are invalid');
  return recipients;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeEmailHeader(value, max = 300) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function mailPurpose(value) {
  const clean = String(value || 'notification').trim().toLowerCase();
  const allowed = new Set([
    'notification','password_reset','user_invite','alarm','alarm_report',
    'maintenance','daily_report','weekly_report','subscription','test'
  ]);
  return allowed.has(clean) ? clean : 'notification';
}

function mailMetadata(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ['customer_code','site_code','machine_code','report_type','event_id']) {
    if (source[key] !== undefined && source[key] !== null) result[key] = String(source[key]).slice(0, 200);
  }
  return result;
}

function maskedRecipientList(recipients) {
  return recipients.map(maskEmail);
}

function emailSubjectForReport(site, report, prefix = 'FactoryBox Günlük Rapor') {
  const score = report.health_score ?? report.overall_score ?? report.report_json?.overall_score ?? '-';
  const siteName = site?.name || site?.code || 'site';
  const date = new Date(report.created_at || report.generated_at || Date.now()).toLocaleDateString('tr-TR');
  return `${prefix} - ${siteName} - Skor ${score}/100 - ${date}`;
}

async function recordOutboundEmailStart({requestId,purpose,mode,recipients,subject,metadata}) {
  try {
    await pool.query(`
      INSERT INTO outbound_email_deliveries
        (request_id,purpose,mode,recipient_count,recipients_masked,subject,status,metadata)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,'processing',$7::jsonb)
      ON CONFLICT(request_id) DO UPDATE SET
        purpose=EXCLUDED.purpose,mode=EXCLUDED.mode,recipient_count=EXCLUDED.recipient_count,
        recipients_masked=EXCLUDED.recipients_masked,subject=EXCLUDED.subject,status='processing',
        error_message=NULL,metadata=EXCLUDED.metadata,updated_at=now()
    `, [
      requestId,purpose,mode,recipients.length,JSON.stringify(maskedRecipientList(recipients)),
      safeEmailHeader(subject,500),JSON.stringify(mailMetadata(metadata))
    ]);
  } catch (error) {
    console.warn('Outbound email start log failed:', error.message);
  }
}

async function recordOutboundEmailFinish({requestId,status,provider,messageId,errorMessage}) {
  try {
    await pool.query(`
      UPDATE outbound_email_deliveries SET
        status=$2,provider=$3,provider_message_id=$4,error_message=$5,
        delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,
        updated_at=now()
      WHERE request_id=$1
    `, [requestId,status,provider || null,messageId || null,errorMessage ? String(errorMessage).slice(0,1000) : null]);
  } catch (error) {
    console.warn('Outbound email finish log failed:', error.message);
  }
}

async function sendDirectSmtpEmail({to,subject,html,text,fromName=null,replyTo=null}, smtpConfig = emailConfig()) {
  if (!smtpConfig.smtpConfigured) return {sent:false,reason:'SMTP settings not configured',provider:'smtp'};
  const recipients = Array.isArray(to) ? to : validatedEmailRecipients(to);
  if (!recipients.length) return {sent:false,reason:'Recipient email not configured',provider:'smtp'};

  const transporter = nodemailer.createTransport({
    host:smtpConfig.host,
    port:smtpConfig.port,
    secure:smtpConfig.secure,
    auth:{user:smtpConfig.user,pass:smtpConfig.pass},
    connectionTimeout:15000,
    greetingTimeout:15000,
    socketTimeout:30000
  });

  const displayName = safeEmailHeader(fromName || smtpConfig.senderName || 'FactoryBox', 160);
  const fromValue = displayName ? `${displayName} <${smtpConfig.from}>` : smtpConfig.from;
  const info = await transporter.sendMail({
    from:fromValue,
    to:recipients.join(','),
    subject:safeEmailHeader(subject,300),
    text:text || stripHtml(html),
    html,
    ...(replyTo ? {replyTo:safeEmailHeader(replyTo,320)} : {})
  });

  return {
    sent:true,
    provider:'smtp',
    message_id:info.messageId || null,
    accepted:info.accepted || [],
    rejected:info.rejected || [],
    to:recipients
  };
}

async function sendViaMailGateway({to,subject,html,text,purpose,metadata,requestId}, cfg = emailConfig()) {
  if (!cfg.gateway.configured) return {sent:false,reason:'HukaTech Central Mail Gateway is not configured',provider:'factorybox_gateway'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.gateway.timeoutMs);
  timeout.unref?.();
  try {
    const gatewayBase=String(cfg.gateway.url || '').replace(/\/+$/,'');
    const gatewaySendUrl=/\/api\/central-mail\/v1$/i.test(gatewayBase)
      ? `${gatewayBase}/send`
      : `${gatewayBase}/api/mail-gateway/v1/send`;
    const response = await fetch(gatewaySendUrl, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'authorization':`Bearer ${cfg.gateway.apiKey}`,
        'x-factorybox-installation-id':cfg.gateway.installationId,
        'x-factorybox-version':APP_VERSION,
        'x-request-id':requestId
      },
      body:JSON.stringify({
        request_id:requestId,
        purpose,
        to,
        subject:safeEmailHeader(subject,300),
        html:String(html || ''),
        text:String(text || ''),
        sender_name:cfg.senderName,
        metadata:{
          customer_code:CFG.customerCode,
          customer_name:CFG.customerName,
          site_code:CFG.siteCode,
          ...mailMetadata(metadata)
        }
      }),
      signal:controller.signal
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok || payload.sent === false) {
      throw new Error(payload.message || payload.reason || `Mail Gateway HTTP ${response.status}`);
    }
    return {
      sent:true,
      provider:'factorybox_gateway',
      message_id:payload.message_id || null,
      gateway_request_id:payload.request_id || requestId,
      duplicate:Boolean(payload.duplicate),
      accepted:payload.accepted || to,
      rejected:payload.rejected || [],
      to
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('HukaTech Central Mail Gateway timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMailGatewayConnection() {
  const cfg = emailConfig();
  if (!cfg.gateway.configured) return {connected:false,configured:false,message:'HukaTech Central Mail Gateway is not configured'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.gateway.timeoutMs);
  timeout.unref?.();
  try {
    const gatewayBase=String(cfg.gateway.url || '').replace(/\/+$/,'');
    const gatewayStatusUrl=/\/api\/central-mail\/v1$/i.test(gatewayBase)
      ? `${gatewayBase}/status`
      : `${gatewayBase}/api/mail-gateway/v1/status`;
    const response = await fetch(gatewayStatusUrl, {
      method:'GET',
      headers:{
        'authorization':`Bearer ${cfg.gateway.apiKey}`,
        'x-factorybox-installation-id':cfg.gateway.installationId,
        'x-factorybox-version':APP_VERSION
      },
      signal:controller.signal
    });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok) throw new Error(payload.message || `Mail Gateway HTTP ${response.status}`);
    return {connected:true,configured:true,...payload};
  } catch (error) {
    if (error.name === 'AbortError') return {connected:false,configured:true,message:'HukaTech Central Mail Gateway timeout'};
    return {connected:false,configured:true,message:error.message};
  } finally {
    clearTimeout(timeout);
  }
}

async function sendReportEmail({to, subject, html, text, purpose='notification', metadata={}}) {
  const cfg = emailConfig();
  const cleanPurpose = mailPurpose(purpose);
  const recipients = validatedEmailRecipients(to || cfg.defaultTo);
  const requestId = crypto.randomUUID();
  const mode = cfg.mode;

  if (!cfg.enabled || mode === 'disabled') {
    return {sent:false,reason:!cfg.enabled ? 'EMAIL_REPORTS_ENABLED=false' : 'Email delivery mode is disabled',mode,provider:null};
  }
  if (!recipients.length) return {sent:false,reason:'Recipient email not configured',mode,provider:null};
  if (!cfg.configured) {
    return {
      sent:false,
      reason:mode === 'gateway' ? 'HukaTech Central Mail Gateway is not configured' : 'SMTP settings not configured',
      mode,
      provider:mode === 'gateway' ? 'factorybox_gateway' : 'smtp'
    };
  }

  await recordOutboundEmailStart({
    requestId,purpose:cleanPurpose,mode,recipients,subject,metadata
  });

  try {
    let result;
    if (mode === 'gateway') {
      try {
        result = await sendViaMailGateway({
          to:recipients,subject,html,text,purpose:cleanPurpose,metadata,requestId
        }, cfg);
      } catch (gatewayError) {
        if (!cfg.gateway.allowSmtpFallback || !cfg.smtpConfigured) throw gatewayError;
        result = await sendDirectSmtpEmail({
          to:recipients,subject,html,text,fromName:cfg.senderName
        }, cfg);
        result.fallback_from = 'factorybox_gateway';
        result.gateway_error = gatewayError.message;
      }
    } else {
      result = await sendDirectSmtpEmail({
        to:recipients,subject,html,text,fromName:cfg.senderName
      }, cfg);
    }

    if (!result.sent) {
      await recordOutboundEmailFinish({
        requestId,status:'failed',provider:result.provider,errorMessage:result.reason
      });
      return {...result,request_id:requestId,mode};
    }

    await recordOutboundEmailFinish({
      requestId,status:'delivered',provider:result.provider,messageId:result.message_id
    });
    return {...result,request_id:requestId,mode};
  } catch (error) {
    await recordOutboundEmailFinish({
      requestId,status:'failed',
      provider:mode === 'gateway' ? 'factorybox_gateway' : 'smtp',
      errorMessage:error.message
    });
    throw error;
  }
}

function mailGatewayServerEnabled() {
  return String(process.env.MAIL_GATEWAY_SERVER_ENABLED || 'false').toLowerCase() === 'true';
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

function mailGatewayInstallationRecords() {
  const records = new Map();
  const raw = String(process.env.MAIL_GATEWAY_INSTALLATIONS_JSON || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const id = String(row?.installation_id || row?.id || '').trim();
          if (id) records.set(id,{...row,installation_id:id});
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const [id,value] of Object.entries(parsed)) {
          if (value && typeof value === 'object') records.set(String(id),{...value,installation_id:String(id)});
        }
      }
    } catch (error) {
      console.error('MAIL_GATEWAY_INSTALLATIONS_JSON parse error:', error.message);
    }
  }

  const singleId = String(process.env.MAIL_GATEWAY_SINGLE_INSTALLATION_ID || '').trim();
  if (singleId) {
    records.set(singleId,{
      installation_id:singleId,
      customer_code:String(process.env.MAIL_GATEWAY_SINGLE_CUSTOMER_CODE || singleId).trim(),
      customer_name:String(process.env.MAIL_GATEWAY_SINGLE_CUSTOMER_NAME || singleId).trim(),
      public_hostname:String(process.env.MAIL_GATEWAY_SINGLE_PUBLIC_HOSTNAME || '').trim().toLowerCase(),
      tunnel_name:String(process.env.MAIL_GATEWAY_SINGLE_TUNNEL_NAME || '').trim(),
      api_key:String(process.env.MAIL_GATEWAY_SINGLE_API_KEY || ''),
      api_key_sha256:String(process.env.MAIL_GATEWAY_SINGLE_API_KEY_SHA256 || '').trim().toLowerCase(),
      enabled:String(process.env.MAIL_GATEWAY_SINGLE_ENABLED || 'true').toLowerCase() !== 'false',
      registry_admin:String(process.env.MAIL_GATEWAY_SINGLE_REGISTRY_ADMIN || 'false').toLowerCase() === 'true',
      max_per_minute:Number(process.env.MAIL_GATEWAY_SINGLE_MAX_PER_MINUTE || process.env.MAIL_GATEWAY_MAX_PER_MINUTE || 30),
      max_per_day:Number(process.env.MAIL_GATEWAY_SINGLE_MAX_PER_DAY || process.env.MAIL_GATEWAY_MAX_PER_DAY || 500),
      source:'environment'
    });
  }
  return records;
}

function gatewayInstallationKeyMatches(record, providedKey) {
  if (!record || !providedKey) return false;
  const expectedHash = String(record.api_key_sha256 || '').trim().toLowerCase();
  if (expectedHash) return timingSafeStringEqual(sha256Hex(providedKey), expectedHash);
  return timingSafeStringEqual(providedKey, String(record.api_key || ''));
}


let installationRegistryFoundationReady = false;

function installationRegistryStatus(value, fallback='active') {
  const clean=String(value || fallback).trim().toLowerCase();
  return ['pending','active','disabled','archived'].includes(clean) ? clean : fallback;
}

function installationRegistrySlug(value) {
  const clean=String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .replace(/-{2,}/g,'-');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(clean)) {
    const error=new Error('Installation slug must contain lowercase letters, numbers and dash only');
    error.statusCode=400;
    throw error;
  }
  return clean;
}

function installationRegistryHostname(value, slug='') {
  const raw=String(value || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
  const host=raw || (slug ? `${slug}.hukatech.com` : '');
  if (!host || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+hukatech\.com$/.test(host)) {
    const error=new Error('Public hostname must be a valid hukatech.com subdomain');
    error.statusCode=400;
    throw error;
  }
  return host;
}

function installationRegistryLimit(value, fallback, max) {
  const parsed=Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    const error=new Error(`Rate limit must be between 1 and ${max}`);
    error.statusCode=400;
    throw error;
  }
  return parsed;
}

function installationRegistryId(slug) {
  return `ht-${slug}-${crypto.randomBytes(4).toString('hex')}`;
}

function installationRegistryApiKey() {
  return `htk_${crypto.randomBytes(32).toString('base64url')}`;
}

function installationProvisioningToken() {
  return `htp_${crypto.randomBytes(32).toString('base64url')}`;
}

function installationProvisioningMinutes(value, fallback=30) {
  const parsed=Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 1440) {
    const error=new Error('Provisioning token lifetime must be between 5 and 1440 minutes');
    error.statusCode=400;
    throw error;
  }
  return parsed;
}

function installationPublicAppUrl() {
  const raw=String(process.env.PUBLIC_APP_URL || 'https://panel.hukatech.com').trim().replace(/\/+$/,'');
  try {
    const parsed=new URL(raw);
    if (!['https:','http:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    return parsed.toString().replace(/\/+$/,'');
  } catch (_) {
    return 'https://panel.hukatech.com';
  }
}

function installationPublicMailGatewayUrl() {
  const configured=String(process.env.PUBLIC_MAIL_GATEWAY_URL || process.env.MAIL_GATEWAY_PUBLIC_URL || '').trim().replace(/\/+$/,'');
  return configured || `${installationPublicAppUrl()}/api/central-mail/v1`;
}

function centralGatewayInternalBaseUrl() {
  const explicit=String(process.env.CENTRAL_MAIL_GATEWAY_INTERNAL_URL || '').trim().replace(/\/+$/,'');
  if (explicit) return explicit;
  const configured=String(emailConfig().gateway.url || '').trim().replace(/\/+$/,'');
  if (!configured || /\/api\/central-mail\/v1$/i.test(configured)) return '';
  return configured;
}

function installationRegistryPublicRow(row) {
  if (!row) return null;
  return {
    installation_id:row.installation_id,
    customer_code:row.customer_code,
    customer_name:row.customer_name,
    slug:row.slug,
    public_hostname:row.public_hostname,
    tunnel_name:row.tunnel_name,
    tunnel_status:row.tunnel_status,
    status:row.status,
    enabled:row.status === 'active',
    api_key_prefix:row.api_key_prefix,
    registry_admin:Boolean(row.registry_admin),
    max_per_minute:Number(row.max_per_minute || 30),
    max_per_day:Number(row.max_per_day || 500),
    source:row.source || 'database',
    notes:row.notes,
    last_authenticated_at:row.last_authenticated_at,
    last_mail_at:row.last_mail_at,
    created_at:row.created_at,
    updated_at:row.updated_at,
    disabled_at:row.disabled_at,
    rotated_at:row.rotated_at,
    provisioning_status:row.provisioning_status || 'registered',
    provisioning_token_prefix:row.provisioning_token_prefix || null,
    provisioning_token_expires_at:row.provisioning_token_expires_at || null,
    provisioning_token_used_at:row.provisioning_token_used_at || null,
    package_generated_at:row.package_generated_at || null,
    provisioned_at:row.provisioned_at || null,
    verified_at:row.verified_at || null,
    revoked_at:row.revoked_at || null,
    last_provisioned_version:row.last_provisioned_version || null,
    key_generation:Number(row.key_generation || 1),
    cloudflare_tunnel_id:row.cloudflare_tunnel_id || null,
    cloudflare_dns_record_id:row.cloudflare_dns_record_id || null,
    cloudflare_origin_service:row.cloudflare_origin_service || null,
    cloudflare_provisioned_at:row.cloudflare_provisioned_at || null,
    cloudflare_last_checked_at:row.cloudflare_last_checked_at || null,
    cloudflare_error:row.cloudflare_error || null
  };
}

async function ensureInstallationRegistryFoundation() {
  if (installationRegistryFoundationReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_installations (
      installation_id text PRIMARY KEY,
      customer_code text NOT NULL,
      customer_name text NOT NULL,
      slug text NOT NULL UNIQUE,
      public_hostname text NOT NULL UNIQUE,
      tunnel_name text,
      tunnel_status text NOT NULL DEFAULT 'pending',
      status text NOT NULL DEFAULT 'active',
      api_key_sha256 text NOT NULL,
      api_key_prefix text NOT NULL,
      registry_admin boolean NOT NULL DEFAULT false,
      max_per_minute integer NOT NULL DEFAULT 30,
      max_per_day integer NOT NULL DEFAULT 500,
      source text NOT NULL DEFAULT 'database',
      notes text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_authenticated_at timestamptz,
      last_mail_at timestamptz,
      disabled_at timestamptz,
      rotated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (status IN ('pending','active','disabled','archived')),
      CHECK (tunnel_status IN ('pending','connected','offline','error','not_configured')),
      CHECK (source IN ('database','environment')),
      CHECK (max_per_minute BETWEEN 1 AND 1000),
      CHECK (max_per_day BETWEEN 1 AND 1000000)
    )
  `);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'registered'`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioning_token_sha256 text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioning_token_prefix text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioning_token_expires_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioning_token_used_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS package_generated_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS provisioned_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS verified_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS revoked_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS last_provisioned_version text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS key_generation integer NOT NULL DEFAULT 1`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_tunnel_id text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_dns_record_id text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_origin_service text`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_provisioned_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_last_checked_at timestamptz`);
  await pool.query(`ALTER TABLE customer_installations ADD COLUMN IF NOT EXISTS cloudflare_error text`);
  await pool.query(`
    DO $$
    DECLARE
      current_definition text;
    BEGIN
      SELECT pg_get_constraintdef(oid)
      INTO current_definition
      FROM pg_constraint
      WHERE conname='customer_installations_provisioning_status_check'
        AND conrelid='customer_installations'::regclass;

      IF current_definition IS NULL OR position('cloudflare_ready' in current_definition)=0 THEN
        ALTER TABLE customer_installations
          DROP CONSTRAINT IF EXISTS customer_installations_provisioning_status_check;
        ALTER TABLE customer_installations
          ADD CONSTRAINT customer_installations_provisioning_status_check
          CHECK (provisioning_status IN (
            'registered','cloudflare_ready','package_generated','provisioned','verified','revoked'
          ));
      END IF;
    END $$;
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_installations_cloudflare_tunnel_id ON customer_installations(cloudflare_tunnel_id) WHERE cloudflare_tunnel_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_installations_provisioning_status ON customer_installations(provisioning_status, updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_installations_status ON customer_installations(status, updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_installations_customer_code ON customer_installations(customer_code)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_installation_events (
      id bigserial PRIMARY KEY,
      installation_id text NOT NULL,
      action text NOT NULL,
      actor_installation_id text,
      actor_email text,
      old_values jsonb,
      new_values jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_installation_events_installation ON customer_installation_events(installation_id, created_at DESC)`);

  for (const record of mailGatewayInstallationRecords().values()) {
    const hash=String(record.api_key_sha256 || '').trim().toLowerCase() || sha256Hex(record.api_key || '');
    if (!hash || hash.length !== 64) continue;
    const fallbackSlug=String(record.customer_code || record.installation_id || 'pilot').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') || 'pilot';
    const slug=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(fallbackSlug) ? fallbackSlug : 'pilot';
    const hostname=String(record.public_hostname || '').trim().toLowerCase() || `${slug}.hukatech.com`;
    await pool.query(`
      INSERT INTO customer_installations(
        installation_id,customer_code,customer_name,slug,public_hostname,tunnel_name,tunnel_status,status,
        api_key_sha256,api_key_prefix,registry_admin,max_per_minute,max_per_day,source,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'environment',now())
      ON CONFLICT(installation_id) DO UPDATE SET
        customer_code=EXCLUDED.customer_code,customer_name=EXCLUDED.customer_name,
        public_hostname=EXCLUDED.public_hostname,tunnel_name=EXCLUDED.tunnel_name,
        status=EXCLUDED.status,api_key_sha256=EXCLUDED.api_key_sha256,
        api_key_prefix=EXCLUDED.api_key_prefix,registry_admin=EXCLUDED.registry_admin,
        max_per_minute=EXCLUDED.max_per_minute,max_per_day=EXCLUDED.max_per_day,
        source='environment',updated_at=now()
    `,[
      record.installation_id,
      String(record.customer_code || record.installation_id).slice(0,100),
      String(record.customer_name || record.installation_id).slice(0,180),
      slug,hostname,String(record.tunnel_name || '').slice(0,180) || null,
      record.tunnel_name ? 'connected' : 'not_configured',record.enabled === false ? 'disabled' : 'active',
      hash,String(record.api_key || '').slice(0,8) || hash.slice(0,8),Boolean(record.registry_admin),
      installationRegistryLimit(record.max_per_minute,30,1000),installationRegistryLimit(record.max_per_day,500,1000000)
    ]);
    await pool.query(`
      UPDATE customer_installations SET
        provisioning_status='verified',
        provisioned_at=COALESCE(provisioned_at,now()),
        verified_at=COALESCE(verified_at,now()),
        last_provisioned_version=COALESCE(last_provisioned_version,$2),
        updated_at=now()
      WHERE installation_id=$1 AND source='environment'
    `,[record.installation_id,APP_VERSION]);
  }
  installationRegistryFoundationReady=true;
}

async function installationRegistryRecord(installationId) {
  await ensureInstallationRegistryFoundation();
  return one(`SELECT * FROM customer_installations WHERE installation_id=$1 LIMIT 1`,[installationId]);
}

async function resolvedMailGatewayInstallationRecord(installationId) {
  const envRecord=mailGatewayInstallationRecords().get(installationId);
  if (envRecord) return {...envRecord,status:envRecord.enabled === false ? 'disabled' : 'active'};
  const row=await installationRegistryRecord(installationId);
  if (!row) return null;
  return {
    ...row,
    enabled:row.status === 'active',
    api_key_sha256:String(row.api_key_sha256 || '').toLowerCase()
  };
}

async function installationRegistryEvent({installationId,action,actorInstallationId=null,actorEmail=null,oldValues=null,newValues=null,metadata={}}) {
  await ensureInstallationRegistryFoundation();
  await pool.query(`
    INSERT INTO customer_installation_events(
      installation_id,action,actor_installation_id,actor_email,old_values,new_values,metadata
    ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)
  `,[installationId,action,actorInstallationId,actorEmail,oldValues ? JSON.stringify(oldValues) : null,newValues ? JSON.stringify(newValues) : null,JSON.stringify(metadata || {})]);
}

function mailGatewayBearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function mailGatewayProviderValue(value, fallback = 'brevo_api') {
  const clean = String(value || fallback || '').trim().toLowerCase();
  return ['brevo_api','smtp','disabled'].includes(clean) ? clean : fallback;
}

function normalizeBrevoApiBaseUrl(value) {
  const raw = String(value || 'https://api.brevo.com/v3').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    return parsed.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function mailGatewayServerProviderConfig() {
  const provider = mailGatewayProviderValue(process.env.MAIL_GATEWAY_PROVIDER || 'brevo_api');
  const senderName = safeEmailHeader(process.env.MAIL_GATEWAY_SENDER_NAME || 'HukaTech',160) || 'HukaTech';
  const from = String(process.env.MAIL_GATEWAY_FROM_EMAIL || process.env.MAIL_GATEWAY_SMTP_FROM || 'noreply@hukatech.com').trim();
  const replyTo = String(process.env.MAIL_GATEWAY_REPLY_TO || '').trim();
  const noReplyText = String(process.env.MAIL_GATEWAY_NO_REPLY_TEXT || 'Bu e-posta HukaTech tarafından otomatik olarak gönderilmiştir. Lütfen bu e-postayı yanıtlamayın.').trim();

  const brevoApiBaseUrl = normalizeBrevoApiBaseUrl(process.env.MAIL_GATEWAY_BREVO_API_BASE_URL || 'https://api.brevo.com/v3');
  const brevoApiKey = String(process.env.MAIL_GATEWAY_BREVO_API_KEY || process.env.BREVO_API_KEY || '').trim();
  const brevoTimeoutMs = Math.min(Math.max(Number(process.env.MAIL_GATEWAY_BREVO_TIMEOUT_MS || 15000),2000),60000);

  const smtpHost = String(process.env.MAIL_GATEWAY_SMTP_HOST || '').trim();
  const smtpPort = Number(process.env.MAIL_GATEWAY_SMTP_PORT || 587);
  const smtpUser = String(process.env.MAIL_GATEWAY_SMTP_USER || '').trim();
  const smtpPass = String(process.env.MAIL_GATEWAY_SMTP_PASS || '');
  const smtpSecure = String(process.env.MAIL_GATEWAY_SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;
  const smtpConfigured = Boolean(smtpHost && smtpUser && smtpPass && from);
  const brevoConfigured = Boolean(brevoApiBaseUrl && brevoApiKey && isValidEmailRecipient(from));
  const configured = provider === 'brevo_api' ? brevoConfigured : provider === 'smtp' ? smtpConfigured : false;

  return {
    enabled:mailGatewayServerEnabled(),
    provider,
    configured,
    senderName,
    from,
    replyTo:isValidEmailRecipient(replyTo) ? replyTo : '',
    noReplyText,
    brevo:{
      apiBaseUrl:brevoApiBaseUrl,
      apiKey:brevoApiKey,
      timeoutMs:brevoTimeoutMs,
      configured:brevoConfigured
    },
    smtpConfigured,
    host:smtpHost,
    port:Number.isFinite(smtpPort) ? smtpPort : 587,
    secure:smtpSecure,
    user:smtpUser,
    pass:smtpPass
  };
}

function appendNoReplyText(text, notice) {
  const body = String(text || '').trim();
  const footer = String(notice || '').trim();
  if (!footer || body.toLocaleLowerCase('tr-TR').includes('lütfen bu e-postayı yanıtlamayın')) return body;
  return body ? `${body}\n\n---\n${footer}` : footer;
}

function appendNoReplyHtml(html, notice) {
  const body = String(html || '');
  const footer = String(notice || '').trim();
  if (!footer || body.toLocaleLowerCase('tr-TR').includes('lütfen bu e-postayı yanıtlamayın')) return body;
  const footerHtml = `<div style="margin-top:22px;padding-top:14px;border-top:1px solid #dfe7f2;color:#6b7788;font-size:12px;line-height:1.55;">${h(footer)}</div>`;
  if (/<\/body>/i.test(body)) return body.replace(/<\/body>/i, `${footerHtml}</body>`);
  return `${body}${footerHtml}`;
}

async function checkBrevoApiConnection(cfg) {
  if (!cfg.brevo.configured) return {connected:false,configured:false,message:'Brevo API is not configured'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.brevo.timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(`${cfg.brevo.apiBaseUrl}/account`, {
      method:'GET',
      headers:{'accept':'application/json','api-key':cfg.brevo.apiKey},
      signal:controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.code || `Brevo HTTP ${response.status}`);
    return {connected:true,configured:true,provider:'brevo_api',message:'Brevo API connection is ready'};
  } catch (error) {
    if (error.name === 'AbortError') return {connected:false,configured:true,provider:'brevo_api',message:'Brevo API timeout'};
    return {connected:false,configured:true,provider:'brevo_api',message:String(error.message || error).slice(0,500)};
  } finally {
    clearTimeout(timeout);
  }
}

async function checkMailGatewayProviderConnection(cfg = mailGatewayServerProviderConfig()) {
  if (!cfg.enabled) return {connected:false,configured:false,provider:cfg.provider,message:'Central Mail Gateway is disabled'};
  if (cfg.provider === 'disabled') return {connected:false,configured:false,provider:'disabled',message:'Mail provider is disabled'};
  if (cfg.provider === 'brevo_api') return checkBrevoApiConnection(cfg);
  return {
    connected:cfg.smtpConfigured,
    configured:cfg.smtpConfigured,
    provider:'smtp',
    message:cfg.smtpConfigured ? 'SMTP provider is configured' : 'SMTP provider is not configured'
  };
}

async function sendBrevoApiEmail({to,subject,html,text,requestId,purpose}, cfg) {
  if (!cfg.brevo.configured) return {sent:false,reason:'Brevo API settings not configured',provider:'brevo_api'};
  const recipients = Array.isArray(to) ? to : validatedEmailRecipients(to);
  if (!recipients.length) return {sent:false,reason:'Recipient email not configured',provider:'brevo_api'};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.brevo.timeoutMs);
  timeout.unref?.();
  try {
    const payload = {
      sender:{name:cfg.senderName,email:cfg.from},
      to:recipients.map(email => ({email})),
      subject:safeEmailHeader(subject,300),
      htmlContent:appendNoReplyHtml(html,cfg.noReplyText),
      textContent:appendNoReplyText(text || stripHtml(html),cfg.noReplyText),
      headers:{
        'X-Hukatech-Request-Id':safeEmailHeader(requestId,200),
        'X-Hukatech-Purpose':safeEmailHeader(purpose,80)
      }
    };
    if (cfg.replyTo) payload.replyTo={email:cfg.replyTo};

    const response = await fetch(`${cfg.brevo.apiBaseUrl}/smtp/email`, {
      method:'POST',
      headers:{
        'accept':'application/json',
        'content-type':'application/json',
        'api-key':cfg.brevo.apiKey
      },
      body:JSON.stringify(payload),
      signal:controller.signal
    });
    const raw = await response.text();
    let responsePayload = {};
    try { responsePayload = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (!response.ok) throw new Error(responsePayload.message || responsePayload.code || `Brevo HTTP ${response.status}`);
    return {
      sent:true,
      provider:'brevo_api',
      message_id:responsePayload.messageId || responsePayload.message_id || null,
      accepted:recipients,
      rejected:[],
      to:recipients
    };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Brevo API timeout');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMailGatewayProviderEmail({to,subject,html,text,requestId,purpose}, cfg = mailGatewayServerProviderConfig()) {
  if (cfg.provider === 'brevo_api') return sendBrevoApiEmail({to,subject,html,text,requestId,purpose},cfg);
  if (cfg.provider === 'smtp') {
    return sendDirectSmtpEmail({
      to,
      subject,
      html:appendNoReplyHtml(html,cfg.noReplyText),
      text:appendNoReplyText(text || stripHtml(html),cfg.noReplyText),
      fromName:cfg.senderName,
      replyTo:cfg.replyTo || null
    },{
      ...cfg,
      smtpConfigured:cfg.smtpConfigured
    });
  }
  return {sent:false,reason:'Central mail provider is disabled',provider:'disabled'};
}

async function mailGatewayAuth(req,res,next) {
  try {
    if (!mailGatewayServerEnabled()) {
      return res.status(404).json({status:'not_found',version:APP_VERSION,message:'Mail Gateway server is disabled'});
    }
    const installationId = safeEmailHeader(req.headers['x-factorybox-installation-id'],200);
    const apiKey = mailGatewayBearerToken(req);
    const record = await resolvedMailGatewayInstallationRecord(installationId);
    if (!record || record.enabled === false || record.status !== 'active' || !gatewayInstallationKeyMatches(record,apiKey)) {
      return res.status(401).json({status:'unauthorized',version:APP_VERSION,message:'Invalid Mail Gateway credentials'});
    }

    const minuteLimit = Math.min(Math.max(Number(record.max_per_minute || process.env.MAIL_GATEWAY_MAX_PER_MINUTE || 30),1),1000);
    const dailyLimit = Math.min(Math.max(Number(record.max_per_day || process.env.MAIL_GATEWAY_MAX_PER_DAY || 500),1),1000000);
    const minute = consumeRateBucket(mailGatewayMinuteBuckets,installationId,minuteLimit,60*1000);
    const day = consumeRateBucket(mailGatewayDailyBuckets,installationId,dailyLimit,24*60*60*1000);
    res.setHeader('X-MailGateway-Minute-Remaining',String(minute.remaining));
    res.setHeader('X-MailGateway-Day-Remaining',String(day.remaining));
    if (!minute.allowed || !day.allowed) {
      return res.status(429).json({status:'rate_limited',version:APP_VERSION,message:'Mail Gateway rate limit exceeded'});
    }
    req.mailGatewayInstallation = {
      ...record,
      installation_id:installationId,
      customer_name:safeEmailHeader(record.customer_name || installationId,160),
      registry_admin:Boolean(record.registry_admin)
    };
    pool.query(`
      UPDATE customer_installations SET
        last_authenticated_at=now(),
        provisioning_status=CASE WHEN provisioning_status IN ('registered','package_generated','provisioned') THEN 'verified' ELSE provisioning_status END,
        verified_at=CASE WHEN provisioning_status IN ('registered','package_generated','provisioned') THEN COALESCE(verified_at,now()) ELSE verified_at END,
        updated_at=now()
      WHERE installation_id=$1
    `,[installationId]).catch(()=>{});
    next();
  } catch(error) {
    return res.status(500).json({status:'error',version:APP_VERSION,message:String(error.message || error)});
  }
}

function mailGatewayRegistryAdminRequired(req,res,next) {
  if (!req.mailGatewayInstallation?.registry_admin) {
    return res.status(403).json({status:'forbidden',version:APP_VERSION,message:'Installation registry admin access required'});
  }
  next();
}

app.get('/api/mail-gateway/v1/status', mailGatewayAuth, async (req,res)=>{
  const provider = mailGatewayServerProviderConfig();
  const providerStatus = await checkMailGatewayProviderConnection(provider);
  res.status(providerStatus.connected ? 200 : 503).json({
    status:providerStatus.connected ? 'ok' : 'not_ready',
    version:APP_VERSION,
    service:'hukatech-central-mail-gateway',
    connected:providerStatus.connected,
    configured:providerStatus.configured,
    provider:provider.provider,
    installation_id:req.mailGatewayInstallation.installation_id,
    customer_name:req.mailGatewayInstallation.customer_name,
    sender_email_configured:Boolean(provider.from),
    api_key_configured:provider.provider === 'brevo_api' ? Boolean(provider.brevo.apiKey) : undefined,
    smtp_configured:provider.provider === 'smtp' ? provider.smtpConfigured : undefined,
    message:providerStatus.message,
    timestamp:new Date().toISOString()
  });
});


app.post('/api/mail-gateway/v1/deployment/confirm', mailGatewayAuth, async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const installationId=req.mailGatewayInstallation.installation_id;
    const publicHostname=String(req.body?.public_hostname || '').trim().toLowerCase();
    const tunnelId=String(req.body?.cloudflare_tunnel_id || '').trim();
    const row=await one(`
      UPDATE customer_installations SET
        tunnel_status='connected',provisioning_status='verified',verified_at=COALESCE(verified_at,now()),
        cloudflare_last_checked_at=now(),cloudflare_error=NULL,updated_at=now()
      WHERE installation_id=$1
        AND ($2='' OR public_hostname=$2)
        AND ($3='' OR cloudflare_tunnel_id=$3)
      RETURNING *
    `,[installationId,publicHostname,tunnelId]);
    if (!row) return res.status(409).json({status:'mismatch',version:APP_VERSION,message:'Deployment confirmation does not match the registered hostname or tunnel'});
    await installationRegistryEvent({installationId,action:'customer_deployment_verified',actorInstallationId:installationId,newValues:installationRegistryPublicRow(row),metadata:{public_hostname:publicHostname,cloudflare_tunnel_id:tunnelId,platform_version:String(req.body?.platform_version || '').slice(0,60),remote_ip:reqIp(req)}});
    res.json({status:'ok',version:APP_VERSION,verified:true,installation:installationRegistryPublicRow(row)});
  } catch(error) {
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});


app.post('/api/mail-gateway/v1/send', mailGatewayAuth, async (req,res)=>{
  const installation = req.mailGatewayInstallation;
  const requestId = safeEmailHeader(req.body?.request_id || req.headers['x-request-id'] || crypto.randomUUID(),200);
  const purpose = mailPurpose(req.body?.purpose);
  let recipients;
  try {
    recipients = validatedEmailRecipients(req.body?.to,20);
  } catch (error) {
    return res.status(400).json({status:'error',version:APP_VERSION,sent:false,message:error.message});
  }
  if (!requestId || !recipients.length) {
    return res.status(400).json({status:'error',version:APP_VERSION,sent:false,message:'request_id and recipients are required'});
  }
  const subject = safeEmailHeader(req.body?.subject,300);
  const html = String(req.body?.html || '');
  const text = String(req.body?.text || '');
  if (!subject || (!html && !text)) {
    return res.status(400).json({status:'error',version:APP_VERSION,sent:false,message:'subject and email content are required'});
  }
  if (html.length > 700000 || text.length > 250000) {
    return res.status(413).json({status:'error',version:APP_VERSION,sent:false,message:'Email content is too large'});
  }

  await ensureMailGatewayFoundation();
  const existing = await one(`
    SELECT status,provider_message_id,error_message,created_at,updated_at
    FROM mail_gateway_deliveries
    WHERE installation_id=$1 AND request_id=$2
    LIMIT 1
  `,[installation.installation_id,requestId]);

  if (existing?.status === 'delivered') {
    return res.json({
      status:'ok',version:APP_VERSION,sent:true,duplicate:true,request_id:requestId,
      message_id:existing.provider_message_id || null,accepted:recipients,rejected:[]
    });
  }
  if (existing?.status === 'processing' && Date.now() - new Date(existing.updated_at).getTime() < 5*60*1000) {
    return res.status(409).json({
      status:'processing',version:APP_VERSION,sent:false,request_id:requestId,
      message:'This mail request is already processing'
    });
  }

  await pool.query(`
    INSERT INTO mail_gateway_deliveries
      (installation_id,request_id,purpose,recipient_count,recipients_masked,subject,status,metadata)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,'processing',$7::jsonb)
    ON CONFLICT(installation_id,request_id) DO UPDATE SET
      purpose=EXCLUDED.purpose,recipient_count=EXCLUDED.recipient_count,
      recipients_masked=EXCLUDED.recipients_masked,subject=EXCLUDED.subject,
      status='processing',error_message=NULL,metadata=EXCLUDED.metadata,updated_at=now()
  `,[
    installation.installation_id,requestId,purpose,recipients.length,
    JSON.stringify(maskedRecipientList(recipients)),subject,
    JSON.stringify(mailMetadata(req.body?.metadata))
  ]);

  const provider = mailGatewayServerProviderConfig();
  if (!provider.configured) {
    const reason = provider.provider === 'brevo_api'
      ? 'Central Mail Gateway Brevo API is not configured'
      : provider.provider === 'smtp'
        ? 'Central Mail Gateway SMTP is not configured'
        : 'Central Mail Gateway provider is disabled';
    await pool.query(`UPDATE mail_gateway_deliveries SET status='failed',error_message=$3,updated_at=now() WHERE installation_id=$1 AND request_id=$2`,[
      installation.installation_id,requestId,reason
    ]);
    return res.status(503).json({status:'not_ready',version:APP_VERSION,sent:false,request_id:requestId,message:reason});
  }

  try {
    const result = await sendMailGatewayProviderEmail({
      to:recipients,
      subject,
      html,
      text,
      requestId,
      purpose
    }, provider);
    if (!result.sent) throw new Error(result.reason || 'Central mail delivery failed');

    await pool.query(`
      UPDATE mail_gateway_deliveries SET
        status='delivered',provider_message_id=$3,error_message=NULL,delivered_at=now(),updated_at=now()
      WHERE installation_id=$1 AND request_id=$2
    `,[installation.installation_id,requestId,result.message_id || null]);
    await pool.query(`UPDATE customer_installations SET last_mail_at=now(),updated_at=now() WHERE installation_id=$1`,[installation.installation_id]).catch(()=>{});

    return res.json({
      status:'ok',version:APP_VERSION,sent:true,request_id:requestId,
      message_id:result.message_id || null,accepted:result.accepted || recipients,
      rejected:result.rejected || [],provider:result.provider || provider.provider
    });
  } catch (error) {
    await pool.query(`
      UPDATE mail_gateway_deliveries SET status='failed',error_message=$3,updated_at=now()
      WHERE installation_id=$1 AND request_id=$2
    `,[installation.installation_id,requestId,String(error.message || error).slice(0,1000)]);
    return res.status(502).json({
      status:'error',version:APP_VERSION,sent:false,request_id:requestId,
      provider:provider.provider,
      message:String(error.message || error)
    });
  }

});



function cloudflareDeploymentConfig() {
  const apiToken=String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const accountId=String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const zoneId=String(process.env.CLOUDFLARE_ZONE_ID || '').trim();
  const zoneName=String(process.env.CLOUDFLARE_ZONE_NAME || 'hukatech.com').trim().toLowerCase();
  const originService=String(process.env.CLOUDFLARE_CUSTOMER_ORIGIN_SERVICE || 'https://nginx:443').trim();
  return {
    apiToken,accountId,zoneId,zoneName,originService,
    configured:Boolean(apiToken && accountId && zoneId && zoneName && originService)
  };
}

async function cloudflareApi(pathname,{method='GET',body=null}={}) {
  const cfg=cloudflareDeploymentConfig();
  if (!cfg.configured) {
    const error=new Error('Cloudflare deployment controller is not configured');
    error.statusCode=503;
    throw error;
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);timer.unref?.();
  try {
    const response=await fetch(`https://api.cloudflare.com/client/v4${pathname}`,{
      method,
      headers:{'authorization':`Bearer ${cfg.apiToken}`,'content-type':'application/json'},
      ...(body === null ? {} : {body:JSON.stringify(body)}),
      signal:controller.signal
    });
    const payload=await response.json().catch(()=>({}));
    if (!response.ok || payload.success === false) {
      const messages=[...(payload.errors || []),...(payload.messages || [])]
        .map(item=>item?.message || item?.code).filter(Boolean).join('; ');
      const error=new Error(messages || `Cloudflare API HTTP ${response.status}`);
      error.statusCode=response.status >= 400 && response.status < 600 ? response.status : 502;
      throw error;
    }
    return payload.result;
  } catch(error) {
    if (error.name === 'AbortError') {
      const timeoutError=new Error('Cloudflare API request timed out');
      timeoutError.statusCode=504;
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

function cloudflareTunnelStatus(value) {
  const status=String(value || '').toLowerCase();
  if (['healthy','active','connected'].includes(status)) return 'connected';
  if (['inactive','pending','down','degraded'].includes(status)) return status === 'inactive' ? 'pending' : 'offline';
  return 'pending';
}

async function cloudflareFindTunnelByName(name) {
  const cfg=cloudflareDeploymentConfig();
  const result=await cloudflareApi(`/accounts/${encodeURIComponent(cfg.accountId)}/cfd_tunnel?is_deleted=false&per_page=100`);
  return (Array.isArray(result) ? result : []).find(item=>String(item?.name || '').toLowerCase() === String(name || '').toLowerCase()) || null;
}

async function cloudflareProvisionInstallation(installation,{actorInstallationId=null,force=false}={}) {
  const cfg=cloudflareDeploymentConfig();
  if (!cfg.configured) {
    const error=new Error('Cloudflare deployment controller is not configured');
    error.statusCode=503;
    throw error;
  }
  if (!installation) {
    const error=new Error('Installation not found');
    error.statusCode=404;
    throw error;
  }
  if (installation.source === 'environment') {
    const error=new Error('Environment-managed pilot tunnel cannot be changed here');
    error.statusCode=409;
    throw error;
  }
  if (['disabled','archived'].includes(installation.status)) {
    const error=new Error('Disabled or archived installation cannot be deployed');
    error.statusCode=409;
    throw error;
  }
  if (!installation.public_hostname.endsWith(`.${cfg.zoneName}`)) {
    const error=new Error(`Public hostname must belong to ${cfg.zoneName}`);
    error.statusCode=400;
    throw error;
  }

  let tunnel=null;
  if (installation.cloudflare_tunnel_id && !force) {
    try { tunnel=await cloudflareApi(`/accounts/${encodeURIComponent(cfg.accountId)}/cfd_tunnel/${encodeURIComponent(installation.cloudflare_tunnel_id)}`); }
    catch(error) { if (error.statusCode !== 404) throw error; }
  }
  if (!tunnel) tunnel=await cloudflareFindTunnelByName(installation.tunnel_name);
  let tunnelCreated=false;
  if (!tunnel) {
    tunnel=await cloudflareApi(`/accounts/${encodeURIComponent(cfg.accountId)}/cfd_tunnel`,{
      method:'POST',body:{name:installation.tunnel_name,config_src:'cloudflare'}
    });
    tunnelCreated=true;
  }
  const tunnelId=String(tunnel?.id || '').trim();
  if (!tunnelId) throw new Error('Cloudflare did not return a tunnel ID');

  const originRequest=cfg.originService.toLowerCase().startsWith('https:') ? {noTLSVerify:true} : {};
  await cloudflareApi(`/accounts/${encodeURIComponent(cfg.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,{
    method:'PUT',
    body:{config:{ingress:[
      {hostname:installation.public_hostname,service:cfg.originService,originRequest},
      {service:'http_status:404'}
    ]}}
  });

  const dnsList=await cloudflareApi(`/zones/${encodeURIComponent(cfg.zoneId)}/dns_records?type=CNAME&name=${encodeURIComponent(installation.public_hostname)}&per_page=100`);
  const target=`${tunnelId}.cfargotunnel.com`;
  let dnsRecord=Array.isArray(dnsList) ? dnsList[0] : null;
  if (dnsRecord) {
    dnsRecord=await cloudflareApi(`/zones/${encodeURIComponent(cfg.zoneId)}/dns_records/${encodeURIComponent(dnsRecord.id)}`,{
      method:'PUT',body:{type:'CNAME',name:installation.public_hostname,content:target,proxied:true,ttl:1}
    });
  } else {
    dnsRecord=await cloudflareApi(`/zones/${encodeURIComponent(cfg.zoneId)}/dns_records`,{
      method:'POST',body:{type:'CNAME',name:installation.public_hostname,content:target,proxied:true,ttl:1}
    });
  }

  const old=installation;
  const row=await one(`
    UPDATE customer_installations SET
      cloudflare_tunnel_id=$2,cloudflare_dns_record_id=$3,cloudflare_origin_service=$4,
      cloudflare_provisioned_at=COALESCE(cloudflare_provisioned_at,now()),cloudflare_last_checked_at=now(),
      cloudflare_error=NULL,tunnel_status=$5,
      provisioning_status=CASE WHEN provisioning_status='registered' THEN 'cloudflare_ready' ELSE provisioning_status END,
      updated_at=now()
    WHERE installation_id=$1 RETURNING *
  `,[old.installation_id,tunnelId,String(dnsRecord?.id || '') || null,cfg.originService,cloudflareTunnelStatus(tunnel?.status)]);
  await installationRegistryEvent({
    installationId:old.installation_id,action:'cloudflare_tunnel_provisioned',actorInstallationId,
    oldValues:installationRegistryPublicRow(old),newValues:installationRegistryPublicRow(row),
    metadata:{tunnel_created:tunnelCreated,tunnel_id:tunnelId,dns_record_id:dnsRecord?.id || null,origin_service:cfg.originService}
  });
  return {row,tunnel,dnsRecord,tunnelCreated};
}

async function cloudflareTunnelToken(tunnelId) {
  const cfg=cloudflareDeploymentConfig();
  const result=await cloudflareApi(`/accounts/${encodeURIComponent(cfg.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`);
  const token=typeof result === 'string' ? result : String(result?.token || '');
  if (!token) throw new Error('Cloudflare tunnel token was not returned');
  return token;
}

function installationRegistryAdminPayload(body={}) {
  const slug=installationRegistrySlug(body.slug || body.customer_code || body.customer_name);
  return {
    customer_code:String(body.customer_code || slug).trim().slice(0,100),
    customer_name:String(body.customer_name || body.customer_code || slug).trim().slice(0,180),
    slug,
    public_hostname:installationRegistryHostname(body.public_hostname,slug),
    tunnel_name:String(body.tunnel_name || `hukatech-${slug}-production`).trim().slice(0,180),
    tunnel_status:['pending','connected','offline','error','not_configured'].includes(String(body.tunnel_status || '').toLowerCase()) ? String(body.tunnel_status).toLowerCase() : 'pending',
    status:installationRegistryStatus(body.status,'active'),
    max_per_minute:installationRegistryLimit(body.max_per_minute,30,1000),
    max_per_day:installationRegistryLimit(body.max_per_day,500,1000000),
    notes:String(body.notes || '').trim().slice(0,1000) || null
  };
}

app.get('/api/mail-gateway/v1/admin/installations',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  await ensureInstallationRegistryFoundation();
  const rows=(await pool.query(`SELECT * FROM customer_installations ORDER BY created_at DESC LIMIT 1000`)).rows.map(installationRegistryPublicRow);
  res.json({status:'ok',version:APP_VERSION,count:rows.length,installations:rows});
});

app.post('/api/mail-gateway/v1/admin/installations',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const data=installationRegistryAdminPayload(req.body || {});
    const apiKey=installationRegistryApiKey();
    const installationId=String(req.body?.installation_id || installationRegistryId(data.slug)).trim();
    if (!/^[a-zA-Z0-9_-]{6,120}$/.test(installationId)) return res.status(400).json({status:'error',message:'Invalid installation_id'});
    const row=await one(`
      INSERT INTO customer_installations(
        installation_id,customer_code,customer_name,slug,public_hostname,tunnel_name,tunnel_status,status,
        api_key_sha256,api_key_prefix,registry_admin,max_per_minute,max_per_day,source,notes
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12,'database',$13)
      RETURNING *
    `,[installationId,data.customer_code,data.customer_name,data.slug,data.public_hostname,data.tunnel_name,data.tunnel_status,data.status,sha256Hex(apiKey),apiKey.slice(0,12),data.max_per_minute,data.max_per_day,data.notes]);
    await installationRegistryEvent({installationId,action:'created',actorInstallationId:req.mailGatewayInstallation.installation_id,newValues:installationRegistryPublicRow(row)});
    res.status(201).json({
      status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(row),
      credentials:{installation_id:installationId,api_key:apiKey,shown_once:true},
      customer_env:[
        'FACTORYBOX_MAIL_MODE=gateway',
        `FACTORYBOX_MAIL_GATEWAY_URL=${installationPublicMailGatewayUrl()}`,
        `FACTORYBOX_MAIL_INSTALLATION_ID=${installationId}`,
        `FACTORYBOX_MAIL_API_KEY=${apiKey}`,
        'FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK=false'
      ].join('\n')
    });
  } catch(error) {
    const duplicate=String(error.code || '') === '23505';
    res.status(duplicate ? 409 : (error.statusCode || 500)).json({status:'error',version:APP_VERSION,message:duplicate ? 'Installation ID, slug or hostname already exists' : error.message});
  }
});

app.patch('/api/mail-gateway/v1/admin/installations/:installationId',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const old=await installationRegistryRecord(req.params.installationId);
    if (!old) return res.status(404).json({status:'not_found',message:'Installation not found'});
    if (old.source === 'environment') return res.status(409).json({status:'managed_by_environment',message:'Environment-managed pilot installation cannot be edited here'});
    const slug=req.body?.slug === undefined ? old.slug : installationRegistrySlug(req.body.slug);
    const hostname=req.body?.public_hostname === undefined ? old.public_hostname : installationRegistryHostname(req.body.public_hostname,slug);
    const status=req.body?.status === undefined ? old.status : installationRegistryStatus(req.body.status,old.status);
    const row=await one(`
      UPDATE customer_installations SET
        customer_code=$2,customer_name=$3,slug=$4,public_hostname=$5,tunnel_name=$6,tunnel_status=$7,status=$8,
        max_per_minute=$9,max_per_day=$10,notes=$11,
        disabled_at=CASE WHEN $8='disabled' THEN COALESCE(disabled_at,now()) ELSE NULL END,
        revoked_at=CASE WHEN $8='disabled' THEN COALESCE(revoked_at,now()) ELSE NULL END,
        provisioning_status=CASE
          WHEN $8='disabled' THEN 'revoked'
          WHEN $8='active' AND provisioning_status='revoked' THEN 'registered'
          ELSE provisioning_status
        END,
        updated_at=now()
      WHERE installation_id=$1 RETURNING *
    `,[
      old.installation_id,
      String(req.body?.customer_code ?? old.customer_code).trim().slice(0,100),
      String(req.body?.customer_name ?? old.customer_name).trim().slice(0,180),
      slug,hostname,String(req.body?.tunnel_name ?? old.tunnel_name ?? '').trim().slice(0,180) || null,
      ['pending','connected','offline','error','not_configured'].includes(String(req.body?.tunnel_status ?? old.tunnel_status).toLowerCase()) ? String(req.body?.tunnel_status ?? old.tunnel_status).toLowerCase() : old.tunnel_status,
      status,
      installationRegistryLimit(req.body?.max_per_minute,old.max_per_minute,1000),
      installationRegistryLimit(req.body?.max_per_day,old.max_per_day,1000000),
      String(req.body?.notes ?? old.notes ?? '').trim().slice(0,1000) || null
    ]);
    await installationRegistryEvent({installationId:old.installation_id,action:'updated',actorInstallationId:req.mailGatewayInstallation.installation_id,oldValues:installationRegistryPublicRow(old),newValues:installationRegistryPublicRow(row)});
    res.json({status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(row)});
  } catch(error) {
    const duplicate=String(error.code || '') === '23505';
    res.status(duplicate ? 409 : (error.statusCode || 500)).json({status:'error',version:APP_VERSION,message:duplicate ? 'Slug or hostname already exists' : error.message});
  }
});

app.post('/api/mail-gateway/v1/admin/installations/:installationId/rotate-key',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const old=await installationRegistryRecord(req.params.installationId);
    if (!old) return res.status(404).json({status:'not_found',message:'Installation not found'});
    if (old.source === 'environment') return res.status(409).json({status:'managed_by_environment',message:'Environment-managed pilot key must be rotated from the secure environment file'});
    const apiKey=installationRegistryApiKey();
    const row=await one(`
      UPDATE customer_installations SET
        api_key_sha256=$2,api_key_prefix=$3,rotated_at=now(),key_generation=key_generation+1,
        provisioning_token_sha256=NULL,provisioning_token_prefix=NULL,provisioning_token_expires_at=NULL,
        provisioning_status=CASE WHEN provisioning_status='package_generated' THEN 'registered' ELSE provisioning_status END,
        updated_at=now()
      WHERE installation_id=$1 RETURNING *
    `,[old.installation_id,sha256Hex(apiKey),apiKey.slice(0,12)]);
    await installationRegistryEvent({installationId:old.installation_id,action:'key_rotated',actorInstallationId:req.mailGatewayInstallation.installation_id,oldValues:{api_key_prefix:old.api_key_prefix},newValues:{api_key_prefix:row.api_key_prefix}});
    res.json({status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(row),credentials:{installation_id:old.installation_id,api_key:apiKey,shown_once:true}});
  } catch(error) {
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});



app.post('/api/mail-gateway/v1/admin/installations/:installationId/cloudflare-provision',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const old=await installationRegistryRecord(req.params.installationId);
    const result=await cloudflareProvisionInstallation(old,{actorInstallationId:req.mailGatewayInstallation.installation_id,force:Boolean(req.body?.force)});
    res.json({status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(result.row),cloudflare:{tunnel_id:result.row.cloudflare_tunnel_id,dns_record_id:result.row.cloudflare_dns_record_id,origin_service:result.row.cloudflare_origin_service,tunnel_created:result.tunnelCreated}});
  } catch(error) {
    if (req.params.installationId) {
      pool.query(`UPDATE customer_installations SET cloudflare_error=$2,tunnel_status='error',cloudflare_last_checked_at=now(),updated_at=now() WHERE installation_id=$1`,[req.params.installationId,String(error.message || error).slice(0,1000)]).catch(()=>{});
    }
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});


app.post('/api/mail-gateway/v1/admin/installations/:installationId/provisioning-token',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    let old=await installationRegistryRecord(req.params.installationId);
    if (!old) return res.status(404).json({status:'not_found',message:'Installation not found'});
    if (old.source === 'environment') return res.status(409).json({status:'managed_by_environment',message:'Environment-managed pilot installation is already provisioned'});
    if (['disabled','archived'].includes(old.status)) return res.status(409).json({status:'inactive',message:'Disabled or archived installation cannot be provisioned'});
    if (!old.cloudflare_tunnel_id || !old.cloudflare_dns_record_id || old.tunnel_status === 'error') {
      const deployed=await cloudflareProvisionInstallation(old,{actorInstallationId:req.mailGatewayInstallation.installation_id});
      old=deployed.row;
    }
    const minutes=installationProvisioningMinutes(req.body?.expires_in_minutes,30);
    const token=installationProvisioningToken();
    const expiresAt=new Date(Date.now() + minutes*60*1000);
    const row=await one(`
      UPDATE customer_installations SET
        provisioning_token_sha256=$2,provisioning_token_prefix=$3,provisioning_token_expires_at=$4,
        provisioning_token_used_at=NULL,package_generated_at=now(),provisioning_status='package_generated',updated_at=now()
      WHERE installation_id=$1 RETURNING *
    `,[old.installation_id,sha256Hex(token),token.slice(0,12),expiresAt]);
    const provisioningPackage={
      format:'hukatech-customer-deployment-v2',
      platform_version:APP_VERSION,
      installation_id:old.installation_id,
      customer_code:old.customer_code,
      customer_name:old.customer_name,
      public_hostname:old.public_hostname,
      cloudflare_tunnel_id:old.cloudflare_tunnel_id,
      cloudflare_tunnel_name:old.tunnel_name,
      provisioning_token:token,
      expires_at:expiresAt.toISOString(),
      exchange_url:`${installationPublicAppUrl()}/api/public/installations/provision/exchange`,
      public_mail_gateway_url:installationPublicMailGatewayUrl(),
      instructions:'Run PROVISION_HUKATECH_CUSTOMER_INSTALLATION.ps1 as Administrator on the customer server. The package token can be used once; persistent mail and tunnel credentials are returned only after the secure exchange.'
    };
    await installationRegistryEvent({installationId:old.installation_id,action:'automated_deployment_package_generated',actorInstallationId:req.mailGatewayInstallation.installation_id,oldValues:installationRegistryPublicRow(old),newValues:installationRegistryPublicRow(row),metadata:{expires_in_minutes:minutes,cloudflare_tunnel_id:old.cloudflare_tunnel_id}});
    res.json({status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(row),provisioning_package:provisioningPackage,shown_once:true});
  } catch(error) {
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});

app.get('/api/mail-gateway/v1/admin/installations/:installationId/events',mailGatewayAuth,mailGatewayRegistryAdminRequired,async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const installation=await installationRegistryRecord(req.params.installationId);
    if (!installation) return res.status(404).json({status:'not_found',message:'Installation not found'});
    const rows=(await pool.query(`
      SELECT id,installation_id,action,actor_installation_id,actor_email,old_values,new_values,metadata,created_at
      FROM customer_installation_events WHERE installation_id=$1 ORDER BY created_at DESC LIMIT 100
    `,[installation.installation_id])).rows;
    res.json({status:'ok',version:APP_VERSION,installation:installationRegistryPublicRow(installation),count:rows.length,events:rows});
  } catch(error) {
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});

app.post('/api/mail-gateway/v1/provisioning/exchange',async(req,res)=>{
  try {
    await ensureInstallationRegistryFoundation();
    const installationId=String(req.body?.installation_id || '').trim();
    const token=String(req.body?.provisioning_token || '').trim();
    const clientVersion=String(req.body?.platform_version || '').trim().slice(0,60) || null;
    if (!/^[a-zA-Z0-9_-]{6,120}$/.test(installationId) || token.length < 30) {
      return res.status(400).json({status:'error',version:APP_VERSION,message:'Invalid provisioning request'});
    }
    const tokenHash=sha256Hex(token);
    const candidate=await one(`
      SELECT * FROM customer_installations
      WHERE installation_id=$1 AND provisioning_token_sha256=$2
        AND provisioning_token_used_at IS NULL AND provisioning_token_expires_at > now()
        AND status IN ('pending','active')
      LIMIT 1
    `,[installationId,tokenHash]);
    if (!candidate) return res.status(401).json({status:'invalid_or_expired',version:APP_VERSION,message:'Provisioning token is invalid, expired or already used'});
    if (!candidate.cloudflare_tunnel_id) return res.status(409).json({status:'cloudflare_not_ready',version:APP_VERSION,message:'Cloudflare Tunnel has not been provisioned for this installation'});

    const tunnelToken=await cloudflareTunnelToken(candidate.cloudflare_tunnel_id);
    const apiKey=installationRegistryApiKey();
    const row=await one(`
      UPDATE customer_installations SET
        api_key_sha256=$3,api_key_prefix=$4,key_generation=key_generation+1,
        provisioning_status='provisioned',provisioning_token_sha256=NULL,
        provisioning_token_used_at=now(),provisioned_at=now(),last_provisioned_version=$5,
        updated_at=now()
      WHERE installation_id=$1
        AND provisioning_token_sha256=$2
        AND provisioning_token_used_at IS NULL
        AND provisioning_token_expires_at > now()
        AND status IN ('pending','active')
      RETURNING *
    `,[installationId,tokenHash,sha256Hex(apiKey),apiKey.slice(0,12),clientVersion]);
    if (!row) return res.status(409).json({status:'already_used',version:APP_VERSION,message:'Provisioning package was already used'});
    await installationRegistryEvent({installationId,action:'deployment_credentials_exchanged',newValues:installationRegistryPublicRow(row),metadata:{platform_version:clientVersion,remote_ip:reqIp(req),cloudflare_tunnel_id:row.cloudflare_tunnel_id}});
    const customerEnv=[
      'FACTORYBOX_MAIL_MODE=gateway',
      `FACTORYBOX_MAIL_GATEWAY_URL=${installationPublicMailGatewayUrl()}`,
      `FACTORYBOX_MAIL_INSTALLATION_ID=${installationId}`,
      `FACTORYBOX_MAIL_API_KEY=${apiKey}`,
      'FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK=false'
    ].join('\n');
    res.json({
      status:'ok',version:APP_VERSION,shown_once:true,
      installation:installationRegistryPublicRow(row),
      credentials:{installation_id:installationId,api_key:apiKey,key_generation:row.key_generation},
      customer_env:customerEnv,
      cloudflare:{
        tunnel_id:row.cloudflare_tunnel_id,
        tunnel_name:row.tunnel_name,
        tunnel_token:tunnelToken,
        public_hostname:row.public_hostname,
        origin_service:row.cloudflare_origin_service || cloudflareDeploymentConfig().originService
      }
    });
  } catch(error) {
    res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message});
  }
});


function systemAdminRequired(req,res,next) {
  if (!authConfig().enabled) return next();
  return adminRequired(req,res,()=>{
    if (req.user?.role !== 'system_admin') return res.status(403).json({status:'forbidden',version:APP_VERSION,message:'system_admin access required'});
    next();
  });
}

async function callInstallationRegistryGateway(pathname,{method='GET',body=null}={}) {
  const cfg=emailConfig();
  if (!cfg.gateway.configured) {
    const error=new Error('HukaTech Central Mail Gateway is not configured');
    error.statusCode=503;
    throw error;
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),cfg.gateway.timeoutMs);timer.unref?.();
  try {
    const response=await fetch(`${cfg.gateway.url}${pathname}`,{
      method,
      headers:{
        'content-type':'application/json',
        'authorization':`Bearer ${cfg.gateway.apiKey}`,
        'x-factorybox-installation-id':cfg.gateway.installationId,
        'x-factorybox-version':APP_VERSION
      },
      ...(body === null ? {} : {body:JSON.stringify(body)}),
      signal:controller.signal
    });
    const payload=await response.json().catch(()=>({}));
    if (!response.ok) {
      const error=new Error(payload.message || `Installation Registry HTTP ${response.status}`);
      error.statusCode=response.status;
      error.payload=payload;
      throw error;
    }
    return payload;
  } catch(error) {
    if (error.name === 'AbortError') {
      const timeoutError=new Error('Installation Registry request timed out');
      timeoutError.statusCode=504;
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

app.get('/api/admin/installations',systemAdminRequired,async(req,res)=>{
  try { res.json(await callInstallationRegistryGateway('/api/mail-gateway/v1/admin/installations')); }
  catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/installations',systemAdminRequired,async(req,res)=>{
  try {
    const result=await callInstallationRegistryGateway('/api/mail-gateway/v1/admin/installations',{method:'POST',body:req.body || {}});
    await writeAuditLog(req,{action:'create_customer_installation',entity_type:'customer_installation',entity_id:result.installation?.installation_id,new_values:result.installation,metadata:{credentials_shown_once:true}});
    res.status(201).json(result);
  } catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.patch('/api/admin/installations/:installationId',systemAdminRequired,async(req,res)=>{
  try {
    const result=await callInstallationRegistryGateway(`/api/mail-gateway/v1/admin/installations/${encodeURIComponent(req.params.installationId)}`,{method:'PATCH',body:req.body || {}});
    await writeAuditLog(req,{action:'update_customer_installation',entity_type:'customer_installation',entity_id:req.params.installationId,new_values:result.installation});
    res.json(result);
  } catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.post('/api/admin/installations/:installationId/rotate-key',systemAdminRequired,async(req,res)=>{
  try {
    const result=await callInstallationRegistryGateway(`/api/mail-gateway/v1/admin/installations/${encodeURIComponent(req.params.installationId)}/rotate-key`,{method:'POST',body:{}});
    await writeAuditLog(req,{action:'rotate_customer_installation_key',entity_type:'customer_installation',entity_id:req.params.installationId,new_values:{api_key_prefix:result.installation?.api_key_prefix,credentials_shown_once:true}});
    res.json(result);
  } catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});



app.post('/api/admin/installations/:installationId/cloudflare-provision',systemAdminRequired,async(req,res)=>{
  try {
    const result=await callInstallationRegistryGateway(`/api/mail-gateway/v1/admin/installations/${encodeURIComponent(req.params.installationId)}/cloudflare-provision`,{method:'POST',body:req.body || {}});
    await writeAuditLog(req,{action:'provision_customer_cloudflare_tunnel',entity_type:'customer_installation',entity_id:req.params.installationId,new_values:result.installation,metadata:{cloudflare_tunnel_id:result.cloudflare?.tunnel_id,dns_record_id:result.cloudflare?.dns_record_id}});
    res.json(result);
  } catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});


app.post('/api/admin/installations/:installationId/provisioning-token',systemAdminRequired,async(req,res)=>{
  try {
    const result=await callInstallationRegistryGateway(`/api/mail-gateway/v1/admin/installations/${encodeURIComponent(req.params.installationId)}/provisioning-token`,{method:'POST',body:req.body || {}});
    await writeAuditLog(req,{action:'generate_customer_provisioning_package',entity_type:'customer_installation',entity_id:req.params.installationId,new_values:{provisioning_status:result.installation?.provisioning_status,expires_at:result.provisioning_package?.expires_at},metadata:{token_shown_once:true}});
    res.json(result);
  } catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

app.get('/api/admin/installations/:installationId/events',systemAdminRequired,async(req,res)=>{
  try { res.json(await callInstallationRegistryGateway(`/api/mail-gateway/v1/admin/installations/${encodeURIComponent(req.params.installationId)}/events`)); }
  catch(error){ res.status(error.statusCode || 500).json({status:'error',version:APP_VERSION,message:error.message}); }
});

async function proxyToCentralGateway(req,res,pathname,{method='POST',forwardCustomerHeaders=false}={}) {
  const base=centralGatewayInternalBaseUrl();
  if (!base) return res.status(503).json({status:'not_ready',version:APP_VERSION,message:'Central Mail Gateway internal URL is not configured'});
  const headers={'content-type':'application/json'};
  if (forwardCustomerHeaders) {
    for (const name of ['authorization','x-factorybox-installation-id','x-factorybox-version','x-request-id']) {
      const value=req.headers[name];
      if (value) headers[name]=String(value);
    }
  }
  try {
    const response=await fetch(`${base}${pathname}`,{method,headers,...(method==='GET' ? {} : {body:JSON.stringify(req.body || {})})});
    const text=await response.text();
    res.status(response.status);
    res.setHeader('content-type',response.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.send(text);
  } catch(error) {
    return res.status(502).json({status:'gateway_unavailable',version:APP_VERSION,message:error.message});
  }
}

app.post('/api/public/installations/provision/exchange',async(req,res)=>{
  return proxyToCentralGateway(req,res,'/api/mail-gateway/v1/provisioning/exchange');
});

app.get('/api/central-mail/v1/status',async(req,res)=>{
  return proxyToCentralGateway(req,res,'/api/mail-gateway/v1/status',{method:'GET',forwardCustomerHeaders:true});
});

app.post('/api/central-mail/v1/deployment/confirm',async(req,res)=>{
  return proxyToCentralGateway(req,res,'/api/mail-gateway/v1/deployment/confirm',{forwardCustomerHeaders:true});
});

app.post('/api/central-mail/v1/send',async(req,res)=>{
  return proxyToCentralGateway(req,res,'/api/mail-gateway/v1/send',{forwardCustomerHeaders:true});
});

app.get('/api/admin/notification-settings/gateway-status', adminRequired, permissionRequired('VIEW_DASHBOARD'), async (req,res)=>{
  const result = await checkMailGatewayConnection();
  res.status(result.connected ? 200 : 503).json({status:result.connected ? 'ok' : 'not_ready',version:APP_VERSION,...result});
});

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
    <div style="color:#6b7788;font-size:12px;line-height:1.55;margin-top:14px;">
      <div>HukaTech platform bildirimi · v${APP_VERSION}</div>
      <div>Bu e-posta otomatik olarak gönderilmiştir. Lütfen bu e-postayı yanıtlamayın.</div>
    </div>
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
      mode:cfg.mode,
      provider:cfg.mode === 'gateway' ? 'hukatech_central_gateway' : cfg.mode === 'direct_smtp' ? 'smtp' : 'disabled',
      gateway_enforced:Boolean(cfg.gatewayEnforced),
      gateway_configured:Boolean(cfg.gateway.configured),
      smtp_configured:Boolean(cfg.smtpConfigured),
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



// -----------------------------------------------------------------------------
// v6.5.0 SmartAI Reports & Natural Language Insights
// Read-only analytics: no device command or database mutation outside report/settings/history records.
// -----------------------------------------------------------------------------
let smartAiCenterFoundationReady = false;
let smartAiSchedulerTimer = null;
let smartAiSchedulerKickoffTimer = null;

const SMARTAI_ENGINES = ['rules','openai'];
const SMARTAI_LANGUAGES = ['tr','en'];
const SMARTAI_AUDIENCES = ['executive','technical','operator'];
const SMARTAI_PERIODS = ['daily','weekly','monthly','custom'];
const SMARTAI_CHANNELS = ['telegram','email'];

function smartAiChoice(value, allowed, label, fallback) {
  const clean=String(value ?? fallback ?? '').trim().toLowerCase();
  if (!allowed.includes(clean)) { const e=new Error(`${label} is invalid`); e.statusCode=400; throw e; }
  return clean;
}
function smartAiBool(value, fallback=false) {
  if (value===undefined || value===null || value==='') return Boolean(fallback);
  if (typeof value==='boolean') return value;
  return ['1','true','yes','on','enabled'].includes(String(value).toLowerCase());
}
function smartAiInt(value, fallback, min, max, label='value') {
  const n=Number(value ?? fallback);
  if (!Number.isFinite(n) || n<min || n>max) { const e=new Error(`${label} must be between ${min} and ${max}`); e.statusCode=400; throw e; }
  return Math.round(n);
}
function smartAiText(value, max=1000) { const s=String(value ?? '').trim(); return s ? s.slice(0,max) : null; }
function smartAiChannels(value) {
  const rows=Array.isArray(value)?value:String(value||'').split(/[,+]/);
  return [...new Set(rows.map(x=>String(x).trim().toLowerCase()).filter(x=>SMARTAI_CHANNELS.includes(x)))];
}
function smartAiIsoDate(value,label='date') {
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)){const e=new Error(`${label} must be YYYY-MM-DD`);e.statusCode=400;throw e;}
  const d=new Date(`${text}T00:00:00.000Z`);if(Number.isNaN(d.getTime())){const e=new Error(`${label} is invalid`);e.statusCode=400;throw e;}return text;
}
function smartAiDateText(date){return new Date(date).toISOString().slice(0,10);}
function smartAiResolveRange(periodRaw,fromRaw,toRaw){
  const period=smartAiChoice(periodRaw,SMARTAI_PERIODS,'period','daily');
  const today=new Date();const to=toRaw?smartAiIsoDate(toRaw,'to'):smartAiDateText(today);
  let from;
  if(fromRaw)from=smartAiIsoDate(fromRaw,'from');
  else {const d=new Date(`${to}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()-(period==='weekly'?6:period==='monthly'?29:0));from=smartAiDateText(d);}
  const start=new Date(`${from}T00:00:00.000Z`),endDay=new Date(`${to}T00:00:00.000Z`);const days=Math.floor((endDay-start)/86400000)+1;
  if(days<1||days>366){const e=new Error('SmartAI date range must be between 1 and 366 days');e.statusCode=400;throw e;}
  return {period,from,to,days,fromDate:start,toDate:endDay,endExclusive:new Date(endDay.getTime()+86400000)};
}
function smartAiLocalParts(timezone='Europe/Istanbul',date=new Date()){
  try {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hour12:false}).formatToParts(date);const map={};for(const p of parts)map[p.type]=p.value;return {date:`${map.year}-${map.month}-${map.day}`,hour:Number(map.hour||0)%24,weekday:String(map.weekday||'').toLowerCase(),day:Number(map.day||1)};} catch {return {date:date.toISOString().slice(0,10),hour:date.getUTCHours(),weekday:['sun','mon','tue','wed','thu','fri','sat'][date.getUTCDay()],day:date.getUTCDate()};}
}

async function ensureSmartAiCenterFoundation(){
  if(smartAiCenterFoundationReady)return;
  await ensureAiReportsHistorySchema();await ensureOrganizationFoundation();await ensureMaintenanceFoundation();await ensurePreventiveMaintenanceFoundation();await ensureInventoryFoundation();await ensureOeeFoundation();
  await pool.query(`
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_kind text NOT NULL DEFAULT 'operations';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'executive';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'tr';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS period_start date;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS period_end date;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS ai_engine text NOT NULL DEFAULT 'rules';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS created_by text;
    ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS delivery_status jsonb NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_ai_reports_customer_created ON ai_reports(customer_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_reports_period ON ai_reports(period_start,period_end,report_type);

    CREATE TABLE IF NOT EXISTS smartai_settings(
      customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT true,
      engine text NOT NULL DEFAULT 'rules',
      language text NOT NULL DEFAULT 'tr',
      default_audience text NOT NULL DEFAULT 'executive',
      timezone text NOT NULL DEFAULT 'Europe/Istanbul',
      daily_enabled boolean NOT NULL DEFAULT false,
      daily_hour integer NOT NULL DEFAULT 8,
      weekly_enabled boolean NOT NULL DEFAULT false,
      weekly_day integer NOT NULL DEFAULT 1,
      weekly_hour integer NOT NULL DEFAULT 8,
      monthly_enabled boolean NOT NULL DEFAULT false,
      monthly_day integer NOT NULL DEFAULT 1,
      monthly_hour integer NOT NULL DEFAULT 8,
      delivery_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
      telegram_chat_ids text,
      email_recipients text,
      history_limit integer NOT NULL DEFAULT 100,
      updated_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS smartai_questions(
      id bigserial PRIMARY KEY,
      customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
      site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
      user_id text,
      user_email text,
      question text NOT NULL,
      answer text NOT NULL,
      language text NOT NULL DEFAULT 'tr',
      ai_engine text NOT NULL DEFAULT 'rules',
      intent text,
      period_start date,
      period_end date,
      evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_smartai_questions_customer_created ON smartai_questions(customer_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS smartai_scheduler_runs(
      id bigserial PRIMARY KEY,
      customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
      schedule_key text NOT NULL,
      period_type text NOT NULL,
      status text NOT NULL,
      report_id uuid,
      delivery_result jsonb NOT NULL DEFAULT '{}'::jsonb,
      error_message text,
      started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      UNIQUE(customer_id,schedule_key,period_type)
    );
    INSERT INTO smartai_settings(customer_id)
    SELECT id FROM customers ON CONFLICT(customer_id) DO NOTHING;
  `);
  smartAiCenterFoundationReady=true;
}

async function smartAiSettingsRow(customerId){await ensureSmartAiCenterFoundation();return one(`SELECT customer_id::text,enabled,engine,language,default_audience,timezone,daily_enabled,daily_hour,weekly_enabled,weekly_day,weekly_hour,monthly_enabled,monthly_day,monthly_hour,delivery_channels,telegram_chat_ids,email_recipients,history_limit,updated_by,updated_at FROM smartai_settings WHERE customer_id=$1`,[customerId]);}
async function smartAiScope(req,opts={}){
  const snapshot=await organizationHierarchySnapshot(req,opts.customer_code);
  let machines=snapshot.machines,sites=snapshot.sites,factories=snapshot.factories;
  if(opts.factory_id){sites=sites.filter(x=>String(x.factory_id)===String(opts.factory_id));const ids=new Set(sites.map(x=>String(x.id)));machines=machines.filter(x=>ids.has(String(x.site_id)));factories=factories.filter(x=>String(x.id)===String(opts.factory_id));}
  if(opts.site_id){sites=sites.filter(x=>String(x.id)===String(opts.site_id));const ids=new Set(sites.map(x=>String(x.id)));machines=machines.filter(x=>ids.has(String(x.site_id)));const factoryIds=new Set(sites.map(x=>String(x.factory_id)));factories=factories.filter(x=>factoryIds.has(String(x.id)));}
  return {...snapshot,machines,sites,factories,machineIds:machines.map(x=>String(x.id)),siteIds:sites.map(x=>String(x.id))};
}
function smartAiSafePct(v){const n=Number(v||0);return Number.isFinite(n)?Math.round(n*10)/10:0;}
function smartAiMinutes(sec){return Math.round(Number(sec||0)/60);}
function smartAiTop(rows,key='count',limit=5){return [...rows].sort((a,b)=>Number(b[key]||0)-Number(a[key]||0)).slice(0,limit);}

async function smartAiCollectContext(req,options={}){
  await ensureSmartAiCenterFoundation();
  const range=smartAiResolveRange(options.period,options.from,options.to);const scope=await smartAiScope(req,options);const ids=scope.machineIds;
  let alarmSummary={total:0,critical:0,warning:0,active:0,cleared:0,avg_ack_min:0,avg_resolve_min:0},alarmTypes=[],alarmMachines=[];
  if(ids.length){
    // Keep these queries deliberately explicit. Older PostgreSQL/parser combinations can
    // report a misleading `syntax error at or near AS` for dense FILTER/cast expressions.
    alarmSummary=await one(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END)::int AS critical,
        SUM(CASE WHEN severity='warning' THEN 1 ELSE 0 END)::int AS warning,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END)::int AS active,
        SUM(CASE WHEN status<>'active' THEN 1 ELSE 0 END)::int AS cleared,
        COALESCE(
          ROUND(AVG(CASE WHEN acknowledged_at IS NOT NULL THEN EXTRACT(EPOCH FROM (acknowledged_at-started_at))/60.0 END)::numeric,1),
          0
        )::double precision AS avg_ack_min,
        COALESCE(
          ROUND(AVG(CASE WHEN cleared_at IS NOT NULL THEN EXTRACT(EPOCH FROM (cleared_at-started_at))/60.0 END)::numeric,1),
          0
        )::double precision AS avg_resolve_min
      FROM alarms
      WHERE machine_id=ANY($1::uuid[])
        AND started_at >= $2
        AND started_at < $3
    `,[ids,range.fromDate,range.endExclusive])||alarmSummary;
    alarmTypes=(await pool.query(`
      SELECT
        COALESCE(NULLIF(alarm_type,''),'unknown') AS alarm_type,
        COUNT(*)::int AS count,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END)::int AS critical_count
      FROM alarms
      WHERE machine_id=ANY($1::uuid[])
        AND started_at >= $2
        AND started_at < $3
      GROUP BY COALESCE(NULLIF(alarm_type,''),'unknown')
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `,[ids,range.fromDate,range.endExclusive])).rows;
    alarmMachines=(await pool.query(`
      SELECT
        m.id::text AS machine_id,
        m.code,
        m.name,
        COUNT(a.id)::int AS count,
        SUM(CASE WHEN a.severity='critical' THEN 1 ELSE 0 END)::int AS critical_count
      FROM alarms a
      JOIN machines m ON m.id=a.machine_id
      WHERE a.machine_id=ANY($1::uuid[])
        AND a.started_at >= $2
        AND a.started_at < $3
      GROUP BY m.id,m.code,m.name
      ORDER BY COUNT(a.id) DESC
      LIMIT 10
    `,[ids,range.fromDate,range.endExclusive])).rows;
  }
  const oeeRange={from:range.from,to:range.to,days:range.days,fromDate:range.fromDate,toDate:range.toDate,endExclusive:range.endExclusive};const oeeData=await loadOeeData(oeeRange);const allowed=new Set(ids);const oeeRows=[];
  for(const base of oeeData.machines||[]){if(!allowed.has(String(base.id)))continue;oeeRows.push(calculateOeeMachineRow(base,base,oeeData.productions||[],oeeData.downtimes||[],oeeData.states||[],oeeRange));}
  const oeeSummary=calculateOeeSummary(oeeRows);const topDowntime=smartAiTop(oeeRows.map(x=>({machine_id:x.machine_id,code:x.machine_code,name:x.machine_name,downtime_sec:Number(x.unplanned_downtime_sec||0),oee_pct:Number(x.oee_pct||0),availability_pct:Number(x.availability_pct||0),performance_pct:Number(x.performance_pct||0),quality_pct:Number(x.quality_pct||0),total_count:Number(x.total_count||0)})),'downtime_sec',8);const lowestOee=[...oeeRows].filter(x=>Number(x.total_count||0)>0).sort((a,b)=>Number(a.oee_pct||0)-Number(b.oee_pct||0)).slice(0,8);
  let overdueTickets=[],overduePlans=[];
  if(ids.length){
    overdueTickets=(await pool.query(`SELECT t.id::text,t.ticket_no,t.title,t.priority,t.status,t.due_at,m.code AS machine_code,m.name AS machine_name FROM maintenance_tickets t JOIN machines m ON m.id=t.machine_id WHERE t.machine_id=ANY($1::uuid[]) AND t.status IN ('open','in_progress','waiting') AND t.due_at IS NOT NULL AND t.due_at<now() ORDER BY t.due_at LIMIT 20`,[ids])).rows;
    overduePlans=(await pool.query(`SELECT p.id::text,p.plan_no,p.title,p.priority,p.next_due_at,m.code AS machine_code,m.name AS machine_name FROM maintenance_plans p JOIN machines m ON m.id=p.machine_id WHERE p.machine_id=ANY($1::uuid[]) AND p.enabled=true AND p.next_due_at IS NOT NULL AND p.next_due_at<now() ORDER BY p.next_due_at LIMIT 20`,[ids])).rows;
  }
  const lowStock=(await pool.query(`SELECT id::text,part_no,sku,name,current_stock::float8,min_stock::float8,reorder_qty::float8,unit FROM spare_parts WHERE enabled=true AND current_stock<=min_stock ORDER BY (min_stock-current_stock) DESC,name LIMIT 20`)).rows;
  const factoryRows=scope.factories.map(f=>{const siteIds=new Set(scope.sites.filter(s=>String(s.factory_id)===String(f.id)).map(s=>String(s.id)));const mids=new Set(scope.machines.filter(m=>siteIds.has(String(m.site_id))).map(m=>String(m.id)));const rows=oeeRows.filter(r=>mids.has(String(r.machine_id)));const sum=calculateOeeSummary(rows);return {id:f.id,code:f.code,name:f.name,machine_count:mids.size,oee_pct:smartAiSafePct(sum.oee_pct),availability_pct:smartAiSafePct(sum.availability_pct),performance_pct:smartAiSafePct(sum.performance_pct),quality_pct:smartAiSafePct(sum.quality_pct),total_count:Number(sum.total_count||0),downtime_sec:Number(sum.unplanned_downtime_sec||0),active_alarm_count:alarmMachines.filter(x=>mids.has(String(x.machine_id))).reduce((n,x)=>n+Number(x.count||0),0)};});
  const missingOee=scope.machines.length-oeeRows.filter(x=>Number(x.total_count||0)>0).length;
  return {generated_at:new Date().toISOString(),range:{period:range.period,from:range.from,to:range.to,days:range.days},scope:{customer:scope.customer,factories:scope.factories,sites:scope.sites,machines:scope.machines,scope_restricted:scope.scope_restricted},metrics:{alarms:alarmSummary,oee:oeeSummary,overdue_tickets:overdueTickets.length,overdue_plans:overduePlans.length,low_stock:lowStock.length,missing_oee_machines:missingOee},alarm_types:alarmTypes,alarm_machines:alarmMachines,oee_rows:oeeRows,top_downtime:topDowntime,lowest_oee:lowestOee,overdue_tickets:overdueTickets,overdue_plans:overduePlans,low_stock:lowStock,factories:factoryRows};
}

function smartAiTr(language,tr,en){return language==='en'?en:tr;}
function smartAiBuildRuleNarrative(context,{language='tr',audience='executive'}={}){
  const tr=language!=='en';const m=context.metrics;const topStop=context.top_downtime[0];const low=context.lowest_oee[0];const repeated=context.alarm_types.filter(x=>Number(x.count)>=2).slice(0,5);const risks=[];const actions=[];const findings=[];
  if(Number(m.alarms.critical||0)>0)risks.push(smartAiTr(language,`${m.alarms.critical} kritik alarm incelenmeli.`,`${m.alarms.critical} critical alarms require review.`));
  if(topStop&&topStop.downtime_sec>0)findings.push(smartAiTr(language,`${topStop.name||topStop.code} ${smartAiMinutes(topStop.downtime_sec)} dakika ile en fazla plansız duruş yaşayan makine.`,`${topStop.name||topStop.code} has the highest unplanned downtime at ${smartAiMinutes(topStop.downtime_sec)} minutes.`));
  if(low)findings.push(smartAiTr(language,`${low.machine_name||low.machine_code} en düşük OEE değerine sahip: %${smartAiSafePct(low.oee_pct)}.`,`${low.machine_name||low.machine_code} has the lowest OEE at ${smartAiSafePct(low.oee_pct)}%.`));
  if(repeated.length)findings.push(smartAiTr(language,`Tekrarlayan alarm tipleri: ${repeated.map(x=>`${x.alarm_type} (${x.count})`).join(', ')}.`,`Repeated alarm types: ${repeated.map(x=>`${x.alarm_type} (${x.count})`).join(', ')}.`));
  if(m.overdue_tickets)risks.push(smartAiTr(language,`${m.overdue_tickets} bakım talebi gecikmiş durumda.`,`${m.overdue_tickets} maintenance tickets are overdue.`));
  if(m.overdue_plans)risks.push(smartAiTr(language,`${m.overdue_plans} önleyici bakım planının tarihi geçmiş.`,`${m.overdue_plans} preventive-maintenance plans are overdue.`));
  if(m.low_stock)risks.push(smartAiTr(language,`${m.low_stock} yedek parça minimum stok seviyesinde veya altında.`,`${m.low_stock} spare parts are at or below minimum stock.`));
  if(topStop&&topStop.downtime_sec>0)actions.push(smartAiTr(language,`${topStop.name||topStop.code} duruş nedenlerini ve bağlı bakım kayıtlarını kontrol et.`,`Review downtime reasons and linked maintenance records for ${topStop.name||topStop.code}.`));
  if(low)actions.push(smartAiTr(language,`${low.machine_name||low.machine_code} için Availability, Performance ve Quality bileşenlerini ayrı ayrı doğrula.`,`Validate Availability, Performance and Quality separately for ${low.machine_name||low.machine_code}.`));
  if(repeated.length)actions.push(smartAiTr(language,`En sık tekrarlayan ${repeated[0].alarm_type} alarmı için kök neden analizi başlat.`,`Start a root-cause analysis for the most frequent ${repeated[0].alarm_type} alarm.`));
  if(m.low_stock)actions.push(smartAiTr(language,`Kritik stoklar için satın alma veya yeniden sipariş sürecini başlat.`,`Start purchasing or replenishment for critical stock items.`));
  if(!findings.length)findings.push(smartAiTr(language,'Seçilen dönemde belirgin bir operasyonel anomali tespit edilmedi.','No significant operational anomaly was detected in the selected period.'));
  if(!actions.length)actions.push(smartAiTr(language,'Mevcut performansı korumak için günlük kontrol rutini sürdürülmeli.','Continue the daily review routine to preserve current performance.'));
  const score=Math.max(0,Math.min(100,Math.round(100-Number(m.alarms.critical||0)*5-Number(m.alarms.active||0)*2-smartAiMinutes(context.top_downtime.reduce((n,x)=>n+x.downtime_sec,0))/60-Number(m.overdue_tickets||0)*3-Number(m.low_stock||0)*2)));
  let summary;
  if(audience==='technical')summary=smartAiTr(language,`Dönemde ${m.alarms.total||0} alarm ve ${smartAiMinutes(context.top_downtime.reduce((n,x)=>n+x.downtime_sec,0))} dakika öne çıkan plansız duruş kaydedildi. Teknik öncelik alarm tekrarları, düşük OEE bileşenleri ve gecikmiş bakımlardır.`,`The period contains ${m.alarms.total||0} alarms and ${smartAiMinutes(context.top_downtime.reduce((n,x)=>n+x.downtime_sec,0))} minutes of notable unplanned downtime. Technical priorities are repeated alarms, weak OEE components and overdue maintenance.`);
  else if(audience==='operator')summary=smartAiTr(language,`Operatör odağı: aktif alarmları kontrol et, duruş nedenlerini doğru seç ve geciken iş emirlerini güncelle. Sistem skoru ${score}/100.`,`Operator focus: review active alarms, select downtime reasons accurately and update overdue work orders. System score is ${score}/100.`);
  else summary=smartAiTr(language,`Seçilen dönemin genel operasyon skoru ${score}/100. Toplam ${m.alarms.total||0} alarm, ${m.overdue_tickets||0} gecikmiş bakım talebi ve ${m.low_stock||0} kritik stok kaydı bulunuyor.`,`The overall operational score for the selected period is ${score}/100. There are ${m.alarms.total||0} alarms, ${m.overdue_tickets||0} overdue maintenance tickets and ${m.low_stock||0} critical stock items.`);
  return {score,summary,executive_comment:findings[0],findings:findings.slice(0,8),risks:risks.slice(0,8),recommendations:actions.slice(0,8),action_items:actions.slice(0,8)};
}

async function smartAiGenericOpenAi(prompt){
  const cfg=openAiConfig();if(!cfg.configured||!cfg.enabled)return {ok:false,reason:cfg.configured?'OpenAI disabled':'OPENAI_API_KEY not configured',model:cfg.model};
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:cfg.model,input:prompt})});const data=await response.json().catch(()=>({}));if(!response.ok)return {ok:false,reason:data?.error?.message||`OpenAI HTTP ${response.status}`,model:cfg.model};const text=extractOpenAiText(data);const parsed=parseJsonFromText(text);return {ok:Boolean(parsed),reason:parsed?null:'Response is not valid JSON',model:cfg.model,parsed,response_id:data?.id||null,raw_text:text};
}
function smartAiReportPrompt(context,rule,{language,audience}){const compact={range:context.range,metrics:context.metrics,top_downtime:context.top_downtime.slice(0,5),lowest_oee:context.lowest_oee.slice(0,5),repeated_alarms:context.alarm_types.slice(0,5),overdue_tickets:context.overdue_tickets.slice(0,5),overdue_plans:context.overdue_plans.slice(0,5),low_stock:context.low_stock.slice(0,8),factories:context.factories};return [`You are a read-only industrial operations analyst for FactoryBox.`,`Write in ${language==='en'?'English':'Turkish'} for a ${audience} audience. Use only supplied data; never invent values.`,`Return valid JSON only with keys: summary, executive_comment, findings, risks, recommendations, action_items. Each list max 8 items.`,`Rule-engine draft: ${JSON.stringify(rule)}`,`Data: ${JSON.stringify(compact)}`].join('\n');}
async function smartAiBuildReport(req,options={}){
  const language=smartAiChoice(options.language,SMARTAI_LANGUAGES,'language','tr');const audience=smartAiChoice(options.audience,SMARTAI_AUDIENCES,'audience','executive');const engine=smartAiChoice(options.engine,SMARTAI_ENGINES,'engine','rules');const context=await smartAiCollectContext(req,options);const rule=smartAiBuildRuleNarrative(context,{language,audience});let narrative=rule,engineUsed='rules',openai={configured:openAiConfig().configured,enabled:openAiConfig().enabled,model:openAiConfig().model,status:'not_used'};
  if(engine==='openai'){const ai=await smartAiGenericOpenAi(smartAiReportPrompt(context,rule,{language,audience}));openai={...openai,status:ai.ok?'ok':'fallback',reason:ai.reason||null,response_id:ai.response_id||null};if(ai.ok){narrative={...rule,...ai.parsed,findings:normalizeAiArray(ai.parsed.findings,rule.findings),risks:normalizeAiArray(ai.parsed.risks,rule.risks),recommendations:normalizeAiArray(ai.parsed.recommendations,rule.recommendations),action_items:normalizeAiArray(ai.parsed.action_items,rule.action_items)};engineUsed='openai';}}
  return {schema:'factorybox-smartai-report-v1',report_type:`smartai_${context.range.period}`,report_kind:'operations',language,audience,ai_engine:engineUsed,openai,generated_at:new Date().toISOString(),period:context.range,scope:{customer:context.scope.customer,factories:context.scope.factories.map(x=>({id:x.id,code:x.code,name:x.name})),sites:context.scope.sites.map(x=>({id:x.id,code:x.code,name:x.name})),machine_count:context.scope.machines.length,scope_restricted:context.scope.scope_restricted},health_score:Number(narrative.score??rule.score),summary:String(narrative.summary||rule.summary),executive_comment:String(narrative.executive_comment||rule.executive_comment||''),findings:normalizeAiArray(narrative.findings,rule.findings),risks:normalizeAiArray(narrative.risks,rule.risks),recommendations:normalizeAiArray(narrative.recommendations,rule.recommendations),action_items:normalizeAiArray(narrative.action_items,rule.action_items),metrics:context.metrics,evidence:{top_downtime:context.top_downtime,lowest_oee:context.lowest_oee,repeated_alarms:context.alarm_types,alarm_machines:context.alarm_machines,overdue_tickets:context.overdue_tickets,overdue_plans:context.overdue_plans,low_stock:context.low_stock,factories:context.factories}};
}
async function smartAiSaveReport(req, report) {
  const customerId = report.scope.customer.id;
  const siteId = report.scope.sites.length === 1 ? report.scope.sites[0].id : null;
  const reportText = smartAiReportText(report);
  const reportJson = JSON.stringify(report);

  // Every PostgreSQL placeholder is intentionally unique and explicitly cast.
  // This avoids parameter-type conflicts when an existing installation has
  // report_date / period_start columns created by an older migration variant.
  const saved = await one(`
    INSERT INTO ai_reports(
      machine_id, customer_id, site_id, report_type, report_kind,
      report_date, period_start, period_end, health_score,
      summary, summary_text, report_text, telegram_text,
      report_json, raw_payload, audience, language, ai_engine,
      status, created_by, created_at
    ) VALUES(
      NULL,
      $1::uuid,
      $2::uuid,
      $3::text,
      $4::text,
      $5::date,
      $6::date,
      $7::date,
      $8::integer,
      $9::text,
      $10::text,
      $11::text,
      $12::text,
      $13::jsonb,
      $14::jsonb,
      $15::text,
      $16::text,
      $17::text,
      'completed',
      $18::text,
      now()
    )
    RETURNING id::text, created_at
  `, [
    customerId,
    siteId,
    report.report_type,
    report.report_kind,
    report.period.from,
    report.period.from,
    report.period.to,
    report.health_score,
    report.summary,
    report.summary,
    reportText,
    reportText,
    reportJson,
    reportJson,
    report.audience,
    report.language,
    report.ai_engine,
    req?.user?.email || 'system'
  ]);

  return saved;
}
function smartAiReportText(report){const en=report.language==='en';const lines=[`FactoryBox SmartAI ${en?'Operations Report':'Operasyon Raporu'}`,`${en?'Period':'Dönem'}: ${report.period.from} — ${report.period.to}`,`${en?'Scope':'Kapsam'}: ${report.scope.customer.name}`,`${en?'Audience':'Hedef Kitle'}: ${report.audience}`,`${en?'Engine':'Motor'}: ${report.ai_engine}`,`${en?'Score':'Skor'}: ${report.health_score}/100`,'',en?'SUMMARY':'ÖZET',report.summary,'',en?'FINDINGS':'BULGULAR',...report.findings.map(x=>`• ${x}`),'',en?'RISKS':'RİSKLER',...report.risks.map(x=>`• ${x}`),'',en?'RECOMMENDATIONS':'ÖNERİLER',...report.recommendations.map(x=>`• ${x}`),'',`${en?'Generated':'Oluşturulma'}: ${new Date(report.generated_at).toLocaleString(en?'en-US':'tr-TR')}`];return lines.join('\n');}
function smartAiReportHtml(report){const en=report.language==='en';const list=x=>(x||[]).map(v=>`<li>${h(v)}</li>`).join('')||`<li>${en?'No item':'Kayıt yok'}</li>`;return `<!doctype html><html lang="${en?'en':'tr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FactoryBox SmartAI</title><style>body{font-family:Arial,sans-serif;background:#eef1f3;color:#202832;margin:0}.page{max-width:980px;margin:24px auto;background:#fff;padding:32px;border-radius:18px}.top{display:flex;justify-content:space-between;border-bottom:3px solid #c67723;padding-bottom:16px}.score{font-size:38px;font-weight:900;color:#c67723}.meta{color:#65717c}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid #dbe1e6;border-radius:13px;padding:13px;background:#f8fafb}.summary{font-size:18px;line-height:1.55;border-left:5px solid #c67723;padding:14px;background:#fff8ef}li{margin:8px 0}h2{margin-top:28px}@media print{body{background:#fff}.page{margin:0;max-width:none;border-radius:0}}</style></head><body><main class="page"><div class="top"><div><h1>FactoryBox SmartAI</h1><div class="meta">${h(report.period.from)} — ${h(report.period.to)} · ${h(report.scope.customer.name)} · ${h(report.audience)}</div></div><div class="score">${h(report.health_score)}/100</div></div><h2>${en?'Executive Summary':'Yönetici Özeti'}</h2><div class="summary">${h(report.summary)}</div><div class="grid"><div class="card"><b>${en?'Alarms':'Alarmlar'}</b><br>${h(report.metrics.alarms.total||0)}</div><div class="card"><b>OEE</b><br>${h(smartAiSafePct(report.metrics.oee.oee_pct))}%</div><div class="card"><b>${en?'Overdue Maintenance':'Gecikmiş Bakım'}</b><br>${h((report.metrics.overdue_tickets||0)+(report.metrics.overdue_plans||0))}</div><div class="card"><b>${en?'Critical Stock':'Kritik Stok'}</b><br>${h(report.metrics.low_stock||0)}</div></div><h2>${en?'Findings':'Bulgular'}</h2><ul>${list(report.findings)}</ul><h2>${en?'Risks':'Riskler'}</h2><ul>${list(report.risks)}</ul><h2>${en?'Recommendations':'Öneriler'}</h2><ul>${list(report.recommendations)}</ul></main></body></html>`;}
async function smartAiDeliver(report,options={}){const channels=smartAiChannels(options.channels);const results=[],errors=[];for(const channel of channels){try{if(channel==='telegram'){const cfg=telegramEscalationConfig();if(!cfg.enabled||!cfg.token)throw new Error('Telegram not configured');const chats=splitRecipientValues(options.telegram_chat_ids||cfg.defaultChatId);if(!chats.length)throw new Error('Telegram chat ID missing');for(const chat of chats){const response=await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:smartAiReportText(report).slice(0,4000),disable_web_page_preview:true})});const p=await response.json().catch(()=>({}));if(!response.ok||p.ok===false)throw new Error(p.description||`Telegram HTTP ${response.status}`);results.push({channel,chat_id:chat,message_id:p.result?.message_id||null});}}else if(channel==='email'){const sent=await sendReportEmail({to:options.email_recipients,subject:`FactoryBox SmartAI - ${report.scope.customer.name} - ${report.period.from}/${report.period.to}`,html:smartAiReportHtml(report),text:smartAiReportText(report)});if(!sent.sent)throw new Error(sent.reason||'Email not sent');results.push({channel,message_id:sent.message_id,to:sent.to});}}catch(e){errors.push({channel,message:String(e.message||e)});}}return {status:errors.length?(results.length?'partial':'failed'):'delivered',results,errors};}

function smartAiNormalizeQuestion(q){return String(q||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function smartAiQuestionIntent(q){const s=smartAiNormalizeQuestion(q);if(/en fazla.*dur|most.*downtime|duruş.*fazla/.test(s))return 'top_downtime';if(/neden.*oee|oee.*neden|low.*oee|dusuk.*oee/.test(s))return 'low_oee_reason';if(/tekrar.*alarm|repeated.*alarm|hangi alarm/.test(s))return 'repeated_alarms';if(/bakım.*gecik|maintenance.*overdue|gecikmiş.*bakım/.test(s))return 'overdue_maintenance';if(/stok.*kritik|critical.*stock|parça.*stok/.test(s))return 'critical_stock';if(/fabrika.*karsilastir|compare.*factor|tesis.*karsilastir/.test(s))return 'factory_comparison';return 'operations_summary';}
function smartAiFindMachine(question,context){const q=smartAiNormalizeQuestion(question);return context.scope.machines.find(m=>q.includes(smartAiNormalizeQuestion(m.code))||q.includes(smartAiNormalizeQuestion(m.name)));}
function smartAiAnswerRule(question,context,language){const intent=smartAiQuestionIntent(question),en=language==='en';let answer,findings=[],recommendations=[];if(intent==='top_downtime'){const x=context.top_downtime[0];answer=x?(en?`${x.name||x.code} has the highest unplanned downtime with ${smartAiMinutes(x.downtime_sec)} minutes.`:`${x.name||x.code}, ${smartAiMinutes(x.downtime_sec)} dakika ile en fazla plansız duruş yaşayan makinedir.`):(en?'No downtime record was found.':'Duruş kaydı bulunamadı.');if(x){findings=[`OEE: ${smartAiSafePct(x.oee_pct)}%`,`Availability: ${smartAiSafePct(x.availability_pct)}%`];recommendations=[en?'Review downtime reason records and related alarms.':'Duruş nedenleri ve ilişkili alarmlar incelenmeli.'];}}
  else if(intent==='low_oee_reason'){const machine=smartAiFindMachine(question,context);const row=machine?context.oee_rows.find(x=>String(x.machine_id)===String(machine.id)):context.lowest_oee[0];if(row){const comps=[['Availability',Number(row.availability_pct||0)],['Performance',Number(row.performance_pct||0)],['Quality',Number(row.quality_pct||0)]].sort((a,b)=>a[1]-b[1]);answer=en?`${row.machine_name||row.machine_code} has OEE ${smartAiSafePct(row.oee_pct)}%. The weakest component is ${comps[0][0]} at ${smartAiSafePct(comps[0][1])}%.`:`${row.machine_name||row.machine_code} OEE değeri %${smartAiSafePct(row.oee_pct)}. En zayıf bileşen %${smartAiSafePct(comps[0][1])} ile ${comps[0][0]}.`;findings=[`Availability ${smartAiSafePct(row.availability_pct)}%`,`Performance ${smartAiSafePct(row.performance_pct)}%`,`Quality ${smartAiSafePct(row.quality_pct)}%`,`${en?'Unplanned downtime':'Plansız duruş'} ${smartAiMinutes(row.unplanned_downtime_sec)} ${en?'min':'dk'}`];recommendations=[comps[0][0]==='Availability'?(en?'Investigate downtime and availability losses.':'Duruş ve kullanılabilirlik kayıpları incelenmeli.'):comps[0][0]==='Performance'?(en?'Validate ideal cycle time and speed losses.':'İdeal çevrim süresi ve hız kayıpları doğrulanmalı.'):(en?'Review reject reasons and quality records.':'Hata nedenleri ve kalite kayıtları incelenmeli.')];}else answer=en?'No production/OEE data was found.':'Üretim/OEE verisi bulunamadı.';}
  else if(intent==='repeated_alarms'){const rows=context.alarm_types.filter(x=>Number(x.count)>=2).slice(0,8);answer=rows.length?(en?`Repeated alarms: ${rows.map(x=>`${x.alarm_type} (${x.count})`).join(', ')}.`:`Tekrarlayan alarmlar: ${rows.map(x=>`${x.alarm_type} (${x.count})`).join(', ')}.`):(en?'No repeated alarm was found.':'Tekrarlayan alarm bulunamadı.');findings=rows.map(x=>`${x.alarm_type}: ${x.count}`);recommendations=rows.length?[en?'Start root-cause analysis with the most frequent alarm.':'En sık alarmdan başlayarak kök neden analizi yapılmalı.']:[];}
  else if(intent==='overdue_maintenance'){const rows=[...context.overdue_tickets,...context.overdue_plans];answer=en?`${rows.length} overdue maintenance item(s) were found.`:`${rows.length} gecikmiş bakım kaydı bulundu.`;findings=rows.slice(0,8).map(x=>`${x.machine_name||x.machine_code}: ${x.title}`);recommendations=rows.length?[en?'Assign owners and update due dates or completion status.':'Sorumlular atanmalı; termin veya tamamlanma durumu güncellenmeli.']:[];}
  else if(intent==='critical_stock'){answer=en?`${context.low_stock.length} critical stock item(s) were found.`:`${context.low_stock.length} kritik stok kaydı bulundu.`;findings=context.low_stock.slice(0,8).map(x=>`${x.name} (${x.part_no}): ${x.current_stock}/${x.min_stock} ${x.unit}`);recommendations=context.low_stock.length?[en?'Create replenishment orders using reorder quantities.':'Önerilen sipariş miktarlarıyla tedarik süreci başlatılmalı.']:[];}
  else if(intent==='factory_comparison'){const rows=[...context.factories].sort((a,b)=>Number(b.oee_pct)-Number(a.oee_pct));answer=rows.length?(en?`${rows[0].name} has the highest OEE at ${rows[0].oee_pct}%.`:`${rows[0].name}, %${rows[0].oee_pct} ile en yüksek OEE değerine sahip.`):(en?'No factory comparison data was found.':'Fabrika karşılaştırma verisi bulunamadı.');findings=rows.map(x=>`${x.name}: OEE ${x.oee_pct}% · ${en?'downtime':'duruş'} ${smartAiMinutes(x.downtime_sec)} ${en?'min':'dk'}`);recommendations=rows.length>1?[en?'Compare the weakest OEE component between the best and lowest factory.':'En iyi ve en düşük fabrikanın zayıf OEE bileşenleri karşılaştırılmalı.']:[];}
  else {const draft=smartAiBuildRuleNarrative(context,{language,audience:'executive'});answer=draft.summary;findings=draft.findings;recommendations=draft.recommendations;}
  return {intent,answer,findings:findings.slice(0,8),recommendations:recommendations.slice(0,8)};}
async function smartAiAnswerQuestion(req,options={}){const question=smartAiText(options.question,2000);if(!question){const e=new Error('question is required');e.statusCode=400;throw e;}const language=smartAiChoice(options.language,SMARTAI_LANGUAGES,'language','tr');const engine=smartAiChoice(options.engine,SMARTAI_ENGINES,'engine','rules');const context=await smartAiCollectContext(req,options);const rule=smartAiAnswerRule(question,context,language);let result=rule,used='rules',openaiStatus='not_used';if(engine==='openai'){const compact={question,language,range:context.range,rule_answer:rule,metrics:context.metrics,top_downtime:context.top_downtime.slice(0,5),lowest_oee:context.lowest_oee.slice(0,5),repeated_alarms:context.alarm_types.slice(0,5),overdue_tickets:context.overdue_tickets.slice(0,5),overdue_plans:context.overdue_plans.slice(0,5),low_stock:context.low_stock.slice(0,8),factories:context.factories};const ai=await smartAiGenericOpenAi(`You are a read-only FactoryBox industrial analyst. Answer in ${language==='en'?'English':'Turkish'}. Use only supplied data. Return JSON only: {"answer":"...","findings":["..."],"recommendations":["..."]}. Data: ${JSON.stringify(compact)}`);openaiStatus=ai.ok?'ok':`fallback: ${ai.reason}`;if(ai.ok){result={...rule,answer:String(ai.parsed.answer||rule.answer),findings:normalizeAiArray(ai.parsed.findings,rule.findings),recommendations:normalizeAiArray(ai.parsed.recommendations,rule.recommendations)};used='openai';}}
  const saved=await one(`INSERT INTO smartai_questions(customer_id,site_id,user_id,user_email,question,answer,language,ai_engine,intent,period_start,period_end,evidence_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id::text,created_at`,[context.scope.customer.id,context.scope.sites.length===1?context.scope.sites[0].id:null,req.user?.id||null,req.user?.email||null,question,result.answer,language,used,result.intent,context.range.from,context.range.to,JSON.stringify({findings:result.findings,recommendations:result.recommendations,metrics:context.metrics,engine_status:openaiStatus})]);return {question_id:saved.id,created_at:saved.created_at,question,language,ai_engine:used,engine_status:openaiStatus,intent:result.intent,answer:result.answer,findings:result.findings,recommendations:result.recommendations,period:context.range,scope:{customer:context.scope.customer,site_count:context.scope.sites.length,machine_count:context.scope.machines.length},read_only:true};}

app.get('/api/admin/smartai/status',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{await ensureSmartAiCenterFoundation();const scope=await smartAiScope(req,{customer_code:req.query.customer_code});const settings=await smartAiSettingsRow(scope.customer.id);res.json({status:'ok',version:APP_VERSION,read_only:true,openai:openAiConfig(),notifications:{telegram:(()=>{const t=telegramEscalationConfig();return {enabled:t.enabled,configured:t.configured,token_present:Boolean(t.token),chat_id_present:Boolean(t.defaultChatId)};})(),email:(()=>{const e=emailConfig();return {enabled:e.enabled,configured:e.configured,host_present:Boolean(e.host),from_present:Boolean(e.from),default_to_present:Boolean(e.defaultTo)};})()},settings,scope:{customer:scope.customer,factory_count:scope.factories.length,site_count:scope.sites.length,machine_count:scope.machines.length,scope_restricted:scope.scope_restricted}});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.get('/api/admin/smartai/settings',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{const scope=await smartAiScope(req,{customer_code:req.query.customer_code});res.json({status:'ok',version:APP_VERSION,customer:scope.customer,settings:await smartAiSettingsRow(scope.customer.id),openai:openAiConfig()});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.patch('/api/admin/smartai/settings',adminRequired,permissionRequired('SEND_REPORTS'),async(req,res)=>{try{const scope=await smartAiScope(req,{customer_code:req.body?.customer_code});const b=req.body||{};const old=await smartAiSettingsRow(scope.customer.id);const row=await one(`UPDATE smartai_settings SET enabled=$2,engine=$3,language=$4,default_audience=$5,timezone=$6,daily_enabled=$7,daily_hour=$8,weekly_enabled=$9,weekly_day=$10,weekly_hour=$11,monthly_enabled=$12,monthly_day=$13,monthly_hour=$14,delivery_channels=$15::text[],telegram_chat_ids=$16,email_recipients=$17,history_limit=$18,updated_by=$19,updated_at=now() WHERE customer_id=$1 RETURNING customer_id::text,enabled,engine,language,default_audience,timezone,daily_enabled,daily_hour,weekly_enabled,weekly_day,weekly_hour,monthly_enabled,monthly_day,monthly_hour,delivery_channels,telegram_chat_ids,email_recipients,history_limit,updated_by,updated_at`,[scope.customer.id,smartAiBool(b.enabled,old.enabled),smartAiChoice(b.engine,SMARTAI_ENGINES,'engine',old.engine),smartAiChoice(b.language,SMARTAI_LANGUAGES,'language',old.language),smartAiChoice(b.default_audience,SMARTAI_AUDIENCES,'default audience',old.default_audience),smartAiText(b.timezone,100)||old.timezone,smartAiBool(b.daily_enabled,old.daily_enabled),smartAiInt(b.daily_hour,old.daily_hour,0,23,'daily hour'),smartAiBool(b.weekly_enabled,old.weekly_enabled),smartAiInt(b.weekly_day,old.weekly_day,0,6,'weekly day'),smartAiInt(b.weekly_hour,old.weekly_hour,0,23,'weekly hour'),smartAiBool(b.monthly_enabled,old.monthly_enabled),smartAiInt(b.monthly_day,old.monthly_day,1,28,'monthly day'),smartAiInt(b.monthly_hour,old.monthly_hour,0,23,'monthly hour'),smartAiChannels(b.delivery_channels),smartAiText(b.telegram_chat_ids,1000),smartAiText(b.email_recipients,2000),smartAiInt(b.history_limit,old.history_limit,10,1000,'history limit'),req.user?.email||'admin']);await writeAuditLog(req,{action:'update_smartai_settings',entity_type:'smartai_settings',entity_id:scope.customer.id,old_values:old,new_values:row,metadata:{customer_code:scope.customer.code}});res.json({status:'ok',version:APP_VERSION,settings:row});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.post('/api/admin/smartai/reports/generate',adminRequired,permissionRequired('SEND_REPORTS'),async(req,res)=>{try{const report=await smartAiBuildReport(req,req.body||{});const saved=await smartAiSaveReport(req,report);await writeAuditLog(req,{action:'generate_smartai_report',entity_type:'ai_report',entity_id:saved.id,new_values:{report_type:report.report_type,period:report.period,audience:report.audience,language:report.language,ai_engine:report.ai_engine},metadata:{customer_code:report.scope.customer.code,read_only:true}});res.status(201).json({status:'ok',version:APP_VERSION,report_id:saved.id,created_at:saved.created_at,report});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.post('/api/admin/smartai/reports/:id/deliver',adminRequired,permissionRequired('SEND_REPORTS'),async(req,res)=>{try{await ensureSmartAiCenterFoundation();const row=await one(`SELECT id::text,customer_id::text,report_json FROM ai_reports WHERE id::text=$1 LIMIT 1`,[req.params.id]);if(!row)return res.status(404).json({status:'not_found',message:'Report not found'});await organizationAssertCustomer(req,(await one(`SELECT code FROM customers WHERE id=$1`,[row.customer_id]))?.code);const result=await smartAiDeliver(row.report_json,{channels:req.body?.channels,telegram_chat_ids:req.body?.telegram_chat_ids,email_recipients:req.body?.email_recipients});await pool.query(`UPDATE ai_reports SET delivery_status=$2::jsonb WHERE id=$1`,[row.id,JSON.stringify(result)]);await writeAuditLog(req,{action:'deliver_smartai_report',entity_type:'ai_report',entity_id:row.id,new_values:result});res.json({status:result.status==='failed'?'not_sent':'ok',version:APP_VERSION,delivery:result});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.get('/api/admin/smartai/reports',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{await ensureSmartAiCenterFoundation();const scope=await smartAiScope(req,{customer_code:req.query.customer_code});const limit=Math.min(Math.max(Number(req.query.limit||100),1),500);const params=[scope.customer.id,limit];let where=`customer_id=$1 AND report_type LIKE 'smartai_%'`;if(req.query.period){params.push(`smartai_${smartAiChoice(req.query.period,SMARTAI_PERIODS,'period','daily')}`);where+=` AND report_type=$${params.length}`;}const rows=(await pool.query(`SELECT id::text,report_type,report_kind,report_date,period_start,period_end,health_score,summary,audience,language,ai_engine,status,delivery_status,created_by,created_at FROM ai_reports WHERE ${where} ORDER BY created_at DESC LIMIT $2`,params)).rows;res.json({status:'ok',version:APP_VERSION,customer:scope.customer,count:rows.length,reports:rows});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.get('/api/admin/smartai/reports/:id',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{await ensureSmartAiCenterFoundation();const row=await one(`SELECT id::text,customer_id::text,report_type,report_date,period_start,period_end,health_score,summary,audience,language,ai_engine,status,delivery_status,report_json,created_by,created_at FROM ai_reports WHERE id::text=$1 AND report_type LIKE 'smartai_%'`,[req.params.id]);if(!row)return res.status(404).json({status:'not_found'});const customer=await one(`SELECT code FROM customers WHERE id=$1`,[row.customer_id]);await organizationAssertCustomer(req,customer?.code);res.json({status:'ok',version:APP_VERSION,report:row});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.get('/api/admin/smartai/reports/:id/text',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{const row=await one(`SELECT customer_id::text,report_json FROM ai_reports WHERE id::text=$1 AND report_type LIKE 'smartai_%'`,[req.params.id]);if(!row)return res.status(404).send('Report not found');const customer=await one(`SELECT code FROM customers WHERE id=$1`,[row.customer_id]);await organizationAssertCustomer(req,customer?.code);res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="FactoryBox_SmartAI_${req.params.id}.txt"`);res.send(smartAiReportText(row.report_json));}catch(e){res.status(e.statusCode||500).send(e.message);}});
app.get('/api/admin/smartai/reports/:id/print',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{const row=await one(`SELECT customer_id::text,report_json FROM ai_reports WHERE id::text=$1 AND report_type LIKE 'smartai_%'`,[req.params.id]);if(!row)return res.status(404).send('Report not found');const customer=await one(`SELECT code FROM customers WHERE id=$1`,[row.customer_id]);await organizationAssertCustomer(req,customer?.code);res.setHeader('Content-Type','text/html; charset=utf-8');res.send(smartAiReportHtml(row.report_json));}catch(e){res.status(e.statusCode||500).send(h(e.message));}});
app.post('/api/admin/smartai/ask',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{const answer=await smartAiAnswerQuestion(req,req.body||{});await writeAuditLog(req,{action:'ask_smartai',entity_type:'smartai_question',entity_id:answer.question_id,new_values:{intent:answer.intent,ai_engine:answer.ai_engine,period:answer.period},metadata:{read_only:true}});res.status(201).json({status:'ok',version:APP_VERSION,answer});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});
app.get('/api/admin/smartai/questions',adminRequired,permissionRequired('VIEW_DASHBOARD'),async(req,res)=>{try{const scope=await smartAiScope(req,{customer_code:req.query.customer_code});const limit=Math.min(Math.max(Number(req.query.limit||50),1),200);const rows=(await pool.query(`SELECT id::text,question,answer,language,ai_engine,intent,period_start,period_end,user_email,evidence_json,created_at FROM smartai_questions WHERE customer_id=$1 ORDER BY created_at DESC LIMIT $2`,[scope.customer.id,limit])).rows;res.json({status:'ok',version:APP_VERSION,customer:scope.customer,count:rows.length,questions:rows});}catch(e){res.status(e.statusCode||500).json({status:'error',version:APP_VERSION,message:e.message});}});

async function smartAiRunScheduledReports(){await ensureSmartAiCenterFoundation();const settings=(await pool.query(`SELECT s.*,c.code AS customer_code FROM smartai_settings s JOIN customers c ON c.id=s.customer_id WHERE s.enabled=true AND (s.daily_enabled OR s.weekly_enabled OR s.monthly_enabled)`)).rows;const results=[];for(const s of settings){const local=smartAiLocalParts(s.timezone);const jobs=[];if(s.daily_enabled&&local.hour===Number(s.daily_hour))jobs.push({type:'daily',key:local.date});if(s.weekly_enabled&&local.hour===Number(s.weekly_hour)&&new Date(`${local.date}T00:00:00Z`).getUTCDay()===Number(s.weekly_day))jobs.push({type:'weekly',key:local.date});if(s.monthly_enabled&&local.hour===Number(s.monthly_hour)&&local.day===Number(s.monthly_day))jobs.push({type:'monthly',key:local.date});for(const job of jobs){let run;try{run=await one(`INSERT INTO smartai_scheduler_runs(customer_id,schedule_key,period_type,status) VALUES($1,$2,$3,'running') ON CONFLICT DO NOTHING RETURNING id::text`,[s.customer_id,job.key,job.type]);if(!run)continue;const fakeReq={user:{id:'system',email:'smartai-scheduler',role:'system_admin'},tenant:null};const report=await smartAiBuildReport(fakeReq,{customer_code:s.customer_code,period:job.type,language:s.language,audience:s.default_audience,engine:s.engine});const saved=await smartAiSaveReport(fakeReq,report);const delivery=await smartAiDeliver(report,{channels:s.delivery_channels,telegram_chat_ids:s.telegram_chat_ids,email_recipients:s.email_recipients});await pool.query(`UPDATE ai_reports SET delivery_status=$2::jsonb WHERE id=$1`,[saved.id,JSON.stringify(delivery)]);await pool.query(`UPDATE smartai_scheduler_runs SET status='completed',report_id=$2,delivery_result=$3::jsonb,completed_at=now() WHERE id=$1`,[run.id,saved.id,JSON.stringify(delivery)]);results.push({customer_code:s.customer_code,period:job.type,report_id:saved.id,delivery});}catch(e){if(run)await pool.query(`UPDATE smartai_scheduler_runs SET status='failed',error_message=$2,completed_at=now() WHERE id=$1`,[run.id,String(e.message||e).slice(0,1000)]);results.push({customer_code:s.customer_code,period:job.type,error:e.message});}}}return results;}
function stopSmartAiScheduler(){if(smartAiSchedulerTimer)clearInterval(smartAiSchedulerTimer);if(smartAiSchedulerKickoffTimer)clearTimeout(smartAiSchedulerKickoffTimer);smartAiSchedulerTimer=null;smartAiSchedulerKickoffTimer=null;}
function startSmartAiScheduler(){stopSmartAiScheduler();const run=()=>smartAiRunScheduledReports().then(rows=>{if(rows.length)console.log(`SmartAI scheduler: ${rows.length} job(s) processed`);}).catch(e=>console.error('SmartAI scheduler error:',e.message));smartAiSchedulerTimer=setInterval(run,60*60*1000);smartAiSchedulerTimer.unref?.();smartAiSchedulerKickoffTimer=setTimeout(run,10000);smartAiSchedulerKickoffTimer.unref?.();console.log('SmartAI report scheduler: hourly checks enabled');}

let alarmEscalationDeliveryTimer = null;
let alarmEscalationDeliveryKickoffTimer = null;
let alarmEscalationDeliveryRunning = false;
let alarmAutomationSchedulerTimer = null;
let alarmAutomationSchedulerKickoffTimer = null;
let alarmReportSchedulerTimer = null;
let alarmReportSchedulerKickoffTimer = null;
let maintenanceSchedulerTimer = null;
let maintenanceSchedulerKickoffTimer = null;

function stopAlarmEscalationDeliveryWorker() {
  if (alarmEscalationDeliveryTimer) clearInterval(alarmEscalationDeliveryTimer);
  if (alarmEscalationDeliveryKickoffTimer) clearTimeout(alarmEscalationDeliveryKickoffTimer);
  alarmEscalationDeliveryTimer = null;
  alarmEscalationDeliveryKickoffTimer = null;
}

function startAlarmEscalationDeliveryWorker() {
  if (alarmAutomationSchedulerEnabled()) {
    console.log('Alarm escalation legacy auto delivery: disabled (automation scheduler active)');
    return;
  }
  if (!alarmEscalationDeliveryEnabled() || !alarmEscalationAutoDeliveryEnabled()) {
    console.log('Alarm escalation auto delivery: disabled');
    return;
  }
  if (alarmEscalationDeliveryTimer) return;

  const run = async () => {
    if (alarmEscalationDeliveryRunning) return;
    alarmEscalationDeliveryRunning = true;
    try {
      await prepareDueEscalationRetries();
      const result = await processAlarmEscalationDeliveries({
        limit:alarmEscalationDeliveryBatchSize(),
        trigger:'auto-worker'
      });
      if (result.claimed_count) {
        console.log(`Alarm escalation worker: ${result.delivered_count} delivered, ${result.failed_count} failed, ${result.dead_letter_count || 0} dead letter`);
      }
    } catch (error) {
      console.error('Alarm escalation worker error:', error.message);
    } finally {
      alarmEscalationDeliveryRunning = false;
    }
  };

  alarmEscalationDeliveryTimer = setInterval(run, alarmEscalationDeliveryIntervalSec() * 1000);
  alarmEscalationDeliveryTimer.unref?.();
  alarmEscalationDeliveryKickoffTimer = setTimeout(run, 2500);
  alarmEscalationDeliveryKickoffTimer.unref?.();
  console.log(`Alarm escalation auto delivery: every ${alarmEscalationDeliveryIntervalSec()} sec`);
}

function restartAlarmEscalationDeliveryWorker() {
  stopAlarmEscalationDeliveryWorker();
  startAlarmEscalationDeliveryWorker();
}

function stopAlarmAutomationScheduler() {
  if (alarmAutomationSchedulerTimer) clearInterval(alarmAutomationSchedulerTimer);
  if (alarmAutomationSchedulerKickoffTimer) clearTimeout(alarmAutomationSchedulerKickoffTimer);
  alarmAutomationSchedulerTimer = null;
  alarmAutomationSchedulerKickoffTimer = null;
  alarmAutomationSchedulerState.next_run_at = null;
}

function startAlarmAutomationScheduler() {
  if (!alarmAutomationSchedulerEnabled()) {
    console.log('Alarm automation scheduler: disabled');
    return;
  }
  if (alarmAutomationSchedulerTimer) return;

  const intervalMs = alarmAutomationSchedulerIntervalSec() * 1000;
  const run = async () => {
    try {
      const result = await runAlarmAutomationCycle({trigger:'auto-scheduler'});
      if (result.status === 'completed') {
        console.log(`Alarm automation scheduler: ${result.scan.created_count} created, ${result.retry.retried_count} retried, ${result.delivery.delivered_count} delivered`);
      }
    } catch (error) {
      console.error('Alarm automation scheduler error:', error.message);
    }
  };

  alarmAutomationSchedulerState.next_run_at = new Date(Date.now() + Math.min(intervalMs, 3000)).toISOString();
  alarmAutomationSchedulerTimer = setInterval(run, intervalMs);
  alarmAutomationSchedulerTimer.unref?.();
  alarmAutomationSchedulerKickoffTimer = setTimeout(run, Math.min(intervalMs, 3000));
  alarmAutomationSchedulerKickoffTimer.unref?.();
  console.log(`Alarm automation scheduler: every ${alarmAutomationSchedulerIntervalSec()} sec`);
}

function restartAlarmAutomationScheduler() {
  stopAlarmAutomationScheduler();
  startAlarmAutomationScheduler();
}


function stopAlarmReportScheduler() {
  if (alarmReportSchedulerTimer) clearInterval(alarmReportSchedulerTimer);
  if (alarmReportSchedulerKickoffTimer) clearTimeout(alarmReportSchedulerKickoffTimer);
  alarmReportSchedulerTimer = null;
  alarmReportSchedulerKickoffTimer = null;
  alarmReportSchedulerState.next_check_at = null;
}

function startAlarmReportScheduler() {
  if (!alarmReportSchedulerEnabled()) {
    console.log('Alarm report scheduler: disabled');
    return;
  }
  if (alarmReportSchedulerTimer) return;
  const intervalMs = 60 * 1000;
  const run = async () => {
    alarmReportSchedulerState.next_check_at = new Date(Date.now() + intervalMs).toISOString();
    try {
      const result = await runDueAlarmReports({trigger:'auto-report-scheduler'});
      const delivered = result.results?.filter(row => ['delivered','partial'].includes(row.status)).length || 0;
      if (delivered) console.log(`Alarm report scheduler: ${delivered} report delivered`);
    } catch (error) {
      console.error('Alarm report scheduler error:', error.message);
    }
  };
  alarmReportSchedulerState.next_check_at = new Date(Date.now() + Math.min(intervalMs, 5000)).toISOString();
  alarmReportSchedulerTimer = setInterval(run, intervalMs);
  alarmReportSchedulerTimer.unref?.();
  alarmReportSchedulerKickoffTimer = setTimeout(run, Math.min(intervalMs, 5000));
  alarmReportSchedulerKickoffTimer.unref?.();
  console.log(`Alarm report scheduler: daily ${alarmReportDailyHour()}:00, weekly ${alarmReportWeekdayName(alarmReportWeeklyDay())} ${alarmReportWeeklyHour()}:00 (${alarmReportTimezone()})`);
}

function restartAlarmReportScheduler() {
  stopAlarmReportScheduler();
  startAlarmReportScheduler();
}


function stopMaintenanceScheduler() {
  if (maintenanceSchedulerTimer) clearInterval(maintenanceSchedulerTimer);
  if (maintenanceSchedulerKickoffTimer) clearTimeout(maintenanceSchedulerKickoffTimer);
  maintenanceSchedulerTimer=null;
  maintenanceSchedulerKickoffTimer=null;
  maintenanceSchedulerState.next_run_at=null;
}

async function startMaintenanceScheduler() {
  stopMaintenanceScheduler();
  let settings;
  try { settings=await maintenanceSchedulerSettings(); }
  catch(error) { console.error('Maintenance scheduler settings error:',error.message); return; }
  if (!settings.enabled) { console.log('Preventive maintenance scheduler: disabled'); return; }
  const intervalSec=Math.min(Math.max(Number(settings.interval_sec||60),15),3600);
  const intervalMs=intervalSec*1000;
  const run=async()=>{
    maintenanceSchedulerState.next_run_at=new Date(Date.now()+intervalMs).toISOString();
    try { const result=await scanPreventiveMaintenance({trigger:'auto-scheduler'}); if(result.created_count) console.log(`Preventive maintenance scheduler: ${result.created_count} work order created`); }
    catch(error){maintenanceSchedulerState.last_error=error.message;console.error('Preventive maintenance scheduler error:',error.message);}
  };
  maintenanceSchedulerState.next_run_at=new Date(Date.now()+Math.min(intervalMs,5000)).toISOString();
  maintenanceSchedulerTimer=setInterval(run,intervalMs);maintenanceSchedulerTimer.unref?.();
  maintenanceSchedulerKickoffTimer=setTimeout(run,Math.min(intervalMs,5000));maintenanceSchedulerKickoffTimer.unref?.();
  console.log(`Preventive maintenance scheduler: every ${intervalSec} sec`);
}

function restartMaintenanceScheduler() { startMaintenanceScheduler().catch(error=>console.error('Maintenance scheduler restart error:',error.message)); }

async function start() {
  await pool.query('SELECT 1');
  await ensureMailGatewayFoundation();
  await ensureInstallationRegistryFoundation();
  if (mailGatewayOnlyEnabled()) {
    httpServer = app.listen(PORT, '0.0.0.0', ()=> console.log(`HukaTech Central Mail Gateway v${APP_VERSION}: http://0.0.0.0:${PORT}`));
    return;
  }
  const bootstrapDefaultEntities = ['1','true','yes','on'].includes(
    String(process.env.BOOTSTRAP_DEFAULT_ENTITIES || '').trim().toLowerCase()
  );
  if (bootstrapDefaultEntities) {
    await ensureEntities();
    console.log('Default entity bootstrap: enabled');
  } else {
    console.log('Default entity bootstrap: disabled');
  }
  await ensureSaasFoundation();
  await ensureSecurityFoundation();
  await ensureOrganizationFoundation();
  await ensurePasswordResetSchema();
  await ensureAuditLogSchema();
  await ensureInviteSchema();
  await ensureBillingFoundation();
  await ensureDeviceRegistrySchema();
  await ensureDeviceOnboardingFoundation();
  await ensureDeviceCapabilityFoundation();
  await ensureAssetManagementFoundation();
  await ensureLiveMonitoringFoundation();
  await ensureAlarmEscalationFoundation();
  await ensureNotificationSettingsFoundation();
  await ensureGeneralSettingsFoundation();
  await ensureRemoteAccessFoundation();
  await ensureSystemHealthFoundation();
  await ensureMaintenanceFoundation();
  await ensurePreventiveMaintenanceFoundation();
  await ensureInventoryFoundation();
  await ensureOeeFoundation();
  await ensureSmartAiCenterFoundation();
  const mqttOptions = { clientId:`factorybox-platform-backend-${Math.random().toString(16).slice(2)}`, clean:true, reconnectPeriod:3000 };
  if (process.env.MQTT_USERNAME) mqttOptions.username = String(process.env.MQTT_USERNAME);
  if (process.env.MQTT_PASSWORD) mqttOptions.password = String(process.env.MQTT_PASSWORD);
  mqttClient = mqtt.connect(CFG.mqttUrl, mqttOptions);
  mqttClient.on('connect',()=>{ mqttConnected=true; mqttClient.subscribe(`${CFG.baseTopic}/#`, (err)=> console.log(err ? err.message : `MQTT subscribed: ${CFG.baseTopic}/#`)); });
  mqttClient.on('close',()=>{ mqttConnected=false; });
  mqttClient.on('error',(e)=> console.error('MQTT error:', e.message));
  mqttClient.on('message', handleMessage);
  httpServer = app.listen(PORT, '0.0.0.0', ()=> console.log(`FactoryBox Platform Backend v${APP_VERSION}: http://0.0.0.0:${PORT}`));
  startAlarmEscalationDeliveryWorker();
  startAlarmAutomationScheduler();
  startAlarmReportScheduler();
  startMaintenanceScheduler();
  restartSystemHealthSchedulers();
  startSmartAiScheduler();
}



let shutdownStarted = false;
async function gracefulShutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Graceful shutdown started: ${signal}`);
  const forceTimer = setTimeout(() => {
    console.error('Graceful shutdown timeout; forcing process exit.');
    process.exit(1);
  }, 15000);
  forceTimer.unref?.();
  try { stopAlarmEscalationDeliveryWorker(); } catch (_) {}
  try { stopAlarmAutomationScheduler(); } catch (_) {}
  try { stopAlarmReportScheduler(); } catch (_) {}
  try { stopMaintenanceScheduler(); } catch (_) {}
  try { stopSystemHealthSchedulers?.(); } catch (_) {}
  try { stopSmartAiScheduler?.(); } catch (_) {}
  try { mqttClient?.end(true); } catch (_) {}
  if (httpServer) {
    await new Promise(resolve => httpServer.close(() => resolve()));
  }
  try { await pool.end(); } catch (_) {}
  clearTimeout(forceTimer);
  console.log('Graceful shutdown completed.');
  process.exit(0);
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

start().catch(e=>{ console.error('Backend start failed:', e); process.exit(1); });


