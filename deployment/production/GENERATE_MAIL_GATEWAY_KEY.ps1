$ErrorActionPreference = "Stop"

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
}
finally {
    $rng.Dispose()
}

$apiKey = [Convert]::ToBase64String($bytes)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($apiKey))
}
finally {
    $sha.Dispose()
}

$apiKeyHash = ([BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
$installationId = "fbx-" + [Guid]::NewGuid().ToString("N")

Write-Host ""
Write-Host "FACTORYBOX_MAIL_INSTALLATION_ID=$installationId"
Write-Host "FACTORYBOX_MAIL_API_KEY=$apiKey"
Write-Host ""
Write-Host "MAIL_GATEWAY_SINGLE_INSTALLATION_ID=$installationId"
Write-Host "MAIL_GATEWAY_SINGLE_API_KEY_SHA256=$apiKeyHash"
Write-Host ""
Write-Host "API key is shown once. Store it securely and do not send it in chat or email."
