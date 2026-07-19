
# MiaDeviceOS / FactoryBox One v4.1 Sprint

## Sprint Adı

v4.1 Device Info Sync

---

## Amaç

Bu sprintin amacı, veritabanındaki device bilgisini gerçek MQTT / cihaz payloadlarından gelen bilgilerle senkronize etmektir.

v4.0 testinde multi-machine API içinde eski demo firmware bilgisi görünmüştü:

```text
firmware_version: 3.2.0
```

Bu sprint, bu alanın artık cihazdan gelen gerçek bilgiyle güncellenebilmesi için altyapı kurar.

---

## Eklenen Backend Özellikleri

### Device Info Schema

devices tablosuna aşağıdaki alanlar eklendi:

```text
platform_name
build_type
firmware_build
raw_device_info
```

---

### MQTT Device Info Sync

Backend artık MQTT payloadlarında şu alanları yakalar:

```text
firmware_version
firmwareVersion
model
device_model
platform_name
build_type
firmware_build
device_uid
device_id
```

Bu bilgiler şu mesajlardan gelebilir:

```text
heartbeat
telemetry
machine/status
digital_inputs/status
command/status
unhandled MQTT message
```

---

## Yeni API Endpointleri

Makine üzerinden device info:

```text
GET /api/machines/laser01/device-info
```

Device UID üzerinden device info:

```text
GET /api/devices/laser01/info
```

---

## Dashboard Güncellemesi

Dashboard’a yeni kart eklendi:

```text
Device Info
```

Gösterilen bilgiler:

```text
Device UID
Model
Firmware
Platform
Build Type
Status
Son Görülme
```

---

## Multi-Machine Report Center Güncellemesi

`/api/sites/site01/ai/report-center` artık device içinde şu alanları da döndürür:

```text
platform_name
build_type
firmware_build
raw_device_info
```

---

## Değişen Dosyalar

```text
platform/backend/package.json
platform/backend/server.js
platform/backend/public/app.js
platform/backend/public/index.html
platform/backend/public/styles.css
platform/database/migrations/006_device_info_sync.sql
KURULUM_V4_1.txt
docs/V4_1_DEVICE_INFO_SYNC.md
```

---

## Test Planı

```text
http://localhost:3100/api/health
```

Beklenen:

```text
version: 4.1.0
```

Device info:

```text
http://localhost:3100/api/machines/laser01/device-info
```

Dashboard:

```text
http://localhost:3100
```

Beklenen yeni kart:

```text
Device Info
```

---

## Not

Firmware bilgisinin güncellenmesi için cihazdan firmware_version içeren bir MQTT payload gelmelidir. Eğer payload içinde bu alan yoksa mevcut veritabanı değeri korunur.

---

## Sonuç

v4.1 ile FactoryBox, device bilgisini yalnızca demo seed verisinden değil gerçek cihaz mesajlarından besleyebilecek seviyeye gelir.
