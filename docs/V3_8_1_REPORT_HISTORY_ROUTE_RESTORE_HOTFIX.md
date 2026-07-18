
# MiaDeviceOS / FactoryBox One v3.8.1 Hotfix

## Hotfix Adı

v3.8.1 SmartAI Report History Route Restore Hotfix

---

## Amaç

v3.8 paketinden sonra oluşan eksik API route sorununu düzeltmek ve SmartAI rapor geçmişi özelliğini sağlam backend dosyası üzerinde çalışır hale getirmek.

---

## Sorun

v3.8 denemesinde şu hata görüldü:

```text
Cannot GET /api/health
```

Bu, `server.js` içinde ana API route'larının eksik kaldığını gösterdi.

---

## Çözüm

v3.7.0 tam çalışan backend dosyası baz alındı ve üzerine v3.8 rapor geçmişi özellikleri tekrar eklendi.

Korunan ana route'lar:

```text
/api/health
/api/machines
/api/machines/laser01/status
/api/machines/laser01/telemetry/latest
/api/machines/laser01/daily-summary
/api/machines/laser01/alarms
/api/machines/laser01/events
/api/machines/laser01/ai/daily-report
/api/machines/laser01/ai/daily-report/telegram
```

Eklenen yeni route'lar:

```text
/api/machines/laser01/ai/reports
/api/machines/laser01/ai/reports/latest
```

---

## Rapor Kayıt Düzeltmesi

`save_to_database` artık doğru şema ile çalışır.

Beklenen sonuç:

```text
saved_to_database.saved: true
report_id dolu
```

---

## Değişen Dosyalar

```text
platform/backend/server.js
platform/backend/package.json
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/database/migrations/003_ai_reports_history.sql

KURULUM_V3_8_1.txt
docs/V3_8_1_REPORT_HISTORY_ROUTE_RESTORE_HOTFIX.md
```

---

## Sonuç

v3.8.1 ile hem eski backend API route'ları korunur hem de SmartAI report history özelliği çalışır hale gelir.
