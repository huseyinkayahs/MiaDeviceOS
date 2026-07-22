-- v5.5 Subscription Enforcement / Usage Limit Guard Pack
-- Safe/idempotent support index for tenant user quota checks.

CREATE INDEX IF NOT EXISTS idx_user_invites_customer_pending
ON user_invites(customer_code, status, expires_at);
