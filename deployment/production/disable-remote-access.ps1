param([string]$ProductionDir=$PSScriptRoot)
$ErrorActionPreference='Stop'
function Set-EnvValue([string]$Path,[string]$Name,[string]$Value){$lines=if(Test-Path $Path){Get-Content -LiteralPath $Path}else{@()};$found=$false;$out=$lines|ForEach-Object{if($_ -match "^$([regex]::Escape($Name))="){$found=$true;"$Name=$Value"}else{$_}};if(-not $found){$out+="$Name=$Value"};Set-Content -LiteralPath $Path -Value $out -Encoding UTF8}
$envFile=Join-Path $ProductionDir '.env.production';Push-Location $ProductionDir
try{
  docker compose --env-file .env.production -f docker-compose.production.yml --profile remote stop cloudflared 2>$null|Out-Null
  docker compose --env-file .env.production -f docker-compose.production.yml --profile remote rm -f cloudflared 2>$null|Out-Null
  docker compose --env-file .env.production -f docker-compose.production.yml --profile quick-remote stop cloudflared-quick 2>$null|Out-Null
  docker compose --env-file .env.production -f docker-compose.production.yml --profile quick-remote rm -f cloudflared-quick 2>$null|Out-Null
  Set-EnvValue $envFile 'REMOTE_ACCESS_ENABLED' 'false';Set-EnvValue $envFile 'REMOTE_ACCESS_MODE' 'disabled';Set-EnvValue $envFile 'REMOTE_PUBLIC_URL' ''
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate backend
  Write-Host 'Uzak erisim kapatildi. Yerel HTTPS panel calismaya devam eder.' -ForegroundColor Green
}finally{Pop-Location}
