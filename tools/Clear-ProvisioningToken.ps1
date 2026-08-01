param(
    [string]$SecretsPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'include\secrets.h')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SecretsPath)) {
    throw "include\secrets.h bulunamadi: $SecretsPath"
}

$text = [IO.File]::ReadAllText($SecretsPath)
$line = '#define PROVISIONING_TOKEN ""'
$pattern = '(?m)^\s*#define\s+PROVISIONING_TOKEN\b.*$'

if ([regex]::IsMatch($text, $pattern)) {
    $text = [regex]::Replace($text, $pattern, $line)
}
else {
    $text = $text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}

[IO.File]::WriteAllText(
    $SecretsPath,
    $text,
    [Text.UTF8Encoding]::new($false)
)

Write-Host 'BASARILI: Kaynak dosyadaki provisioning token temizlendi.' -ForegroundColor Green
