param([string]$ProductionDir=$PSScriptRoot)
$ErrorActionPreference='Stop'
function Set-EnvValue([string]$Path,[string]$Name,[string]$Value){$lines=if(Test-Path $Path){Get-Content -LiteralPath $Path}else{@()};$found=$false;$out=$lines|ForEach-Object{if($_ -match "^$([regex]::Escape($Name))="){$found=$true;"$Name=$Value"}else{$_}};if(-not $found){$out+="$Name=$Value"};Set-Content -LiteralPath $Path -Value $out -Encoding UTF8}
$envFile=Join-Path $ProductionDir '.env.production';if(-not(Test-Path $envFile)){Copy-Item (Join-Path $ProductionDir '.env.production.example') $envFile;throw '.env.production olusturuldu. Parolalari kontrol edip scripti tekrar calistirin.'}
Set-EnvValue $envFile 'FACTORYBOX_IMAGE_TAG' 'v6.7.0'
if(-not(Get-Content $envFile|Select-String '^REMOTE_ACCESS_ENABLED=')){Set-EnvValue $envFile 'REMOTE_ACCESS_ENABLED' 'false';Set-EnvValue $envFile 'REMOTE_ACCESS_MODE' 'disabled';Set-EnvValue $envFile 'REMOTE_PUBLIC_URL' '';Set-EnvValue $envFile 'CLOUDFLARE_TUNNEL_TOKEN' ''}
$active=Join-Path $ProductionDir 'nginx/active/default.conf'
if(Test-Path $active){$text=Get-Content $active -Raw;if($text -notmatch 'listen 8081;'){$internal=@'

server {
    listen 8081;
    server_name _;
    absolute_redirect off;
    client_max_body_size 10m;
    location = /nginx-health { access_log off; default_type text/plain; return 200 "ok\n"; }
    location = / { return 302 /admin.html; }
    location = /index.html { return 302 /admin.html; }
    location / {
        proxy_pass http://backend:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
'@;Add-Content -LiteralPath $active -Value $internal -Encoding UTF8}}
Push-Location $ProductionDir
try{
  docker compose --env-file .env.production -f docker-compose.production.yml build --no-cache backend
  if($LASTEXITCODE -ne 0){throw 'Backend image build basarisiz.'}
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate backend nginx
  if($LASTEXITCODE -ne 0){throw 'Backend/Nginx baslatilamadi.'}
  Start-Sleep -Seconds 20
  docker compose --env-file .env.production -f docker-compose.production.yml ps
  Write-Host 'FactoryBox v6.7.0 uygulandi.' -ForegroundColor Green
}finally{Pop-Location}
