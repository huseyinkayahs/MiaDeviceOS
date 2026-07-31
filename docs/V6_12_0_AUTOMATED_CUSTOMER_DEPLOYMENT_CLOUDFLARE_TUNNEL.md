# HukaTech Platform v6.12.0

## Automated Customer Deployment & Cloudflare Tunnel Provisioning

This sprint automates the customer deployment path from an installation registry record to a reachable `customer.hukatech.com` application.

## Security model

- The scoped Cloudflare account API token remains only in the HukaTech central `.env.cloudflare` file.
- Customers never receive the account API token.
- The central controller creates the remotely managed tunnel, ingress configuration and proxied CNAME record.
- A one-time deployment package authorizes the exchange.
- The persistent customer mail API key and tunnel token are returned only after the one-time exchange and written to local environment files.
- The JSON package is deleted after a successful deployment.

## Automated flow

1. Create the customer installation registry record.
2. Create or reuse the named Cloudflare Tunnel.
3. Configure ingress for the customer hostname and `https://nginx:443` with TLS verification disabled for the local certificate.
4. Create or update the proxied CNAME to `<tunnel-id>.cfargotunnel.com`.
5. Generate a 30-minute one-time deployment package.
6. Exchange the package on the customer server.
7. Write `.env.customer-mail`, `PUBLIC_APP_URL`, `CLOUDFLARE_TUNNEL_ID` and `CLOUDFLARE_TUNNEL_TOKEN`.
8. Start the Docker `cloudflared` remote profile.
9. Verify the public hostname and notify the central registry.
