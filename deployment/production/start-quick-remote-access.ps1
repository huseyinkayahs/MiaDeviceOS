param(
  [string]$ProductionDir = $PSScriptRoot,
  [int]$WaitSeconds = 90
)

$ErrorActionPreference = 'Stop'

function Assert-SafeEnvFile([string]$Path,[int64]$MaxBytes = 65536) {
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -gt $MaxBytes) { throw "Ortam dosyasi beklenenden buyuk: $Path ($($item.Length) byte)." }
}

function Set-EnvLine([string]$Path,[string]$Name,[string]$Value) {
  Assert-SafeEnvFile $Path
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in [IO.File]::ReadAllLines($Path)) { [void]$lines.Add($line) }
  $prefix = $Name + '='
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
      if (-not $found) { $lines[$i] = $prefix + $Value; $found = $true }
      else { $lines.RemoveAt($i); $i-- }
    }
  }
  if (-not $found) { [void]$lines.Add($prefix + $Value) }
  [IO.File]::WriteAllLines($Path,$lines,(New-Object Text.UTF8Encoding($false)))
  Assert-SafeEnvFile $Path
}

function Remove-ContainerQuietly([string]$Name) {
  & $env:ComSpec /d /s /c "docker rm -f $Name >nul 2>&1" | Out-Null
}

function Get-ContainerLogs([string]$Name) {
  return (& $env:ComSpec /d /s /c "docker logs $Name 2>&1" | Out-String)
}

function Wait-Healthy([string]$Name,[int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    Start-Sleep -Seconds 4
    $health = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>$null).Trim()
    if ($health -eq 'healthy') { return }
  } while ((Get-Date) -lt $deadline)
  & docker logs --tail 80 $Name | Out-Host
  throw "$Name healthy olmadi: $health"
}

$envFile = Join-Path $ProductionDir '.env.production'
$composeFile = Join-Path $ProductionDir 'docker-compose.production.yml'
if (-not (Test-Path -LiteralPath $envFile)) { throw '.env.production bulunamadi.' }
if (-not (Test-Path -LiteralPath $composeFile)) { throw 'docker-compose.production.yml bulunamadi.' }
Assert-SafeEnvFile $envFile

Push-Location $ProductionDir
try {
  Remove-ContainerQuietly 'factorybox-prod-cloudflared'

  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d backend nginx
  if ($LASTEXITCODE -ne 0) { throw 'Backend veya Nginx baslatilamadi.' }
  Wait-Healthy 'factorybox-prod-backend'
  Wait-Healthy 'factorybox-prod-nginx'

  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' --profile quick-remote up -d --force-recreate cloudflared-quick
  if ($LASTEXITCODE -ne 0) { throw 'Quick Tunnel baslatilamadi.' }

  $url = $null
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  do {
    Start-Sleep -Seconds 3
    $logs = Get-ContainerLogs 'factorybox-prod-cloudflared-quick'
    $match = [regex]::Match($logs,'https://[a-z0-9-]+\.trycloudflare\.com',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) { $url = $match.Value; break }
  } while ((Get-Date) -lt $deadline)

  if (-not $url) {
    Write-Host (Get-ContainerLogs 'factorybox-prod-cloudflared-quick')
    throw 'Quick Tunnel URL bulunamadi.'
  }

  Set-EnvLine $envFile 'REMOTE_ACCESS_ENABLED' 'true'
  Set-EnvLine $envFile 'REMOTE_ACCESS_MODE' 'quick'
  Set-EnvLine $envFile 'REMOTE_PUBLIC_URL' $url
  Set-EnvLine $envFile 'PUBLIC_APP_URL' $url

  # Backend yeni URL'yi yukler. Ardindan Nginx de yeniden olusturulur;
  # boylece Nginx eski backend container IP'sini tutmaz.
  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --force-recreate backend
  if ($LASTEXITCODE -ne 0) { throw 'Backend uzak erisim ayarlariyla yeniden baslatilamadi.' }
  Wait-Healthy 'factorybox-prod-backend'

  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --force-recreate nginx
  if ($LASTEXITCODE -ne 0) { throw 'Nginx yeni backend adresiyle yeniden baslatilamadi.' }
  Wait-Healthy 'factorybox-prod-nginx'

  Write-Host "BACKEND_STATUS=healthy"
  Write-Host "NGINX_STATUS=healthy"
  Write-Host "Quick Tunnel hazir: $url" -ForegroundColor Green
  Write-Host 'Bu adres gecicidir. Tunnel yeniden olusturulursa sifre sifirlama maili yeniden istenmelidir.' -ForegroundColor Yellow
} finally {
  Pop-Location
}
