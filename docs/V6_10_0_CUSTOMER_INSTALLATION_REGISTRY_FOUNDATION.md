# HukaTech Platform v6.10.0

## Customer Installation Registry Foundation

This release adds a central installation registry to the HukaTech Mail Gateway.

### Capabilities

- Separate installation ID and API key for every customer installation.
- API keys are returned once; only SHA-256 hashes are stored.
- Enable, disable, archive and rotate customer credentials.
- Per-installation minute and daily mail limits.
- Public hostname, Cloudflare tunnel name and tunnel-status metadata.
- Last authentication and last mail timestamps.
- Registry management restricted to the HukaTech pilot `system_admin` and a gateway installation marked as `registry_admin`.
- Environment-managed pilot credentials cannot be edited from the panel.

### Security

The plaintext customer API key is never written to the database or update ZIP. It is shown only in the create/rotate response and must be copied into the customer's secure `.env.customer-mail` file.

### Admin Panel

Open **Organization → Customer Installations**. Only `system_admin` accounts can load or change the registry.
