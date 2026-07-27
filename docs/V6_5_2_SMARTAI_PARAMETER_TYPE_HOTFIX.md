# FactoryBox One v6.5.2 SmartAI Parameter Type Hotfix

## Sorun

SmartAI raporu oluşturulup `ai_reports` tablosuna kaydedilirken aynı PostgreSQL placeholder değeri birden fazla tarih kolonunda tekrar kullanılıyordu. Bazı mevcut veritabanı şemalarında PostgreSQL bu placeholder için farklı türler çıkararak şu hatayı üretiyordu:

```text
inconsistent types deduced for parameter $5
```

## Düzeltme

- SmartAI rapor kayıt sorgusundaki bütün parametreler birbirinden ayrıldı.
- UUID, date, integer, text ve JSONB parametrelerine açık PostgreSQL cast ifadeleri eklendi.
- `report_date`, `period_start` ve `period_end` ayrı parametrelerle kaydedilir hale getirildi.
- Rapor metni ile JSON içeriğinin tekrar kullanılan placeholder değerleri kaldırıldı.
- Uygulama ve Admin Panel sürümü v6.5.2 olarak güncellendi.

## Etkilenen Dosyalar

```text
platform/backend/server.js
platform/backend/public/admin.html
```
