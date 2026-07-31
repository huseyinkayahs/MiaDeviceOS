-- HukaTech Platform v6.10.0
-- Customer Installation Registry Foundation

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
);

CREATE INDEX IF NOT EXISTS idx_customer_installations_status
ON customer_installations(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_installations_customer_code
ON customer_installations(customer_code);

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
);

CREATE INDEX IF NOT EXISTS idx_customer_installation_events_installation
ON customer_installation_events(installation_id, created_at DESC);
