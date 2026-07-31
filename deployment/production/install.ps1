[CmdletBinding()]
param(
  [ValidateSet('Local','Domain')][string]$Mode = 'Local',
  [string]$Domain = '',
  [string]$LetsEncryptEmail = '',
  [string]$AdminEmail = 'admin@factorybox.local',
  [int]$HttpPort = 8080,
  [int]$HttpsPort = 8443,
  [switch]$EnableN8n,
  [switch]$EnablePgAdmin,
  [switch]$ForceRegenerateSecrets,
  [switch]$SkipStartupRegistration
)

$ErrorActionPreference = 'Stop'
$ProductionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile = Join-Path $ProductionDir '.env.production'
$EnvTemplate = Join-Path $ProductionDir '.env.production.example'
$ActiveNginx = Join-Path $ProductionDir 'nginx\active\default.conf'
$RootDir = (Resolve-Path (Join-Path $ProductionDir '..\..')).Path
$CredentialsFile = Join-Path $ProductionDir 'INSTALLATION_CREDENTIALS.txt'

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Utf8NoBom([string]$Path,[string[]]$Lines) { [System.IO.File]::WriteAllLines($Path,$Lines,(New-Object System.Text.UTF8Encoding -ArgumentList $false)) }
function Write-TextUtf8NoBom([string]$Path,[string]$Text) { [System.IO.File]::WriteAllText($Path,$Text,(New-Object System.Text.UTF8Encoding -ArgumentList $false)) }
function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name bulunamadı. Önce Docker Desktop kurup çalıştırın." }
}
function New-Secret([int]$Length = 36) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789_-'
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
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
function Get-EnvValue([string]$Path,[string]$Key) {
  $line = Get-Content $Path | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -Last 1
  if ($line) { return ($line -split '=',2)[1] }
  return ''
}
function Assert-NpmLock {
  $lockPath = Join-Path $RootDir 'platform\backend\package-lock.json'
  if (-not (Test-Path $lockPath)) { throw "package-lock.json bulunamadi: $lockPath" }
  $lockRaw = [System.IO.File]::ReadAllText($lockPath)
  $pattern = '(?s)"node_modules/dotenv"\s*:\s*\{.*?"version"\s*:\s*"(?<version>[^"]+)"'
  $match = [regex]::Match($lockRaw, $pattern)
  if (-not $match.Success) { throw 'package-lock.json icinde node_modules/dotenv kaydi bulunamadi.' }
  $dotenvVersion = $match.Groups['version'].Value
  if ($dotenvVersion -ne '16.4.5') { throw "Gecersiz dotenv lock surumu: $dotenvVersion. Beklenen: 16.4.5" }
  Write-Host "NPM lock dogrulandi: dotenv $dotenvVersion" -ForegroundColor Green
}
function Invoke-Compose([string[]]$Arguments) {
  $base = @('compose','--env-file',$EnvFile,'-f',$ComposeFile)
  & docker @base @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose komutu başarısız: $($Arguments -join ' ')" }
}
function Get-PrimaryIPv4 {
  $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1
  $ip = $null
  if ($route) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
  if (-not $ip) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
      Select-Object -First 1 -ExpandProperty IPAddress
  }
  if (-not $ip) { $ip = 'localhost' }
  return $ip
}

Write-Step 'Sistem gereksinimleri kontrol ediliyor'
Assert-Command docker
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop çalışmıyor.' }
if (-not (Test-Path $ComposeFile)) { throw "Compose dosyası bulunamadı: $ComposeFile" }
New-Item -ItemType Directory -Force -Path (Join-Path $RootDir 'Backups') | Out-Null
@('nginx\active','certs\local','certs\acme','certs\letsencrypt','mosquitto\config','data\logs\backend','data\n8n','data\pgadmin','state') |
  ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $ProductionDir $_) | Out-Null }

