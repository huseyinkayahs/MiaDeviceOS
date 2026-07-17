CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('active', 'passive', 'pilot', 'archived'))
);

CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    location TEXT,
    timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, code),
    CHECK (status IN ('active', 'passive', 'pilot', 'archived'))
);

CREATE TABLE IF NOT EXISTS machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    machine_type TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, code),
    CHECK (status IN ('active', 'passive', 'maintenance', 'archived'))
);

CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    device_uid TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL DEFAULT 'FactoryBox One',
    firmware_version TEXT,
    hardware_revision TEXT,
    mqtt_base_topic TEXT,
    last_seen_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('online', 'offline', 'unknown', 'maintenance', 'archived'))
);

CREATE TABLE IF NOT EXISTS sensors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, code),
    CHECK (status IN ('active', 'passive', 'fault', 'archived'))
);

CREATE TABLE IF NOT EXISTS telemetry_events (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    event_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_amp NUMERIC(10, 3),
    temperature_c NUMERIC(10, 3),
    wifi_rssi INTEGER,
    uptime_ms BIGINT,
    alarm_active BOOLEAN,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS machine_state_events (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    state TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'unknown',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    duration_sec INTEGER,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    CHECK (state IN ('RUNNING', 'STOPPED', 'UNKNOWN'))
);

CREATE TABLE IF NOT EXISTS alarms (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    alarm_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cleared_at TIMESTAMPTZ,
    message TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    CHECK (severity IN ('info', 'warning', 'critical')),
    CHECK (status IN ('active', 'cleared', 'acknowledged'))
);

CREATE TABLE IF NOT EXISTS daily_machine_summaries (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    runtime_sec INTEGER NOT NULL DEFAULT 0,
    stop_sec INTEGER NOT NULL DEFAULT 0,
    observed_sec INTEGER NOT NULL DEFAULT 0,
    utilization_pct NUMERIC(6, 2),
    longest_run_sec INTEGER NOT NULL DEFAULT 0,
    longest_stop_sec INTEGER NOT NULL DEFAULT 0,
    run_start_count INTEGER NOT NULL DEFAULT 0,
    stop_start_count INTEGER NOT NULL DEFAULT 0,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (machine_id, summary_date)
);

CREATE TABLE IF NOT EXISTS vision_events (
    id BIGSERIAL PRIMARY KEY,
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    camera_code TEXT,
    event_type TEXT NOT NULL,
    value_text TEXT,
    value_number NUMERIC(12, 3),
    confidence NUMERIC(5, 4),
    event_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS workflow_events (
    id BIGSERIAL PRIMARY KEY,
    workflow_name TEXT NOT NULL,
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'done',
    event_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS ai_reports (
    id BIGSERIAL PRIMARY KEY,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    machine_id UUID REFERENCES machines(id) ON DELETE SET NULL,
    report_type TEXT NOT NULL,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    summary_text TEXT NOT NULL,
    model_name TEXT,
    source_data_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_commands (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    UNIQUE (device_id, request_id),
    CHECK (status IN ('pending', 'sent', 'done', 'failed', 'timeout'))
);

CREATE INDEX IF NOT EXISTS idx_sites_customer_id ON sites(customer_id);
CREATE INDEX IF NOT EXISTS idx_machines_site_id ON machines(site_id);
CREATE INDEX IF NOT EXISTS idx_devices_machine_id ON devices(machine_id);
CREATE INDEX IF NOT EXISTS idx_sensors_device_id ON sensors(device_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_ts ON telemetry_events(device_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_machine_ts ON telemetry_events(machine_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_machine_state_machine_started ON machine_state_events(machine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_machine_started ON alarms(machine_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summary_machine_date ON daily_machine_summaries(machine_id, summary_date DESC);
CREATE INDEX IF NOT EXISTS idx_vision_machine_ts ON vision_events(machine_id, event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_customer_created ON ai_reports(customer_id, created_at DESC);

CREATE OR REPLACE VIEW v_machine_overview AS
SELECT
    c.code AS customer_code,
    c.name AS customer_name,
    s.code AS site_code,
    s.name AS site_name,
    m.id AS machine_id,
    m.code AS machine_code,
    m.name AS machine_name,
    m.machine_type,
    d.device_uid,
    d.model AS device_model,
    d.firmware_version,
    d.status AS device_status,
    d.last_seen_at
FROM machines m
JOIN sites s ON s.id = m.site_id
JOIN customers c ON c.id = s.customer_id
LEFT JOIN devices d ON d.machine_id = m.id;

CREATE OR REPLACE VIEW v_latest_device_telemetry AS
SELECT DISTINCT ON (device_id)
    device_id,
    machine_id,
    event_ts,
    current_amp,
    temperature_c,
    wifi_rssi,
    uptime_ms,
    alarm_active
FROM telemetry_events
ORDER BY device_id, event_ts DESC;

CREATE OR REPLACE VIEW v_latest_machine_state AS
SELECT DISTINCT ON (machine_id)
    machine_id,
    device_id,
    state,
    source,
    started_at,
    ended_at,
    duration_sec
FROM machine_state_events
ORDER BY machine_id, started_at DESC;
