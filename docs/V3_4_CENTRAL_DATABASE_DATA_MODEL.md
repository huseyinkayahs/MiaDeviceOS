# MiaDeviceOS / FactoryBox One v3.4 Sprint

## Sprint Adı
v3.4 Central Database and Data Model

## Amaç
FactoryBox One cihazından gelen makine, sensör, alarm, günlük özet, SmartVision ve SmartAI verilerini uzun vadede saklayacak merkezi PostgreSQL veri tabanı modelini oluşturmak.

Bu sprintte ESP32 firmware’e dokunulmaz. Amaç; Mia BusinessOS / FactoryBox Platform için ilk kalıcı veri omurgasını kurmaktır.

---

## Neden Bu Sprint Gerekli?

v3.3 ile büyük sistem mimarisi kağıt üzerinde netleşti.

Artık şu ihtiyaç doğdu:

```text
Cihazdan gelen veriyi sadece MQTT üzerinde görmek yetmez.
Bu verinin platformda saklanması, sorgulanması, raporlanması ve AI tarafından kullanılabilmesi gerekir.
```

Bu yüzden ilk merkezi veritabanı katmanı hazırlanır.

---

## Sistem İçindeki Yeri

Genel akış:

```text
FactoryBox Edge Cihazı
        ↓
MQTT Broker
        ↓
Backend / Ingestion Service
        ↓
PostgreSQL
        ↓
SmartDashboard
        ↓
SmartFlows / n8n
        ↓
SmartAI
```

Bu sprintte sadece PostgreSQL katmanı hazırlanır.

---

## Bu Sprintte Eklenen Yapı

```text
platform/database/
├── docker-compose.yml
├── README.md
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_demo_seed.sql
└── queries/
    └── 001_basic_checks.sql
```

---

## PostgreSQL Servisleri

Docker Compose içinde iki servis tanımlandı:

```text
factorybox-postgres → PostgreSQL veri tabanı
factorybox-pgadmin  → PgAdmin web arayüzü
```

PostgreSQL bağlantı bilgileri:

```text
Host: localhost
Port: 5433
Database: factorybox
User: factorybox
Password: factorybox_dev_pass
```

PgAdmin:

```text
URL: http://localhost:5050
Email: admin@factorybox.local
Password: factorybox_admin
```

---

## İlk Veri Modeli

İlk migration dosyasında aşağıdaki tablolar oluşturuldu:

```text
customers
sites
machines
devices
sensors
telemetry_events
machine_state_events
alarms
daily_machine_summaries
vision_events
workflow_events
ai_reports
device_commands
```

---

## Tablo Açıklamaları

### customers

Müşteri veya işletme kaydıdır.

Örnek:

```text
Mia Demo
ABC Lazer
XYZ Mobilya
```

### sites

Müşteriye ait fabrika, atölye veya lokasyon bilgisidir.

Bir müşteri birden fazla site sahibi olabilir.

### machines

Fabrikadaki takip edilen makineleri temsil eder.

Örnek:

```text
laser01
cnc01
compressor01
injection01
```

### devices

Makineye bağlı FactoryBox cihazlarını temsil eder.

Cihazın şu bilgileri tutulur:

```text
device_uid
model
firmware_version
hardware_revision
mqtt_base_topic
last_seen_at
status
```

### sensors

Cihaza bağlı sensörlerin listesidir.

Örnek:

```text
DI1
DS18B20
current_sensor
vision_camera
energy_meter
```

### telemetry_events

Cihazdan düzenli gelen ölçüm verileridir.

Örnek alanlar:

```text
current_amp
temperature_c
wifi_rssi
uptime_ms
raw_payload
```

### machine_state_events

Makinenin RUNNING / STOPPED durum olaylarıdır.

Bu tablo ileride çalışma süresi ve duruş süresi analizlerinin temelidir.

### alarms

Cihaz veya sistem tarafından üretilen alarmlardır.

Örnek alarm tipleri:

```text
OVER_CURRENT
OVER_TEMPERATURE
LONG_STOP
DEVICE_OFFLINE
LOW_HEAP
```

### daily_machine_summaries

Günlük makine özetleri burada saklanır.

Örnek alanlar:

```text
runtime_sec
stop_sec
observed_sec
utilization_pct
longest_run_sec
longest_stop_sec
run_start_count
stop_start_count
```

### vision_events

SmartVision kamera sisteminden gelen sonuç olaylarıdır.

Örnek:

```text
part_count
machine_light_status
quality_warning
no_product_flow
```

Ham video değil, sadece analiz sonucu saklanır.

### workflow_events

n8n / SmartFlows çalışmaları ve otomasyon kayıtlarıdır.

Örnek:

```text
daily_report_sent
long_stop_alert_sent
temperature_alert_sent
```

### ai_reports

SmartAI tarafından üretilen rapor ve özetlerdir.

Örnek:

```text
daily_factory_summary
weekly_machine_performance
vision_analysis_summary
```

### device_commands

Backend veya dashboard üzerinden cihaza gönderilecek komutların izlenmesi için hazırlandı.

Örnek komutlar:

```text
get_config
get_diagnostics
restart
set_machine_input_source
get_temperature
```

---

## Demo Seed Verisi

002_demo_seed.sql dosyası ile demo kayıtları oluşturulur:

```text
Customer: Mia Demo
Site: site01
Machine: laser01
Device: laser01
Sensors:
- DI1
- DS18B20
```

Ayrıca örnek kayıtlar eklenir:

```text
telemetry event
machine state event
daily machine summary
vision event
alarm
ai report
```

Bu sayede veritabanı boş başlamaz ve temel sorgular hemen test edilebilir.

---

## Hazır Kontrol Sorguları

queries/001_basic_checks.sql dosyasında şu kontroller bulunur:

```text
müşteri listesi
makine listesi
cihaz listesi
son telemetry kayıtları
günlük özet
vision event
alarm kayıtları
AI raporları
```

---

## İlk View Yapıları

Migration içinde bazı yardımcı view’ler de oluşturuldu:

```text
v_machine_overview
v_latest_device_telemetry
v_latest_machine_state
```

Bunlar dashboard ve backend için ilk hızlı okuma noktalarıdır.

---

## Güvenlik Notu

Bu sprintte kullanılan kullanıcı adı ve şifreler sadece lokal geliştirme içindir.

Gerçek ürün ortamında:

```text
güçlü şifre
müşteri bazlı yetkilendirme
MQTT ACL
API token
rol bazlı erişim
yedekleme politikası
loglama
```

gereklidir.

---

## Bu Sprintte Yapılmayanlar

```text
ESP32 firmware değişmedi
MQTT ingestion servisi yazılmadı
Backend API yazılmadı
Dashboard backend’e bağlanmadı
Gerçek müşteri verisi eklenmedi
AI gerçek veritabanından çalıştırılmadı
```

---

## Sonraki Sprint Önerisi

```text
v3.5 Backend Ingestion Service
```

Amaç:

```text
MQTT command/status, telemetry, machine/status ve digital_inputs/status mesajlarını dinleyen küçük bir backend servisi yazmak.
Gelen mesajları PostgreSQL tablolarına kaydetmek.
```

Bu sayede cihazdan gelen canlı veri ilk kez kalıcı veritabanına yazılmış olur.

---

## Sonuç

v3.4 ile FactoryBox / Mia BusinessOS platformunun ilk merkezi veri tabanı omurgası oluşturuldu.

Bu sprint sonunda sistemin dönüşümü:

```text
MQTT üzerinde anlık veri
↓
PostgreSQL üzerinde kalıcı platform verisi
```

haline gelir.
