$ErrorActionPreference = 'Stop'

$developmentRoot = 'C:\New DeviceOs Project\MiaDeviceOS_v0.5_command_engine (1)'
$productionRoot = 'C:\FactoryBox'

$paths = @(
  (Join-Path $developmentRoot 'platform\backend\server.js'),
  (Join-Path $productionRoot 'platform\backend\server.js')
)

foreach ($path in $paths) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "server.js not found: $path"
  }

  node --check $path
  if ($LASTEXITCODE -ne 0) {
    throw "Node syntax check failed: $path"
  }

  $text = [System.IO.File]::ReadAllText(
    $path,
    (New-Object System.Text.UTF8Encoding($false))
  )

  foreach ($route in @(
    "/public/installations/provision/exchange",
    "/central-mail/v1/status",
    "/central-mail/v1/deployment/confirm",
    "/central-mail/v1/send"
  )) {
    if (-not $text.Contains("req.path === '" + $route + "'")) {
      throw "Browser auth bypass missing for route: $route"
    }
  }

  Write-Host ('SERVER_ROUTE_GUARD_OK=' + $path)
}

$productionDir = Join-Path $productionRoot 'deployment\production'
Push-Location $productionDir
try {
  docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --force-recreate backend nginx
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker rebuild failed'
  }
}
finally {
  Pop-Location
}

$deadline = (Get-Date).AddSeconds(180)
do {
  $backend = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-backend 2>$null | Out-String).Trim()
  $nginx = (docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' factorybox-prod-nginx 2>$null | Out-String).Trim()

  if ($backend -eq 'healthy' -and $nginx -eq 'healthy') {
    break
  }

  Write-Host ('WAITING_FOR_HEALTH backend=' + $backend + ' nginx=' + $nginx)
  Start-Sleep -Seconds 5
}
while ((Get-Date) -lt $deadline)

if ($backend -ne 'healthy' -or $nginx -ne 'healthy') {
  throw "Containers not healthy: backend=$backend nginx=$nginx"
}

$temp = Join-Path $env:TEMP ('hukatech-v612-route-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null

try {
  $exchangeBody = Join-Path $temp 'exchange.json'
  $exchangeHttp = curl.exe -ksS -o $exchangeBody -w '%{http_code}' `
    -H 'Content-Type: application/json' `
    -d '{}' `
    'https://127.0.0.1:8443/api/public/installations/provision/exchange'

  $exchangeText = Get-Content -LiteralPath $exchangeBody -Raw
  if ($exchangeHttp -ne '400') {
    throw "Unexpected public exchange HTTP status: $exchangeHttp"
  }
  if ($exchangeText -match 'Login required') {
    throw 'Public provisioning exchange is still blocked by browser login'
  }

  foreach ($test in @(
    @{ Name='CENTRAL_STATUS'; Method='GET'; Url='https://127.0.0.1:8443/api/central-mail/v1/status' },
    @{ Name='DEPLOYMENT_CONFIRM'; Method='POST'; Url='https://127.0.0.1:8443/api/central-mail/v1/deployment/confirm' },
    @{ Name='CENTRAL_SEND'; Method='POST'; Url='https://127.0.0.1:8443/api/central-mail/v1/send' }
  )) {
    $bodyFile = Join-Path $temp ($test.Name + '.json')
    if ($test.Method -eq 'GET') {
      $http = curl.exe -ksS -o $bodyFile -w '%{http_code}' $test.Url
    }
    else {
      $http = curl.exe -ksS -o $bodyFile -w '%{http_code}' `
        -H 'Content-Type: application/json' `
        -d '{}' `
        $test.Url
    }

    $body = Get-Content -LiteralPath $bodyFile -Raw
    if ($body -match 'Login required') {
      throw ($test.Name + ' is still blocked by browser login')
    }
    if ($http -ne '401') {
      throw ($test.Name + ' expected machine-auth HTTP 401, received ' + $http)
    }

    Write-Host ($test.Name + '_AUTH_BYPASS=OK')
  }
}
finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ('BACKEND_STATUS=' + $backend)
Write-Host ('NGINX_STATUS=' + $nginx)
Write-Host 'PUBLIC_PROVISIONING_EXCHANGE_HTTP=400'
Write-Host 'PUBLIC_PROVISIONING_EXCHANGE_AUTH_BYPASS=OK'
Write-Host 'HUKATECH_V6_12_0_PUBLIC_MACHINE_ROUTES_FIX_READY'
