
# MiaDeviceOS / FactoryBox One v4.8 Sprint

## Sprint Adı

v4.8 SaaS Management Actions Pack

---

## Amaç

Bu sprintin amacı, v4.7 ile gelen SaaS Admin Panel'i sadece görüntüleme ekranından temel yönetim aksiyonları yapabilen bir admin paneline dönüştürmektir.

---

## Ana Kazanım

FactoryBox artık admin panel üzerinden kullanıcı, customer ve site durumlarını yönetebilir.

---

## Eklenen Backend Endpointleri

Kullanıcı status güncelleme:

```text
PATCH /api/admin/users/:id/status
```

Kullanıcı rol güncelleme:

```text
PATCH /api/admin/users/:id/role
```

Customer status güncelleme:

```text
PATCH /api/admin/customers/:code/status
```

Site status güncelleme:

```text
PATCH /api/admin/sites/:customerCode/:siteCode/status
```

---

## Admin Panel Güncellemesi

Admin panelde artık şu aksiyonlar var:

```text
Kullanıcı rol seçimi
Kullanıcı status seçimi
Customer status seçimi
Site status seçimi
Kaydet butonları
```

---

## Desteklenen Roller

```text
viewer
operator
admin
owner
system_admin
```

---

## Desteklenen Status Değerleri

Kullanıcı için:

```text
active
inactive
suspended
```

Customer/site için:

```text
trial
pilot
active
inactive
suspended
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/admin.html
platform/backend/public/styles.css
platform/database/migrations/011_saas_management_actions_pack.sql

KURULUM_V4_8.txt
docs/V4_8_SAAS_MANAGEMENT_ACTIONS_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Kullanıcı silme yapılmadı
Customer/site silme yapılmadı
Role bazlı detaylı sayfa izinleri yapılmadı
Davet sistemi yapılmadı
Şifre sıfırlama yapılmadı
Audit log yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.8 ile FactoryBox SaaS Admin Panel, sadece izleme değil temel yönetim aksiyonları da yapabilen bir yapıya geçti.
