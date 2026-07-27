-- FactoryBox One v6.4.0
-- Multi-Site / Multi-Factory Management

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  country TEXT NOT NULL DEFAULT 'Türkiye',
  timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul',
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(customer_id, code)
);

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS workweek_start SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Istanbul';

CREATE TABLE IF NOT EXISTS production_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  shift_pattern JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, code)
);

ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS production_line_id UUID REFERENCES production_lines(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app_user_location_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  factory_id UUID REFERENCES factories(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  production_line_id UUID REFERENCES production_lines(id) ON DELETE CASCADE,
  access_role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user_location_policy (
  user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_location_access_scope
ON app_user_location_access(
  user_id,
  customer_id,
  COALESCE(factory_id, '00000000-0000-0000-0000-000000000000'::UUID),
  COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::UUID),
  COALESCE(production_line_id, '00000000-0000-0000-0000-000000000000'::UUID)
);

CREATE INDEX IF NOT EXISTS idx_factories_customer_status ON factories(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_sites_factory_status ON sites(factory_id, status);
CREATE INDEX IF NOT EXISTS idx_production_lines_site_status ON production_lines(site_id, status);
CREATE INDEX IF NOT EXISTS idx_machines_production_line ON machines(production_line_id);
CREATE INDEX IF NOT EXISTS idx_user_location_access_user ON app_user_location_access(user_id, status);

-- Backward-compatible hierarchy for existing records.
INSERT INTO factories(customer_id, code, name, location, country, timezone, status, metadata)
SELECT
  c.id,
  'main',
  c.name || ' Ana Fabrika',
  NULL,
  'Türkiye',
  'Europe/Istanbul',
  CASE WHEN c.status IN ('active','pilot','trial') THEN 'active' ELSE 'inactive' END,
  jsonb_build_object('auto_created', true, 'migration_version', '6.4.0')
FROM customers c
ON CONFLICT(customer_id, code) DO NOTHING;

UPDATE sites s
SET factory_id=f.id,
    timezone=COALESCE(NULLIF(s.timezone, ''), 'Europe/Istanbul')
FROM factories f
WHERE s.customer_id=f.customer_id
  AND f.code='main'
  AND s.factory_id IS NULL;

INSERT INTO production_lines(site_id, code, name, description, status, shift_pattern)
SELECT
  s.id,
  'general',
  'Genel Üretim Hattı',
  'v6.4 otomatik oluşturulan varsayılan hat',
  'active',
  '{}'::jsonb
FROM sites s
ON CONFLICT(site_id, code) DO NOTHING;

UPDATE machines m
SET production_line_id=pl.id
FROM production_lines pl
WHERE pl.site_id=m.site_id
  AND pl.code='general'
  AND m.production_line_id IS NULL;
