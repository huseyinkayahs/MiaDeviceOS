# FactoryBox One v5.6.0

## Sprint Adı

v5.6.0 Audit Log / Security Activity Viewer Pack

---

## Amaç

Bu sprintin amacı, FactoryBox SaaS admin panelinde güvenlik ve yönetim aktivitelerinin daha kolay izlenmesini sağlamaktır.

v5.5 ile abonelik ve limit kontrolleri gerçek operasyonlara bağlandı. v5.6 ile bu aksiyonların kim tarafından, ne zaman ve hangi kayıt üzerinde yapıldığını izlemek daha pratik hale getirildi.

---

## Gelen Özellikler

```text
Security Activity / Audit Log ekranı
Audit log özet sayaçları
Action, entity, actor ve tarih filtreleri
Serbest arama filtresi
CSV dışa aktarım
Login success / failed kayıtları
Logout kayıtları
Signup owner created kayıtları
Audit log summary API
Audit log CSV export API
Audit log performans indeksleri
```

---

## Yeni Endpointler

```text
GET /api/admin/audit-logs/summary
GET /api/admin/audit-logs
GET /api/admin/audit-logs/export.csv
```

Desteklenen query parametreleri:

```text
q
action
entity_type
actor_email
from
to
limit
```

Örnek:

```text
/api/admin/audit-logs?action=login_failed&limit=100
/api/admin/audit-logs?entity_type=subscription&from=2026-07-01&to=2026-07-22
```

---

## Admin Panel Değişikliği

Audit Log bölümü artık Security Activity olarak kullanılabilir.

```text
Toplam log sayısı
Son 24 saat log sayısı
Son 7 gün log sayısı
Actor sayısı
Action dağılımı
Entity dağılımı
Filtrelenmiş audit log tablosu
CSV indirme
```

---

## .env Ayarı

```env
AUDIT_EXPORT_ENABLED=true
```

`false` yapılırsa CSV export kapanır; panelde görüntüleme devam eder.

---

## Test

```text
Backend version 5.6.0 döndü
Audit export enabled true döndü
Admin panel Security Activity bölümü açıldı
Filtreleme çalıştı
CSV dosyası indirildi
Login success / failed aktiviteleri audit loga yazıldı
```
