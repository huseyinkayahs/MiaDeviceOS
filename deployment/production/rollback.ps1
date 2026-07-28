[CmdletBinding()]
param([string]$TargetVersion='')
$ErrorActionPreference='Stop'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile=Join-Path $ProductionDir '.env.production'
$StateFile=Join-Path $ProductionDir 'state\deployment-state.json'
function SetEnv([string]$Key,[string]$Value){$lines=Get-Content $EnvFile;$found=$false;$out=foreach($l in $lines){if($l-match"^$Key="){"$Key=$Value";$found=$true}else{$l}};if(-not$found){$out+="$Key=$Value"};[IO.File]::WriteAllLines($EnvFile,$out,(New-Object System.Text.UTF8Encoding -ArgumentList $false))}
if (-not $TargetVersion){if (-not (Test-Path $StateFile)){throw 'Rollback hedefi bulunamadı.'};$state=Get-Content $StateFile -Raw|ConvertFrom-Json;$TargetVersion=$state.previous}
& docker image inspect "factorybox-backend:$TargetVersion" *> $null
if ($LASTEXITCODE -ne 0){throw "Docker image bulunamadı: factorybox-backend:$TargetVersion"}
SetEnv 'FACTORYBOX_IMAGE_TAG' $TargetVersion
& docker compose --env-file $EnvFile -f $ComposeFile up -d --no-build backend nginx
if ($LASTEXITCODE -ne 0){throw 'Rollback başlatılamadı.'}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProductionDir 'health-check.ps1')
if ($LASTEXITCODE -ne 0){throw 'Rollback sağlık kontrolü başarısız.'}
Write-Host "Rollback tamamlandı: $TargetVersion" -ForegroundColor Green
