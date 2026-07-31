param([string]$ProductionDir=$PSScriptRoot)
$ErrorActionPreference='Stop';$envFile=Join-Path $ProductionDir '.env.production'
Push-Location $ProductionDir
try{
  Write-Host 'FactoryBox Remote Access Status' -ForegroundColor Cyan
  Get-Content $envFile|Where-Object{$_ -match '^(REMOTE_ACCESS_ENABLED|REMOTE_ACCESS_MODE|REMOTE_PUBLIC_URL)='}
  docker compose --env-file .env.production -f docker-compose.production.yml --profile remote --profile quick-remote ps
  if(docker ps -a --format '{{.Names}}'|Select-String '^factorybox-prod-cloudflared$'){docker logs --tail 40 factorybox-prod-cloudflared}
  if(docker ps -a --format '{{.Names}}'|Select-String '^factorybox-prod-cloudflared-quick$'){docker logs --tail 40 factorybox-prod-cloudflared-quick}
}finally{Pop-Location}
