-- FactoryBox One v6.5.0
-- SmartAI Reports & Natural Language Insights

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_kind text NOT NULL DEFAULT 'operations';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'executive';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'tr';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS period_end date;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS ai_engine text NOT NULL DEFAULT 'rules';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS delivery_status jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_reports_customer_created ON ai_reports(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_period ON ai_reports(period_start, period_end, report_type);

CREATE TABLE IF NOT EXISTS smartai_settings (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  engine text NOT NULL DEFAULT 'rules',
  language text NOT NULL DEFAULT 'tr',
  default_audience text NOT NULL DEFAULT 'executive',
  timezone text NOT NULL DEFAULT 'Europe/Istanbul',
  daily_enabled boolean NOT NULL DEFAULT false,
  daily_hour integer NOT NULL DEFAULT 8,
  weekly_enabled boolean NOT NULL DEFAULT false,
  weekly_day integer NOT NULL DEFAULT 1,
  weekly_hour integer NOT NULL DEFAULT 8,
  monthly_enabled boolean NOT NULL DEFAULT false,
  monthly_day integer NOT NULL DEFAULT 1,
  monthly_hour integer NOT NULL DEFAULT 8,
  delivery_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  telegram_chat_ids text,
  email_recipients text,
  history_limit integer NOT NULL DEFAULT 100,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS smartai_questions (
  id bigserial PRIMARY KEY,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  user_id text,
  user_email text,
  question text NOT NULL,
  answer text NOT NULL,
  language text NOT NULL DEFAULT 'tr',
  ai_engine text NOT NULL DEFAULT 'rules',
  intent text,
  period_start date,
  period_end date,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smartai_questions_customer_created
ON smartai_questions(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS smartai_scheduler_runs (
  id bigserial PRIMARY KEY,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  schedule_key text NOT NULL,
  period_type text NOT NULL,
  status text NOT NULL,
  report_id uuid,
  delivery_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(customer_id, schedule_key, period_type)
);

INSERT INTO smartai_settings(customer_id)
SELECT id FROM customers
ON CONFLICT(customer_id) DO NOTHING;
