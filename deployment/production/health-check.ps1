[CmdletBinding()]
param([int]$TimeoutSeconds = 180)
$ErrorActionPreference='Stop'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
$EnvFile=Join-Path $ProductionDir '.env.production'
if (-not (Test-Path $EnvFile)) { throw '.env.production bulunamadı.' }
$deadline=(Get-Date).AddSeconds($TimeoutSeconds)
$backendReady=$false
do {
  & docker compose --env-file $EnvFile -f $ComposeFile exec -T backend node -e "fetch('http://127.0.0.1:3100/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" *> $null
  $backendReady=($LASTEXITCODE -eq 0)
  if($backendReady){break}
  Start-Sleep -Seconds 5
} while((Get-Date)-lt $deadline)
if (-not $backendReady) {
  & docker compose --env-file $EnvFile -f $ComposeFile ps
  & docker compose --env-file $EnvFile -f $ComposeFile logs --tail 80 backend
  exit 1
}

& docker compose --env-file $EnvFile -f $ComposeFile exec -T nginx wget -qO- http://127.0.0.1/nginx-health *> $null
if ($LASTEXITCODE -ne 0) {
  & docker compose --env-file $EnvFile -f $ComposeFile logs --tail 80 nginx
  throw 'Nginx sağlık kontrolü başarısız.'
}
$publicUrl=(Get-Content $EnvFile|Where-Object{$_ -match '^FACTORYBOX_PUBLIC_URL='}|Select-Object -Last 1)-replace '^FACTORYBOX_PUBLIC_URL=',''
try {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if($curl) {
    $curlArgs=@('-fsS','--max-time','20')
    if($publicUrl -match '^https://localhost|^https://\d+\.\d+\.\d+\.\d+'){$curlArgs += '-k'}
    $curlArgs += "$publicUrl/healthz"
    & curl.exe @curlArgs | Out-Null
    if ($LASTEXITCODE -ne 0){throw 'curl health request failed'}
  } else {
    Invoke-WebRequest -Uri "$publicUrl/healthz" -UseBasicParsing -TimeoutSec 20 | Out-Null
  }
} catch {
  Write-Warning "Dış URL kontrolü başarısız: $($_.Exception.Message)"
}
& docker compose --env-file $EnvFile -f $ComposeFile ps
Write-Host 'FactoryBox health check: PASSED' -ForegroundColor Green
exit 0
