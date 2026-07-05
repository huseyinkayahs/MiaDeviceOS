# MiaDeviceOS v1.9 Field Reliability Layer

## Amaç

Field Reliability Layer, cihazın sahadaki kararlılığını izlemek için eklendi.

Bu katman cihaz sadece çalışıyor mu diye bakmaz; bağlantı kalitesi, kopma geçmişi, aktif sorun ve genel güvenilirlik puanı gibi bilgileri de takip eder.

## Eklenen Dosyalar

```text
include/field_reliability_context.h
include/field_reliability_manager.h
src/field_reliability_manager.cpp
```

## Yeni Komut

MQTT command topic:

```text
mia/site01/laser01/command
```

Payload:

```json
{
  "command": "get_reliability",
  "request_id": "rel-001"
}
```

## Örnek Cevap

```json
{
  "device_id": "laser01",
  "request_id": "rel-001",
  "command": "get_reliability",
  "status": "done",
  "message": "Field reliability returned",
  "firmware_version": "2.0.0",
  "field_reliability": {
    "status": "ALARM",
    "issue": "ALARM_ACTIVE",
    "score": 95,
    "wifi_connected": true,
    "mqtt_connected": true,
    "wifi_drop_events": 0,
    "mqtt_drop_events": 0,
    "wifi_offline_ms": 0,
    "mqtt_offline_ms": 0,
    "warning_count": 0
  }
}
```

## Status Değerleri

```text
OK        -> Cihaz normal durumda
ALARM     -> Cihaz çalışıyor ama alarm aktif
DEGRADED  -> Cihaz çalışıyor ama bir kalite sorunu var
OFFLINE   -> WiFi bağlantısı yok
OTA       -> OTA güncelleme devam ediyor
STARTING  -> Cihaz yeni açılıyor
```

## Issue Değerleri

```text
NONE
STARTUP
ALARM_ACTIVE
WIFI_OFFLINE
MQTT_OFFLINE
LOW_HEAP
WATCHDOG_SETUP_FAILED
OTA_IN_PROGRESS
```

## Reliability Score

Cihaz 100 üzerinden bir güvenilirlik puanı üretir.

Örnek düşüşler:

```text
WiFi offline       -50
MQTT offline       -25
Low heap warning   -10
Watchdog problem   -10
Alarm active        -5
Drop events         -1 each, max -10
```

## Diagnostics Entegrasyonu

`get_diagnostics` çıktısına şu bölüm eklendi:

```json
"field_reliability": {
  "status": "ALARM",
  "issue": "ALARM_ACTIVE",
  "score": 95,
  "wifi_drop_events": 0,
  "mqtt_drop_events": 0,
  "wifi_offline_ms": 0,
  "mqtt_offline_ms": 0,
  "warning_count": 0
}
```

## Health Entegrasyonu

`get_health` çıktısına şu alanlar eklendi:

```text
field_reliability_status
field_reliability_issue
field_reliability_score
```

## Heartbeat Entegrasyonu

Heartbeat payload içine şu alanlar eklendi:

```text
field_reliability_status
field_reliability_issue
field_reliability_score
wifi_drop_events
mqtt_drop_events
```

## Bilinen Durumlar

- Gerçek sensör henüz bağlı değil; alarm hâlâ simulated current üzerinden oluşuyor.
- WiFi/MQTT kopma testleri ileride saha ortamında ayrıca yapılacak.
- Bu sprintte amaç saha güvenilirlik bilgisini merkezi olarak görünür hale getirmektir.
