
-- v4.8 SaaS Management Actions Pack
-- Yönetim aksiyonları için status/role sorgularında yardımcı indexler.

CREATE INDEX IF NOT EXISTS idx_app_users_status
ON app_users(status);

CREATE INDEX IF NOT EXISTS idx_app_users_role
ON app_users(role);

CREATE INDEX IF NOT EXISTS idx_customers_status
ON customers(status);

CREATE INDEX IF NOT EXISTS idx_sites_status
ON sites(status);
