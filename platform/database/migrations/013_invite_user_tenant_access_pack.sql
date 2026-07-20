
-- v5.0 Invite User / Tenant Access Pack

CREATE TABLE IF NOT EXISTS user_invites (
  id bigserial PRIMARY KEY,
  invite_token text NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'viewer',
  customer_code text NOT NULL,
  site_code text,
  status text NOT NULL DEFAULT 'pending',
  invited_by_email text,
  accepted_user_id text,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_email
ON user_invites(lower(email));

CREATE INDEX IF NOT EXISTS idx_user_invites_token
ON user_invites(invite_token);

CREATE INDEX IF NOT EXISTS idx_user_invites_status
ON user_invites(status);
