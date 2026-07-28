[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile=Join-Path $ProductionDir '.env.production'
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
function Env([string]$Key){(($line=Get-Content $EnvFile|Where-Object{$_ -match "^$Key="}|Select-Object -Last 1)-split '=',2)[1]}
if((Env 'FACTORYBOX_DEPLOYMENT_MODE') -ne 'domain'){throw 'Sertifika yenileme yalnızca Domain modunda kullanılır.'}
$acme=(Resolve-Path (Join-Path $ProductionDir 'certs\acme')).Path
$le=(Resolve-Path (Join-Path $ProductionDir 'certs\letsencrypt')).Path
& docker run --rm -v "${acme}:/var/www/certbot" -v "${le}:/etc/letsencrypt" certbot/certbot renew --webroot --webroot-path /var/www/certbot
if($LASTEXITCODE-ne 0){throw 'Sertifika yenileme başarısız.'}
& docker compose --env-file $EnvFile -f $ComposeFile restart nginx
Write-Host 'Sertifika yenileme kontrolü tamamlandı.' -ForegroundColor Green
