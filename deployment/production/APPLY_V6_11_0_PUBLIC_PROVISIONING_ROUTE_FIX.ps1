$ErrorActionPreference = 'Stop'

$ProductionDir = 'C:\FactoryBox\deployment\production'
$ComposeFile = Join-Path $ProductionDir 'docker-compose.production.yml'
$ProductionEnv = Join-Path $ProductionDir '.env.production'
$ServerFile = 'C:\FactoryBox\platform\backend\server.js'

function Get-ContainerHealth {
  param([string]$Name)
  $result = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>&1
  if ($LASTEXITCODE -ne 0) { return 'not_found' }
  return (($result | Out-String).Trim())
}

foreach ($path in @($ComposeFile,$ProductionEnv,$ServerFile)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing file: $path" }
}

$serverText = Get-Content -LiteralPath $ServerFile -Raw
foreach ($route in @(
  "/public/installations/provision/exchange",
  "/central-mail/v1/status",
  "/central-mail/v1/send"
)) {
  if ($serverText -notmatch [regex]::Escape($route)) { throw "Public machine route exemption missing: $route" }
}

Push-Location $ProductionDir
try {
  docker compose --env-file '.env.production' -f 'docker-compose.production.yml' build backend | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Backend image build failed' }

  docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --force-recreate backend nginx | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Backend/Nginx restart failed' }
} finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(180)
do {
  $backend = Get-ContainerHealth -Name 'factorybox-prod-backend'
  $nginx = Get-ContainerHealth -Name 'factorybox-prod-nginx'
  Write-Host "Waiting for services: Backend=$backend, Nginx=$nginx"
  if ($backend -eq 'healthy' -and $nginx -eq 'healthy') { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

if ($backend -ne 'healthy' -or $nginx -ne 'healthy') {
  throw "Services did not become healthy: Backend=$backend, Nginx=$nginx"
}

$bodyFile = Join-Path $env:TEMP 'hukatech-v611-public-provisioning-route-check.json'
$http = curl.exe -ksS -o $bodyFile -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' 'https://127.0.0.1:8443/api/public/installations/provision/exchange'
$responseBody = if (Test-Path -LiteralPath $bodyFile) { Get-Content -LiteralPath $bodyFile -Raw } else { '' }
Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue

if ([string]$http -ne '400') {
  throw "Public provisioning route validation failed. HTTP=$http BODY=$responseBody"
}
if ($responseBody -match 'Login required') {
  throw 'Public provisioning route is still intercepted by browser login middleware'
}

Write-Host 'BACKEND_STATUS=healthy'
Write-Host 'NGINX_STATUS=healthy'
Write-Host 'PUBLIC_PROVISIONING_ROUTE_HTTP=400'
Write-Host 'PUBLIC_PROVISIONING_ROUTE_AUTH_BYPASS=OK'
Write-Host 'CENTRAL_MAIL_MACHINE_ROUTES_AUTH_BYPASS=OK'
Write-Host 'HUKATECH_V6_11_0_PUBLIC_PROVISIONING_ROUTE_FIX_READY'
