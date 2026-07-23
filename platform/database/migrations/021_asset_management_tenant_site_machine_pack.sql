-- FactoryBox One v5.10.0
-- Asset Management / Tenant Site Machine Pack

DO $$
BEGIN
  ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_status_check;
  ALTER TABLE machines ADD CONSTRAINT machines_status_check
    CHECK (status IN ('active','passive','maintenance','archived'));
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_code_status ON customers(code, status);
CREATE INDEX IF NOT EXISTS idx_sites_customer_status ON sites(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_machines_site_status ON machines(site_id, status);
CREATE INDEX IF NOT EXISTS idx_machines_code_status ON machines(code, status);
