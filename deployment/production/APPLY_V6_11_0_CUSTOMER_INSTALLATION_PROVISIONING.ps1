param(
  [string]$ProductionDir = 'C:\FactoryBox\deployment\production'
)

$ErrorActionPreference = 'Stop'

function Set-EnvValue {
  param([string]$Path,[string]$Name,[string]$Value)
  if (-not (Test-Path -LiteralPath $Path)) { throw "Environment file not found: $Path" }
  $lines = @(Get-Content -LiteralPath $Path)
  $out = New-Object System.Collections.Generic.List[string]
  $written = $false
  foreach ($line in $lines) {
    $clean = $line.TrimStart([char]0xFEFF)
    if ($clean -match ('^' + [regex]::Escape($Name) + '=')) {
      if (-not $written) { $out.Add($Name + '=' + $Value); $written=$true }
    } else { $out.Add($clean) }
  }
  if (-not $written) { $out.Add($Name + '=' + $Value) }
  [IO.File]::WriteAllLines($Path,$out,(New-Object Text.UTF8Encoding($false)))
}

function Read-EnvMap {
  param([string]$Path)
  $map=@{}
  foreach($line in (Get-Content -LiteralPath $Path)) {
    if($line -match '^\s*([^#][^=]*)=(.*)$') { $map[$matches[1].Trim()]=$matches[2].Trim() }
  }
  return $map
}

function Get-ContainerHealth {
  param([string]$Name)
  $result=docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>&1
  if($LASTEXITCODE -ne 0){return 'not_found'}
  return (($result|Out-String).Trim())
}

function Wait-ContainersHealthy {
  param([hashtable]$Containers,[int]$TimeoutSeconds=180,[int]$PollSeconds=5)
  $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
  $last=@{}
  while((Get-Date)-lt $deadline){
    $ok=$true
    foreach($name in $Containers.Keys){
      $last[$name]=Get-ContainerHealth -Name $name
      if($last[$name]-ne 'healthy'){$ok=$false}
    }
    $summary=($Containers.Keys|Sort-Object|ForEach-Object{"$($Containers[$_])=$($last[$_])"}) -join ', '
    Write-Host ('Waiting for container health: '+$summary)
    if($ok){return $last}
    Start-Sleep -Seconds $PollSeconds
  }
  throw ('Containers did not become healthy within '+$TimeoutSeconds+' seconds')
}

$productionEnv=Join-Path $ProductionDir '.env.production'
$gatewayEnv=Join-Path $ProductionDir '.env.mail-gateway'
$customerEnv=Join-Path $ProductionDir '.env.customer-mail'
$composeProduction=Join-Path $ProductionDir 'docker-compose.production.yml'
$composeGateway=Join-Path $ProductionDir 'docker-compose.mail-gateway.yml'
$migration=Join-Path (Split-Path (Split-Path $ProductionDir -Parent) -Parent) 'platform\database\migrations\043_customer_installation_provisioning_key_lifecycle.sql'

foreach($required in @($productionEnv,$gatewayEnv,$customerEnv,$composeProduction,$composeGateway,$migration)){
  if(-not(Test-Path -LiteralPath $required)){throw "Required file not found: $required"}
}

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item -LiteralPath $productionEnv -Destination ($productionEnv+'.pre-v6.11.0-'+$stamp) -Force
Copy-Item -LiteralPath $gatewayEnv -Destination ($gatewayEnv+'.pre-v6.11.0-'+$stamp) -Force
Copy-Item -LiteralPath $customerEnv -Destination ($customerEnv+'.pre-v6.11.0-'+$stamp) -Force

$production=Read-EnvMap -Path $productionEnv
$publicApp=([string]$production['PUBLIC_APP_URL']).TrimEnd('/')
if([string]::IsNullOrWhiteSpace($publicApp)){$publicApp='https://panel.hukatech.com'}
$publicMail=$publicApp+'/api/central-mail/v1'

