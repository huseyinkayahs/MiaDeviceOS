param(
  [Parameter(Mandatory=$true)][string]$TunnelToken,
  [Parameter(Mandatory=$true)][string]$PublicUrl,
  [string]$ProductionDir = $PSScriptRoot,
  [switch]$AccessProtected
)
$ErrorActionPreference='Stop'
function Set-EnvValue([string]$Path,[string]$Name,[string]$Value){
  $lines=if(Test-Path $Path){Get-Content -LiteralPath $Path}else{@()};$found=$false
  $out=$lines|ForEach-Object{if($_ -match "^$([regex]::Escape($Name))="){$found=$true;"$Name=$Value"}else{$_}}
  if(-not $found){$out+= "$Name=$Value"};Set-Content -LiteralPath $Path -Value $out -Encoding UTF8
}
$envFile=Join-Path $ProductionDir '.env.production';$compose=Join-Path $ProductionDir 'docker-compose.production.yml'
if(-not(Test-Path $envFile)){throw ".env.production bulunamadi: $envFile"}
if(-not(Test-Path $compose)){throw "docker-compose.production.yml bulunamadi: $compose"}
if($TunnelToken.Trim().Length -lt 40){throw 'Cloudflare Tunnel token gecersiz veya cok kisa.'}
try{$uri=[uri]$PublicUrl}catch{throw 'PublicUrl gecersiz.'};if($uri.Scheme -ne 'https'){throw 'PublicUrl HTTPS olmali.'}
Set-EnvValue $envFile 'REMOTE_ACCESS_ENABLED' 'true'
Set-EnvValue $envFile 'REMOTE_ACCESS_MODE' 'named'
Set-EnvValue $envFile 'REMOTE_PUBLIC_URL' $PublicUrl.TrimEnd('/')
Set-EnvValue $envFile 'CLOUDFLARE_TUNNEL_TOKEN' $TunnelToken.Trim()
Push-Location $ProductionDir
try{
  docker compose --env-file .env.production -f docker-compose.production.yml --profile quick-remote stop cloudflared-quick 2>$null | Out-Null
  docker compose --env-file .env.production -f docker-compose.production.yml --profile quick-remote rm -f cloudflared-quick 2>$null | Out-Null
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate backend nginx
  if($LASTEXITCODE -ne 0){throw 'Backend/Nginx yeniden baslatilamadi.'}
  docker compose --env-file .env.production -f docker-compose.production.yml --profile remote up -d cloudflared
  if($LASTEXITCODE -ne 0){throw 'Cloudflare Tunnel baslatilamadi.'}
  Start-Sleep -Seconds 12
  docker compose --env-file .env.production -f docker-compose.production.yml --profile remote ps
  Write-Host ''
  Write-Host 'Cloudflare Tunnel baslatildi.' -ForegroundColor Green
  Write-Host "Public URL: $($PublicUrl.TrimEnd('/'))" -ForegroundColor Green
  Write-Host 'Cloudflare public hostname origin ayari: http://nginx:8081' -ForegroundColor Yellow
  if(-not $AccessProtected){Write-Host 'Oneri: Cloudflare Access ile e-posta/kimlik dogrulama politikasi ekleyin.' -ForegroundColor Yellow}
}catch{docker compose --env-file .env.production -f docker-compose.production.yml --profile remote logs --tail 120 cloudflared;throw}finally{Pop-Location}
