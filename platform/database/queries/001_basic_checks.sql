\echo '--- customers ---'
SELECT code, name, status, created_at FROM customers;

\echo '--- machine overview ---'
SELECT customer_code, site_code, machine_code, machine_name, device_uid, firmware_version, device_status
FROM v_machine_overview;

\echo '--- sensors ---'
SELECT d.device_uid, s.code, s.sensor_type, s.name, s.unit, s.status
FROM sensors s
JOIN devices d ON d.id = s.device_id
ORDER BY s.code;

\echo '--- latest telemetry ---'
SELECT d.device_uid, t.event_ts, t.current_amp, t.temperature_c, t.wifi_rssi, t.alarm_active
FROM v_latest_device_telemetry t
JOIN devices d ON d.id = t.device_id;

\echo '--- latest machine state ---'
SELECT m.code AS machine_code, l.state, l.source, l.started_at, l.duration_sec
FROM v_latest_machine_state l
JOIN machines m ON m.id = l.machine_id;

\echo '--- daily summaries ---'
SELECT m.code AS machine_code, s.summary_date, s.runtime_sec, s.stop_sec, s.utilization_pct
FROM daily_machine_summaries s
JOIN machines m ON m.id = s.machine_id;

\echo '--- active alarms ---'
SELECT m.code AS machine_code, a.alarm_type, a.severity, a.status, a.message
FROM alarms a
LEFT JOIN machines m ON m.id = a.machine_id
ORDER BY a.started_at DESC;

\echo '--- vision events ---'
SELECT m.code AS machine_code, v.camera_code, v.event_type, v.value_text, v.value_number, v.confidence, v.event_ts
FROM vision_events v
LEFT JOIN machines m ON m.id = v.machine_id
ORDER BY v.event_ts DESC;

\echo '--- ai reports ---'
SELECT report_type, summary_text, created_at
FROM ai_reports
ORDER BY created_at DESC;
