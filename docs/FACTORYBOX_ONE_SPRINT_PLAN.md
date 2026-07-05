# FactoryBox One Sprint Plan

## v2.1 Product Definition
Durum: Başlatıldı

Amaç:
FactoryBox One ürün kapsamını netleştirmek.

Çıktı:
`docs/FACTORYBOX_ONE_PRODUCT_DEFINITION.md`

---

## v2.2 Machine State Manager

Amaç:
Makine durumunu takip edecek ana yazılım katmanını eklemek.

Durumlar:

```text
RUNNING
STOPPED
UNKNOWN
ALARM
```

Beklenen çıktılar:

```text
get_machine_state komutu
machine/state MQTT mesajı
machine/event MQTT mesajı
runtime başlangıç altyapısı
```

---

## v2.3 Runtime Counter

Amaç:
Günlük çalışma ve duruş sürelerini hesaplamak.

Beklenen çıktılar:

```text
runtime_today_sec
downtime_today_sec
last_run_duration_sec
last_stop_duration_sec
get_runtime_summary komutu
```

---

## v2.4 SmartFlows Runtime Report

Amaç:
n8n üzerinden günlük üretim raporu oluşturmak.

Beklenen çıktılar:

```text
Telegram günlük rapor
WhatsApp hazırlığı
Makine durdu / çalıştı bildirimi
Basit AI yorum metni
```

---

## v2.5 Pilot Installation Plan

Amaç:
İlk saha prototipini kendi lazer makinesine bağlama planını hazırlamak.

Beklenen çıktılar:

```text
Kablo bağlantı planı
Kutu yerleşim planı
Güç besleme planı
Test checklist
Risk listesi
```
