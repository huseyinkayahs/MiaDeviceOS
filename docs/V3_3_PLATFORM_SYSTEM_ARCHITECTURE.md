# MiaDeviceOS / FactoryBox One v3.3 Sprint

## Sprint Adı
v3.3 Platform System Architecture

## Amaç
FactoryBox One cihazını tekil bir ESP32 / MQTT projesi olmaktan çıkarıp, uzun vadeli Mia BusinessOS / FactoryBox Platform mimarisine bağlamak.

Bu sprintte firmware veya dashboard kodu yazılmayacak. Amaç; sistemin müşteri, fabrika, makine, cihaz, sensör, veri tabanı, backend, dashboard, n8n, SmartAI ve SmartVision katmanlarını kağıt üzerinde netleştirmektir.

---

## Neden Bu Sprint Gerekli?

v3.1 ve v3.2.1 ile gerçek donanım tarafında iki önemli eşik geçildi:

```text
v3.1   → DS18B20 gerçek sıcaklık sensörü çalıştı
v3.2.1 → PC817 optokuplör ile gerçek DI1 RUN / STOP testi çalıştı
```

Artık cihaz tarafı temel olarak kanıtlandı.

Bundan sonra sistemi büyütmek için şu soruların cevabı net olmalı:

```text
Birden fazla müşteri nasıl yönetilecek?
Bir müşterinin birden fazla fabrikası nasıl tutulacak?
Her fabrikadaki makineler nasıl modellenecek?
Her makineye bağlı cihazlar ve sensörler nasıl takip edilecek?
MQTT topic standardı nasıl olacak?
Veriler hangi tablolara yazılacak?
Dashboard veriyi nereden okuyacak?
n8n hangi olayları işleyecek?
SmartAI hangi verilere erişecek?
SmartVision kamera modülü ileride sisteme nasıl bağlanacak?
```

---

## Büyük Sistem Görünümü

Genel mimari:

```text
FactoryBox Edge Cihazları
        ↓
MQTT Broker
        ↓
Ingestion / Backend API
        ↓
PostgreSQL Veri Tabanı
        ↓
SmartDashboard
        ↓
SmartFlows / n8n
        ↓
SmartAI
        ↓
Telegram / WhatsApp / E-posta / Raporlar
```

SmartVision eklendiğinde:

```text
Kamera
  ↓
SmartVision Edge
  ↓
Görüntü Analizi Sonucu
  ↓
MQTT / Backend
  ↓
PostgreSQL + SmartAI + Dashboard
```

---

## Platform Modülleri

### 1. FactoryBox Core

Makine yanında çalışan fiziksel cihazdır.

Görevleri:

```text
RUN / STOP takibi
DI1 / dijital giriş okuma
Sıcaklık ölçümü
Akım / enerji ölçümü
Alarm üretimi
Heartbeat gönderimi
Diagnostics gönderimi
OTA güncelleme
Uzaktan config alma
MQTT ile haberleşme
```

---

### 2. MiaDeviceOS

FactoryBox cihazının firmware / cihaz işletim sistemi katmanıdır.

Mevcut özellikler:

```text
MQTT Command Engine
Remote Config
Heartbeat
Alarm System
Telemetry
OTA
BLE Service Mode
Diagnostics
Watchdog
Boot Diagnostics
Field Reliability
Machine Runtime Tracker
Digital Input Driver
DS18B20 Temperature Sensor
Live DI1 Updates
```

---

### 3. SmartFlows

n8n tabanlı otomasyon paketleridir.

Örnek akışlar:

```text
Günlük çalışma raporu
Makine uzun duruş uyarısı
Aynı duruş için tek uyarı
Makine tekrar çalıştı bildirimi
Aşırı sıcaklık uyarısı
Cihaz offline uyarısı
Haftalık performans raporu
Bakım hatırlatma akışı
```

---

### 4. SmartDashboard

Kullanıcı ve servis panelidir.

İlk aşamada iki panel mantığı olacak:

```text
Müşteri Paneli
- Makineleri görür
- RUN / STOP durumunu izler
- Günlük çalışma süresini görür
- Alarmları ve raporları takip eder

Yönetici / Servis Paneli
- Müşterileri görür
- Cihazları yönetir
- Firmware sürümünü takip eder
- Online / offline durumunu izler
- Config ve diagnostics işlemlerini yapar
```

---

### 5. SmartAI

Toplanan verileri yorumlayan yapay zekâ katmanıdır.

İlk görevleri:

```text
Günlük yönetici özeti
Haftalık performans yorumu
Duruş nedenleri için olası açıklama
Makine karşılaştırması
Sıcaklık / duruş ilişkisi yorumu
Anomali tespiti için ilk analizler
```

Temel prensip:

```text
Kesin kurallar alarm üretir.
Yapay zekâ yorum ve öneri üretir.
```

