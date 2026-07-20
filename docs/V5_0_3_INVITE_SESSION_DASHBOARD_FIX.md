
# MiaDeviceOS / FactoryBox One v5.0.3 Hotfix

## Sprint Adı

v5.0.3 Invite Session Dashboard Fix

---

## Amaç

Davet kabul edildikten sonra dashboard açıldığında kullanıcı login olmuş olsa bile SaaS Foundation alanlarının boş görünmesi sorununu düzeltmek.

---

## Sorun

Davet kabul başarılıydı ve dashboard açılıyordu.

Fakat dashboard:

```text
AUTH MODE: -
USER: -
CUSTOMER: -
SITE: -
```

gibi görünüyordu.

Üst sağda:

```text
Hata
```

yazıyordu.

---

## Kök Sebep

Dashboard refresh akışında login/tenant bilgisi en başta alınmasına rağmen ekrana en sonda yazılıyordu.

Aradaki site/machine API çağrılarından biri hata verince `catch` çalışıyor ve tenant bilgisi hiç render edilmiyordu.

---

## Düzeltme

Frontend tarafı:

```text
Tenant bilgisi ilk aşamada ekrana yazılır
siteCode tenant current_site üzerinden dinamik seçilir
safeJson eklendi
Kısmi API hataları tüm dashboard'u bozmaz
```

Backend tarafı:

```text
Customer-level tenant access, customer altındaki sitelere genişletildi
siteAccessRequired customer-level erişimi dikkate alır hale getirildi
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/admin.html

KURULUM_V5_0_3.txt
docs/V5_0_3_INVITE_SESSION_DASHBOARD_FIX.md
```

---

## Test Beklentisi

Davetli kullanıcı dashboard'a girdiğinde SaaS Foundation bölümünde:

```text
AUTH_ENABLED=true
USER: davet edilen email
CUSTOMER: davet edilen customer
SITE: varsa customer altındaki site
```

görünmelidir.

Bazı site verileri eksikse üst durum:

```text
Kısmi
```

olabilir. Bu login hatası değildir.
