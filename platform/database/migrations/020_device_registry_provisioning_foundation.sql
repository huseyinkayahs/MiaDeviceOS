-- FactoryBox One v5.7.0
-- Device Registry / Provisioning Foundation Pack

ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial_no text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'paired';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_token_hash text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioning_token_expires_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_notes text;

UPDATE devices
SET provisioning_status='paired', provisioned_at=COALESCE(provisioned_at, created_at)
WHERE provisioning_status IS NULL
   OR provisioning_status NOT IN ('pending','paired','revoked');

CREATE INDEX IF NOT EXISTS idx_devices_provisioning_status
ON devices(provisioning_status);

CREATE INDEX IF NOT EXISTS idx_devices_provisioning_token_hash
ON devices(provisioning_token_hash);

CREATE INDEX IF NOT EXISTS idx_devices_status_updated_at
ON devices(status, updated_at DESC);
