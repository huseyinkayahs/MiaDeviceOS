# FactoryBox One v6.1.2 Docker PostgreSQL Backup Hotfix

## Amaç

Windows üzerinde ayrıca PostgreSQL kurulumu bulunmadığında, `factorybox-postgres` Docker container içindeki `pg_dump` ve `pg_restore` araçlarını kullanarak veritabanı yedeği ve doğrulaması yapmak.

## Eklenenler

- Docker PostgreSQL container otomatik araç tespiti
- `factorybox-postgres` içinden `pg_dump` çalıştırma
- Oluşturulan yedeği Windows backup klasörüne kopyalama
- Docker içindeki `pg_restore` ile arşiv doğrulama
- Container adı ve iç port için `.env` ayarları
- MQTT Broker kartında broker ve cihaz trafiğinin ayrı durumları
- MQTT Broker bağlıysa broker kartında `HAZIR` gösterimi
- Sistem günlüğü mesajları ve metadata için Türkçe görünüm iyileştirmesi

## Varsayılan Docker Yapısı

```text
Container: factorybox-postgres
Image: postgres:16-alpine
Host port: 5433
Container port: 5432
```

## Önerilen Ayarlar

```env
FACTORYBOX_BACKUP_DIR=C:\New DeviceOs Project\Backups
FACTORYBOX_POSTGRES_CONTAINER=factorybox-postgres
FACTORYBOX_POSTGRES_INTERNAL_HOST=127.0.0.1
FACTORYBOX_POSTGRES_INTERNAL_PORT=5432
```
