
# MiaDeviceOS / FactoryBox One v4.2 Sprint

## Sprint Adı

v4.2 Smart Report Automation Pack

---

## Amaç

Bu sprintin amacı, v4.0 ile hazırlanan multi-machine site raporunu otomasyon ve geçmiş yönetimi seviyesine çıkarmaktır.

---

## Birleştirilen Sprintler

Bu sprintte üç iş birleştirildi:

```text
1) Multi Machine Telegram Automation
2) Site Report History / kayıt iyileştirme
3) Dashboard’dan rapor üret + kaydet butonu
```

---

## Yeni Backend Endpointleri

Site rapor geçmişi:

```text
GET /api/sites/site01/ai/reports
```

Son site raporu:

```text
GET /api/sites/site01/ai/reports/latest
```

Site rapor detayı:

```text
GET /api/sites/site01/ai/reports/:id
```

Mevcut site raporu kayıt endpointi kullanılmaya devam eder:

```text
GET /api/sites/site01/ai/daily-report/telegram?save=1
```

---

## Dashboard Güncellemesi

Dashboard’a yeni bölüm eklendi:

```text
Site Rapor Otomasyonu
```

Bu bölümde:

```text
Site Raporu Oluştur + Kaydet butonu
Son site raporu
Site rapor geçmişi
Site rapor detayı
```

yer alır.

---

## n8n Workflow

Yeni workflow dosyası:

```text
platform/n8n/workflows/FactoryBox_Smart_Report_Automation_Pack.json
```

Workflow akışı:

```text
Daily 18:05
↓
Get Site Daily Telegram Report
↓
Send Site Telegram Report
```

HTTP node:

```text
http://host.docker.internal:3100/api/sites/site01/ai/daily-report/telegram?save=1
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/database/migrations/007_smart_report_automation_pack.sql
platform/n8n/workflows/FactoryBox_Smart_Report_Automation_Pack.json
KURULUM_V4_2.txt
docs/V4_2_SMART_REPORT_AUTOMATION_PACK.md
```

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değiştirilmedi
PDF export yapılmadı
OpenAI API entegrasyonu yapılmadı
Kullanıcı yetkilendirme yapılmadı
Gerçek ikinci fiziksel makine eklenmedi
```

---

## Sonuç

v4.2 ile FactoryBox artık site/fabrika raporunu dashboard’dan oluşturup kaydedebilen ve n8n üzerinden otomatik Telegram raporuna hazır hale gelen bir platform seviyesine ulaşır.
