
# MiaDeviceOS / FactoryBox One v4.0 Sprint

## Sprint Adı

v4.0 Multi Machine Daily Report

---

## Amaç

Bu sprintin amacı, FactoryBox platformunu tek makine raporundan site/fabrika bazlı günlük yönetici raporuna taşımaktır.

---

## Yeni Akış

```text
Makine verileri
↓
Machine report center
↓
Site daily report engine
↓
Genel fabrika skoru
↓
Telegram yönetici raporu
↓
Dashboard multi-machine özet
```

---

## Yeni Backend Endpointleri

Site günlük rapor:

```text
GET /api/sites/site01/ai/daily-report
```

Telegram formatlı site raporu:

```text
GET /api/sites/site01/ai/daily-report/telegram
```

Kaydederek üretmek:

```text
GET /api/sites/site01/ai/daily-report/telegram?save=1
```

Mevcut report center endpointi korunur:

```text
GET /api/sites/site01/ai/report-center
```

---

## Rapor İçeriği

```text
site bilgisi
genel skor
toplam makine sayısı
çalışan makine sayısı
duruşta/bilinmeyen makine sayısı
aktif alarm toplamı
makine bazlı skor
bulgular
öneriler
Telegram metni
```

---

## Skor Mantığı

Makine skorunda öncelik:

```text
1) Son SmartAI makine raporu skoru varsa onu kullan
2) Yoksa state / alarm / telemetry / RSSI üzerinden tahmini skor üret
```

Site skoru:

```text
makine skorlarının ortalaması
```

---

## Dashboard Güncellemesi

Dashboard’a yeni alan eklendi:

```text
Multi-Machine Günlük Yönetici Raporu
```

Gösterilenler:

```text
Genel Fabrika Skoru
Çalışan / toplam makine
Aktif alarm
Makine bazlı özet
Bulgular
Öneriler
Telegram önizleme
```

---

## n8n Workflow

Yeni workflow taslağı:

```text
FactoryBox - Multi Machine Daily Telegram Report
```

Dosya:

```text
platform/n8n/workflows/FactoryBox_Multi_Machine_Daily_Telegram_Report.json
```

Akış:

```text
Daily 18:05
↓
Get Site Daily Report
↓
Send Site Telegram Report
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/database/migrations/005_site_daily_report_indexes.sql
platform/n8n/workflows/FactoryBox_Multi_Machine_Daily_Telegram_Report.json
KURULUM_V4_0.txt
docs/V4_0_MULTI_MACHINE_DAILY_REPORT.md
```

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değişmedi
OpenAI API entegrasyonu yapılmadı
PDF export yapılmadı
E-posta raporu yapılmadı
Gerçek çoklu fiziksel makine testi yapılmadı
Kullanıcı yetkilendirme yapılmadı
```

---

## Sonuç

v4.0 ile FactoryBox tek makine analizinden fabrika/site bazlı yönetici raporuna geçer.
