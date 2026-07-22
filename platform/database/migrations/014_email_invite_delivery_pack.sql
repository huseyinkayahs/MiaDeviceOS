
-- v5.1 Email Invite Delivery Pack

ALTER TABLE user_invites
ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

ALTER TABLE user_invites
ADD COLUMN IF NOT EXISTS email_message_id text;

ALTER TABLE user_invites
ADD COLUMN IF NOT EXISTS email_last_error text;

CREATE INDEX IF NOT EXISTS idx_user_invites_email_sent_at
ON user_invites(email_sent_at DESC);
