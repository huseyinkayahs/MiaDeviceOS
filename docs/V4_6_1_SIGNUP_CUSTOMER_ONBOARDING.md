
# MiaDeviceOS / FactoryBox One v4.6.1 Sprint

## Sprint Adı

v4.6.1 Sign Up / Customer Onboarding Pack

---

## Amaç

Bu sprintin amacı, v4.6 ile gelen login ve tenant temelinin üzerine kontrollü kayıt ol / müşteri onboarding akışı eklemektir.

---

## Ana Kazanım

FactoryBox artık sadece admin tarafından tanımlanmış kullanıcıyla değil, kontrollü şekilde yeni müşteri ve site oluşturabilecek kayıt akışına da sahiptir.

Yeni onboarding akışı:

```text
Kullanıcı kayıt olur
↓
Customer oluşturulur
↓
Site oluşturulur
↓
İlk kullanıcı owner yapılır
↓
Tenant access kaydı açılır
↓
Session token oluşturulur
↓
Dashboard açılır
```

---

## Yeni Backend Endpointi

```text
POST /api/auth/signup
```

---

## Yeni UI

```text
platform/backend/public/signup.html
```

URL:

```text
http://localhost:3100/signup.html
```

---

## Yeni .env Ayarı

```text
SIGNUP_ENABLED=false
```

Kayıt ekranını açmak için:

```text
SIGNUP_ENABLED=true
```

---

## Güvenlik Yaklaşımı

Public sign up kontrolsüz açık bırakılmadı. Kayıt akışı environment flag ile kontrol edilir.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/login.html
platform/backend/public/signup.html
platform/backend/public/styles.css
platform/backend/.env.signup.example
platform/database/migrations/009_signup_customer_onboarding.sql

KURULUM_V4_6_1.txt
docs/V4_6_1_SIGNUP_CUSTOMER_ONBOARDING.md
```

---

## Bu Sprintte Yapılmayanlar

```text
E-posta doğrulama yapılmadı
Şifre sıfırlama yapılmadı
Tenant invite sistemi yapılmadı
Captcha / anti-spam yapılmadı
Ödeme / abonelik başlatma yapılmadı
Admin kullanıcı yönetim ekranı yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.6.1 ile FactoryBox, müşteri onboarding ve SaaS kayıt akışı için ilk gerçek adımı aldı.