---

### 6. SmartVision

Kamera ve görüntü analizi modülüdür.

İlk kullanım alanları:

```text
Makine ışığı rengi algılama
Ürün / parça sayma
Alan doluluk / boşluk kontrolü
Basit kalite kontrol
Ürün akışı durdu mu kontrolü
```

Mimari prensip:

```text
Görüntü yerelde analiz edilir.
Buluta sadece sonuç gönderilir.
```

Örnek MQTT çıktısı:

```json
{
  "customer_id": "mia",
  "site_id": "site01",
  "machine_id": "laser01",
  "vision_event": "part_count",
  "count": 124,
  "confidence": 0.92,
  "timestamp": "2026-07-15T14:30:00"
}
```

---

## Veri Modeli

İlk PostgreSQL tablo taslağı aşağıdaki gibi düşünülür.

### customers

```text
id
name
status
created_at
```

Müşteri / işletme bilgisi.

---

### sites

```text
id
customer_id
name
location
created_at
```

Bir müşterinin bir veya daha fazla üretim lokasyonu olabilir.

---

### machines

```text
id
site_id
name
machine_type
status
created_at
```

Örnek:

```text
laser01
cnc01
compressor01
injection01
```

---

### devices

```text
id
machine_id
device_id
model
firmware_version
hardware_revision
last_seen_at
status
created_at
```

FactoryBox cihazları burada tutulur.

---

### sensors

```text
id
device_id
sensor_type
name
unit
status
created_at
```

Örnek sensörler:

```text
temperature
current
digital_input
vision_count
energy
```

---

### telemetry_events

```text
id
device_id
machine_id
timestamp
current
temperature
wifi_rssi
uptime_ms
raw_payload
```

Düzenli gelen cihaz verileri.

---

### machine_state_events

```text
id
machine_id
device_id
state
source
started_at
ended_at
duration_sec
raw_payload
```

RUNNING / STOPPED olayları burada tutulur.

---

### alarms

```text
id
machine_id
device_id
alarm_type
severity
status
started_at
cleared_at
message
raw_payload
```

Örnek alarm türleri:

```text
OVER_CURRENT
OVER_TEMPERATURE
LONG_STOP
DEVICE_OFFLINE
LOW_HEAP
```

---

### daily_machine_summaries

```text
id
machine_id
date
runtime_sec
stop_sec
observed_sec
utilization_pct
longest_run_sec
longest_stop_sec
run_start_count
stop_start_count
created_at
```

Günlük rapor için ana tablo.

---

### vision_events

```text
id
machine_id
camera_id
event_type
value
confidence
timestamp
raw_payload
```

SmartVision sonuçları burada tutulur.

Örnek event_type:

```text
part_count
machine_light_status
object_detected
quality_warning
no_product_flow
```

---

### workflow_events

```text
id
workflow_name
machine_id
event_type
status
created_at
raw_payload
```

n8n / SmartFlows kayıtları.

---

### ai_reports

```text
id
customer_id
site_id
machine_id
report_type
period_start
period_end
summary_text
model_name
created_at
source_data_ref
```

SmartAI tarafından üretilen raporlar.

---

## MQTT Topic Standardı

Mevcut yapı:

```text
mia/site01/laser01/command
mia/site01/laser01/command/status
```

Platform için önerilen standart:

```text
business/{customer_id}/{site_id}/{machine_id}/{device_id}/telemetry
business/{customer_id}/{site_id}/{machine_id}/{device_id}/heartbeat
business/{customer_id}/{site_id}/{machine_id}/{device_id}/alarm
business/{customer_id}/{site_id}/{machine_id}/{device_id}/command
business/{customer_id}/{site_id}/{machine_id}/{device_id}/command/status
business/{customer_id}/{site_id}/{machine_id}/{device_id}/machine/status
business/{customer_id}/{site_id}/{machine_id}/{device_id}/digital_inputs/status
business/{customer_id}/{site_id}/{machine_id}/{device_id}/vision/status
```

Pilot için mevcut topic korunabilir. Platform geçişinde yeni standart kullanılacak.

---

## Backend API Taslağı

İlk backend API şu endpoint’leri desteklemeli:

```text
GET  /api/customers
GET  /api/sites
GET  /api/machines
GET  /api/devices
GET  /api/machines/{id}/status
GET  /api/machines/{id}/daily-summary
GET  /api/machines/{id}/alarms
GET  /api/devices/{id}/diagnostics
POST /api/devices/{id}/commands
GET  /api/reports/daily
POST /api/ai/query
```

Dashboard doğrudan MQTT’ye bağlı kalabilir; fakat uzun vadede veriyi backend API üzerinden okumalıdır.

---

## Veri Akışı

### Canlı Makine Durumu

