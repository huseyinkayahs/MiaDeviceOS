# MiaDeviceOS / FactoryBox One v3.6 Sprint

## Sprint Adı

v3.6 SmartAI Daily Report From Database

---

## Amaç

Bu sprintin amacı, v3.5.1 ile PostgreSQL'e akmaya başlayan FactoryBox verilerini okuyarak günlük üretim raporu oluşturan ilk SmartAI katmanını başlatmaktır.

Bu sprint ile sistem şu seviyeye çıkar:

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
Günlük üretim raporu
↓
Dashboard / API
```

---

## Eklenen Endpoint

```text
GET /api/machines/:code/ai/daily-report
```

Örnek:

```text
http://localhost:3100/api/machines/laser01/ai/daily-report
```

---

## Dashboard Ekleri

Dashboard içine yeni alan eklendi:

```text
SmartAI Günlük Üretim Raporu
Sistem skoru
Özet
Bulgular
Öneriler
```

Dashboard adresi:

```text
http://localhost:3100
```

---

## SmartAI Motoru

Bu sprintte gerçek dış servis AI kullanılmadı.

Kullanılan yapı:

```text
SmartAI Local Rule Engine
```

Bu motor PostgreSQL'den şu verileri okur:

```text
latest machine state
latest telemetry
daily machine summary
recent alarms
son telemetry örnekleri
son alarm kayıtları
```

Sonra bunlardan rapor üretir:

```text
health_score
summary
findings
recommendations
raw analysis data
```

---

## Health Score Mantığı

Başlangıç skoru:

```text
100
```

Düşüren durumlar:

```text
Düşük utilization
Aktif alarm
Yüksek sıcaklık
Zayıf WiFi RSSI
```

Sonuç:

```text
0 - 100 arası sistem skoru
```

---

## Rapor Kaydetme Mantığı

Dashboard refresh sırasında rapor otomatik kaydedilmez.

Veritabanına kayıt denemesi için:

```text
/api/machines/laser01/ai/daily-report?save=true
```

Eğer `ai_reports` tablosu uyumluysa rapor kaydedilir.
Uygun değilse API yine raporu döndürür ve kayıt nedenini belirtir.

---

## v3.5.1 Hotfix Korundu

Bu paket içinde alarm duplicate düzeltmesi de korunmuştur.

Kontrol kelimesi:

```text
existingActiveAlarm
```

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değişmedi
Gerçek OpenAI API entegrasyonu yapılmadı
Kullanıcı bazlı rapor geçmişi ekranı yapılmadı
PDF rapor export yapılmadı
E-posta / Telegram otomatik rapor gönderimi yapılmadı
```

---

## Sonraki Sprint Önerisi

```text
v3.7 SmartAI Report History + Telegram Daily Report
```

Amaç:

```text
Üretilen SmartAI raporlarını veritabanında düzenli saklamak
Gün sonunda Telegram'a otomatik üretim raporu göndermek
Dashboard'da geçmiş raporları listelemek
```

Alternatif:

```text
v3.7 Backend Hardening
```

Amaç:

```text
API standardizasyonu
log yapısı
.env güvenliği
error handling
production servis yapısı
```

---

## Sonuç

v3.6 ile FactoryBox artık sadece veri toplayan bir sistem değil, veriyi yorumlamaya başlayan bir platform haline gelmiştir.

Bu sprint Mia BusinessOS vizyonundaki SmartAI katmanının ilk çalışan versiyonudur.
