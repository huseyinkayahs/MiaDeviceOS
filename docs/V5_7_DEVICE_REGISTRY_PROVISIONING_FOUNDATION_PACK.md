# FactoryBox One v5.7.0

## Device Registry / Provisioning Foundation Pack

Bu sprint, FactoryBox cihazlarının SaaS tenant yapısına güvenli şekilde bağlanması için temel altyapıyı ekler.

## Eklenenler

- Admin panelde Device Registry / Provisioning bölümü
- Cihaz listesi ve durum yönetimi
- Tek kullanımlık provisioning token üretimi
- Token hash saklama
- Token süre sınırı
- Public cihaz claim endpoint'i
- Cihaz limitinin abonelik kotasına bağlanması
- Cihaz işlemleri için audit log kayıtları

## Endpointler

```text
GET  /api/admin/devices
POST /api/admin/devices/provision-token
PATCH /api/admin/devices/:uid/status
POST /api/device/provision/claim
```

## Güvenlik

Provisioning token sadece oluşturulduğu anda response içinde gösterilir. Veritabanına token'ın kendisi değil, SHA-256 hash değeri kaydedilir.
