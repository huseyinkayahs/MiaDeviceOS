# FactoryBox One Sprint Plan

## v2.1 Product Definition
Durum: Tamamlandı

Amaç:
FactoryBox One ürün kapsamını netleştirmek.

Çıktılar:

```text
docs/FACTORYBOX_ONE_PRODUCT_DEFINITION.md
docs/SMARTBOX_PLATFORM_VISION.md
docs/FACTORYBOX_ONE_SPRINT_PLAN.md
```

---

## v2.2 FactoryBox One MVP Core
Durum: Başlatıldı

Bu sprintte daha önce ayrı planlanan bazı sprintler tek pakette toplandı.

Kapsam:

```text
Machine Runtime Tracker
RUNNING / STOPPED state takibi
Daily runtime counter
Daily stop counter
machine/status MQTT mesajı
get_machine_runtime komutu
get_daily_summary komutu
set_machine_state test komutu
reset_machine_runtime test komutu
n8n daily report payload dokümanı
Pilot installation plan dokümanı
```

Amaç:
Cihazı ilk ürün mantığına geçirmek.

Bu sprintten sonra FactoryBox One şu sorulara cevap verebilir:

```text
Makine çalışıyor mu?
Makine duruyor mu?
Bugün kaç saniye çalıştı?
Bugün kaç saniye durdu?
Günlük rapor için veri hazır mı?
```

---

## v2.3 SmartFlows Daily Report

Amaç:
n8n üzerinden günlük üretim raporu oluşturmak.

Beklenen çıktılar:

```text
Cron trigger
MQTT get_daily_summary isteği
Telegram günlük rapor
WhatsApp hazırlığı
Basit AI yorum metni
```

---

## v2.4 Pilot Hardware Planning

Amaç:
İlk saha prototipini kendi lazer makinesine bağlama planını hazırlamak.

Beklenen çıktılar:

```text
Kablo bağlantı planı
Kutu yerleşim planı
Güç besleme planı
Giriş/çıkış planı
Risk listesi
```

---

## Sensör Hazır Olduğunda

```text
Real Sensor Driver
Sensor Calibration
Field Sensor Test
```
