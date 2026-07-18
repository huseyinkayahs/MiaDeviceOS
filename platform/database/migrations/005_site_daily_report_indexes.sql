
CREATE INDEX IF NOT EXISTS idx_ai_reports_site_daily_created
ON ai_reports(report_type, created_at DESC)
WHERE machine_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_reports_site_daily_date
ON ai_reports(report_type, report_date DESC)
WHERE machine_id IS NULL;
