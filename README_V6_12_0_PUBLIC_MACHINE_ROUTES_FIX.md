# HukaTech Platform v6.12.0 Public Machine Routes Fix

## Problem

The automatic customer deployment package calls:

POST /api/public/installations/provision/exchange

The route was registered after the global browser-login middleware. v6.12.0
also introduced the deployment confirmation machine route. These machine
endpoints authenticate with a one-time provisioning token or installation API
key, but the browser middleware returned `Login required` before those checks.

## Fix

The following exact routes bypass only browser session authentication:

- /api/public/installations/provision/exchange
- /api/central-mail/v1/status
- /api/central-mail/v1/deployment/confirm
- /api/central-mail/v1/send

Their own provisioning-token or installation-key validation remains active.
No wildcard public API access is added.

The package updates the complete server.js file in development and production,
rebuilds Backend and Nginx, waits for health, and verifies that unauthenticated
requests reach machine authentication instead of browser login.

No API key, Cloudflare token, password, tunnel credential, or environment file
is included.
