$ErrorActionPreference = 'Stop'

$developmentRoot = 'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)'
$productionRoot = 'C:\FactoryBox'
$expected044 = 'A7F9AA5CE1E1268094BE90C81E1A63043B76B426F608C96A9EDCF026135FFCD4'

foreach ($root in @($developmentRoot, $productionRoot)) {
  $migration044 = Join-Path $root 'platform\database\migrations\044_automated_customer_deployment_cloudflare_tunnel.sql'
  $migration045 = Join-Path $root 'platform\database\migrations\045_v6_12_0_provisioning_status_constraint_fix.sql'

  if (-not (Test-Path -LiteralPath $migration044)) {
    throw "Migration 044 missing: $migration044"
  }
  if (-not (Test-Path -LiteralPath $migration045)) {
    throw "Migration 045 missing: $migration045"
  }

  $actual044 = (Get-FileHash -Algorithm SHA256 -LiteralPath $migration044).Hash
  if ($actual044 -ne $expected044) {
    throw "Migration 044 checksum is not the released checksum at $root. Actual: $actual044"
  }

  Write-Host ('MIGRATION_044_RESTORED=' + $root)
  Write-Host ('MIGRATION_045_PRESENT=' + $root)
}

$productionDir = Join-Path $productionRoot 'deployment\production'
Push-Location $productionDir
try {
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --force-recreate backend nginx
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker rebuild failed'
  }
}
finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(180)
do {
  $backend = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-backend 2>$null | Out-String).Trim()
  $nginx = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-nginx 2>$null | Out-String).Trim()

  if ($backend -eq 'healthy' -and $nginx -eq 'healthy') {
    break
  }

  Write-Host ('WAITING_FOR_HEALTH backend=' + $backend + ' nginx=' + $nginx)
  Start-Sleep -Seconds 5
}
while ((Get-Date) -lt $deadline)

if ($backend -ne 'healthy' -or $nginx -ne 'healthy') {
  throw "Containers not healthy: backend=$backend nginx=$nginx"
}

$constraintSql = @"
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname='customer_installations_provisioning_status_check'
  AND conrelid='customer_installations'::regclass;
"@

$constraintDefinition = ($constraintSql |
  docker exec -i factorybox-mail-gateway-postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' |
  Out-String).Trim()

if ([string]::IsNullOrWhiteSpace($constraintDefinition)) {
  throw 'Provisioning status constraint could not be read'
}
if ($constraintDefinition -notmatch 'cloudflare_ready') {
  throw "cloudflare_ready is missing from constraint: $constraintDefinition"
}

$status = curl.exe -ksS 'https://127.0.0.1:8443/api/auth/status' | ConvertFrom-Json
if ([string]$status.version -ne '6.12.0') {
  throw ('Unexpected backend version: ' + [string]$status.version)
}

$adminHtml = curl.exe -ksS 'https://127.0.0.1:8443/admin.html'
if ($adminHtml -notmatch 'FactoryBox v6\.12\.0 Admin Panel') {
  throw 'Admin initial version display validation failed'
}

Write-Host ('BACKEND_STATUS=' + $backend)
Write-Host ('NGINX_STATUS=' + $nginx)
Write-Host ('BACKEND_VERSION=' + [string]$status.version)
Write-Host ('MIGRATION_044_SHA256=' + $expected044)
Write-Host ('CONSTRAINT_DEFINITION=' + $constraintDefinition)
Write-Host 'ADMIN_INITIAL_VERSION=6.12.0'
Write-Host 'HUKATECH_V6_12_0_MIGRATION_CHECKSUM_RECOVERY_READY'
