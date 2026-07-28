# FactoryBox v6.6.0 Production Deployment

Bu klasör FactoryBox platformunu Docker Compose, Nginx ve HTTPS ile production ortamına kurar.

## Modlar

- **Local:** `https://BILGISAYAR_IP:8443` üzerinden self-signed sertifika ile yerel test.
- **Domain:** Gerçek domain, Nginx ve Let's Encrypt sertifikası ile production kurulum.

## Hızlı yerel test

PowerShell'i yönetici olarak açın:

```powershell
cd "C:\New DeviceOs Project\deployment\production"
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1 -Mode Local
```

## Domain kurulumu

Domain DNS kaydı sunucunun public IP adresine yönlenmiş ve 80/443 portları açık olmalıdır.

```powershell
.\install.ps1 -Mode Domain `
  -Domain "panel.example.com" `
  -LetsEncryptEmail "admin@example.com" `
  -AdminEmail "admin@example.com"
```

## Teknik servisler

n8n ve pgAdmin dışarıya açılmaz, yalnızca localhost'a bağlanır:

```powershell
.\install.ps1 -Mode Local -EnableN8n -EnablePgAdmin
```

## Yönetim

```powershell
.\health-check.ps1
.\start-production.ps1
.\system-info.ps1
.\renew-certificate.ps1
.\update.ps1 -NewVersion v6.7.0
.\rollback.ps1
```

## Güvenlik

- PostgreSQL host portu açılmaz.
- pgAdmin ve n8n yalnızca `127.0.0.1` üzerinden erişilir.
- MQTT anonim erişime kapalıdır.
- Normal panel trafiği Nginx üzerinden geçer.
- `.env.production` ve `INSTALLATION_CREDENTIALS.txt` gizli dosyalardır; Git'e eklemeyin.
- Domain modunda HTTP otomatik olarak HTTPS'ye yönlendirilir.

Docker container restart politikaları ve Windows başlangıç kaydı, bilgisayar yeniden açıldığında production servislerinin tekrar başlamasını sağlar.
