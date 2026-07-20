
-- v4.7 SaaS Admin Panel Pack
-- Admin listeleri için yardımcı indexler.

CREATE INDEX IF NOT EXISTS idx_app_users_created_at
ON app_users(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_created_at
ON customers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sites_created_at
ON sites(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_tenant_access_created_at
ON app_user_tenant_access(created_at DESC);
