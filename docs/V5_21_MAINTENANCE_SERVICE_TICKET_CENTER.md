# FactoryBox One v5.21.0 — Maintenance & Service Ticket Center

## Amaç

Makine bakım ve servis taleplerini tek merkezde açmak, alarm kayıtlarıyla ilişkilendirmek, sorumlu ve termin atamak ve ticket kapanana kadar tüm hareketleri izlemek.

## Admin Panel

```text
Maintenance & Tickets
```

Alarm bağlantılı ticket için:

```text
Alarm
  └─ Alarm Center
       └─ Ticket Aç
```

## Özellikler

```text
Manuel bakım ticketı oluşturma
Alarmdan otomatik ticket oluşturma
Makine, site ve customer bağlantısı
Alarm ID ve alarm tipi bağlantısı
Preventive / Corrective / Inspection kategorileri
Electrical / Mechanical / Software / Safety kategorileri
Low / Medium / High / Critical öncelikleri
Open / In Progress / Waiting durumları
Resolved / Closed / Cancelled durumları
Assignee yönetimi
Termin tarihi yönetimi
Geciken ticket tespiti
Kritik aktif ticket sayacı
Atanmamış ticket sayacı
30 günlük tamamlanan ticket sayacı
Ticket notları
Ticket durum ve işlem geçmişi
Aynı alarm için aktif ticket tekrar engeli
Audit log kaydı
```

## Yeni Yetkiler

```text
VIEW_MAINTENANCE
MANAGE_MAINTENANCE
```

- `viewer`: Sadece ticket görüntüleme ve geçmiş.
- `operator`, `admin`, `owner`, `system_admin`: Ticket oluşturma ve güncelleme.

## Yeni API'ler

```text
GET   /api/admin/maintenance-tickets
POST  /api/admin/maintenance-tickets
POST  /api/admin/maintenance-tickets/from-alarm/:alarmId
PATCH /api/admin/maintenance-tickets/:id
POST  /api/admin/maintenance-tickets/:id/notes
GET   /api/admin/maintenance-tickets/:id/history
```

Manuel ticket örneği:

```json
{
  "title": "Lazer egzoz fanı kontrolü",
  "machine_id": "1",
  "category": "electrical",
  "priority": "high",
  "assignee": "Bakım Ekibi",
  "due_at": "2026-07-27T12:00:00.000Z",
  "description": "Fan debisi ve elektrik bağlantısı kontrol edilecek."
}
```

Ticket güncelleme örneği:

```json
{
  "status": "in_progress",
  "priority": "high",
  "assignee": "Bakım Ekibi",
  "due_at": "2026-07-27T12:00:00.000Z"
}
```

## Veritabanı

Yeni tablolar:

```text
maintenance_tickets
maintenance_ticket_events
```

Şema güncellemeleri backend başlatılırken otomatik uygulanır.