if (-not (Test-Path $EnvFile)) { Copy-Item $EnvTemplate $EnvFile }
$needsSecrets = $ForceRegenerateSecrets -or (Get-EnvValue $EnvFile 'PGPASSWORD') -eq 'CHANGE_ME'
if ($needsSecrets) {
  Set-EnvValue $EnvFile 'PGPASSWORD' (New-Secret 40)
  Set-EnvValue $EnvFile 'FACTORYBOX_ADMIN_PASSWORD' (New-Secret 24)
  Set-EnvValue $EnvFile 'MQTT_PASSWORD' (New-Secret 32)
  Set-EnvValue $EnvFile 'N8N_ENCRYPTION_KEY' (New-Secret 48)
  Set-EnvValue $EnvFile 'N8N_BASIC_AUTH_PASSWORD' (New-Secret 24)
  Set-EnvValue $EnvFile 'PGADMIN_DEFAULT_PASSWORD' (New-Secret 24)
}
Set-EnvValue $EnvFile 'FACTORYBOX_IMAGE_TAG' 'v6.7.0'
Set-EnvValue $EnvFile 'AUTH_ENABLED' 'true'
Set-EnvValue $EnvFile 'FACTORYBOX_ADMIN_EMAIL' $AdminEmail
Set-EnvValue $EnvFile 'FACTORYBOX_DEPLOYMENT_MODE' $Mode.ToLowerInvariant()

if ($Mode -eq 'Domain') {
  if ([string]::IsNullOrWhiteSpace($Domain)) { $Domain = Read-Host 'Domain adı (ör. panel.example.com)' }
  if ([string]::IsNullOrWhiteSpace($LetsEncryptEmail)) { $LetsEncryptEmail = Read-Host 'Let''s Encrypt e-posta adresi' }
  if ($Domain -notmatch '^[A-Za-z0-9.-]+$') { throw 'Geçersiz domain adı.' }
  Set-EnvValue $EnvFile 'FACTORYBOX_DOMAIN' $Domain
  Set-EnvValue $EnvFile 'FACTORYBOX_PUBLIC_URL' "https://$Domain"
  Set-EnvValue $EnvFile 'FACTORYBOX_HTTP_PORT' '80'
  Set-EnvValue $EnvFile 'FACTORYBOX_HTTPS_PORT' '443'
  Set-EnvValue $EnvFile 'CORS_ALLOWED_ORIGINS' "https://$Domain"
  $template = Get-Content (Join-Path $ProductionDir 'nginx\templates\bootstrap-http.conf') -Raw
  Write-TextUtf8NoBom -Path $ActiveNginx -Text ($template.Replace('__DOMAIN__',$Domain))
} else {
  $localIp = Get-PrimaryIPv4
  Set-EnvValue $EnvFile 'FACTORYBOX_DOMAIN' $localIp
  Set-EnvValue $EnvFile 'FACTORYBOX_PUBLIC_URL' "https://${localIp}:$HttpsPort"
  Set-EnvValue $EnvFile 'FACTORYBOX_HTTP_PORT' "$HttpPort"
  Set-EnvValue $EnvFile 'FACTORYBOX_HTTPS_PORT' "$HttpsPort"
  Set-EnvValue $EnvFile 'CORS_ALLOWED_ORIGINS' "https://${localIp}:$HttpsPort,https://localhost:$HttpsPort,http://${localIp}:$HttpPort,http://localhost:$HttpPort"
  $certDir = (Resolve-Path (Join-Path $ProductionDir 'certs\local')).Path
  if (-not (Test-Path (Join-Path $certDir 'factorybox.crt')) -or $ForceRegenerateSecrets) {
    Write-Step 'Yerel test için self-signed HTTPS sertifikası oluşturuluyor'
    & docker run --rm -v "${certDir}:/certs" alpine:3.20 sh -c "apk add --no-cache openssl >/dev/null && openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /certs/factorybox.key -out /certs/factorybox.crt -subj '/CN=$localIp' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$localIp'"
    if ($LASTEXITCODE -ne 0) { throw 'Yerel HTTPS sertifikası oluşturulamadı.' }
  }
  $template = Get-Content (Join-Path $ProductionDir 'nginx\templates\local-https.conf') -Raw
  Write-TextUtf8NoBom -Path $ActiveNginx -Text ($template.Replace('__HTTPS_PORT__',"$HttpsPort"))
}

Write-Step 'MQTT kimlik doğrulama yapısı hazırlanıyor'
$mqttUser = Get-EnvValue $EnvFile 'MQTT_USERNAME'
$mqttPass = Get-EnvValue $EnvFile 'MQTT_PASSWORD'
if ([string]::IsNullOrWhiteSpace($mqttUser) -or [string]::IsNullOrWhiteSpace($mqttPass)) {
  throw 'MQTT_USERNAME veya MQTT_PASSWORD boş bırakılamaz.'
}
# v6.7.0: password_file container başlatılırken /tmp altında oluşturulur.
# Windows bind-mount izinleri ve klasöre dönüşen password_file sorunları böylece engellenir.
$legacyPasswordPath = Join-Path $ProductionDir 'mosquitto\config\password_file'
if (Test-Path $legacyPasswordPath) { Remove-Item -Force -Recurse $legacyPasswordPath }

