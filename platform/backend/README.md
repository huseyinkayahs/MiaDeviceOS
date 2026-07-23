# FactoryBox Platform Backend MVP

Amaç:

```text
MQTT mesajlarını dinlemek
PostgreSQL'e kayıt atmak
Basit REST API açmak
Platform dashboard sayfası sunmak
```

## Kurulum

Önce PostgreSQL:

```powershell
cd platform\database
docker compose up -d
```

Sonra backend:

```powershell
cd platform\backend
copy .env.example .env
npm.cmd install
npm.cmd start
```

Açılacak adres:

```text
http://localhost:3100
```

API:

```text
GET /api/health
GET /api/machines
GET /api/machines/laser01/status
GET /api/machines/laser01/telemetry/latest
GET /api/machines/laser01/daily-summary
GET /api/machines/laser01/alarms
GET /api/machines/laser01/events
```


## v3.6 SmartAI Daily Report

Yeni endpoint:

```text
GET /api/machines/laser01/ai/daily-report
```

Tarayıcı:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report
```

Veritabanına kayıt denemesi için:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report?save=true
```

Dashboard:

```text
http://localhost:3100
```

## v5.9.0 Admin Dashboard KPI / System Snapshot Pack

```text
GET /api/subscription/current
GET /api/subscription/access-check
GET /api/subscription/quota-check/users?additional=1
GET /api/subscription/quota-check/sites?additional=1
GET /api/subscription/quota-check/devices?additional=1
```

Aktif enforcement:

```env
SUBSCRIPTION_ENFORCEMENT_ENABLED=true
```

`expired`, `cancelled` veya `past_due` tenant için `/api/machines`, `/api/sites` ve `/api/devices` operasyonları engellenir. Kullanıcı davetleri plan limitine göre kontrol edilir.


## v5.7 Device Registry / Provisioning

Admin panel üzerinden cihaz listesi, cihaz durum yönetimi ve tek kullanımlık provisioning token üretimi desteklenir.


## v5.11.0 Asset Management / Tenant Site Machine Pack

Bu sürümde admin panel üzerinden customer, site ve machine kayıtları daha düzenli yönetilebilir hale getirildi.

- Customer oluşturma ve düzenleme
- Site oluşturma, düzenleme ve site quota kontrolü
- Machine oluşturma ve düzenleme
- Machine listesi ve durum yönetimi
- Asset işlemlerinin audit log'a yazılması
