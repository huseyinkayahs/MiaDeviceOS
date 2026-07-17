
# MiaDeviceOS / FactoryBox One v3.7 Sprint

## Sprint Adı

v3.7 SmartAI Telegram Daily Report

---

## Amaç

Bu sprintin amacı, v3.6.4 ile çalışan SmartAI günlük raporunu Telegram'a gönderilebilir bir rapor formatına dönüştürmek ve n8n üzerinden otomatik günlük gönderim akışını hazırlamaktır.

Bu sprint ile veri akışı şu hale gelir:

```text
FactoryBox cihaz verisi
↓
MQTT
↓
Platform Backend
↓
PostgreSQL
↓
SmartAI Local Rule Engine
↓
Telegram mesaj formatı
↓
n8n
↓
Telegram
```

---

## Eklenen Backend Endpoint

Yeni endpoint:

```text
GET /api/machines/:machineCode/ai/daily-report/telegram
```

Örnek:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report/telegram
```

Opsiyonel kayıt:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report/telegram?save=1
```

---

## Endpoint Çıktısı

Beklenen JSON alanları:

```text
status
ai_engine
version
machine_code
saved_to_database
telegram_text
report
```

---

## Telegram Mesaj Formatı

Mesaj şu başlıkları içerir:

```text
🏭 FactoryBox SmartAI Günlük Üretim Raporu
Makine
Skor
Özet
Durum
Runtime
Stop
Utilization
Son Telemetry
Bulgular
Öneriler
Rapor zamanı
```

---

## n8n Workflow

Eklenen workflow dosyası:

```text
platform/n8n/workflows/FactoryBox_SmartAI_Daily_Telegram_Report.json
```

Workflow yapısı:

```text
Daily 18:00
↓
Get SmartAI Telegram Report
↓
Send Telegram Report
```

---

## n8n Backend URL Notu

n8n Docker içinde çalışıyorsa:

```text
http://host.docker.internal:3100/api/machines/laser01/ai/daily-report/telegram?save=1
```

n8n lokal Windows üzerinde çalışıyorsa:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report/telegram?save=1
```

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değişmedi
Gerçek OpenAI API entegrasyonu yapılmadı
PDF rapor export yapılmadı
E-posta raporu yapılmadı
Çoklu makine raporu yapılmadı
Kullanıcı yetkilendirme yapılmadı
```

---

## Sonraki Sprint Önerisi

```text
v3.8 SmartAI Report History
```

Amaç:

```text
Üretilen raporları ai_reports tablosunda kalıcı saklamak
Dashboard'da geçmiş raporları listelemek
Raporları tarihe göre filtrelemek
```

---

## Sonuç

v3.7 ile SmartAI raporu sadece dashboard içinde görülen bir çıktı olmaktan çıkıp, operatöre / işletme sahibine otomatik gönderilebilen günlük üretim raporuna dönüşür.
