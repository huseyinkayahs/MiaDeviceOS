param(
    [string]$SecretsPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'include\secrets.h')
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Host "HATA: $Message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $SecretsPath)) {
    Fail "include\secrets.h bulunamadi: $SecretsPath"
}

try {
    $raw = Get-Clipboard -Raw
    $token = ([string]$raw).Trim()
}
catch {
    Fail "Pano okunamadi: $($_.Exception.Message)"
}

# Backend format: fbp_ + 48 hexadecimal characters = 52 characters.
if ($token -notmatch '^fbp_[a-fA-F0-9]{48}$') {
    Fail "Panodaki deger gecerli provisioning tokeni degil. Beklenen: fbp_ ile baslayan 52 karakter. Okunan uzunluk: $($token.Length)"
}

$url = 'https://panel.hukatech.com/api/device/provision/claim'
$model = 'FactoryBox One'
$encoding = [Text.UTF8Encoding]::new($false)
$text = [IO.File]::ReadAllText($SecretsPath)

function Set-Define {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowEmptyString()][string]$Value
    )

    # ConvertTo-Json provides a valid C/C++ quoted string for these values.
    $quoted = ConvertTo-Json -Compress -InputObject $Value
    $line = "#define $Name $quoted"
    $pattern = '(?m)^\s*#define\s+' + [regex]::Escape($Name) + '\b.*$'

    if ([regex]::IsMatch($script:text, $pattern)) {
        $script:text = [regex]::Replace($script:text, $pattern, $line)
    }
    else {
        $script:text = $script:text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
    }
}

$backup = $SecretsPath + '.before-provisioning-clipboard-v2.bak'
Copy-Item -LiteralPath $SecretsPath -Destination $backup -Force

try {
    Set-Define -Name 'PROVISIONING_CLAIM_URL' -Value $url
    Set-Define -Name 'PROVISIONING_TOKEN' -Value $token
    Set-Define -Name 'PROVISIONING_MODEL' -Value $model

    if (-not [regex]::IsMatch($text, '(?m)^\s*#define\s+PROVISIONING_SERIAL_NO\b')) {
        Set-Define -Name 'PROVISIONING_SERIAL_NO' -Value ''
    }

    [IO.File]::WriteAllText($SecretsPath, $text, $encoding)

    # Verify the value written to disk without printing it.
    $written = [IO.File]::ReadAllText($SecretsPath)
    $match = [regex]::Match($written, '(?m)^\s*#define\s+PROVISIONING_TOKEN\s+"([^"]*)"\s*$')
    if (-not $match.Success) {
        throw 'PROVISIONING_TOKEN satiri yazildiktan sonra dogrulanamadi.'
    }
    if ($match.Groups[1].Value.Length -ne 52) {
        throw "Yazilan token uzunlugu hatali: $($match.Groups[1].Value.Length)"
    }
}
catch {
    Copy-Item -LiteralPath $backup -Destination $SecretsPath -Force
    Fail "Token yazilamadi; onceki secrets.h geri yuklendi. $($_.Exception.Message)"
}

# Clear clipboard only after a verified write. A single space avoids Set-Clipboard's null/empty bug.
try {
    Set-Clipboard -Value ' '
}
catch {
    Write-Host 'UYARI: Token yazildi fakat pano otomatik temizlenemedi. Panoyu elle temizleyin.' -ForegroundColor Yellow
}

Write-Host 'BASARILI: Provisioning tokeni guvenli sekilde yazildi ve dosyada dogrulandi. Uzunluk: 52' -ForegroundColor Green
Write-Host 'Token ekrana yazdirilmadi.'
exit 0
