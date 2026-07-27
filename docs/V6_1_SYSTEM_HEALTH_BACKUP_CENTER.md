# FactoryBox One v6.1.0

## System Health & Backup Center

Bu sürüm, FactoryBox One platformunun üretim ortamına hazırlanması için merkezi sistem sağlığı ve veritabanı yedekleme ekranı ekler.

### Sistem Sağlığı

- Backend sürümü, çalışma süresi, Node.js ve bellek kullanımı
- PostgreSQL bağlantısı, gecikme, veritabanı boyutu ve aktif bağlantılar
- MQTT bağlantısı, topic ve son mesaj zamanı
- Telegram ve Email/SMTP yapılandırma durumu
- Alarm delivery, otomasyon, alarm raporu ve bakım scheduler durumları
- Disk kapasitesi, boş alan ve kullanım yüzdesi
- Production ortam değişkeni kontrolleri
- Kritik sistem hatalarında Telegram bildirimi ve tekrar bildirim sınırlaması

### Veritabanı Yedekleri

- Admin panelinden manuel PostgreSQL yedeği oluşturma
- Günlük otomatik yedek saati
- Saklama günü ve maksimum yedek adedi politikası
- pg_dump custom archive formatı
- SHA256 checksum üretimi
- pg_restore archive catalog doğrulaması
- Yedek geçmişi, boyut, doğrulama durumu ve indirme
- Eski yedekleri manuel veya otomatik temizleme
- Yedekleme ve sağlık olayları için sistem günlüğü ve audit log

### Varsayılan Yedek Klasörü

```text
C:\New DeviceOs Project\Backups
```

Backend farklı bir konuma kuruluysa klasör, proje kökünün altındaki `Backups` dizini olarak otomatik hesaplanır. `FACTORYBOX_BACKUP_DIR` ile değiştirilebilir.

### PostgreSQL Araçları

Sistem önce PATH içindeki `pg_dump` ve `pg_restore` araçlarını, ardından Windows üzerindeki yaygın PostgreSQL kurulum klasörlerini kontrol eder. Bulunamazsa `.env` dosyasına şu değerler eklenebilir:

```env
PG_DUMP_PATH=C:\Program Files\PostgreSQL\17\bin\pg_dump.exe
PG_RESTORE_PATH=C:\Program Files\PostgreSQL\17\bin\pg_restore.exe
```

PostgreSQL sürüm numarası bilgisayardaki kuruluma göre değiştirilmelidir.
