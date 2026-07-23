-- FactoryBox One v5.11.0
-- Machine Live Monitoring / Telemetry Snapshot Pack

CREATE INDEX IF NOT EXISTS idx_telemetry_events_machine_ts_desc
ON telemetry_events(machine_id, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_machine_state_events_machine_started_desc
ON machine_state_events(machine_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_alarms_machine_status_started
ON alarms(machine_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_devices_machine_status_seen
ON devices(machine_id, status, last_seen_at DESC);
