
CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'owner',
  status text NOT NULL DEFAULT 'active',
  default_customer_code text,
  default_site_code text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user_tenant_access (
  id bigserial PRIMARY KEY,
  user_email text NOT NULL,
  customer_code text NOT NULL,
  site_code text,
  access_role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_email, customer_code, site_code)
);

CREATE INDEX IF NOT EXISTS idx_app_user_tenant_access_email
ON app_user_tenant_access(user_email);
