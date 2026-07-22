-- v5.4 SaaS Billing / Subscription Foundation Pack
-- Ödeme sağlayıcısından bağımsız plan, abonelik, trial ve limit altyapısı.

DO $$
BEGIN
  ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
  ALTER TABLE customers ADD CONSTRAINT customers_status_check
    CHECK (status IN ('active','passive','pilot','archived','trial','inactive','suspended'));

  ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_status_check;
  ALTER TABLE sites ADD CONSTRAINT sites_status_check
    CHECK (status IN ('active','passive','pilot','archived','trial','inactive','suspended'));
END $$;

CREATE TABLE IF NOT EXISTS subscription_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  user_limit integer CHECK (user_limit IS NULL OR user_limit >= 0),
  site_limit integer CHECK (site_limit IS NULL OR site_limit >= 0),
  device_limit integer CHECK (device_limit IS NULL OR device_limit >= 0),
  monthly_price_cents integer CHECK (monthly_price_cents IS NULL OR monthly_price_cents >= 0),
  currency text NOT NULL DEFAULT 'TRY',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES subscription_plans(code),
  status text NOT NULL DEFAULT 'trialing',
  starts_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  external_provider text,
  external_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('trialing','active','past_due','cancelled','expired'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status
ON tenant_subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_plan_code
ON tenant_subscriptions(plan_code);

INSERT INTO subscription_plans(
  code,name,description,trial_days,user_limit,site_limit,device_limit,monthly_price_cents,currency,is_active,sort_order
) VALUES
  ('trial','Trial','14 günlük FactoryBox deneme paketi',14,3,1,2,0,'TRY',true,10),
  ('starter','Starter','Küçük atölyeler için başlangıç paketi',0,5,2,5,NULL,'TRY',true,20),
  ('professional','Professional','Büyüyen üretim ekipleri için profesyonel paket',0,20,10,50,NULL,'TRY',true,30),
  ('enterprise','Enterprise','Kurumsal ve özel limitli paket',0,NULL,NULL,NULL,NULL,'TRY',true,40)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  trial_days=EXCLUDED.trial_days,
  user_limit=EXCLUDED.user_limit,
  site_limit=EXCLUDED.site_limit,
  device_limit=EXCLUDED.device_limit,
  monthly_price_cents=EXCLUDED.monthly_price_cents,
  currency=EXCLUDED.currency,
  is_active=EXCLUDED.is_active,
  sort_order=EXCLUDED.sort_order,
  updated_at=now();

INSERT INTO tenant_subscriptions(
  customer_id,plan_code,status,starts_at,trial_ends_at,current_period_start,current_period_end
)
SELECT
  c.id,
  'trial',
  'trialing',
  now(),
  now() + interval '14 days',
  now(),
  now() + interval '14 days'
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_subscriptions ts WHERE ts.customer_id=c.id
);
