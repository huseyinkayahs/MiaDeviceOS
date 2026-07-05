git statusgit status# FactoryBox One Product Definition

## Sprint
v2.1 FactoryBox One Product Definition

## Amaç
MiaDeviceOS altyapısını ilk ticari ürüne dönüştürmek.

Bu dokümanın amacı, ilk ürünün ne yapacağını netleştirmek ve sonraki yazılım / donanım sprintlerine yön vermektir.

---

## Üst Vizyon

MiaDeviceOS tek bir cihaz değil, uzun vadede bir endüstriyel otomasyon platformunun çekirdeğidir.

Platform bileşenleri:

```text
SmartBox Core      → Veri toplama cihazı
SmartFlows         → Hazır n8n otomasyon paketleri
SmartAI            → AI analiz ve doğal dilde raporlama
SmartVision        → Kamera ile sayım ve kalite kontrol
SmartDashboard     → Web / mobil yönetim paneli
```

İlk ticari ürün:

```text
FactoryBox One
```

---

## İlk Hedef Sektör

İlk hedef sektör tek tutulacaktır:

```text
Lazer kesim ve CNC atölyeleri
```

Neden bu sektör?

```text
Süreçler biliniyor
Saha dili biliniyor
İlk prototip kendi iş yerinde test edilebilir
Referans oluşturmak kolaydır
Makine çalışma / duruş bilgisi müşteriye hızlı değer sağlar
```

Sonraki olası sektörler:

```text
Plastik enjeksiyon
Mobilya üreticileri
Küçük ve orta ölçekli üretim atölyeleri
```

---

## Ürün Adı

```text
FactoryBox One
```

Tanım:

```text
Üretim makinelerinin çalışma / duruş bilgisini toplayan, bu veriyi n8n otomasyonlarına aktaran ve günlük rapor üreten akıllı saha kutusu.
```

Kısa satış cümlesi:

```text
Makineniz çalışıyor mu, durdu mu, bugün kaç saat üretim yaptı? FactoryBox One bunu sizin yerinize takip eder.
```

---

## İlk Versiyon Kapsamı

İlk versiyonda sadece 4 temel özellik olacaktır:

```text
1. Makine çalışıyor mu?
2. Makine durdu mu?
3. Günlük çalışma süresi
4. WhatsApp / Telegram bildirimi
```

Bu sınır özellikle korunacaktır.

Amaç:

```text
Çalışan, kurulabilir ve müşteriye net değer veren ilk ürün çıkarmak.
```

---

## İlk Donanım Hedefi

FactoryBox One donanım hedefi:

```text
ESP32 tabanlı ana kontrolcü
Wi-Fi
Ethernet hazırlığı
4 dijital giriş
2 röle çıkışı
2 analog giriş
Modbus hazırlığı
24V DC güç girişi
Durum LED'i
Servis bağlantısı
```

Not:
İlk saha prototipinde tüm donanım özellikleri fiziksel olarak hazır olmak zorunda değildir. Ancak yazılım mimarisi bu yöne göre düzenlenecektir.

---

## İlk Ölçülecek Veri

Minimum veri modeli:

```text
device_id
machine_id
machine_state
state_changed_at
runtime_today_sec
downtime_today_sec
last_run_duration_sec
last_stop_duration_sec
wifi_connected
mqtt_connected
health_status
reliability_score
```

Makine durumları:

```text
RUNNING
STOPPED
UNKNOWN
ALARM
```

---

## İlk MQTT Topic Yapısı

Mevcut MiaDeviceOS topic yapısı korunacaktır.

Önerilen FactoryBox topicleri:

```text
factorybox/site01/machine01/telemetry
factorybox/site01/machine01/state
factorybox/site01/machine01/event
factorybox/site01/machine01/heartbeat
factorybox/site01/machine01/command
factorybox/site01/machine01/command/status
factorybox/site01/machine01/config
factorybox/site01/machine01/config/status
```

Geçiş notu:
İlk aşamada mevcut `mia/site01/laser01/...` topicleri kullanılmaya devam edebilir. FactoryBox topic yapısına geçiş ayrı sprintte yapılmalıdır.

---

## n8n SmartFlows

İlk SmartFlow paketi:

```text
SmartFlows - Machine Runtime Basic
```

İlk akışlar:

```text
Makine durdu bildirimi
Makine tekrar çalıştı bildirimi
Gün sonu çalışma süresi raporu
Sabah önceki gün özeti
Basit reliability uyarısı
```

İlk bildirim kanalları:

```text
Telegram
WhatsApp hazırlığı
```

---

## Günlük Rapor Örneği

```text
Günaydın Hüseyin.

Dün lazer makinesi toplam 8 saat 42 dakika çalıştı.

✔️ En uzun duruş: 16 dakika
✔️ Toplam duruş süresi: 1 saat 08 dakika
✔️ Makine önceki güne göre %12 daha az çalıştı
✔️ Bağlantı kopması görülmedi
✔️ Cihaz güvenilirlik skoru: 95/100

Tahmini yorum:
Üretim genel olarak stabil görünüyor. En uzun duruş öğleden sonra gerçekleşmiş. Operatör beklemesi veya iş hazırlık süresi olabilir.
```

---

## SmartAI Hedefi

İlk AI hedefi:

```text
Veriyi doğal dilde açıklamak.
```

Patron sorusu örneği:

```text
Bugün neden az üretim yaptık?
```

AI cevaplamak için şunlara bakacaktır:

```text
Çalışma süresi
Duruş süreleri
Geçmiş gün ortalaması
Bağlantı sağlığı
Alarm / issue bilgisi
Operatör notları, varsa
```

İlk aşamada AI karar vermez, sadece açıklayıcı rapor üretir.

---

## İlk Pilot Kurulum

Pilot yer:

```text
Kendi iş yerindeki lazer makinesi
```

Pilot hedefi:

```text
Makine durumunu güvenilir algılamak
Günlük çalışma süresini doğru hesaplamak
n8n üzerinden bildirim almak
Günlük rapor üretmek
```

Pilot başarı kriterleri:

```text
En az 7 gün kesintisiz veri toplama
Yanlış RUNNING / STOPPED algısının az olması
Günlük raporun anlaşılır olması
Cihazın reset / bağlantı sorunlarında kendini toparlaması
```

---

## Mevcut Altyapı Durumu

MiaDeviceOS v2.0.0 ile hazır olan altyapılar:

```text
MQTT Command Engine
Remote Config
Alarm System
Heartbeat
OTA
BLE Service Mode
BLE Security
Diagnostics
Runtime Log Level
Persistent Runtime Settings
Production Health Monitor
Watchdog
Boot Diagnostics
Field Reliability Layer
```

FactoryBox One için eksik olan ana yazılım katmanları:

```text
Machine State Manager
Runtime Counter
Digital Input Driver
Daily Report Data Model
FactoryBox topic standardı
n8n SmartFlow paketi
```

---

## Sonraki Sprint Önerisi

```text
v2.2 Machine State Manager
```

Amaç:

```text
Makine durumunu RUNNING / STOPPED olarak izlemek ve state change event üretmek.
```

İlk aşamada gerçek giriş yerine simüle giriş kullanılabilir.

