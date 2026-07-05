# FactoryBox One MVP Core

## Amaç

FactoryBox One ürününü ilk ticari MVP mantığına geçirmek.

Bu sürümde cihaz artık sadece alarm / diagnostics cihazı değildir. Makine çalışma-duruş takibi yapmaya başlar.

---

## İlk MVP Özellikleri

```text
1. Makine çalışıyor mu?
2. Makine durdu mu?
3. Günlük çalışma süresi
4. Günlük duruş süresi
5. MQTT machine/status yayını
6. n8n günlük rapor datası
```

---

## MVP Dışında Bırakılanlar

Bu sprintte bilerek eklenmeyenler:

```text
Gerçek sensör driver
Kalibrasyon
Dashboard
WhatsApp canlı entegrasyon
Modbus
Ethernet
Çoklu makine desteği
```

Sebep: Önce sade ama çalışan ürün çekirdeği kurulmalıdır.

---

## Yeni Firmware Sürümü

```text
MiaDeviceOS v2.2.0
```

---

## Yeni Dosyalar

```text
include/machine_runtime_context.h
include/machine_runtime_manager.h
src/machine_runtime_manager.cpp
docs/MACHINE_RUNTIME_TRACKER.md
docs/FACTORYBOX_ONE_MVP_CORE.md
docs/N8N_DAILY_REPORT_PAYLOAD.md
docs/PILOT_INSTALLATION_PLAN.md
```

---

## Yeni MQTT Topic

```text
mia/site01/laser01/machine/status
```

---

## Yeni Komutlar

```text
get_machine_runtime
get_daily_summary
set_machine_state
reset_machine_runtime
```

---

## Test Planı

```text
Build
Upload
get_machine_runtime
set_machine_state STOPPED
set_machine_state RUNNING
get_daily_summary
set_machine_state AUTO
get_diagnostics
get_health
commit / push
```
