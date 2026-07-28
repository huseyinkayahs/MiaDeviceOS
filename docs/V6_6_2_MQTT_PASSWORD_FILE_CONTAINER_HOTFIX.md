# FactoryBox One v6.6.2 MQTT Password File Container Hotfix

## Sorun

Windows bind-mount üzerinden `/mosquitto/config/password_file` bağlandığında Docker Desktop bazı sistemlerde dosyayı klasör olarak oluşturuyor veya Mosquitto kullanıcısının okuyamayacağı hale getiriyordu. Sonuç olarak MQTT container şu hata ile yeniden başlama döngüsüne giriyordu:

```text
password-file: Error: Unable to open pwfile "/mosquitto/config/password_file"
```

## Düzeltme

- Host üzerindeki `password_file` bind-mount kaldırıldı.
- Şifre dosyası her MQTT container başlangıcında container içinde `/tmp/factorybox_password_file` konumunda oluşturuluyor.
- Dosya yalnızca çalışma anında mevcut oluyor; host üzerinde düz metin şifre tutulmuyor.
- Eski dosya veya klasör haline gelmiş `password_file` otomatik temizleniyor.
- MQTT container zorla yeniden oluşturuluyor.
- PostgreSQL volume ve mevcut production verileri korunuyor.

## Onarım

```cmd
cd /d "PROJE_KLASORU\deployment\production"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\repair-mqtt.ps1"
```

## Beklenen Sonuç

```text
factorybox-prod-postgres   healthy
factorybox-prod-mqtt       healthy
factorybox-prod-backend    healthy
factorybox-prod-nginx      healthy
```
