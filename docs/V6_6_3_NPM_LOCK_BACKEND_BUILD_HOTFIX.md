# FactoryBox One v6.6.3 NPM Lock & Backend Build Hotfix

## Amaç

Production Docker backend image oluşturulurken mevcut olmayan `dotenv@16.6.2` paketinin çağrılmasına neden olan `package-lock.json` kaydını düzeltir.

## Düzeltmeler

- `dotenv` sürümü doğrulanmış `16.4.5` sürümüne sabitlendi.
- Tarball adresi ve SHA512 integrity değeri düzeltildi.
- Production image etiketi `v6.6.3` olarak güncellendi.
- `repair-mqtt.ps1`, backend build öncesinde npm lock kontrolü yapar.
- PostgreSQL volume korunur.

## Çalıştırma

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\repair-mqtt.ps1"
```
