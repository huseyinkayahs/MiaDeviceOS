
# MiaDeviceOS / FactoryBox One v5.0 Sprint

## Sprint Adı

v5.0 Invite User / Tenant Access Pack

---

## Amaç

Bu sprintin amacı, FactoryBox SaaS yapısında admin panelden yeni kullanıcı daveti oluşturmak ve kullanıcıya customer/site erişimi verebilmektir.

---

## Ana Kazanım

FactoryBox artık tek kullanıcılı SaaS temelinden çok kullanıcılı tenant erişim sistemine geçiş yaptı.

Yeni akış:

```text
Admin Panel
↓
Invite User
↓
Davet linki oluşturulur
↓
Kullanıcı invite.html üzerinden kabul eder
↓
app_users oluşturulur/güncellenir
↓
app_user_tenant_access yazılır
↓
Audit log kaydı oluşur
```

---

## Yeni Database Tablosu

```text
user_invites
```

Alanlar:

```text
invite_token
email
full_name
role
customer_code
site_code
status
invited_by_email
accepted_user_id
accepted_at
expires_at
created_at
updated_at
```

---

## Yeni Backend Endpointleri

```text
GET /api/admin/invites
POST /api/admin/invites
POST /api/admin/invites/:id/cancel

GET /api/invites/:token
POST /api/invites/:token/accept
```

---

## Admin Panel Güncellemesi

Admin panelde yeni bölüm eklendi:

```text
Invite User / Tenant Access
```

Bu bölümde:

```text
Email
Ad Soyad
Role
Customer Code
Site Code
Davet Oluştur
Davet linki kopyalama
Davet iptal etme
```

bulunur.

---

## Davet Kabul Ekranı

Yeni dosya:

```text
platform/backend/public/invite.html
```

Kullanım:

```text
http://localhost:3100/invite.html?token=...
```

---

## Audit Log Entegrasyonu

Aşağıdaki aksiyonlar audit log’a yazılır:

```text
create_user_invite
cancel_user_invite
accept_user_invite
```

---

## Desteklenen Roller

```text
viewer
operator
admin
owner
```

---

## Tenant Access Davranışı

Site Code boş bırakılırsa:

```text
customer seviyesinde erişim
site_code = null
```

Site Code girilirse:

```text
belirli site erişimi
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js

platform/backend/public/admin.html
platform/backend/public/invite.html
platform/backend/public/login.html
platform/backend/public/index.html
platform/backend/public/app.js
platform/backend/public/signup.html
platform/backend/public/styles.css

platform/database/migrations/013_invite_user_tenant_access_pack.sql

KURULUM_V5_0.txt
docs/V5_0_INVITE_USER_TENANT_ACCESS_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Gerçek email gönderimi yapılmadı
Şifre sıfırlama yapılmadı
Davet email şablonu yapılmadı
Detaylı role based permission yapılmadı
Davet süresi admin panelden değiştirilebilir yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v5.0 ile FactoryBox SaaS yapısı, admin tarafından yönetilen çok kullanıcılı tenant erişimine geçti.
