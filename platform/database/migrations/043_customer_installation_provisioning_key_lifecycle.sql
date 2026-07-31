-- HukaTech Platform v6.11.0
-- Customer Installation Provisioning & Key Lifecycle

ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'registered';
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioning_token_sha256 text;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioning_token_prefix text;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioning_token_expires_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioning_token_used_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS package_generated_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS last_provisioned_version text;
ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS key_generation integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_installations_provisioning_status_check'
  ) THEN
    ALTER TABLE customer_installations
      ADD CONSTRAINT customer_installations_provisioning_status_check
      CHECK (provisioning_status IN (
        'registered','package_generated','provisioned','verified','revoked'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_installations_provisioning_status
ON customer_installations(provisioning_status, updated_at DESC);

UPDATE customer_installations
SET provisioning_status='verified',
    provisioned_at=COALESCE(provisioned_at,now()),
    verified_at=COALESCE(verified_at,now()),
    last_provisioned_version=COALESCE(last_provisioned_version,'6.11.0'),
    updated_at=now()
WHERE source='environment';
