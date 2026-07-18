
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid,
  report_type text NOT NULL DEFAULT 'daily_production',
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  health_score integer,
  summary text,
  summary_text text,
  report_text text,
  telegram_text text,
  report_json jsonb,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS machine_id uuid;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'daily_production';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS health_score integer;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS summary_text text;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_text text;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS telegram_text text;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS report_json jsonb;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS raw_payload jsonb;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE ai_reports ALTER COLUMN summary_text DROP NOT NULL;
ALTER TABLE ai_reports ALTER COLUMN report_text DROP NOT NULL;

UPDATE ai_reports
SET summary_text = COALESCE(summary_text, summary, report_text, 'SmartAI report')
WHERE summary_text IS NULL;

UPDATE ai_reports
SET summary = COALESCE(summary, summary_text, report_text, 'SmartAI report')
WHERE summary IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_created
ON ai_reports(machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_date
ON ai_reports(machine_id, report_date DESC);
