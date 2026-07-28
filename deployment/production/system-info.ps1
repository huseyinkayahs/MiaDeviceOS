[CmdletBinding()]
param()
$ErrorActionPreference='Continue'
$ProductionDir=Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile=Join-Path $ProductionDir '.env.production'
$ComposeFile=Join-Path $ProductionDir 'docker-compose.production.yml'
$Out=Join-Path $ProductionDir ("FactoryBox_System_Info_{0}.txt" -f (Get-Date -Format yyyyMMdd_HHmmss))
"FactoryBox System Information`r`nGenerated: $(Get-Date -Format o)`r`n"|Set-Content $Out
"Docker:`r`n$(& docker version --format '{{.Server.Version}}' 2>&1)`r`n"|Add-Content $Out
"Compose Services:`r`n$(& docker compose --env-file $EnvFile -f $ComposeFile ps 2>&1 | Out-String)`r`n"|Add-Content $Out
"Backend Health:`r`n$(& docker compose --env-file $EnvFile -f $ComposeFile exec -T backend node -e "fetch('http://127.0.0.1:3100/readyz').then(r=>r.text()).then(console.log).catch(e=>console.error(e.message))" 2>&1 | Out-String)`r`n"|Add-Content $Out
"Recent Backend Logs:`r`n$(& docker compose --env-file $EnvFile -f $ComposeFile logs --tail 120 backend 2>&1 | Out-String)`r`n"|Add-Content $Out
Write-Host "Sistem bilgi dosyası: $Out" -ForegroundColor Green
