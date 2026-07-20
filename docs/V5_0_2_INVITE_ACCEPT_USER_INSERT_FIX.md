
# MiaDeviceOS / FactoryBox One v5.0.2 Hotfix

## Sprint Adı

v5.0.2 Invite Accept User Insert Fix

---

## Amaç

v5.0 Invite User / Tenant Access Pack içinde davet kabul sırasında yeni kullanıcı oluşturma hatasını düzeltmek.

---

## Sorun

Davet linki açılıyordu ve form görünüyordu. Fakat **Daveti Kabul Et** butonuna basıldığında backend şu hatayı döndürüyordu:

```text
null value in column "id" of relation "app_users" violates not-null constraint
```

---

## Kök Sebep

Yeni kullanıcı insert sorgusunda `app_users.id` alanı gönderilmiyordu.

Ayrıca `app_users.password_salt` alanı da schema gereği zorunlu olduğu için davet kabul akışı mevcut FactoryBox şifreleme yapısına uyarlanmalıydı.

---

## Düzeltme

Davet kabul endpoint'i şu yapıya geçirildi:

```text
makeUserId()
makeSalt()
hashPassword()
authSessions.set(...)
getTenantContextForUser(...)
```

Böylece davet kabul edildiğinde:

```text
app_users doğru oluşur
password_hash ve password_salt dolu olur
tenant access yazılır
invite accepted olur
user session açılır
dashboard'a yönlenir
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js

KURULUM_V5_0_2.txt
docs/V5_0_2_INVITE_ACCEPT_USER_INSERT_FIX.md
```

---

## Test Beklentisi

```text
Davet kabul edildi. Dashboard açılıyor...
```

Admin panelde:

```text
Invites status: accepted
Users içinde yeni kullanıcı
Tenant Access içinde yeni erişim
Activity History içinde accept_user_invite
```
