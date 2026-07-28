[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProductionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile = Join-Path $ProductionDir '.env.production'
$ActiveNginx = Join-Path $ProductionDir 'nginx\active\default.conf'
$RootDir = (Resolve-Path (Join-Path $ProductionDir '..\..')).Path

if (-not (Test-Path $EnvFile)) { throw '.env.production bulunamadi.' }

function Write-Utf8NoBom([string]$Path,[string[]]$Lines) {
  [System.IO.File]::WriteAllLines($Path,$Lines,(New-Object System.Text.UTF8Encoding -ArgumentList $false))
}
function Write-TextUtf8NoBom([string]$Path,[string]$Text) {
  [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding -ArgumentList $false))
}
function Get-EnvValue([string]$Path,[string]$Key) {
  $line = Get-Content $Path | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -Last 1
  if ($line) { return ($line -split '=',2)[1] }
  return ''
}
function Set-EnvValue([string]$Path,[string]$Key,[string]$Value) {
  $lines = Get-Content $Path
  $found = $false
  $result = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") { "$Key=$Value"; $found=$true } else { $line }
  }
  if (-not $found) { $result += "$Key=$Value" }
  Write-Utf8NoBom -Path $Path -Lines $result
}
function Invoke-Compose([string[]]$Arguments) {
  & docker compose --env-file $EnvFile -f $ComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose komutu basarisiz: $($Arguments -join ' ')" }
}
function Assert-NpmLock {
  $lockPath = Join-Path $RootDir 'platform\backend\package-lock.json'
  $lockRaw = [System.IO.File]::ReadAllText($lockPath)
  $pattern = '(?s)"node_modules/dotenv"\s*:\s*\{.*?"version"\s*:\s*"(?<version>[^"]+)"'
  $match = [regex]::Match($lockRaw, $pattern)
  if (-not $match.Success -or $match.Groups['version'].Value -ne '16.4.5') {
    throw 'package-lock.json dotenv 16.4.5 kaydi dogrulanamadi.'
  }
}

Write-Host 'FactoryBox production HTTPS port yonlendirme onarimi baslatiliyor...' -ForegroundColor Cyan
Assert-NpmLock
Set-EnvValue $EnvFile 'FACTORYBOX_IMAGE_TAG' 'v6.6.6'

$mode = (Get-EnvValue $EnvFile 'FACTORYBOX_DEPLOYMENT_MODE').ToLowerInvariant()
$domain = Get-EnvValue $EnvFile 'FACTORYBOX_DOMAIN'
$httpsPort = Get-EnvValue $EnvFile 'FACTORYBOX_HTTPS_PORT'
if ([string]::IsNullOrWhiteSpace($httpsPort)) { $httpsPort = '8443' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ActiveNginx) | Out-Null

if ($mode -eq 'domain') {
  if ([string]::IsNullOrWhiteSpace($domain)) { throw 'FACTORYBOX_DOMAIN bos.' }
  $template = Get-Content (Join-Path $ProductionDir 'nginx\templates\domain-https.conf') -Raw
  Write-TextUtf8NoBom -Path $ActiveNginx -Text ($template.Replace('__DOMAIN__',$domain))
} else {
  $template = Get-Content (Join-Path $ProductionDir 'nginx\templates\local-https.conf') -Raw
  Write-TextUtf8NoBom -Path $ActiveNginx -Text ($template.Replace('__HTTPS_PORT__',$httpsPort))
}

Invoke-Compose @('config','--quiet')
Write-Host 'Backend v6.6.6 image olusturuluyor...' -ForegroundColor Cyan
Invoke-Compose @('build','backend')
Write-Host 'Backend ve Nginx yeniden baslatiliyor...' -ForegroundColor Cyan
Invoke-Compose @('up','-d','--force-recreate','backend','nginx')

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProductionDir 'health-check.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Saglik kontrolu basarisiz oldu.' }

$target = if ($mode -eq 'domain') { "https://$domain/admin.html" } else { "https://${domain}:$httpsPort/admin.html" }
Write-Host "Yonlendirme duzeltildi. HTTPS ve port korunuyor: $target" -ForegroundColor Green
