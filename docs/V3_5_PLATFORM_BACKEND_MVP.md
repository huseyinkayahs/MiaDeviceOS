# MiaDeviceOS / FactoryBox One v3.5 Sprint

## Sprint Adı
v3.5 Platform Backend MVP

## Amaç
v3.5, v3.6 ve v3.7 kapsamlarını birleştirerek FactoryBox cihazından gelen MQTT mesajlarını dinleyen, PostgreSQL’e kayıt atan, REST API sunan ve basit bir platform dashboard ekranı gösteren ilk backend MVP’yi oluşturmak.

Bu sprintin sonunda sistem şu akışa geçer:

```text
ESP32 FactoryBox
↓
MQTT
↓
Platform Backend
↓
PostgreSQL
↓
REST API
↓
Platform Dashboard
```

---

## Neden Birleştirildi?

Ayrı ayrı planlanan sprintler:

```text
v3.5 Backend Ingestion Service
v3.6 Backend API
v3.7 Dashboard Database Integration
```

tek sprintte birleştirildi.

Sebep:

```text
Veri akışını uçtan uca daha hızlı görmek
Backend ve veritabanını aynı anda test etmek
Dashboard’u anlık MQTT izleme ekranından platform API ekranına taşımak
Sistemin gerçek platform omurgasını hızlandırmak
```

---

## Bu Sprintte Eklenenler

```text
platform/backend/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── server.js
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

---

## Backend Görevleri

```text
PostgreSQL’e bağlanır
Demo customer / site / machine / device kayıtlarını garanti eder
MQTT broker’a bağlanır
mia/site01/laser01/# topic’ini dinler
Telemetry mesajlarını telemetry_events tablosuna yazar
Heartbeat mesajlarından cihaz last_seen bilgisini günceller
Alarm mesajlarını alarms tablosuna yazar
Machine status mesajlarını machine_state_events tablosuna yazar
Command/status mesajlarını workflow_events tablosuna yazar
get_daily_summary cevabını daily_machine_summaries tablosuna yazar
get_temperature cevabını telemetry_events tablosuna yazar
Basit REST API sunar
Platform Dashboard MVP sayfasını servis eder
```

---

## Dinlenen MQTT Topic’leri

```text
mia/site01/laser01/telemetry
mia/site01/laser01/heartbeat
mia/site01/laser01/alarm
mia/site01/laser01/machine/status
mia/site01/laser01/digital_inputs/status
mia/site01/laser01/command/status
```

---

## REST API Endpointleri

```text
GET /api/health
GET /api/machines
GET /api/machines/laser01/status
GET /api/machines/laser01/telemetry/latest
GET /api/machines/laser01/daily-summary
GET /api/machines/laser01/alarms
GET /api/machines/laser01/events
```

---

## Platform Dashboard MVP

Adres:

```text
http://localhost:3100
```

Gösterilen alanlar:

```text
Backend durumu
MQTT bağlantı durumu
Son MQTT mesajı
Makine kodu
RUNNING / STOPPED durumu
Telemetry sıcaklık / akım / RSSI
Günlük runtime / stop / utilization
Son alarm kayıtları
API health JSON
```

---

## Mevcut SmartDashboard Lite Durumu

Bu sprintte mevcut SmartDashboard Lite bozulmadı.

```text
SmartDashboard Lite     → http://localhost:3000
Platform Backend MVP    → http://localhost:3100
```

---

## Sonraki Sprint Önerisi

```text
v3.6 Platform Backend Hardening
```

Alternatif:

```text
v3.6 SmartAI Daily Report From Database
```

---

## Sonuç

v3.5 Platform Backend MVP ile FactoryBox / Mia BusinessOS ilk kez uçtan uca platform veri akışına geçer.
