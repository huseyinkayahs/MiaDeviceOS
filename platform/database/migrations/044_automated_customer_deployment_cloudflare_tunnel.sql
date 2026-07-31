BEGIN;

ALTER TABLE customer_installations
  ADD COLUMN IF NOT EXISTS cloudflare_tunnel_id text,
  ADD COLUMN IF NOT EXISTS cloudflare_dns_record_id text,
  ADD COLUMN IF NOT EXISTS cloudflare_origin_service text,
  ADD COLUMN IF NOT EXISTS cloudflare_provisioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS cloudflare_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS cloudflare_error text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_installations_cloudflare_tunnel_id
  ON customer_installations(cloudflare_tunnel_id)
  WHERE cloudflare_tunnel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_installations_cloudflare_state
  ON customer_installations(tunnel_status, cloudflare_last_checked_at DESC);

COMMIT;
