param(
  [string]$ProductionDir = 'C:\FactoryBox\deployment\production'
)

$ErrorActionPreference = 'Stop'

function Set-EnvValue {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Value
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Environment file not found: $Path"
  }
  $lines = @(Get-Content -LiteralPath $Path)
  $out = New-Object System.Collections.Generic.List[string]
  $written = $false
  foreach ($line in $lines) {
    $clean = $line.TrimStart([char]0xFEFF)
    if ($clean -match ('^' + [regex]::Escape($Name) + '=')) {
      if (-not $written) {
        $out.Add($Name + '=' + $Value)
        $written = $true
      }
    } else {
      $out.Add($clean)
    }
  }
  if (-not $written) { $out.Add($Name + '=' + $Value) }
  [IO.File]::WriteAllLines($Path, $out, (New-Object Text.UTF8Encoding($false)))
}

function Read-EnvMap {
  param([string]$Path)
  $map = @{}
  foreach ($line in (Get-Content -LiteralPath $Path)) {
    if ($line -match '^\s*([^#][^=]*)=(.*)$') {
      $map[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $map
}

$productionEnv = Join-Path $ProductionDir '.env.production'
$gatewayEnv = Join-Path $ProductionDir '.env.mail-gateway'
$customerEnv = Join-Path $ProductionDir '.env.customer-mail'
$composeProduction = Join-Path $ProductionDir 'docker-compose.production.yml'
$composeGateway = Join-Path $ProductionDir 'docker-compose.mail-gateway.yml'

foreach ($required in @($productionEnv,$gatewayEnv,$customerEnv,$composeProduction,$composeGateway)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required file not found: $required" }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $productionEnv -Destination ($productionEnv + '.pre-v6.10.0-' + $stamp) -Force
Copy-Item -LiteralPath $gatewayEnv -Destination ($gatewayEnv + '.pre-v6.10.0-' + $stamp) -Force

Set-EnvValue -Path $productionEnv -Name 'FACTORYBOX_IMAGE_TAG' -Value 'v6.10.0'
Set-EnvValue -Path $gatewayEnv -Name 'FACTORYBOX_IMAGE_TAG' -Value 'v6.10.0'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_CUSTOMER_CODE' -Value 'hukatech-pilot'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_PUBLIC_HOSTNAME' -Value 'panel.hukatech.com'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_TUNNEL_NAME' -Value 'hukatech-platform-production'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_REGISTRY_ADMIN' -Value 'true'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_MAX_PER_MINUTE' -Value '30'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_SINGLE_MAX_PER_DAY' -Value '500'

$productionSize = (Get-Item -LiteralPath $productionEnv).Length
$gatewaySize = (Get-Item -LiteralPath $gatewayEnv).Length
if ($productionSize -gt 20000) { throw ".env.production is unexpectedly large: $productionSize bytes" }
if ($gatewaySize -gt 30000) { throw ".env.mail-gateway is unexpectedly large: $gatewaySize bytes" }

Push-Location $ProductionDir
try {
  docker compose --env-file '.env.mail-gateway' -f 'docker-compose.mail-gateway.yml' up -d --build --force-recreate mail-gateway | Out-Host
  docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --build --force-recreate backend nginx | Out-Host
} finally {
  Pop-Location
}

function Get-ContainerHealth {
  param([Parameter(Mandatory=$true)][string]$Name)
  $result = docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>&1
  if ($LASTEXITCODE -ne 0) { return 'not_found' }
  return (($result | Out-String).Trim())
}

function Wait-ContainersHealthy {
  param(
    [Parameter(Mandatory=$true)][hashtable]$Containers,
    [int]$TimeoutSeconds = 180,
    [int]$PollSeconds = 5
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastStatuses = @{}

  while ((Get-Date) -lt $deadline) {
    $allHealthy = $true

    foreach ($name in $Containers.Keys) {
      $status = Get-ContainerHealth -Name $name
      $lastStatuses[$name] = $status
      if ($status -ne 'healthy') { $allHealthy = $false }
    }

    $summary = ($Containers.Keys | Sort-Object | ForEach-Object {
      $label = $Containers[$_]
      $status = $lastStatuses[$_]
      "$label=$status"
    }) -join ', '

    Write-Host ('Waiting for container health: ' + $summary)

    if ($allHealthy) { return $lastStatuses }
    Start-Sleep -Seconds $PollSeconds
  }

  $failureSummary = ($Containers.Keys | Sort-Object | ForEach-Object {
    "$($Containers[$_])=$($lastStatuses[$_])"
  }) -join ', '

  throw "Containers did not become healthy within $TimeoutSeconds seconds: $failureSummary"
}

$containerStatuses = Wait-ContainersHealthy -Containers @{
  'factorybox-prod-backend' = 'Backend'
  'factorybox-prod-nginx' = 'Nginx'
  'factorybox-mail-gateway' = 'Mail Gateway'
}

$backendHealth = $containerStatuses['factorybox-prod-backend']
$nginxHealth = $containerStatuses['factorybox-prod-nginx']
$gatewayHealth = $containerStatuses['factorybox-mail-gateway']

$authStatusRaw = curl.exe -ksS 'https://127.0.0.1:8443/api/auth/status'
if ($LASTEXITCODE -ne 0) { throw 'Backend auth status request failed' }
$authStatus = $authStatusRaw | ConvertFrom-Json
if ($authStatus.version -ne '6.10.0') { throw "Unexpected backend version: $($authStatus.version)" }

$customer = Read-EnvMap -Path $customerEnv
$headers = @{
  Authorization = 'Bearer ' + $customer['FACTORYBOX_MAIL_API_KEY']
  'x-factorybox-installation-id' = $customer['FACTORYBOX_MAIL_INSTALLATION_ID']
  'x-factorybox-version' = '6.10.0'
}
$registry = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3101/api/mail-gateway/v1/admin/installations' -Headers $headers

Write-Host ('ENV_PRODUCTION_SIZE=' + $productionSize)
Write-Host ('ENV_MAIL_GATEWAY_SIZE=' + $gatewaySize)
Write-Host ('BACKEND_STATUS=' + $backendHealth)
Write-Host ('NGINX_STATUS=' + $nginxHealth)
Write-Host ('MAIL_GATEWAY_STATUS=' + $gatewayHealth)
Write-Host ('BACKEND_VERSION=' + $authStatus.version)
Write-Host ('INSTALLATION_REGISTRY_COUNT=' + $registry.count)
Write-Host 'HUKATECH_V6_10_0_CUSTOMER_INSTALLATION_REGISTRY_READY'
