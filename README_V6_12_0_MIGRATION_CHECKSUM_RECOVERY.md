# HukaTech Platform v6.12.0 Migration Checksum Recovery

## Root cause

Migration 044 had already been applied and its SHA-256 checksum was recorded.
A later hotfix modified the contents of the same applied migration file.
The backend migration guard correctly refused to start with:

Applied migration checksum changed:
044_automated_customer_deployment_cloudflare_tunnel.sql

## Safe repair

- Restore migration 044 byte-for-byte to the originally released file.
- Put the constraint change into a new migration 045.
- Rebuild Backend and Nginx.
- Allow the normal migration runner to apply migration 045.
- Verify container health, backend version, database constraint, and the
  initial admin version display.

No production secret, Cloudflare token, API key, password, tunnel, or DNS
record is included in this package.
