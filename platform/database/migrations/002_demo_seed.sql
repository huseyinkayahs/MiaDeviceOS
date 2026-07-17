INSERT INTO customers (id, code, name, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'mia-demo', 'Mia Demo', 'pilot')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sites (id, customer_id, code, name, location, status)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'site01', 'Mia Demo Atolye', 'Istanbul', 'pilot')
ON CONFLICT (id) DO NOTHING;

INSERT INTO machines (id, site_id, code, name, machine_type, status)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'laser01', 'Lazer-01', 'laser_cutting', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO devices (id, machine_id, device_uid, model, firmware_version, hardware_revision, mqtt_base_topic, last_seen_at, status)
VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 'laser01', 'FactoryBox One', '3.3.0', 'prototype', 'mia/site01/laser01', now(), 'online')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensors (id, device_id, code, sensor_type, name, unit, metadata)
VALUES
('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', 'DI1', 'digital_input', 'Machine RUN Signal', NULL, '{"pin": 27, "active_low": true, "driver": "PC817"}'::jsonb),
('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000004', 'TEMP1', 'temperature', 'DS18B20 Temperature Sensor', 'C', '{"pin": 4, "resolution_bits": 10}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO telemetry_events (device_id, machine_id, event_ts, current_amp, temperature_c, wifi_rssi, uptime_ms, alarm_active, raw_payload)
VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', now(), 20.000, 30.000, -42, 123456, true, '{"source": "demo_seed", "firmware_version": "3.3.0"}'::jsonb);

INSERT INTO machine_state_events (machine_id, device_id, state, source, started_at, duration_sec, raw_payload)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'RUNNING', 'DI1', now() - interval '25 minutes', 1500, '{"source": "demo_seed"}'::jsonb);

INSERT INTO daily_machine_summaries (machine_id, summary_date, runtime_sec, stop_sec, observed_sec, utilization_pct, longest_run_sec, longest_stop_sec, run_start_count, stop_start_count, raw_payload)
VALUES ('00000000-0000-0000-0000-000000000003', CURRENT_DATE, 14400, 3600, 18000, 80.00, 5400, 1200, 4, 3, '{"source": "demo_seed"}'::jsonb)
ON CONFLICT (machine_id, summary_date) DO NOTHING;

INSERT INTO alarms (machine_id, device_id, alarm_type, severity, status, started_at, message, raw_payload)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'OVER_CURRENT', 'warning', 'active', now() - interval '10 minutes', 'Demo over current alarm', '{"current": 20, "current_limit": 12, "source": "demo_seed"}'::jsonb);

INSERT INTO vision_events (machine_id, device_id, camera_code, event_type, value_number, confidence, event_ts, raw_payload)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'cam01', 'part_count', 124, 0.9200, now(), '{"source": "demo_seed"}'::jsonb);

INSERT INTO ai_reports (customer_id, site_id, machine_id, report_type, period_start, period_end, summary_text, model_name, source_data_ref)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'daily_machine_summary', date_trunc('day', now()), now(), 'Demo rapor: Lazer-01 bugün yüzde 80 kullanım oranı ile çalıştı. En uzun duruş 20 dakika sürdü. Sıcaklık ve DI1 verileri platforma başarıyla aktarıldı.', 'demo', '{"source": "demo_seed"}'::jsonb);
