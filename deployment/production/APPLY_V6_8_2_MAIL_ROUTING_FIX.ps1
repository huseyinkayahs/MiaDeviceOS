$ErrorActionPreference = 'Stop'

$root = 'C:\FactoryBox'
$production = Join-Path $root 'deployment\production'
$envProduction = Join-Path $production '.env.production'
$envCustomerMail = Join-Path $production '.env.customer-mail'
$serverFile = Join-Path $root 'platform\backend\server.js'
$composeProduction = Join-Path $production 'docker-compose.production.yml'
$composeGateway = Join-Path $production 'docker-compose.mail-gateway.yml'
$envGateway = Join-Path $production '.env.mail-gateway'

foreach ($required in @($envProduction,$envCustomerMail,$serverFile,$composeProduction,$composeGateway,$envGateway)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Eksik dosya: $required" }
}

function Set-EnvValue([string]$Path,[string]$Name,[string]$Value) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $content = [IO.File]::ReadAllText($Path)
  $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
  $line = $Name + '=' + $Value
  if ([regex]::IsMatch($content,$pattern)) {
    $content = [regex]::Replace($content,$pattern,$line)
  } else {
    $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
  }
  [IO.File]::WriteAllText($Path,$content,$utf8)
}

function Get-EnvValue([string]$Path,[string]$Name) {
  $content = [IO.File]::ReadAllText($Path)
  $m = [regex]::Match($content,'(?m)^' + [regex]::Escape($Name) + '=(.*)$')
  if (-not $m.Success) { return '' }
  return $m.Groups[1].Value.Trim()
}

function Normalize-PublicUrl([string]$Value) {
  $clean = [string]$Value
  $clean = $clean.Trim().TrimStart([char]0xFEFF)
  $clean = [regex]::Replace($clean,'^(PUBLIC_APP_URL|PUBLIC_API_URL|FACTORYBOX_PUBLIC_URL|REMOTE_PUBLIC_URL)\s*=\s*','',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ([string]::IsNullOrWhiteSpace($clean)) { return '' }
  try {
    $uri = [Uri]$clean
    if ($uri.Scheme -notin @('http','https')) { return '' }
    return $clean.TrimEnd('/')
  } catch { return '' }
}

Set-EnvValue $envProduction 'FACTORYBOX_IMAGE_TAG' 'v6.8.2'
Set-EnvValue $envCustomerMail 'FACTORYBOX_MAIL_MODE' 'gateway'
Set-EnvValue $envCustomerMail 'FACTORYBOX_MAIL_ALLOW_SMTP_FALLBACK' 'false'

$currentPublic = Normalize-PublicUrl (Get-EnvValue $envProduction 'PUBLIC_APP_URL')
if (-not $currentPublic) {
  $remotePublic = Normalize-PublicUrl (Get-EnvValue $envProduction 'REMOTE_PUBLIC_URL')
  $factoryPublic = Normalize-PublicUrl (Get-EnvValue $envProduction 'FACTORYBOX_PUBLIC_URL')
  $currentPublic = if ($remotePublic) { $remotePublic } else { $factoryPublic }
}
if ($currentPublic) { Set-EnvValue $envProduction 'PUBLIC_APP_URL' $currentPublic }

# Remove legacy SMTP credentials from the customer database. Brevo remains only in the central gateway.
$postgresRunning = (& docker inspect -f '{{.State.Running}}' factorybox-prod-postgres 2>$null) -eq 'true'
if ($postgresRunning) {
  $sql = @"
UPDATE notification_settings
SET email_mode='gateway',
    email_sender_name='HukaTech',
    mail_gateway_url=NULL,
    mail_gateway_installation_id=NULL,
    mail_gateway_api_key=NULL,
    mail_gateway_allow_smtp_fallback=false,
    smtp_host=NULL,
    smtp_port=587,
    smtp_secure=false,
    smtp_user=NULL,
    smtp_pass=NULL,
    smtp_from=NULL,
    updated_by='v6.8.2-mail-routing-fix',
    updated_at=now()
WHERE id=1;
"@
  $sql | & docker exec -i factorybox-prod-postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Eski SMTP ayarları veritabanından temizlenemedi.' }
}

& node --check $serverFile
if ($LASTEXITCODE -ne 0) { throw 'server.js sözdizimi kontrolü başarısız.' }

Push-Location $production
try {
  & docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --build --force-recreate backend
  if ($LASTEXITCODE -ne 0) { throw 'Production backend yeniden oluşturulamadı.' }

  & docker compose --env-file '.env.mail-gateway' -f 'docker-compose.mail-gateway.yml' up -d --build --force-recreate mail-gateway
  if ($LASTEXITCODE -ne 0) { throw 'Merkezi mail gateway yeniden oluşturulamadı.' }
} finally {
  Pop-Location
}

Start-Sleep -Seconds 8
$backendHealth = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-backend).Trim()
$gatewayHealth = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-mail-gateway).Trim()
Write-Host "BACKEND_STATUS=$backendHealth"
Write-Host "MAIL_GATEWAY_STATUS=$gatewayHealth"
Write-Host 'HUKATECH_V6_8_2_MAIL_ROUTING_FIX_READY'
