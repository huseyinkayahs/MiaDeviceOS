# V2 Final Backup Plan

## Amaç
FactoryBox One V2 hattının temiz ve güvenli bir yedeğini almak.

## Yedek Stratejisi

Yedek Git tag üzerinden alınmalıdır. Böylece geçici dosyalar, `.env`, `node_modules`, `.pio`, `secrets.h` gibi yerel dosyalar yedeğe karışmaz.

## Önerilen Komutlar

Proje ana klasöründe:

```powershell
git status
```

Tag kontrolü:

```powershell
git tag --list v2.14.0
```

Backup klasörü oluşturma:

```powershell
New-Item -ItemType Directory -Force "C:\New DeviceOs Project\Backups"
```

Tag üzerinden temiz ZIP oluşturma:

```powershell
git archive --format=zip --output="C:\New DeviceOs Project\Backups\FactoryBox_One_v2.14.0_Final_V2_Package.zip" v2.14.0
```

Yedeği kontrol etme:

```powershell
Get-Item "C:\New DeviceOs Project\Backups\FactoryBox_One_v2.14.0_Final_V2_Package.zip" | Select-Object FullName, Length, LastWriteTime
```

## Yedeğe Girmemesi Gerekenler

```text
include/secrets.h
.pio/
smartdashboard-lite/.env
smartdashboard-lite/node_modules/
```

## Yedekte Olması Gerekenler

```text
src/
include/
docs/
README.md
platformio.ini
partitions_ota_ble.csv
smartdashboard-lite source files
smartdashboard-lite/.env.example
smartdashboard-lite/package.json
smartdashboard-lite/package-lock.json
```
