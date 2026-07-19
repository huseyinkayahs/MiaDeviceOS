
# MiaDeviceOS / FactoryBox One v4.6 Sprint

## Sprint Adı

v4.6 SaaS Foundation Pack

---

## Amaç

Bu sprintin amacı, FactoryBox'ı tek atölye panelinden çok müşterili SaaS altyapısına hazırlamaktır.

---

## Birleştirilen Sprintler

Bu sprintte 3 sprint birleştirildi:

```text
1) User Login altyapısı
2) Customer / Tenant yapısı
3) Dashboard erişim ayrımı temeli
```

---

## Ana Kazanım

FactoryBox artık sadece tek müşterili lokal dashboard yapısından çıkıp, kullanıcı ve tenant bağlamı olan SaaS altyapısına geçiş yaptı.

Yeni temel yapı:

```text
User
↓
Customer / Tenant
↓
Site
↓
Machine
↓
Dashboard / API Access
```

---

## Eklenen Backend Endpointleri

Auth status:

```text
GET /api/auth/status
```

Mevcut kullanıcı:

```text
GET /api/auth/me
```

Login:

```text
POST /api/auth/login
```

Logout:

```text
POST /api/auth/logout
```

Tenant context:

```text
GET /api/tenant/context
```

Tenant customers/sites:

```text
GET /api/tenant/customers
```

---

## Yeni Database Tabloları

```text
app_users
app_user_tenant_access
```

Bu tablolar kullanıcıları ve hangi customer/site erişimine sahip olduklarını tutar.

---

## Dashboard Güncellemesi

Dashboard’a yeni bölüm eklendi:

```text
SaaS Foundation
```

Bu bölümde:

```text
Auth Mode
User
Customer
Site
Login Ekranı
Logout
Tenant Context
```

görünür.

---

## Login Ekranı

Yeni dosya:

```text
platform/backend/public/login.html
```

URL:

```text
http://localhost:3100/login.html
```

---

## .env Alanları

```text
AUTH_ENABLED=false
FACTORYBOX_ADMIN_EMAIL=admin@factorybox.local
FACTORYBOX_ADMIN_PASSWORD=FactoryBox123!
FACTORYBOX_ADMIN_ROLE=owner
AUTH_SESSION_HOURS=12
```

Başlangıçta AUTH_ENABLED=false bırakılabilir. Böylece mevcut dashboard bozulmaz.

Login test edilecekse:

```text
AUTH_ENABLED=true
```

yapılır.

---

## Erişim Kontrolü Temeli

AUTH_ENABLED=true olduğunda:

```text
/api endpointleri login ister
/api/auth/* public kalır
/api/health public kalır
/api/sites/:siteCode route’larında site erişim kontrolü temeli çalışır
```

---

## Teknik Yaklaşım

Bu sprintte ek dependency eklenmedi.

Şifre hashleme için Node.js crypto PBKDF2 kullanıldı.

Session token backend memory içinde tutulur.

Bu yapı production için ilk temel olup, ileride şu alanlar güçlendirilecektir:

```text
persistent session table
role based access control
customer admin panel
user management UI
tenant invitation flow
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/login.html
platform/backend/public/styles.css
platform/backend/.env.auth.example
platform/database/migrations/008_saas_foundation_pack.sql

KURULUM_V4_6.txt
docs/V4_6_SAAS_FOUNDATION_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Tam kullanıcı yönetim ekranı yapılmadı
Rol bazlı detaylı yetkilendirme yapılmadı
Şifre sıfırlama yapılmadı
Davet sistemi yapılmadı
Çoklu müşteri yönetim paneli yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.6 ile FactoryBox, çok müşterili SaaS mimarisi için ilk gerçek temelini aldı.
