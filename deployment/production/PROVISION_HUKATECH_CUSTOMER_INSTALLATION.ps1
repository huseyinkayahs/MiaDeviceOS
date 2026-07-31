param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [string]$ProductionDir = 'C:\FactoryBox\deployment\production',
  [switch]$SkipRestart,
  [switch]$KeepPackage
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param([string]$Path,[string]$Content)
  [IO.File]::WriteAllText($Path,$Content.TrimEnd() + [Environment]::NewLine,(New-Object Text.UTF8Encoding($false)))
}

function Set-EnvValue {
  param([string]$Path,[string]$Name,[string]$Value)
  if (-not (Test-Path -LiteralPath $Path)) { throw "Environment file not found: $Path" }
  $lines=@(Get-Content -LiteralPath $Path)
  $out=New-Object System.Collections.Generic.List[string]
  $written=$false
  foreach($line in $lines){
    $clean=$line.TrimStart([char]0xFEFF)
    if($clean -match ('^'+[regex]::Escape($Name)+'=')){
      if(-not $written){$out.Add($Name+'='+$Value);$written=$true}
    } else {$out.Add($clean)}
  }
  if(-not $written){$out.Add($Name+'='+$Value)}
  [IO.File]::WriteAllLines($Path,$out,(New-Object Text.UTF8Encoding($false)))
}

function Read-EnvMap {
  param([string]$Path)
  $map=@{}
  foreach($line in (Get-Content -LiteralPath $Path)){
    if($line -match '^\s*([^#][^=]*)=(.*)$'){$map[$matches[1].Trim()]=$matches[2].Trim()}
  }
  return $map
}

function Get-ContainerHealth {
  param([string]$Name)
  $result=docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Name 2>&1
  if($LASTEXITCODE -ne 0){return 'not_found'}
  return (($result|Out-String).Trim())
}

if (-not (Test-Path -LiteralPath $PackagePath)) { throw "Provisioning package not found: $PackagePath" }
if (-not (Test-Path -LiteralPath $ProductionDir)) { throw "Production directory not found: $ProductionDir" }

$package=Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
if ($package.format -notin @('hukatech-customer-provisioning-v1','hukatech-customer-deployment-v2')) { throw 'Unsupported provisioning package format' }
if ([string]::IsNullOrWhiteSpace([string]$package.installation_id)) { throw 'installation_id is missing' }
if ([string]::IsNullOrWhiteSpace([string]$package.provisioning_token)) { throw 'provisioning_token is missing' }
if ([string]::IsNullOrWhiteSpace([string]$package.exchange_url)) { throw 'exchange_url is missing' }

$expires=[DateTimeOffset]::Parse([string]$package.expires_at)
if ($expires -le [DateTimeOffset]::UtcNow) { throw 'Provisioning package has expired. Create a new package from the HukaTech panel.' }

$payload=@{
  installation_id=[string]$package.installation_id
  provisioning_token=[string]$package.provisioning_token
  platform_version=[string]$package.platform_version
}|ConvertTo-Json -Compress

Write-Host ('Provisioning installation: '+[string]$package.installation_id)
$response=Invoke-RestMethod -Method Post -Uri ([string]$package.exchange_url) -ContentType 'application/json' -Body $payload
if($response.status -ne 'ok' -or [string]::IsNullOrWhiteSpace([string]$response.customer_env)){
  throw 'HukaTech provisioning exchange did not return a valid customer environment file'
}

$customerEnv=Join-Path $ProductionDir '.env.customer-mail'
if(Test-Path -LiteralPath $customerEnv){
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $customerEnv -Destination ($customerEnv+'.pre-provision-'+$stamp) -Force
}
Write-Utf8NoBom -Path $customerEnv -Content ([string]$response.customer_env)

$productionEnv=Join-Path $ProductionDir '.env.production'
if(-not(Test-Path -LiteralPath $productionEnv)){throw "Missing file: $productionEnv"}

$cloudflareEnabled=$package.format -eq 'hukatech-customer-deployment-v2'
if($cloudflareEnabled){
  if([string]::IsNullOrWhiteSpace([string]$response.cloudflare.tunnel_token)){throw 'Cloudflare tunnel token was not returned'}
  if([string]::IsNullOrWhiteSpace([string]$response.cloudflare.tunnel_id)){throw 'Cloudflare tunnel ID was not returned'}
  if([string]::IsNullOrWhiteSpace([string]$response.cloudflare.public_hostname)){throw 'Public hostname was not returned'}
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $productionEnv -Destination ($productionEnv+'.pre-cloudflare-'+$stamp) -Force
  Set-EnvValue -Path $productionEnv -Name 'CLOUDFLARE_TUNNEL_TOKEN' -Value ([string]$response.cloudflare.tunnel_token)
  Set-EnvValue -Path $productionEnv -Name 'CLOUDFLARE_TUNNEL_ID' -Value ([string]$response.cloudflare.tunnel_id)
  Set-EnvValue -Path $productionEnv -Name 'PUBLIC_APP_URL' -Value ('https://'+[string]$response.cloudflare.public_hostname)
  Set-EnvValue -Path $productionEnv -Name 'FACTORYBOX_IMAGE_TAG' -Value 'v6.12.0'
}

