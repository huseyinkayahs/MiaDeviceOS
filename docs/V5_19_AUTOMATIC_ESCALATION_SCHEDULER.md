# FactoryBox One v5.19.0 — Automatic Escalation Scheduler

## Amaç

Alarm SLA taraması, escalation kuyruğu, Telegram/Email teslimatı ve başarısız gönderim retry sürecini tek otomatik scheduler altında toplar.

## Akış

```text
Aktif Alarm
→ SLA taraması
→ Escalation olayı oluşturma
→ Pending kuyruğu
→ Telegram / Email teslimatı
→ Delivered
```

Başarısız teslimatta:

```text
Failed
→ Exponential backoff
→ Otomatik tekrar kuyruğa alma
→ Yeniden gönderim
→ Maksimum deneme aşılırsa Dead Letter
```

## Admin Panel

```text
System Settings
  ├─ Notifications
  └─ Automation Scheduler
```

Automation Scheduler ekranında:

- Scheduler açık/kapalı durumu
- Çalışma aralığı
- Son ve sonraki çalışma zamanı
- Otomatik retry açık/kapalı durumu
- İlk retry bekleme süresi
- Maksimum retry bekleme süresi
- Maksimum deneme sayısı
- Pending, retry due ve Dead Letter sayaçları
- Son 20 scheduler çalışma kaydı
- Şimdi Çalıştır işlemi

## Yeni API Uçları

```text
GET   /api/admin/automation-scheduler
PATCH /api/admin/automation-scheduler
POST  /api/admin/automation-scheduler/run-now
```

## Varsayılanlar

```text
Scheduler Enabled: false
Scheduler Interval: 60 saniye
Automatic Retry: true
Retry Base Delay: 60 saniye
Retry Max Delay: 3600 saniye
Retry Max Attempts: 5
```

Scheduler varsayılan olarak kapalıdır. Admin panelinden açıldıktan sonra çalışma planı backend yeniden başlatılmadan etkinleşir.

## Retry Backoff Örneği

60 saniye başlangıç ve 3600 saniye üst sınır için:

```text
1. başarısız deneme → 60 saniye
2. başarısız deneme → 120 saniye
3. başarısız deneme → 240 saniye
4. başarısız deneme → 480 saniye
5. başarısız deneme → Dead Letter
```

## Veritabanı

Mevcut `notification_settings` tablosuna scheduler ve retry alanları otomatik eklenir.

Yeni tablo:

```text
alarm_automation_scheduler_runs
```

Escalation teslimat durumlarına:

```text
dead_letter
```

durumu eklenmiştir.
