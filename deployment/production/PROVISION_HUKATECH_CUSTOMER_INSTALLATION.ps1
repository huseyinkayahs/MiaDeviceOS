param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [string]$ProductionDir = 'C:\FactoryBox\deployment\production',
  [switch]$SkipRestart,
  [switch]$KeepPackage
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  [IO.File]::WriteAllText($Path,$Content.TrimEnd() + [Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
}

function Get-ContainerHealth {
  param([string]$Name)
  $result = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>&1
  if ($LASTEXITCODE -ne 0) { return 'not_found' }
  return (($result | Out-String).Trim())
}

if (-not (Test-Path -LiteralPath $PackagePath)) { throw "Provisioning package not found: $PackagePath" }
if (-not (Test-Path -LiteralPath $ProductionDir)) { throw "Production directory not found: $ProductionDir" }

$package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
if ($package.format -ne 'hukatech-customer-provisioning-v1') { throw 'Unsupported provisioning package format' }
if ([string]::IsNullOrWhiteSpace([string]$package.installation_id)) { throw 'installation_id is missing' }
if ([string]::IsNullOrWhiteSpace([string]$package.provisioning_token)) { throw 'provisioning_token is missing' }
if ([string]::IsNullOrWhiteSpace([string]$package.exchange_url)) { throw 'exchange_url is missing' }

$expires = [DateTimeOffset]::Parse([string]$package.expires_at)
if ($expires -le [DateTimeOffset]::UtcNow) { throw 'Provisioning package has expired. Create a new package from the HukaTech panel.' }

$payload = @{
  installation_id = [string]$package.installation_id
  provisioning_token = [string]$package.provisioning_token
  platform_version = [string]$package.platform_version
} | ConvertTo-Json -Compress

Write-Host ('Provisioning installation: ' + [string]$package.installation_id)
$response = Invoke-RestMethod -Method Post -Uri ([string]$package.exchange_url) -ContentType 'application/json' -Body $payload
if ($response.status -ne 'ok' -or [string]::IsNullOrWhiteSpace([string]$response.customer_env)) {
  throw 'HukaTech provisioning exchange did not return a valid customer environment file'
}

$customerEnv = Join-Path $ProductionDir '.env.customer-mail'
if (Test-Path -LiteralPath $customerEnv) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $customerEnv -Destination ($customerEnv + '.pre-provision-' + $stamp) -Force
}
Write-Utf8NoBom -Path $customerEnv -Content ([string]$response.customer_env)

if (-not $SkipRestart) {
  $productionEnv = Join-Path $ProductionDir '.env.production'
  $compose = Join-Path $ProductionDir 'docker-compose.production.yml'
  if (-not (Test-Path -LiteralPath $productionEnv)) { throw "Missing file: $productionEnv" }
  if (-not (Test-Path -LiteralPath $compose)) { throw "Missing file: $compose" }

  Push-Location $ProductionDir
  try {
    docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --force-recreate backend nginx | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Docker restart failed' }
  } finally {
    Pop-Location
  }

  $deadline = (Get-Date).AddSeconds(180)
  do {
    $backend = Get-ContainerHealth -Name 'factorybox-prod-backend'
    $nginx = Get-ContainerHealth -Name 'factorybox-prod-nginx'
    Write-Host ("Waiting for services: Backend=$backend, Nginx=$nginx")
    if ($backend -eq 'healthy' -and $nginx -eq 'healthy') { break }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)

  if ($backend -ne 'healthy' -or $nginx -ne 'healthy') {
    throw "Services did not become healthy: Backend=$backend, Nginx=$nginx"
  }
}

if (-not $KeepPackage) {
  Remove-Item -LiteralPath $PackagePath -Force
  Write-Host 'One-time provisioning package deleted after successful exchange.'
}

Write-Host ('INSTALLATION_ID=' + [string]$response.installation.installation_id)
Write-Host ('KEY_GENERATION=' + [string]$response.installation.key_generation)
Write-Host ('PUBLIC_MAIL_GATEWAY=' + [string]$package.public_mail_gateway_url)
Write-Host 'HUKATECH_CUSTOMER_PROVISIONING_READY'
