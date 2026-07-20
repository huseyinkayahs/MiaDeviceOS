
# MiaDeviceOS / FactoryBox One v5.0.1 Hotfix

## Sprint Adı

v5.0.1 Invite Accept bcrypt Fix

---

## Amaç

v5.0 Invite User / Tenant Access Pack testinde davet kabul ekranında oluşan bcrypt hatasını düzeltmek.

---

## Sorun

Davet linki doğru açılıyordu:

```text
FactoryBox Davet Kabul
Email
Role
Customer
Site
```

Fakat şifre girip **Daveti Kabul Et** butonuna basıldığında backend şu hatayı döndürüyordu:

```text
bcrypt is not defined
```

---

## Kök Sebep

`POST /api/invites/:token/accept` endpoint'i şifreyi hashlemek için:

```text
bcrypt.hash(...)
```

kullanıyordu fakat `server.js` içinde bcrypt import edilmemişti.

---

## Düzeltme

Backend'e bcrypt import eklendi.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js

KURULUM_V5_0_1.txt
docs/V5_0_1_INVITE_ACCEPT_BCRYPT_FIX.md
```

---

## Test Beklentisi

```text
Davet kabul edildi. Dashboard açılıyor...
```

Sonrasında:

```text
Invites status: accepted
Users içinde yeni kullanıcı
Tenant Access içinde yeni erişim
Activity History içinde accept_user_invite
```
