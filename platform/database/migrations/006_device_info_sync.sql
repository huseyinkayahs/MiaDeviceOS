
ALTER TABLE devices ADD COLUMN IF NOT EXISTS platform_name text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS build_type text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_build text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS raw_device_info jsonb;

CREATE INDEX IF NOT EXISTS idx_devices_device_uid_updated
ON devices(device_uid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_devices_machine_updated
ON devices(machine_id, updated_at DESC);
