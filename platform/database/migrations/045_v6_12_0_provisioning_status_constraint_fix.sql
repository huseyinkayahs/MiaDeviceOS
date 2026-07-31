BEGIN;

ALTER TABLE customer_installations
  DROP CONSTRAINT IF EXISTS customer_installations_provisioning_status_check;

ALTER TABLE customer_installations
  ADD CONSTRAINT customer_installations_provisioning_status_check
  CHECK (provisioning_status IN (
    'registered',
    'cloudflare_ready',
    'package_generated',
    'provisioned',
    'verified',
    'revoked'
  ));

COMMIT;
