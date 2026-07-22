
# MiaDeviceOS / FactoryBox One v5.2 Sprint

## Sprint Adı

v5.2 Role Based Permission Pack

---

## Amaç

Bu sprintin amacı, FactoryBox SaaS içinde kullanılan rollerin gerçek yetkilere bağlanmasıdır.

---

## Ana Kazanım

FactoryBox artık sadece `role` bilgisini saklamıyor; role göre backend endpointlerini koruyor ve admin panel aksiyonlarını gizliyor/kısıtlıyor.

---

## Rol Yetki Matrisi

```text
system_admin:
  tüm yetkiler

owner:
  ADMIN_VIEW
  MANAGE_USERS
  MANAGE_CUSTOMERS
  MANAGE_SITES
  MANAGE_INVITES
  AUDIT_VIEW
  SEND_REPORTS
  VIEW_REPORTS
  VIEW_DASHBOARD

admin:
  ADMIN_VIEW
  MANAGE_CUSTOMERS
  MANAGE_SITES
  MANAGE_INVITES
  AUDIT_VIEW
  SEND_REPORTS
  VIEW_REPORTS
  VIEW_DASHBOARD

operator:
  SEND_REPORTS
  VIEW_REPORTS
  VIEW_DASHBOARD

viewer:
  VIEW_REPORTS
  VIEW_DASHBOARD
```

---

## Yeni Backend Yapıları

```text
ROLE_PERMISSIONS
getRolePermissions()
hasPermission()
publicPermissions()
permissionRequired()
assertRoleChangeAllowed()
```

---

## Yeni Backend Endpoint

```text
GET /api/admin/permissions
```

Bu endpoint aktif admin kullanıcısının rolünü ve yetkilerini döndürür.

---

## Korunan Backend Endpointleri

```text
PATCH /api/admin/users/:id/status          → MANAGE_USERS
PATCH /api/admin/users/:id/role            → MANAGE_USERS
PATCH /api/admin/customers/:code/status    → MANAGE_CUSTOMERS
PATCH /api/admin/sites/:customerCode/:siteCode/status → MANAGE_SITES

GET  /api/admin/audit-logs                 → AUDIT_VIEW

GET  /api/admin/invites                    → MANAGE_INVITES
POST /api/admin/invites                    → MANAGE_INVITES
POST /api/admin/invites/:id/email          → MANAGE_INVITES
POST /api/admin/invites/:id/cancel         → MANAGE_INVITES
```

---

## Report Permission

Site AI rapor üretim/gönderim tarzı aksiyonlar için:

```text
SEND_REPORTS
```

kontrolü eklendi.

Viewer rolünde bu yetki yoktur.

---

## Admin Panel Güncellemesi

Admin panelde yeni bölüm eklendi:

```text
Permission Overview
```

Panelde şu bilgiler görünür:

```text
Aktif user
Role
ADMIN_VIEW
MANAGE_USERS
MANAGE_INVITES
SEND_REPORTS
Tüm permission listesi
```

Admin panel butonları da role göre gösterilir:

```text
MANAGE_USERS yoksa kullanıcı rol/status butonları görünmez
MANAGE_CUSTOMERS yoksa customer kaydet görünmez
MANAGE_SITES yoksa site kaydet görünmez
MANAGE_INVITES yoksa davet bölümü gizlenir
AUDIT_VIEW yoksa audit log bölümü gizlenir
```

---

## Güvenlik Ekleri

```text
Kullanıcı kendi aktif admin hesabını inactive/suspended yapamaz
system_admin rolünü sadece system_admin verebilir
owner rolünü sadece owner/system_admin verebilir
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js

platform/backend/public/admin.html
platform/backend/public/invite.html
platform/backend/public/index.html
platform/backend/public/app.js
platform/backend/public/login.html
platform/backend/public/signup.html
platform/backend/public/styles.css

platform/database/migrations/015_role_based_permission_pack.sql

KURULUM_V5_2.txt
docs/V5_2_ROLE_BASED_PERMISSION_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Sayfa bazlı ayrı frontend route guard yapılmadı
Detaylı müşteri bazlı custom permission yapılmadı
Permission matrix database'e taşınmadı
Audit log export yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v5.2 ile FactoryBox SaaS yapısı production seviyesine bir adım daha yaklaştı.

Artık roller sadece isim değil, gerçek backend ve UI yetkisi haline geldi.
