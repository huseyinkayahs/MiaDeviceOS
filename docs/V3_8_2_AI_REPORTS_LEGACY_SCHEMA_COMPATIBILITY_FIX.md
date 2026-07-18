
# MiaDeviceOS / FactoryBox One v3.8.2 Hotfix

## Hotfix Adı

v3.8.2 ai_reports Legacy Schema Compatibility Fix

---

## Amaç

SmartAI report history kayıt sırasında eski veritabanı şemasından gelen `summary_text NOT NULL` hatasını düzeltmek.

---

## Sorun

v3.8.1 testinde şu hata alındı:

```text
null value in column "summary_text" of relation "ai_reports" violates not-null constraint
```

Bu, önceki demo / seed / eski migration kaynaklı `ai_reports` tablosunda `summary_text` kolonunun `NOT NULL` kalmasından kaynaklandı.

---

## Çözüm

Backend schema uyumluluk fonksiyonu güncellendi.

Yeni davranış:

```text
summary_text kolonu eklenir / korunur
report_text kolonu eklenir / korunur
summary_text NOT NULL kaldırılır
report_text NOT NULL kaldırılır
boş summary_text alanları doldurulur
boş summary alanları doldurulur
```

Kayıt sırasında artık şu alanlar birlikte doldurulur:

```text
summary
summary_text
report_text
telegram_text
report_json
raw_payload
```

---

## Değişen Dosyalar

```text
platform/backend/server.js
platform/backend/package.json
platform/database/migrations/003_ai_reports_history.sql

KURULUM_V3_8_2.txt
docs/V3_8_2_AI_REPORTS_LEGACY_SCHEMA_COMPATIBILITY_FIX.md
```

---

## Test

```text
http://localhost:3100/api/machines/laser01/ai/daily-report/telegram?save=1
```

Beklenen sonuç:

```text
saved_to_database.saved: true
report_id dolu
```

---

## Sonuç

v3.8.2 ile SmartAI raporları eski ve yeni `ai_reports` tablo şemalarıyla uyumlu şekilde kalıcı kaydedilebilir hale gelir.
