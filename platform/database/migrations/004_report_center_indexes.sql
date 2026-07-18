-- v3.9 SmartAI Report Center helper migration
-- Backend already auto-prepares ai_reports with v3.8.2 compatibility.
-- This file is kept as a readable database change record for v3.9.

CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_created
ON ai_reports(machine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_machine_score
ON ai_reports(machine_id, health_score DESC);
