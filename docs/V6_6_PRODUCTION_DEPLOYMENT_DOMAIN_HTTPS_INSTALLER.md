# v6.6.0 Production Deployment, Domain, HTTPS & Installer

## Amaç

FactoryBox platformunu geliştirme bilgisayarındaki doğrudan Node.js çalıştırma yapısından çıkarıp Docker Compose, Nginx, HTTPS, güvenli servis ağı ve sürüm yönetimi olan kurulabilir bir ürün haline getirmek.

## Mimari

```text
Kullanıcı / Telefon / Tablet
          |
      HTTPS 443
          |
        Nginx
          |
 FactoryBox Backend :3100
          |
 PostgreSQL + MQTT + isteğe bağlı n8n
```

## Güvenlik İlkeleri

- PostgreSQL dış ağa port açmaz.
- Backend doğrudan host portuna yayınlanmaz.
- MQTT kullanıcı/parola zorunludur.
- pgAdmin ve n8n yalnızca localhost'a bind edilir.
- Production ortam değişkenleri Git dışında tutulur.
- Yedek klasörü proje kökündeki `Backups` dizinine bind edilir.
- Domain modunda Let's Encrypt sertifikası kullanılır.

## Sağlık Endpointleri

- `/healthz`: Backend process ve sürüm bilgisi.
- `/readyz`: PostgreSQL bağlantısı dahil hazır olma kontrolü.

## Güncelleme ve Rollback

`update.ps1`, güncelleme öncesi veritabanı yedeği alır, yeni Docker image oluşturur ve sağlık kontrolü başarısız olursa önceki image etiketine döner.
