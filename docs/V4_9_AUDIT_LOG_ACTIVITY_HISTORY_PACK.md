
# MiaDeviceOS / FactoryBox One v4.9 Sprint

## Sprint Adı

v4.9 Audit Log / Activity History Pack

---

## Amaç

Bu sprintin amacı, SaaS Admin Panel üzerinde yapılan yönetim aksiyonlarını kayıt altına almaktır.

---

## Ana Kazanım

FactoryBox artık admin tarafından yapılan değişiklikleri geçmiş olarak tutar.

Cevaplanan sorular:

```text
Kim değiştirdi?
Neyi değiştirdi?
Ne zaman değiştirdi?
Eski değer neydi?
Yeni değer ne oldu?
```

---

## Yeni Database Tablosu

```text
admin_audit_logs
```

Alanlar:

```text
actor_user_id
actor_email
actor_role
action
entity_type
entity_id
old_values
new_values
metadata
ip_address
user_agent
created_at
```

---

## Yeni Backend Endpoint

```text
GET /api/admin/audit-logs
```

---

## Audit Kaydı Oluşturan Aksiyonlar

```text
PATCH /api/admin/users/:id/status
PATCH /api/admin/users/:id/role
PATCH /api/admin/customers/:code/status
PATCH /api/admin/sites/:customerCode/:siteCode/status
```

---

## Admin Panel Güncellemesi

Admin panelde yeni bölüm eklendi:

```text
Activity History / Audit Log
```

Ayrıca overview kartlarına:

```text
Audit Logs
```

sayacı eklendi.

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/admin.html
platform/backend/public/styles.css
platform/database/migrations/012_audit_log_activity_history_pack.sql

KURULUM_V4_9.txt
docs/V4_9_AUDIT_LOG_ACTIVITY_HISTORY_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
Audit log silme yapılmadı
Audit log filtreleme arayüzü yapılmadı
CSV export yapılmadı
Detaylı role based permission yapılmadı
ESP32 firmware değiştirilmedi
```

---

## Sonuç

v4.9 ile FactoryBox, SaaS yönetim aksiyonlarını izlenebilir hale getirerek production mimarisine bir adım daha yaklaştı.