```text
FactoryBox
↓
MQTT machine/status
↓
Backend ingestion
↓
PostgreSQL machine_state_events
↓
SmartDashboard canlı durum
↓
SmartFlows alarm kontrolü
```

---

### Günlük Rapor

```text
FactoryBox get_daily_summary
↓
MQTT command/status
↓
n8n / Backend
↓
daily_machine_summaries
↓
SmartAI yorum
↓
Telegram / Dashboard / E-posta
```

---

### SmartVision Olayı

```text
Kamera
↓
SmartVision Edge
↓
vision/status MQTT
↓
Backend
↓
vision_events
↓
SmartAI günlük rapora ekler
```

---

## AI Veri Erişim Modeli

SmartAI doğrudan ham verinin tamamına sınırsız erişmemeli.

İlk aşamada AI’ye şu özet veriler verilmeli:

```text
Günlük çalışma süresi
Günlük duruş süresi
En uzun duruş
Alarm sayısı
Sıcaklık ortalaması / maksimumu
Makine durum olayları
Vision event özetleri
Stok / satış / reklam verisi varsa özet
```

AI cevap üretirken kaynak metrikleri de gösterebilmeli.

Örnek AI çıktısı:

```text
Lazer-01 bugün 6 saat 12 dakika çalıştı.
Toplam duruş süresi 1 saat 18 dakika.
En uzun duruş 14:20–14:41 arasında gerçekleşti.
Kamera verisine göre bu duruş sırasında ürün akışı da kesilmiş.
Bu durum malzeme bekleme veya operatör müdahalesi kaynaklı olabilir.
```

---

## n8n / SmartFlows Konumu

n8n sistemin otomasyon motoru olarak konumlanacak.

n8n şu işleri yapabilir:

```text
MQTT event dinleme
Alarm kurallarını çalıştırma
Telegram / WhatsApp mesajı gönderme
Günlük rapor tetikleme
AI raporu oluşturma
Google Sheets / e-posta entegrasyonu
Muhasebe / reklam API entegrasyonu
```

n8n kritik gerçek zamanlı kararların tek noktası olmamalı. Kritik alarm kuralları cihaz veya backend tarafında da desteklenmeli.

---

## SmartDashboard Konumu

Mevcut SmartDashboard Lite pilot/test panelidir.

Platform mimarisinde iki aşama olacak:

### Aşama 1

```text
Lokal dashboard
MQTT üzerinden canlı izleme
Pilot kurulum kontrolü
```

### Aşama 2

```text
Bulut dashboard
Backend API üzerinden veri okuma
Çoklu müşteri
Çoklu makine
Kullanıcı yetkileri
Raporlar
AI soru-cevap
```

---

## SmartVision Genişleme Noktası

SmartVision ana sisteme üç noktadan bağlanacak:

```text
vision/status MQTT topic
vision_events PostgreSQL tablosu
SmartDashboard vision kartları
```

İlk SmartVision MVP:

```text
1 N100 mini PC
1-2 kamera
Makine ışığı algılama
Basit ürün sayma
MQTT’ye sonuç gönderme
Dashboard’da gösterme
AI günlük rapora dahil etme
```

---

## Güvenlik ve Yetkilendirme

İlk platform sürümünde şu kurallar olmalı:

```text
Her cihaz bir customer_id / site_id / machine_id ile eşleşmeli
MQTT topic erişimi müşteri bazlı ayrılmalı
Dashboard kullanıcıları rol bazlı yetkilendirilmeli
Cihaz komutları izin listesiyle sınırlandırılmalı
Restart / OTA / config değişiklikleri loglanmalı
AI sadece izin verilen özet verilere erişmeli
```

---

## Operasyonel Roller

### Owner / İşletme Sahibi

```text
Tüm makineleri görür
Raporları alır
AI’ye soru sorar
```

### Operator / Operatör

```text
Kendi makinesini görür
Duruş nedeni girebilir
```

### Service / Teknik Servis

```text
Diagnostics görür
Config günceller
Firmware durumunu takip eder
```

### Admin

```text
Müşteri, cihaz, abonelik ve sistem yönetimi yapar
```

---

## v3.4 İçin Önerilen Sonraki Sprint

```text
v3.4 Central Database and Data Model
```

Amaç:

```text
PostgreSQL veri tabanı tasarımı
İlk migration dosyaları
customers / sites / machines / devices tabloları
machine_state_events ve daily summaries tabloları
Backend için ilk veri modeli
```

---

## Sonuç

v3.3 Platform System Architecture sprinti ile FactoryBox One’ın büyük Mia BusinessOS platformuna nasıl bağlanacağı netleşir.

Bu sprintin sonucu:

```text
Tekil cihaz projesi → Modüler IoT + AI + SmartVision platformu
```

Bu mimari, sonraki geliştirmelerde dağılmayı engelleyecek ve yatırımcı / müşteri anlatımını güçlendirecektir.
