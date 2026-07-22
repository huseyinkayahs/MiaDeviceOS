
# MiaDeviceOS / FactoryBox One v5.1 Sprint

## Sprint Adı

v5.1 Email Invite Delivery Pack

---

## Amaç

Bu sprintin amacı, v5.0 ile oluşturulan davet linklerini admin panelden otomatik e-posta ile gönderebilmektir.

---

## Ana Kazanım

FactoryBox artık kullanıcı davet linklerini sadece manuel kopyalamakla kalmaz, e-posta olarak da gönderebilir.

Yeni akış:

```text
Admin Panel
↓
Invite User
↓
Davet oluşturulur
↓
Mail otomatik gönderilir
↓
Mail gönderim sonucu kaydedilir
↓
Activity History güncellenir
```

---

## Database Güncellemesi

`user_invites` tablosuna şu alanlar eklendi:

```text
email_sent_at
email_message_id
email_last_error
```

---

## Yeni Backend Davranışı

`POST /api/admin/invites` artık şu alanı destekler:

```text
send_email: true / false
```

Yeni endpoint:

```text
POST /api/admin/invites/:id/email
```

Bu endpoint pending davet için davet mailini tekrar gönderir.

---

## Email Şablonu

Profesyonel HTML davet maili eklendi.

Mail içinde:

```text
Davet edilen kullanıcı
Rol
Customer
Site
Daveti Kabul Et butonu
Manuel token linki
```

bulunur.

---

## Admin Panel Güncellemesi

Invite User / Tenant Access bölümünde:

```text
Mail Gönder checkbox
Davet Oluştur + Mail butonu
Mail Gönder butonu
Mail gönderim durumu
```

eklendi.

---

## Audit Log Entegrasyonu

Şu aksiyon Activity History’ye yazılır:

```text
send_user_invite_email
```

---

## SMTP Kullanımı

Bu sprint mevcut Email Report Delivery altyapısını kullanır.

Gerekli ayarlar:

```text
EMAIL_REPORTS_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=...
SMTP_PASS=Google uygulama şifresi
SMTP_FROM=...
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

platform/database/migrations/014_email_invite_delivery_pack.sql

KURULUM_V5_1.txt
docs/V5_1_EMAIL_INVITE_DELIVERY_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Email queue yapılmadı
Mail retry scheduler yapılmadı
Mail template editörü yapılmadı
Davet süresi admin panelden değiştirilebilir yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v5.1 ile FactoryBox SaaS onboarding akışı daha profesyonel hale geldi.

Artık admin yeni kullanıcıyı davet ederken linki e-posta ile gönderebilir.
