
CREATE INDEX IF NOT EXISTS idx_ai_reports_site_daily_history
ON ai_reports(report_type, created_at DESC)
WHERE machine_id IS NULL AND report_type='site_daily_production';

CREATE INDEX IF NOT EXISTS idx_ai_reports_site_daily_score
ON ai_reports(health_score, created_at DESC)
WHERE machine_id IS NULL AND report_type='site_daily_production';
