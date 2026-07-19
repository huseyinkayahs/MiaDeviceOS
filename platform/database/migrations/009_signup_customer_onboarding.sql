
-- v4.6.1 Sign Up / Customer Onboarding Pack
-- v4.6 app_users ve app_user_tenant_access tablolarını kullanır.
-- Bu migration sign up akışı için yardımcı indexleri güçlendirir.

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email_lower
ON app_users(lower(email));

CREATE INDEX IF NOT EXISTS idx_customers_code
ON customers(code);

CREATE INDEX IF NOT EXISTS idx_sites_customer_code
ON sites(customer_id, code);
