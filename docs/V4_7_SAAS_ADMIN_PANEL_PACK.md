# MiaDeviceOS / FactoryBox One v4.7 Sprint

## Sprint Adı

v4.7 SaaS Admin Panel Pack

---

## Amaç

Bu sprintin amacı, v4.6 ve v4.6.1 ile gelen login, signup ve tenant altyapısının üstüne ilk SaaS admin panelini eklemektir.

---

## Ana Kazanım

FactoryBox artık signup ile oluşan kullanıcıları, müşterileri, siteleri ve tenant access kayıtlarını tek admin ekranında gösterebilir.

---

## Eklenen Backend Endpointleri

```text
GET /api/admin/overview
GET /api/admin/users
GET /api/admin/customers
GET /api/admin/sites
GET /api/admin/tenant-access
```

---

## Yeni UI

```text
platform/backend/public/admin.html
```

URL:

```text
http://localhost:3100/admin.html
```

---

## Dashboard Güncellemesi

SaaS Foundation kartına link eklendi:

```text
Admin Panel
```

---

## Admin Yetki Kontrolü

AUTH_ENABLED=true olduğunda admin endpointleri login ister.

İzin verilen roller:

```text
owner
admin
system_admin
```

AUTH_ENABLED=false olduğunda local geliştirme kolaylığı için admin endpointleri açık kalır.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/index.html
platform/backend/public/admin.html
platform/backend/public/styles.css
platform/database/migrations/010_saas_admin_panel_pack.sql

KURULUM_V4_7.txt
docs/V4_7_SAAS_ADMIN_PANEL_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Kullanıcı silme/düzenleme yapılmadı
Customer/site düzenleme yapılmadı
Role değiştirme yapılmadı
Davet sistemi yapılmadı
Şifre sıfırlama yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.7 ile FactoryBox SaaS tarafında görünür bir admin panel seviyesine geldi.
