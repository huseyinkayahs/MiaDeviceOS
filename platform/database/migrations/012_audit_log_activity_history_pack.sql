
-- v4.9 Audit Log / Activity History Pack

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id bigserial PRIMARY KEY,
  actor_user_id text,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
ON admin_audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_entity
ON admin_audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_email
ON admin_audit_logs(actor_email);
