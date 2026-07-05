# n8n Daily Report Payload

## Amaç

FactoryBox One cihazından gelen günlük çalışma verisini n8n içinde rapora dönüştürmek.

İlk hedef Telegram / WhatsApp benzeri kısa günlük özet mesajıdır.

---

## Komut

n8n gün sonunda cihaza şu MQTT komutunu gönderir:

```json
{
  "command": "get_daily_summary",
  "request_id": "daily-report-001"
}
```

Topic:

```text
mia/site01/laser01/command
```

---

## Örnek Cevap

```json
{
  "device_id": "laser01",
  "command": "get_daily_summary",
  "status": "done",
  "firmware_version": "2.2.0",
  "daily_summary": {
    "date_source": "uptime_day",
    "machine_state": "RUNNING",
    "runtime_sec": 28800,
    "stop_sec": 3600,
    "runtime_min": 480,
    "stop_min": 60,
    "utilization_pct": 88,
    "state_change_count": 12,
    "longest_run_sec": 7200,
    "longest_stop_sec": 900,
    "report_ready_for_n8n": true
  },
  "ai_report_hint": {
    "language": "tr",
    "audience": "workshop_owner",
    "message_type": "daily_factorybox_summary"
  }
}
```

---

## Örnek Günlük Mesaj

```text
Günaydın Hüseyin.

Dünkü makine özeti:

✔️ Toplam çalışma: 8 saat 00 dakika
✔️ Toplam duruş: 1 saat 00 dakika
✔️ Kullanım oranı: %88
✔️ Durum değişimi: 12 kez
✔️ En uzun duruş: 15 dakika

Genel durum iyi görünüyor.
```

---

## n8n Akış Taslağı

```text
Cron Trigger
↓
MQTT Publish -> get_daily_summary
↓
MQTT Trigger / Response topic dinleme
↓
Function Node -> süreleri saat/dakikaya çevir
↓
AI Node -> doğal dil özet
↓
Telegram / WhatsApp gönder
```

---

## Not

Bu sürümde tarih bilgisi gerçek takvim değildir. `uptime_day` bazlıdır.

Gerçek günlük rapor için ileride NTP veya dashboard tarafında tarih eşleştirme yapılmalıdır.
