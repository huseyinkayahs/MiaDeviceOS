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

app.get('/api/health', async (req,res)=>{
  try {
    const db = await pool.query('SELECT now() AS now');
    const counts = await one(`SELECT (SELECT count(*)::int FROM customers) customers, (SELECT count(*)::int FROM machines) machines, (SELECT count(*)::int FROM devices) devices, (SELECT count(*)::int FROM telemetry_events) telemetry_events, (SELECT count(*)::int FROM machine_state_events) machine_state_events, (SELECT count(*)::int FROM alarms) alarms`);
    res.json({ status:'ok', service:'factorybox-platform-backend', version:'3.5.0', database_time: db.rows[0].now, mqtt_connected:mqttConnected, mqtt_base_topic:CFG.baseTopic, last_mqtt_message_at:lastMqttMessageAt, last_mqtt_topic:lastMqttTopic, counts });
  } catch(e) { res.status(500).json({status:'error', message:e.message}); }
});

app.get('/api/machines', async (req,res)=>{ const r=await pool.query('SELECT * FROM v_machine_overview ORDER BY customer_code,site_code,machine_code'); res.json(r.rows); });
app.get('/api/machines/:code/status', async (req,res)=>{
  const r = await one(`SELECT mo.*, row_to_json(ls.*) latest_state, row_to_json(lt.*) latest_telemetry,
    (SELECT json_agg(a ORDER BY a.started_at DESC) FROM (SELECT alarm_type,severity,status,started_at,cleared_at,message FROM alarms a WHERE a.machine_id=mo.machine_id ORDER BY started_at DESC LIMIT 5) a) recent_alarms,
    (SELECT row_to_json(s.*) FROM (SELECT summary_date,runtime_sec,stop_sec,observed_sec,utilization_pct,longest_run_sec,longest_stop_sec,run_start_count,stop_start_count FROM daily_machine_summaries d WHERE d.machine_id=mo.machine_id ORDER BY summary_date DESC LIMIT 1) s) latest_daily_summary
    FROM v_machine_overview mo LEFT JOIN v_latest_machine_state ls ON ls.machine_id=mo.machine_id LEFT JOIN v_latest_device_telemetry lt ON lt.machine_id=mo.machine_id WHERE mo.machine_code=$1 LIMIT 1`, [req.params.code]);
  if (!r) return res.status(404).json({status:'not_found'}); res.json(r);
});
app.get('/api/machines/:code/telemetry/latest', async (req,res)=>{ const r=await pool.query('SELECT t.* FROM telemetry_events t JOIN machines m ON m.id=t.machine_id WHERE m.code=$1 ORDER BY t.event_ts DESC LIMIT 20',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/daily-summary', async (req,res)=>{ const r=await pool.query('SELECT d.* FROM daily_machine_summaries d JOIN machines m ON m.id=d.machine_id WHERE m.code=$1 ORDER BY d.summary_date DESC LIMIT 30',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/alarms', async (req,res)=>{ const r=await pool.query('SELECT a.* FROM alarms a JOIN machines m ON m.id=a.machine_id WHERE m.code=$1 ORDER BY a.started_at DESC LIMIT 50',[req.params.code]); res.json(r.rows); });
app.get('/api/machines/:code/events', async (req,res)=>{ const r=await pool.query(`SELECT 'machine_state' event_group,state event_type,started_at event_ts,raw_payload FROM machine_state_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 UNION ALL SELECT 'vision',event_type,event_ts,raw_payload FROM vision_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 UNION ALL SELECT 'workflow',event_type,event_ts,raw_payload FROM workflow_events e JOIN machines m ON m.id=e.machine_id WHERE m.code=$1 ORDER BY event_ts DESC LIMIT 50`,[req.params.code]); res.json(r.rows); });

async function start() {
  await pool.query('SELECT 1');
  await ensureEntities();
  const client = mqtt.connect(CFG.mqttUrl, { clientId:`factorybox-platform-backend-${Math.random().toString(16).slice(2)}`, clean:true, reconnectPeriod:3000 });
  client.on('connect',()=>{ mqttConnected=true; client.subscribe(`${CFG.baseTopic}/#`, (err)=> console.log(err ? err.message : `MQTT subscribed: ${CFG.baseTopic}/#`)); });
  client.on('close',()=>{ mqttConnected=false; });
  client.on('error',(e)=> console.error('MQTT error:', e.message));
  client.on('message', handleMessage);
  app.listen(PORT, ()=> console.log(`FactoryBox Platform Backend MVP: http://localhost:${PORT}`));
}
start().catch(e=>{ console.error('Backend start failed:', e); process.exit(1); });
