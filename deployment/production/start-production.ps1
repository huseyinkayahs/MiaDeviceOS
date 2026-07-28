[CmdletBinding()]
param([int]$DockerWaitSeconds=300)
$ErrorActionPreference='Stop'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile=Join-Path $ProductionDir '.env.production'
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
$deadline=(Get-Date).AddSeconds($DockerWaitSeconds)
do {
  & docker info *> $null
  if($LASTEXITCODE -eq 0){break}
  Start-Sleep -Seconds 10
} while((Get-Date)-lt $deadline)
if($LASTEXITCODE -ne 0){throw 'Docker engine başlatılamadı.'}
& docker compose --env-file $EnvFile -f $ComposeFile up -d
if($LASTEXITCODE -ne 0){throw 'FactoryBox production servisleri başlatılamadı.'}
