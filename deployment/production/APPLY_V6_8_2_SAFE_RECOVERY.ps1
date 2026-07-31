$ErrorActionPreference = 'Stop'

$root = 'C:\FactoryBox'
$production = Join-Path $root 'deployment\production'
$envProduction = Join-Path $production '.env.production'
$envCustomerMail = Join-Path $production '.env.customer-mail'
$composeFile = Join-Path $production 'docker-compose.production.yml'
$serverFile = Join-Path $root 'platform\backend\server.js'
$packageFile = Join-Path $root 'platform\backend\package.json'

foreach ($required in @($envProduction,$envCustomerMail,$composeFile,$serverFile,$packageFile)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Eksik dosya: $required" }
}

function Assert-SafeEnvFile([string]$Path,[int64]$MaxBytes = 65536) {
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -gt $MaxBytes) {
    throw "Ortam dosyasi beklenenden buyuk: $Path ($($item.Length) byte). Islem durduruldu."
  }
}

function Set-EnvLine([string]$Path,[string]$Name,[string]$Value) {
  Assert-SafeEnvFile $Path
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($Path)) { [void]$lines.Add($line) }
  $prefix = $Name + '='
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
      if (-not $found) {
        $lines[$i] = $prefix + $Value
        $found = $true
      } else {
        $lines.RemoveAt($i)
        $i--
      }
    }
  }
  if (-not $found) { [void]$lines.Add($prefix + $Value) }
  [IO.File]::WriteAllLines($Path,$lines,(New-Object Text.UTF8Encoding($false)))
  Assert-SafeEnvFile $Path
}

Assert-SafeEnvFile $envProduction
Assert-SafeEnvFile $envCustomerMail

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $envProduction -Destination ($envProduction + '.pre-v6.8.2-recovery-' + $stamp) -Force
Copy-Item -LiteralPath $envCustomerMail -Destination ($envCustomerMail + '.pre-v6.8.2-recovery-' + $stamp) -Force

Set-EnvLine $envProduction 'FACTORYBOX_IMAGE_TAG' 'v6.8.2'
Set-EnvLine $envCustomerMail 'FACTORYBOX_MAIL_MODE' 'gateway'
Set-EnvLine $envCustomerMail 'FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK' 'false'

$package = Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json
if ([string]$package.version -ne '6.8.2') {
  throw "Backend kaynak surumu 6.8.2 degil: $($package.version)"
}

& node --check $serverFile
if ($LASTEXITCODE -ne 0) { throw 'server.js soz dizimi kontrolu basarisiz.' }

Push-Location $production
try {
  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose dogrulamasi basarisiz.' }

  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --build --force-recreate backend nginx
  if ($LASTEXITCODE -ne 0) { throw 'Backend ve Nginx yeniden olusturulamadi.' }
} finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(150)
do {
  Start-Sleep -Seconds 5
  $backendHealth = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-backend 2>$null).Trim()
  $nginxHealth = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-nginx 2>$null).Trim()
  if ($backendHealth -eq 'healthy' -and $nginxHealth -eq 'healthy') { break }
} while ((Get-Date) -lt $deadline)

if ($backendHealth -ne 'healthy') {
  & docker logs --tail 80 factorybox-prod-backend | Out-Host
  throw "Backend healthy olmadi: $backendHealth"
}
if ($nginxHealth -ne 'healthy') {
  & docker logs --tail 80 factorybox-prod-nginx | Out-Host
  throw "Nginx healthy olmadi: $nginxHealth"
}

$statusJson = (& docker exec factorybox-prod-backend node -e "fetch('http://127.0.0.1:3100/api/auth/status').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{console.error(e.message);process.exit(1)})")
if ($LASTEXITCODE -ne 0) { throw 'Backend durum endpointi okunamadi.' }
$status = $statusJson | ConvertFrom-Json
if ([string]$status.version -ne '6.8.2') { throw "Calisan backend surumu beklenenden farkli: $($status.version)" }

Write-Host "ENV_PRODUCTION_SIZE=$((Get-Item -LiteralPath $envProduction).Length)"
Write-Host "BACKEND_STATUS=$backendHealth"
Write-Host "NGINX_STATUS=$nginxHealth"
Write-Host "BACKEND_VERSION=$($status.version)"
Write-Host 'HUKATECH_V6_8_2_SAFE_RECOVERY_OK'
