[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$NewVersion,
  [switch]$SkipDatabaseBackup
)
$ErrorActionPreference='Stop'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile=Join-Path $ProductionDir '.env.production'
$StateFile=Join-Path $ProductionDir 'state\deployment-state.json'
function Env([string]$Key){(($line=Get-Content $EnvFile|Where-Object{$_ -match "^$Key="}|Select-Object -Last 1)-split '=',2)[1]}
function SetEnv([string]$Key,[string]$Value){$lines=Get-Content $EnvFile;$found=$false;$out=foreach($l in $lines){if($l-match"^$Key="){"$Key=$Value";$found=$true}else{$l}};if(-not$found){$out+="$Key=$Value"};[IO.File]::WriteAllLines($EnvFile,$out,(New-Object System.Text.UTF8Encoding -ArgumentList $false))}
if(-not(Test-Path $EnvFile)){throw '.env.production bulunamadı.'}
$current=Env 'FACTORYBOX_IMAGE_TAG'; if (-not $current){$current='unknown'}
New-Item -ItemType Directory -Force (Split-Path $StateFile) | Out-Null
@{previous=$current;target=$NewVersion;started_at=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content $StateFile -Encoding UTF8
if (-not $SkipDatabaseBackup){
  $backupDir=(Resolve-Path (Join-Path $ProductionDir '..\..\Backups')).Path
  $stamp=Get-Date -Format yyyyMMdd_HHmmss
  $backupName="FactoryBox_PreUpdate_${current}_to_${NewVersion}_${stamp}.dump"
  $containerPath="/tmp/$backupName"
  & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres sh -c "PGPASSWORD=`$POSTGRES_PASSWORD pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB -Fc --no-owner --no-acl -f '$containerPath'"
  if ($LASTEXITCODE -ne 0){throw 'Güncelleme öncesi veritabanı yedeği alınamadı.'}
  & docker cp "factorybox-prod-postgres:$containerPath" (Join-Path $backupDir $backupName)
  $copyExit=$LASTEXITCODE
  & docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres rm -f $containerPath | Out-Null
  if ($copyExit -ne 0){throw 'Güncelleme öncesi yedek host klasörüne kopyalanamadı.'}
}
SetEnv 'FACTORYBOX_IMAGE_TAG' $NewVersion
try {
  & docker compose --env-file $EnvFile -f $ComposeFile build --pull backend
  if ($LASTEXITCODE -ne 0){throw 'Backend image build başarısız.'}
  & docker compose --env-file $EnvFile -f $ComposeFile up -d --remove-orphans
  if ($LASTEXITCODE -ne 0){throw 'Servis güncellemesi başarısız.'}
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProductionDir 'health-check.ps1')
  if ($LASTEXITCODE -ne 0){throw 'Güncelleme sonrası sağlık kontrolü başarısız.'}
  @{previous=$current;current=$NewVersion;completed_at=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content $StateFile -Encoding UTF8
  Write-Host "FactoryBox güncellendi: $current -> $NewVersion" -ForegroundColor Green
} catch {
  Write-Warning $_.Exception.Message
  SetEnv 'FACTORYBOX_IMAGE_TAG' $current
  & docker compose --env-file $EnvFile -f $ComposeFile up -d --no-build
  throw 'Güncelleme geri alındı. Ayrıntılar için Docker loglarını kontrol edin.'
}