# v6.7.0: Onceki hatali MQTT containerini kaldir. PostgreSQL volume ve diger veriler korunur.
$existingMqtt = & docker ps -a --filter "name=^/factorybox-prod-mqtt$" --format "{{.Names}}"
if ($existingMqtt -eq 'factorybox-prod-mqtt') {
  Write-Step 'Eski MQTT containeri guvenli sekilde yenileniyor'
  & docker rm -f factorybox-prod-mqtt | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Eski MQTT containeri kaldirilamadi.' }
}

Write-Step 'NPM lock dosyası doğrulanıyor'
Assert-NpmLock

Write-Step 'Docker Compose yapılandırması doğrulanıyor'
Invoke-Compose -Arguments @('config','--quiet')

$profileArgs = @()
if ($EnableN8n) { $profileArgs += @('--profile','automation') }
if ($EnablePgAdmin) { $profileArgs += @('--profile','tools') }

Write-Step 'FactoryBox production servisleri kuruluyor'
Invoke-Compose -Arguments ($profileArgs + @('up','-d','--build','postgres','mqtt','backend','nginx'))
if ($EnableN8n) { Invoke-Compose -Arguments @('--profile','automation','up','-d','n8n') }
if ($EnablePgAdmin) { Invoke-Compose -Arguments @('--profile','tools','up','-d','pgadmin') }

if ($Mode -eq 'Domain') {
  Write-Step 'Let''s Encrypt sertifikası alınıyor'
  $acmeDir = (Resolve-Path (Join-Path $ProductionDir 'certs\acme')).Path
  $leDir = (Resolve-Path (Join-Path $ProductionDir 'certs\letsencrypt')).Path
  & docker run --rm -v "${acmeDir}:/var/www/certbot" -v "${leDir}:/etc/letsencrypt" certbot/certbot certonly --webroot --webroot-path /var/www/certbot --non-interactive --agree-tos --email $LetsEncryptEmail -d $Domain
  if ($LASTEXITCODE -ne 0) { throw 'Let''s Encrypt sertifikası alınamadı. DNS ve 80 portunu kontrol edin.' }
  $template = Get-Content (Join-Path $ProductionDir 'nginx\templates\domain-https.conf') -Raw
  Write-TextUtf8NoBom -Path $ActiveNginx -Text ($template.Replace('__DOMAIN__',$Domain))
  Invoke-Compose -Arguments @('restart','nginx')
}

Write-Step 'Kurulum sonrası sağlık kontrolü çalıştırılıyor'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProductionDir 'health-check.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Sağlık kontrolü başarısız oldu.' }

if (-not $SkipStartupRegistration) {
  Write-Step 'Windows oturum açılışında FactoryBox başlatma kaydı ekleniyor'
  $startScript=Join-Path $ProductionDir 'start-production.ps1'
  $startupCommand="powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
  New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Force | Out-Null
  New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'FactoryBoxProduction' -Value $startupCommand -PropertyType String -Force | Out-Null
}

$adminPassword = Get-EnvValue $EnvFile 'FACTORYBOX_ADMIN_PASSWORD'
$publicUrl = Get-EnvValue $EnvFile 'FACTORYBOX_PUBLIC_URL'
@"
FactoryBox v6.7.0 Production Installation
Panel: $publicUrl
Admin Email: $AdminEmail
Admin Password: $adminPassword
MQTT Username: $mqttUser
MQTT Password: $mqttPass
Environment File: $EnvFile

Bu dosya gizlidir. Güvenli bir parola yöneticisine aktardıktan sonra silin.
"@ | Set-Content $CredentialsFile -Encoding UTF8

Write-Host "`nKurulum tamamlandı." -ForegroundColor Green
Write-Host "Panel: $publicUrl"
Write-Host "Kurulum bilgileri: $CredentialsFile" -ForegroundColor Yellow
if ($Mode -eq 'Local') { Write-Warning 'Yerel self-signed sertifika tarayıcı uyarısı gösterebilir. Gerçek müşteri kurulumu için Domain modu kullanın.' }
