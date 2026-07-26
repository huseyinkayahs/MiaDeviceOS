# FactoryBox One v5.22.0 — Preventive Maintenance Scheduler & Work Orders

## Amaç

v5.22.0, arıza oluşmasını beklemeden makine bakımlarının planlanmasını ve zamanı gelen planlardan otomatik iş emri oluşturulmasını sağlar.

## Yeni Admin Menü Yapısı

```text
Maintenance
├─ Service Tickets
├─ Maintenance Plans
└─ Work Orders
```

## Bakım Planları

Bakım planları aşağıdaki periyotlarla oluşturulabilir:

- Günlük
- Haftalık
- Aylık
- Makinenin toplam çalışma saati

Her plan için makine, kategori, öncelik, periyot, sonraki bakım zamanı, hatırlatma günü, teknisyen/ekip, tahmini süre, bildirim kanalı ve kontrol listesi tanımlanabilir.

## Otomatik Scheduler

Scheduler etkin olduğunda belirlenen saniye aralığında aktif bakım planlarını tarar.

```text
Plan yaklaşan/geciken duruma gelir
→ Aktif iş emri kontrol edilir
→ Aynı plan için açık iş emri yoksa yeni iş emri oluşturulur
→ Seçilen Telegram/Email kanalıyla hatırlatma gönderilir
```

Aynı bakım planı için eş zamanlı birden fazla aktif iş emri oluşturulması veritabanı seviyesinde engellenir.

## İş Emirleri

İş emri durumları:

```text
scheduled
open
in_progress
waiting
completed
cancelled
```

İş emrinde teknisyen, termin, öncelik, kontrol listesi, gerçek bakım süresi, kullanılan parçalar ve tamamlanma notu saklanır.

İş emri tamamlandığında ilgili planın:

- Son bakım zamanı
- Son bakım çalışma saati
- Son iş emri
- Sonraki bakım tarihi veya çalışma saati hedefi

otomatik güncellenir.

## API'ler

```text
GET   /api/admin/maintenance-plans
POST  /api/admin/maintenance-plans
PATCH /api/admin/maintenance-plans/:id
POST  /api/admin/maintenance-plans/:id/generate-work-order
PATCH /api/admin/maintenance-scheduler
POST  /api/admin/maintenance-scheduler/run-now
GET   /api/admin/maintenance-work-orders
PATCH /api/admin/maintenance-work-orders/:id
POST  /api/admin/maintenance-work-orders/:id/notes
GET   /api/admin/maintenance-work-orders/:id/history
```

## Veritabanı Tabloları

```text
maintenance_scheduler_settings
maintenance_plans
maintenance_work_orders
maintenance_work_order_events
maintenance_scheduler_runs
maintenance_notification_deliveries
```

## Yetkiler

Görüntüleme için `VIEW_MAINTENANCE`, oluşturma ve güncelleme için `MANAGE_MAINTENANCE` yetkisi kullanılır.
