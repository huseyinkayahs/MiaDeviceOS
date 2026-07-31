$ErrorActionPreference = 'Stop'

$roots = @(
  'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)',
  'C:\FactoryBox'
)

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8 {
  param([string]$Path)
  return [System.IO.File]::ReadAllText($Path, $utf8)
}

function Write-Utf8 {
  param(
    [string]$Path,
    [string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Restore-Good-Backup {
  param(
    [string]$PublicDir,
    [string]$Name
  )

  $target = Join-Path $PublicDir $Name
  $backup = Get-ChildItem -LiteralPath $PublicDir -File |
    Where-Object { $_.Name -like ($Name + '.pre-v6.12-version-fix-*') } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if ($null -eq $backup) {
    throw "Good UTF-8 backup not found for $target"
  }

  $safety = $target + '.corrupted-before-utf8-recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  Copy-Item -LiteralPath $target -Destination $safety -Force
  Copy-Item -LiteralPath $backup.FullName -Destination $target -Force

  Write-Host ('RESTORED_FROM=' + $backup.FullName)
}

foreach ($root in $roots) {
  $publicDir = Join-Path $root 'platform\backend\public'

  if (-not (Test-Path -LiteralPath $publicDir)) {
    throw "Public directory not found: $publicDir"
  }

  foreach ($name in @('admin.html', 'login.html', 'reset-password.html')) {
    Restore-Good-Backup -PublicDir $publicDir -Name $name
  }

  $adminPath = Join-Path $publicDir 'admin.html'
  $admin = Read-Utf8 -Path $adminPath

  $admin = $admin -replace '<title>FactoryBox v6\.8\.1 Admin Panel</title>', '<title>FactoryBox v6.12.0 Admin Panel</title>'
  $admin = [regex]::Replace(
    $admin,
    '<p\s+id="adminVersionLabel"[^>]*>.*?</p>',
    '<p id="adminVersionLabel">v6.12.0 &mdash; Otomatik m&uuml;&#351;teri da&#287;&#305;t&#305;m&#305; ve Cloudflare Tunnel y&ouml;netimi aktif.</p>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  $admin = [regex]::Replace(
    $admin,
    '<p\s+id="adminOverviewVersionLabel"[^>]*>.*?</p>',
    '<p id="adminOverviewVersionLabel" class="muted">v6.12.0 &mdash; Otomatik m&uuml;&#351;teri da&#287;&#305;t&#305;m&#305; ve Cloudflare Tunnel y&ouml;netimi aktif.</p>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  $admin = $admin -replace "(data\.version\s*\|\|\s*)'6\.8\.1'", '${1}''6.12.0'''
  $admin = $admin -replace "(generalSettings\.site_name\|\|'Main Factory'\}[^0-9]{0,20})v6\.8\.1", '${1}v6.12.0'

  Write-Utf8 -Path $adminPath -Content $admin

  $loginPath = Join-Path $publicDir 'login.html'
  $login = Read-Utf8 -Path $loginPath
  $login = $login -replace '6\.8\.1', '6.12.0'
  Write-Utf8 -Path $loginPath -Content $login

  $resetPath = Join-Path $publicDir 'reset-password.html'
  $reset = Read-Utf8 -Path $resetPath
  $reset = $reset -replace '6\.8\.1', '6.12.0'
  Write-Utf8 -Path $resetPath -Content $reset

  foreach ($name in @('admin.html', 'login.html', 'reset-password.html')) {
    $path = Join-Path $publicDir $name
    $content = Read-Utf8 -Path $path

    if ($content.IndexOf([char]0x00C3) -ge 0 -or $content.IndexOf([char]0x00C2) -ge 0) {
      throw "Mojibake marker found after recovery: $path"
    }

    if ($content -notmatch '<meta\s+charset="?UTF-8"?') {
      throw "UTF-8 meta tag missing: $path"
    }
  }

  Write-Host ('UTF8_FILES_RECOVERED=' + $root)
}

$productionDir = 'C:\FactoryBox\deployment\production'
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

$adminPath = 'C:\FactoryBox\platform\backend\public\admin.html'
$adminCheck = Read-Utf8 -Path $adminPath

if ($adminCheck -notmatch '<title>FactoryBox v6\.12\.0 Admin Panel</title>') {
  throw 'Admin version validation failed'
}
if ($adminCheck.IndexOf([char]0x00C3) -ge 0 -or $adminCheck.IndexOf([char]0x00C2) -ge 0) {
  throw 'Admin mojibake validation failed'
}

Write-Host ('BACKEND_STATUS=' + $backend)
Write-Host ('NGINX_STATUS=' + $nginx)
Write-Host 'ADMIN_INITIAL_VERSION=6.12.0'
Write-Host 'UTF8_TURKISH_TEXT=RECOVERED'
Write-Host 'LOGIN_RESET_UTF8=RECOVERED'
Write-Host 'HUKATECH_V6_12_0_UTF8_FULL_RECOVERY_READY'
