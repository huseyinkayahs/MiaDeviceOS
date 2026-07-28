[CmdletBinding()]
param([int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
$ProductionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile = Join-Path $ProductionDir '.env.production'
$RootDir = (Resolve-Path (Join-Path $ProductionDir '..\..')).Path
if (-not (Test-Path $EnvFile)) { throw '.env.production bulunamadı.' }


function Write-Utf8NoBom([string]$Path,[string[]]$Lines) {
  [System.IO.File]::WriteAllLines($Path,$Lines,(New-Object System.Text.UTF8Encoding -ArgumentList $false))
}
function Set-EnvValue([string]$Path,[string]$Key,[string]$Value) {
  $escaped = $Value -replace "`r|`n",''
  $lines = if (Test-Path $Path) { Get-Content $Path } else { @() }
  $found = $false
  $result = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") { "$Key=$escaped"; $found=$true } else { $line }
  }
  if (-not $found) { $result += "$Key=$escaped" }
  Write-Utf8NoBom -Path $Path -Lines $result
}
function Assert-NpmLock {
  $lockPath = Join-Path $RootDir 'platform\backend\package-lock.json'
  if (-not (Test-Path $lockPath)) { throw "package-lock.json bulunamadi: $lockPath" }

  # Windows PowerShell 5.1, package-lock.json icindeki bos paket anahtari nedeniyle
  # ConvertFrom-Json ile hata verebilir. Bu nedenle gerekli lock surumunu ham metinden okuruz.
  $lockRaw = [System.IO.File]::ReadAllText($lockPath)
  $pattern = '(?s)"node_modules/dotenv"\s*:\s*\{.*?"version"\s*:\s*"(?<version>[^"]+)"'
  $match = [regex]::Match($lockRaw, $pattern)
  if (-not $match.Success) {
    throw 'package-lock.json icinde node_modules/dotenv kaydi bulunamadi.'
  }
  $dotenvVersion = $match.Groups['version'].Value
  if ($dotenvVersion -ne '16.4.5') {
    throw "Gecersiz dotenv lock surumu: $dotenvVersion. Beklenen: 16.4.5"
  }
  Write-Host "NPM lock dogrulandi: dotenv $dotenvVersion" -ForegroundColor Green
}

function Invoke-Compose([string[]]$Arguments) {
  & docker compose --env-file $EnvFile -f $ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose komutu başarısız: $($Arguments -join ' ')" }
}

Write-Host 'FactoryBox production MQTT ve backend build onarimi baslatiliyor...' -ForegroundColor Cyan
Set-EnvValue $EnvFile 'FACTORYBOX_IMAGE_TAG' 'v6.6.6'
Assert-NpmLock
$legacyPasswordPath = Join-Path $ProductionDir 'mosquitto\config\password_file'
if (Test-Path $legacyPasswordPath) {
  Remove-Item -Force -Recurse $legacyPasswordPath
  Write-Host 'Eski password_file bind-mount kaydı temizlendi.' -ForegroundColor DarkGray
}

Invoke-Compose @('config','--quiet')
$existing = & docker ps -a --filter "name=^/factorybox-prod-mqtt$" --format "{{.Names}}"
if ($existing -eq 'factorybox-prod-mqtt') {
  & docker rm -f factorybox-prod-mqtt | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'MQTT containeri kaldırılamadı.' }
}

Invoke-Compose @('up','-d','--force-recreate','mqtt')
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
  $status = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-mqtt 2>$null
  if ($status -eq 'healthy') { break }
  if ($status -eq 'unhealthy' -or $status -eq 'restarting' -or $status -eq 'exited') {
    Start-Sleep -Seconds 3
  } else {
    Start-Sleep -Seconds 2
  }
} while ((Get-Date) -lt $deadline)

if ($status -ne 'healthy') {
  Invoke-Compose @('ps','-a')
  Invoke-Compose @('logs','--tail','120','mqtt')
  throw "MQTT sağlıklı duruma geçemedi. Son durum: $status"
}

Write-Host 'MQTT HAZIR. Backend ve Nginx başlatılıyor...' -ForegroundColor Green
Invoke-Compose @('build','--no-cache','backend')
Invoke-Compose @('up','-d','backend','nginx')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProductionDir 'health-check.ps1')
exit $LASTEXITCODE