Set-EnvValue -Path $productionEnv -Name 'FACTORYBOX_IMAGE_TAG' -Value 'v6.11.0'
Set-EnvValue -Path $productionEnv -Name 'CENTRAL_MAIL_GATEWAY_INTERNAL_URL' -Value 'http://host.docker.internal:3101'
Set-EnvValue -Path $productionEnv -Name 'PUBLIC_MAIL_GATEWAY_URL' -Value $publicMail
Set-EnvValue -Path $gatewayEnv -Name 'FACTORYBOX_IMAGE_TAG' -Value 'v6.11.0'
Set-EnvValue -Path $gatewayEnv -Name 'MAIL_GATEWAY_PUBLIC_URL' -Value $publicMail

Push-Location $ProductionDir
try {
  docker compose --env-file '.env.mail-gateway' -f 'docker-compose.mail-gateway.yml' up -d mail-gateway-postgres | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Mail Gateway PostgreSQL start failed'}
} finally { Pop-Location }

Wait-ContainersHealthy -Containers @{'factorybox-mail-gateway-postgres'='Mail Gateway PostgreSQL'} -TimeoutSeconds 120 | Out-Null
Get-Content -LiteralPath $migration -Raw | docker exec -i factorybox-mail-gateway-postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if($LASTEXITCODE -ne 0){throw 'Migration 043 failed'}

Push-Location $ProductionDir
try {
  docker compose --env-file '.env.mail-gateway' -f 'docker-compose.mail-gateway.yml' up -d --build --force-recreate mail-gateway | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Mail Gateway build/recreate failed'}
  docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --build --force-recreate backend nginx | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Backend/Nginx build/recreate failed'}
} finally { Pop-Location }

$health=Wait-ContainersHealthy -Containers @{
  'factorybox-prod-backend'='Backend'
  'factorybox-prod-nginx'='Nginx'
  'factorybox-mail-gateway'='Mail Gateway'
} -TimeoutSeconds 180

$authStatus=(curl.exe -ksS 'https://127.0.0.1:8443/api/auth/status'|ConvertFrom-Json)
if($authStatus.version -ne '6.11.0'){throw "Unexpected backend version: $($authStatus.version)"}

$customer=Read-EnvMap -Path $customerEnv
$headers=@{
  Authorization='Bearer '+$customer['FACTORYBOX_MAIL_API_KEY']
  'x-factorybox-installation-id'=$customer['FACTORYBOX_MAIL_INSTALLATION_ID']
  'x-factorybox-version'='6.11.0'
}
$registry=Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3101/api/mail-gateway/v1/admin/installations' -Headers $headers
$columnCount=(docker exec factorybox-mail-gateway-postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name=''customer_installations'' AND column_name IN (''provisioning_status'',''provisioning_token_sha256'',''key_generation'');"'|Out-String).Trim()
if($columnCount -ne '3'){throw "Provisioning columns missing: $columnCount/3"}

$relayCode=(curl.exe -ksS -o NUL -w '%{http_code}' -X POST 'https://127.0.0.1:8443/api/central-mail/v1/send' -H 'Content-Type: application/json' -d '{}')
if($relayCode -notin @('400','401','403')){throw "Unexpected public relay validation response: HTTP $relayCode"}

Write-Host ('BACKEND_STATUS='+$health['factorybox-prod-backend'])
Write-Host ('NGINX_STATUS='+$health['factorybox-prod-nginx'])
Write-Host ('MAIL_GATEWAY_STATUS='+$health['factorybox-mail-gateway'])
Write-Host ('BACKEND_VERSION='+$authStatus.version)
Write-Host ('INSTALLATION_REGISTRY_COUNT='+$registry.count)
Write-Host ('PROVISIONING_COLUMNS='+$columnCount+'/3')
Write-Host ('PUBLIC_MAIL_GATEWAY='+$publicMail)
Write-Host ('PUBLIC_RELAY_VALIDATION_HTTP='+$relayCode)
Write-Host 'HUKATECH_V6_11_0_CUSTOMER_PROVISIONING_READY'