if(-not $SkipRestart){
  $compose=Join-Path $ProductionDir 'docker-compose.production.yml'
  if(-not(Test-Path -LiteralPath $compose)){throw "Missing file: $compose"}
  Push-Location $ProductionDir
  try{
    if($cloudflareEnabled){
      docker compose --env-file '.env.production' -f 'docker-compose.production.yml' --profile remote up -d --build --force-recreate backend nginx cloudflared | Out-Host
    } else {
      docker compose --env-file '.env.production' -f 'docker-compose.production.yml' up -d --build --force-recreate backend nginx | Out-Host
    }
    if($LASTEXITCODE -ne 0){throw 'Docker restart failed'}
  } finally {Pop-Location}

  $deadline=(Get-Date).AddSeconds(240)
  do{
    $backend=Get-ContainerHealth -Name 'factorybox-prod-backend'
    $nginx=Get-ContainerHealth -Name 'factorybox-prod-nginx'
    $cloudflared=if($cloudflareEnabled){Get-ContainerHealth -Name 'factorybox-prod-cloudflared'}else{'skipped'}
    Write-Host ("Waiting for services: Backend=$backend, Nginx=$nginx, Cloudflared=$cloudflared")
    $ready=$backend -eq 'healthy' -and $nginx -eq 'healthy' -and (-not $cloudflareEnabled -or $cloudflared -eq 'healthy')
    if($ready){break}
    Start-Sleep -Seconds 5
  }while((Get-Date)-lt $deadline)
  if(-not $ready){throw "Services did not become healthy: Backend=$backend, Nginx=$nginx, Cloudflared=$cloudflared"}
}

$mail=Read-EnvMap -Path $customerEnv
if($cloudflareEnabled -and -not $SkipRestart){
  $publicUrl='https://'+[string]$response.cloudflare.public_hostname
  $deadline=(Get-Date).AddSeconds(240)
  $publicReady=$false
  do{
    try{
      $status=Invoke-RestMethod -Method Get -Uri ($publicUrl+'/api/auth/status') -TimeoutSec 15
      if([string]$status.version){$publicReady=$true;break}
    }catch{}
    Write-Host ('Waiting for public hostname: '+$publicUrl)
    Start-Sleep -Seconds 5
  }while((Get-Date)-lt $deadline)
  if(-not $publicReady){throw 'Cloudflare public hostname did not become reachable within 240 seconds'}

  $headers=@{
    Authorization='Bearer '+$mail['FACTORYBOX_MAIL_API_KEY']
    'x-factorybox-installation-id'=$mail['FACTORYBOX_MAIL_INSTALLATION_ID']
    'x-factorybox-version'='6.12.0'
  }
  $confirmBody=@{
    public_hostname=[string]$response.cloudflare.public_hostname
    cloudflare_tunnel_id=[string]$response.cloudflare.tunnel_id
    platform_version='6.12.0'
  }|ConvertTo-Json -Compress
  $confirmUrl=([string]$mail['FACTORYBOX_MAIL_GATEWAY_URL']).TrimEnd('/')+'/deployment/confirm'
  $confirm=Invoke-RestMethod -Method Post -Uri $confirmUrl -Headers $headers -ContentType 'application/json' -Body $confirmBody
  if(-not $confirm.verified){throw 'Central deployment verification failed'}
}

if(-not $KeepPackage){
  Remove-Item -LiteralPath $PackagePath -Force
  Write-Host 'One-time provisioning package deleted after successful exchange.'
}

Write-Host ('INSTALLATION_ID='+[string]$response.installation.installation_id)
Write-Host ('KEY_GENERATION='+[string]$response.installation.key_generation)
Write-Host ('PUBLIC_MAIL_GATEWAY='+[string]$package.public_mail_gateway_url)
if($cloudflareEnabled){
  Write-Host ('PUBLIC_APP_URL=https://'+[string]$response.cloudflare.public_hostname)
  Write-Host ('CLOUDFLARE_TUNNEL_ID='+[string]$response.cloudflare.tunnel_id)
  $deploymentState=if($SkipRestart){'credentials_written'}else{'verified'}
  Write-Host ('CLOUDFLARE_DEPLOYMENT='+$deploymentState)
}
Write-Host 'HUKATECH_CUSTOMER_DEPLOYMENT_READY'
